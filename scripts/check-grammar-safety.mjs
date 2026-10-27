// Diagnose the current grammar/moderation flow against a real local Worker and
// a simulated OpenAI server. Neutral canary sentences exercise the control flow;
// the grammar stub deliberately returns a correction. This diagnoses routing,
// not OpenAI's ability to classify real messages. No real API key,
// student data, browser tabs, or production storage are used.
// Run: node scripts/check-grammar-safety.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { library, missions } from '../worker/tests/fixtures/season-1.mjs';

const root = path.join(import.meta.dirname, '..');
const scratch = path.join(root, '.wrangler', 'grammar-safety');
fs.mkdirSync(scratch, { recursive: true });
const state = fs.mkdtempSync(path.join(scratch, 'run-'));
const reportPath = path.join(scratch, 'report.json');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const cases = [
    { name: 'Clean control', mode: 'clean' },
    { name: 'Flagged control', mode: 'flagged' },
    { name: 'Local sexual block, API clean', mode: 'local', text: 'i suck dick like a proffesional' },
    { name: 'Local disguised sexual block', mode: 'local', text: 'suck d1ck' },
    { name: 'HTTP 500', mode: 'http', status: 500 },
    { name: 'HTTP 429', mode: 'http', status: 429 },
    { name: 'HTTP 401', mode: 'http', status: 401 },
    { name: 'Invalid JSON', mode: 'invalid-json' },
    { name: 'Empty results', mode: 'empty' },
    { name: 'Missing flagged field', mode: 'malformed' },
    { name: 'Connection closed', mode: 'disconnect' },
    { name: 'Moderation over 3 seconds', mode: 'timeout' },
    { name: 'Hint after browser deadline', mode: 'slow-clean', grammarDelay: 1600 },
];
const byText = new Map(cases.map((item, index) => {
    item.text ??= `She go to school for lesson ${index + 1}`;
    item.calls = [];
    return [item.text, item];
}));
const simulated = http.createServer(async (req, res) => {
    try {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        const text = body.input ?? JSON.parse(body.messages?.[1]?.content ?? '{}').message;
        const item = byText.get(text);
        assert.ok(item, 'Only this diagnostic canary may reach the simulated API');
        item.calls.push(req.url);
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/moderations') {
            if (item.mode === 'disconnect') return req.socket.destroy();
            if (item.mode === 'timeout') await pause(3500);
            if (item.mode === 'slow-clean') await pause(2700);
            if (res.destroyed) return;
            if (item.mode === 'http') { res.statusCode = item.status; return res.end('{}'); }
            if (item.mode === 'invalid-json') return res.end('{');
            if (item.mode === 'empty') return res.end(JSON.stringify({ results: [] }));
            if (item.mode === 'malformed') return res.end(JSON.stringify({ results: [{ categories: {} }] }));
            return res.end(JSON.stringify({ results: [{ flagged: item.mode === 'flagged', categories: { sexual: item.mode === 'flagged' } }] }));
        }
        if (req.url === '/v1/decisions') return res.end(JSON.stringify({ answers: [{ name: 'grammar_mistake', probability: 0.99 }] }));
        assert.equal(req.url, '/v1/chat/completions');
        if (item.grammarDelay) await pause(item.grammarDelay);
        if (!res.destroyed) res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
            ok: false, corrected: item.text.replace('She go ', 'She goes '), why: 'Use goes with she.',
        }) } }] }));
    } catch (error) {
        if (!res.destroyed) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); }
    }
});
await new Promise(resolve => simulated.listen(0, '127.0.0.1', resolve));
const reservation = net.createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const password = crypto.randomUUID();
const contentToken = crypto.randomUUID();
const vars = {
    CREATE_PASSWORD_HASH: crypto.createHash('sha256').update(password).digest('hex'),
    TESTER_MODE: '1', CONTENT_TOKEN: contentToken, PINPLAY_API_URL: '',
    LAN_URL: '', CLOUD_URL: '', MOVEMENT_CHECK: '0',
    OPENAI_API_KEY: 'simulation-only',
    OPENAI_BASE_URL: `http://127.0.0.1:${simulated.address().port}`,
    OPENAI_GRAMMAR_MODEL: 'simulated-grammar', OPENAI_GRAMMAR_GATE: '1',
};
const worker = spawn(process.execPath, [path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    'dev', '--local', '--port', String(port), '--inspector-port', '0', '--persist-to', state,
    '--show-interactive-dev-session=false',
    ...Object.entries(vars).flatMap(([key, value]) => ['--var', `${key}:${value}`]),
], { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = '';
worker.stdout.on('data', chunk => { log += chunk; });
worker.stderr.on('data', chunk => { log += chunk; });
let socket;
const results = [];
async function api(route, body, headers = {}) {
    const response = await fetch(base + route, { method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    const data = await response.json();
    assert.ok(response.ok, `${route}: ${response.status} ${JSON.stringify(data)}`);
    return data;
}
function connect(ticket) {
    socket = new WebSocket(`${base.replace('http', 'ws')}/api/plaza/ws?ticket=${ticket}`);
    const messages = [];
    const waiters = [];
    socket.onmessage = event => {
        if (event.data === 'pong') return;
        messages.push(JSON.parse(event.data));
        for (const waiter of [...waiters]) {
            const index = messages.findIndex(waiter.match);
            if (index < 0) continue;
            waiters.splice(waiters.indexOf(waiter), 1);
            clearTimeout(waiter.timer);
            waiter.resolve(messages.splice(index, 1)[0]);
        }
    };
    return match => new Promise((resolve, reject) => {
        const index = messages.findIndex(match);
        if (index >= 0) return resolve(messages.splice(index, 1)[0]);
        const waiter = { match, resolve, timer: setTimeout(() => {
            waiters.splice(waiters.indexOf(waiter), 1);
            reject(new Error('Timed out waiting for the local Worker'));
        }, 10000) };
        waiters.push(waiter);
    });
}
try {
    console.log('Starting an isolated Worker with a simulated OpenAI endpoint...');
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
        try { ready = (await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) })).ok; } catch { /* starting */ }
        if (ready) break;
        if (worker.exitCode !== null) break;
        await pause(250);
    }
    assert.ok(ready, 'Local Worker did not start; see .wrangler/grammar-safety/worker.log');
    await api('/api/content', { missions, library }, { 'x-content-token': contentToken });
    const { token } = await api('/api/teacher/login', { password });
    const auth = { 'x-teacher-session': token };
    const { pin } = await api('/api/teacher/game', { name: 'Grammar safety diagnostic', randomNames: false }, auth);
    await api('/api/teacher/mode', { mode: 'review' }, auth);
    const { ticket } = await api('/api/plaza/join', { pin, avatar: null }, { 'x-student-token': 'tester:Canary' });
    const next = connect(ticket);
    await next(message => message.t === 'welcome');
    for (const [index, item] of cases.entries()) {
        await pause(1600); // the real per-student grammar and chat rate limits
        const id = `safety-${index}`;
        socket.send(JSON.stringify({ t: 'attempt', id, source: 'chat', text: item.text }));
        await next(message => message.t === 'attempt-recorded' && message.id === id);
        const started = Date.now();
        socket.send(JSON.stringify({ t: 'check', id, attemptId: id, text: item.text }));
        const hint = await next(message => message.t === 'checked' && message.id === id);
        const elapsedMs = Date.now() - started;
        const { attempts } = await api('/api/teacher/attempts?studentKey=tester-canary', null, auth);
        const attempt = attempts.find(attempt => attempt.text === item.text);
        assert.ok(attempt, 'The teacher must retain the attempted message');
        const hintReturned = hint.ok === false;
        assert.equal(attempt.status === 'hint-offered', hintReturned, 'History agrees with the server hint result');
        const { lines } = await api('/api/teacher/conversations?studentKey=tester-canary', null, auth);
        assert.equal(lines.find(line => line.id === attempt.id)?.status, attempt.status, 'The drawer receives the recorded status');
        const status = await api('/api/teacher/status', null, auth);
        const incident = status.incidents.some(incident => incident.texts.includes(item.text));
        if (['flagged', 'local'].includes(item.mode)) {
            assert.equal(hintReturned, false, 'Flagged content must not receive a correction');
            assert.equal(item.calls.includes('/v1/chat/completions'), false);
            assert.equal(incident, true, 'Flagged content must reach the teacher');
        }
        const failure = !['clean', 'slow-clean', 'flagged', 'local'].includes(item.mode);
        if (failure) {
            assert.equal(hintReturned, false, 'No hint without a successful safety check');
            assert.equal(item.calls.includes('/v1/chat/completions'), false, 'Unavailable moderation must never reach grammar');
            assert.match(attempt.reason, /Safety check unavailable/);
        }
        if (item.mode === 'local') assert.deepEqual(item.calls, [], 'Local blocking must work without any AI call');
        if (item.mode === 'clean') assert.equal(hintReturned, true, 'Ordinary English still receives help');
        const result = { scenario: item.name, grammarCalled: item.calls.includes('/v1/chat/completions'),
            hintRecorded: hintReturned, withinBrowserDeadline: elapsedMs < 4000, teacherIncident: incident,
            historyStatus: attempt.status, elapsedMs };
        // Sending after the check must not publish an unchecked message automatically.
        socket.send(JSON.stringify({ t: 'chat', cid: id, attemptId: id, text: item.text }));
        const delivery = await next(message => (message.t === 'notice' || message.t === 'result') && message.cid === id);
        const afterSend = await api('/api/teacher/status', null, auth);
        const entry = afterSend.entries.find(entry => entry.text === item.text);
        if (failure) {
            assert.equal(entry, undefined, 'Failed automatic moderation must not create an approval queue');
            assert.equal(delivery.level, 'warning');
            assert.match(delivery.text, /not sent.*try again/i);
            const { attempts: after } = await api('/api/teacher/attempts?studentKey=tester-canary', null, auth);
            assert.equal(after.find(row => row.id === attempt.id)?.status, 'not-sent', 'The refused attempt remains auditable');
            result.sendStatus = 'not-sent';
            result.sendFlag = 'retry requested';
        } else {
            assert.ok(entry, `The send attempt must be retained: ${JSON.stringify(delivery)}`);
            result.sendStatus = entry.status;
            result.sendFlag = entry.flag;
            if (['flagged', 'local'].includes(item.mode)) assert.equal(entry.status, 'blocked');
        }
        results.push(result);
        console.log(`${item.name}: grammar=${result.grammarCalled}, hint=${hintReturned}, drawer=${attempt.status}, send=${result.sendStatus}, ${elapsedMs}ms`);
    }
    fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(),
        scope: 'Real local Worker and SQLite; synthetic examples; failures forced only on moderation; the grammar stub deliberately returns a correction. Not a classifier accuracy test.',
        results }, null, 2) + '\n');
    console.table(results);
    console.log(`Report: ${reportPath}`);
} finally {
    socket?.close();
    if (worker.exitCode === null) {
        await new Promise(resolve => {
            if (process.platform === 'win32') {
                const cleanup = spawn('taskkill', ['/pid', String(worker.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
                cleanup.once('exit', resolve); cleanup.once('error', () => { worker.kill(); resolve(); });
            } else { worker.once('exit', resolve); worker.kill('SIGTERM'); }
        });
    }
    simulated.closeAllConnections();
    await new Promise(resolve => simulated.close(resolve));
    fs.writeFileSync(path.join(scratch, 'worker.log'), log);
}
