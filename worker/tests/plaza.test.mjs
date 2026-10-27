// The whole flow against a real `wrangler dev`, with a fake PinPlay. The local
// Durable Object storage is kept between two runs to prove progress survives a
// restart (which is what a deploy is).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sha256Hex } from '../rules.ts';
import { voiceFor } from '../../shared/voices.ts';
import { castanyada, castanyadaComplete, castanyadaInvestigations, library, missions, sideQuests } from './fixtures/season-1.mjs';
import { FACTS } from '../../shared/warmup.ts';
import { IDENTITIES, identityById } from '../../shared/warmupKinds.ts';
import { defaultWarmup } from '../../shared/warmupConfig.ts';
import { missionEnvelope } from '../../shared/missionSchema.ts';
import { legalMove } from '../../shared/plazaMap.ts';
import { SIDE_QUEST_SOURCE } from '../../shared/sideQuests.ts';
import { getWorld } from '../../shared/themeCatalog.ts';

const root = path.join(import.meta.dirname, '..', '..');
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
let PIN = ''; // the teacher page shows it once the class is open
const PASSWORD = 'local test password';
const students = { 'signed-a': { studentKey: 'stu_a', displayName: 'Alex', className: '4B' },
    'signed-b': { studentKey: 'stu_b', displayName: 'Sam', className: '4B' },
    'signed-c': { studentKey: 'stu_c', displayName: 'Chris', className: '4B' },
    'roger-1': { studentKey: 'stu_r1', displayName: 'Roger Lopez Marti', className: '4B' },
    'roger-2': { studentKey: 'stu_r2', displayName: 'Roger Costa', className: '4B' },
    'roger-3': { studentKey: 'stu_r3', displayName: 'Roger Lluch', className: '4B' } };

// Windows can hold workerd's files a moment after it exits; a leftover temp
// folder must not hide the test's real result.
function removeTemp(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* left in temp */ }
}

async function freePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

function startPinPlay() {
    const server = http.createServer((req, res) => {
        res.setHeader('content-type', 'application/json');
        const student = students[req.headers['x-student-token']];
        if (req.url === '/api/student/config') {
            return res.end(JSON.stringify({ loginEnabled: true, googleClientId: 'client-id', allowedDomains: [] }));
        }
        if (req.url === '/api/student/me' && student) return res.end(JSON.stringify({ student }));
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Please sign in again.' }));
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Like the online server, a test server keeps missions and the side quest library as data. Each one gets the frozen
// copy of Season 1 and the library (fixtures/) through /api/content, unless `content` is false.
const CONTENT_TOKEN = 'test-content';
async function startPlaza(pinPlayUrl, persistTo, vars = {}, { content = true, port: fixed } = {}) {
    const port = fixed ?? await freePort();
    const child = spawn(process.execPath, [wrangler, 'dev', '--port', String(port), '--inspector-port', '0',
        '--persist-to', persistTo, '--show-interactive-dev-session=false',
        '--var', `CREATE_PASSWORD_HASH:${await sha256Hex(PASSWORD)}`,
        '--var', `PINPLAY_API_URL:${pinPlayUrl}`,
        // No OpenAI key unless a test brings its own: the one in .dev.vars must not change the results.
        ...Object.entries({ OPENAI_API_KEY: '', MOVEMENT_CHECK: '0', CONTENT_TOKEN, ...vars }).flatMap(([key, value]) => ['--var', `${key}:${value}`])], {
        cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let log = '';
    child.stdout.on('data', chunk => { log += chunk; });
    child.stderr.on('data', chunk => { log += chunk; });
    const base = `http://127.0.0.1:${port}`;
    const stop = () => new Promise(resolve => {
        if (child.exitCode !== null) return resolve();
        // wrangler runs workerd as a child process; take the whole tree down.
        // On Windows the parent can exit before taskkill finishes the workerd children;
        // wait for the tree cleanup too before a migration test opens its SQLite file.
        if (process.platform === 'win32') {
            const cleanup = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
            cleanup.once('exit', () => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
            cleanup.once('error', () => { child.once('exit', resolve); child.kill(); });
        } else { child.once('exit', resolve); child.kill('SIGTERM'); }
    });
    for (let attempt = 0; attempt < 120; attempt++) {
        let up = false;
        try { up = (await fetch(`${base}/api/health`)).ok; } catch { /* starting */ }
        if (up) {
            const loaded = content && await fetch(`${base}/api/content`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-content-token': CONTENT_TOKEN }, body: JSON.stringify({ missions, library }) });
            if (loaded && !loaded.ok) { await stop(); throw new Error(`Loading the test missions failed: ${await loaded.text()}`); }
            return { base, stop };
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    await stop();
    throw new Error(`wrangler dev did not start:\n${log}`);
}

async function api(base, route, { token, session, body } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (token) headers['x-student-token'] = token;
    if (session) headers['x-teacher-session'] = session;
    const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
}

function openSocket(base, ticket) {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/api/plaza/ws?ticket=${ticket}`);
    const inbox = [];
    const state = { quest: null };
    const waiters = [];
    const deliver = () => {
        for (const waiter of [...waiters]) {
            const index = inbox.findIndex(waiter.match);
            if (index < 0) continue;
            waiters.splice(waiters.indexOf(waiter), 1);
            clearTimeout(waiter.timer);
            waiter.resolve(inbox.splice(index, 1)[0]);
        }
    };
    ws.onmessage = event => { if (event.data !== 'pong') { const message = JSON.parse(event.data); if (message.t === 'quest') state.quest = message.quest;
        // Batched positions are checked as the single moves a student sees.
        if (message.t === 'moves') inbox.push(...message.moves.map(([id, x, y]) => ({ t: 'move', id, x, y }))); else inbox.push(message);
        deliver(); } };
    const closed = new Promise(resolve => { ws.onclose = event => resolve(event.code); });
    return {
        ws, closed, inbox, state,
        send: message => ws.send(JSON.stringify(message)),
        next: (match, what = 'a message') => new Promise((resolve, reject) => {
            const waiter = { match, resolve, timer: setTimeout(() => reject(new Error(`Timed out waiting for ${what}`)), 5000) };
            waiters.push(waiter);
            deliver();
        })
    };
}

async function enter(base, token, avatar) {
    const joined = await api(base, '/api/plaza/join', { token, body: { pin: PIN, avatar } });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    const socket = openSocket(base, joined.body.ticket);
    const welcome = await socket.next(message => message.t === 'welcome', 'welcome');
    return { ...socket, welcome, me: welcome.players.find(player => player.id === welcome.id) };
}

async function exchangeEvidence(teacher, investigator, witness, objective) {
    await new Promise(resolve => setTimeout(resolve, 1550)); // same rate limit as ordinary chat
    const clue = investigator.state.quest.clues.filter(c => c.from === 'job' || c.from === 'reward').at(-1).id;
    investigator.send({ t: 'interview-ask', objective, witness: witness.me.id, clue, text: 'What does your evidence tell us about this mystery?' });
    await investigator.next(m => m.t === 'notice' && /Sent to your teacher/.test(m.text), 'question submitted');
    const question = (await teacher('status')).body.entries.find(e => e.status === 'pending' && e.sender === investigator.me.name && e.note?.startsWith('Investigation:'));
    assert.ok(question, 'the question uses the moderation queue');
    await teacher('review', { id: question.id, approve: true });
    const received = (await witness.next(m => m.t === 'quest' && m.quest?.interviews?.some(i => i.incoming && i.objective === objective && i.questionStatus === 'approved' && !i.answerStatus), 'witness question')).quest.interviews.find(i => i.incoming && i.objective === objective && !i.answerStatus);
    await new Promise(resolve => setTimeout(resolve, 1550));
    witness.send({ t: 'interview-reply', id: received.id, clue: witness.state.quest.clues.filter(c => c.from === 'job' || c.from === 'reward').at(-1).id,
        text: 'My evidence helps explain what happened in the town.' });
    await witness.next(m => m.t === 'notice' && /Sent to your teacher/.test(m.text), 'reply submitted');
    const reply = (await teacher('status')).body.entries.find(e => e.status === 'pending' && e.sender === witness.me.name && e.note?.startsWith('Investigation:'));
    assert.ok(reply, 'the reply uses the moderation queue');
    const pending = (await investigator.next(m => m.t === 'quest' && m.quest?.interviews?.some(i => i.id === received.id && i.answerStatus === 'pending'), 'pending witness reply')).quest.interviews.find(i => i.id === received.id);
    assert.equal(pending.answer, null); assert.equal(pending.evidence, null, 'unapproved evidence stays private');
    await teacher('review', { id: reply.id, approve: true });
    await investigator.next(m => m.t === 'quest' && m.quest?.interviews?.some(i => i.id === received.id && i.answerStatus === 'approved'), 'approved evidence exchange');
    return { id: received.id, questionId: question.id, replyId: reply.id };
}

test('one AI help per student and classroom session, with durable usage, direct teacher help and safe failure', { timeout: 120000 }, async () => {
    const calls = []; let fail = false; let hold = null;
    const ai = http.createServer(async (req, res) => {
        let body = ''; for await (const chunk of req) body += chunk;
        calls.push(JSON.parse(body));
        const pause = hold; hold = null; if (pause) await pause();
        res.writeHead(fail ? 500 : 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tip: 'want' }) } }] }));
    });
    await new Promise(resolve => ai.listen(0, '127.0.0.1', resolve));
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-ai-help-'));
    const pinPlayUrl = `http://127.0.0.1:${pinPlay.address().port}`;
    const vars = { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${ai.address().port}` };
    let plaza = await startPlaza(pinPlayUrl, persistTo, vars); const sockets = [];
    try {
        let base = plaza.base;
        const session = (await api(base, '/api/teacher/login', { body: { password: PASSWORD } })).body.token;
        const teacher = (op, body) => api(base, `/api/teacher/${op}`, { session, body });
        PIN = (await teacher('class', { open: true })).body.pin;
        let alex = await enter(base, 'signed-a', null); sockets.push(alex);
        const sam = await enter(base, 'signed-b', null); sockets.push(sam);
        const first = (await alex.next(m => m.t === 'support')).support;
        assert.equal(first.ai.available, true);
        alex.send({ t: 'help-request', route: 'auto', topic: 'writing', text: 'I want tell...', attemptId: 'first-help' });
        const helped = (await alex.next(m => m.t === 'support' && m.support.ai?.used)).support;
        assert.match(helped.ai.tip, /want to/); assert.equal(calls.length, 1);
        assert.deepEqual(JSON.parse(calls[0].messages[1].content), { topic: 'writing', unfinishedMessageOrIntention: 'I want tell...' });
        let status = (await teacher('status')).body;
        assert.deepEqual(status.support.ai, { used: 1, students: 2 });
        assert.equal(status.support.alerts.length, 1, 'AI help alerts the teacher');
        assert.match(status.support.alerts[0].ai.tip, /want to/);
        alex.send({ t: 'help-request', route: 'auto', topic: 'writing', text: 'I still need help', attemptId: 'next-help', studentKey: 'stu_b', session: 'forged', used: false });
        await alex.next(m => m.t === 'support' && m.support.request);
        assert.equal(calls.length, 1, 'second request routes to teacher without an AI call');
        assert.equal((await teacher('status')).body.support.alerts.length, 1);
        sam.send({ t: 'help-request', route: 'teacher', topic: 'writing', text: 'Teacher please', attemptId: 'direct-help' });
        const direct = (await sam.next(m => m.t === 'support' && m.support.request)).support;
        assert.equal(direct.ai.used, false); assert.equal(calls.length, 1);

        let entered; let release;
        const started = new Promise(resolve => { entered = resolve; });
        const waiting = new Promise(resolve => { release = resolve; });
        hold = () => { entered(); return waiting; };
        sam.send({ t: 'help-request', route: 'auto', topic: 'writing', text: 'I want say...', attemptId: 'sam-ai' });
        await started;
        sam.send({ t: 'help-request', route: 'auto', topic: 'writing', text: 'Another request', attemptId: 'sam-concurrent' });
        await sam.next(m => m.t === 'support' && m.support.ai?.pending && m.support.request);
        assert.equal(calls.length, 2, 'concurrent requests cannot reserve another AI call');
        release(); await sam.next(m => m.t === 'support' && m.support.ai?.used);
        assert.deepEqual((await teacher('status')).body.support.ai, { used: 2, students: 2 });
        await teacher('class', { open: true });
        alex = await enter(base, 'signed-a', null); sockets.push(alex);
        assert.equal((await alex.next(m => m.t === 'support')).support.ai.used, true, 'rejoining and repeated teacher-open keep usage');

        for (const socket of sockets) socket.ws.close();
        await plaza.stop(); plaza = await startPlaza(pinPlayUrl, persistTo, vars); base = plaza.base;
        alex = await enter(base, 'signed-a', null); sockets.push(alex);
        assert.equal((await alex.next(m => m.t === 'support')).support.ai.used, true, 'usage survives a server restart');
        const chris = await enter(base, 'signed-c', null); sockets.push(chris);
        fail = true;
        chris.send({ t: 'help-request', route: 'auto', topic: 'writing', text: 'I want...', attemptId: 'failure' });
        const fallback = (await chris.next(m => m.t === 'support' && m.support.request && !m.support.ai?.pending)).support;
        assert.equal(fallback.ai.used, false); assert.equal(fallback.ai.available, true);
        assert.equal(calls.length, 3);
        assert.ok((await teacher('status')).body.support.alerts.some(a => a.studentKey === 'stu_c'));
        chris.send({ t: 'help-request', route: 'auto', topic: 'writing', text: 'Retry too soon', attemptId: 'quick-retry' });
        await chris.next(m => m.t === 'support' && m.support.request && !m.support.ai?.pending);
        assert.equal(calls.length, 3, 'failed-call cooldown bounds repeated spending');
        fail = false;
        await teacher('class', { open: false }); await teacher('class', { open: true });
        assert.deepEqual((await teacher('status')).body.support.ai, { used: 0, students: 0 });
        alex = await enter(base, 'signed-a', null); sockets.push(alex);
        const fresh = (await alex.next(m => m.t === 'support')).support.ai;
        assert.notEqual(fresh.session, first.ai.session); assert.equal(fresh.used, false); assert.equal(fresh.tip, null);
        alex.send({ t: 'help-request', route: 'auto', topic: 'writing', text: 'I want ask...', attemptId: 'new-session-help' });
        await alex.next(m => m.t === 'support' && m.support.ai?.used);
        assert.equal(calls.length, 4);
        assert.deepEqual((await teacher('status')).body.support.ai, { used: 1, students: 1 });
        const audit = (await teacher('attempts')).body.attempts;
        assert.ok(audit.some(a => a.status === 'ai-help' && a.text === 'I want ask...' && /want to/.test(a.reason)));
        await teacher('game', { name: 'Next class', randomNames: false });
        assert.deepEqual((await teacher('status')).body.support.ai, { used: 0, students: 0 });
    } finally {
        for (const socket of sockets) socket.ws.close(); await plaza.stop();
        await Promise.all([new Promise(resolve => pinPlay.close(resolve)), new Promise(resolve => ai.close(resolve))]); removeTemp(persistTo);
    }
});

test('chat speech uses persisted sender voices and only synthesizes messages delivered to the listener', { timeout: 120000 }, async () => {
    const requests = [];
    let holdResponse = null;
    const bridge = http.createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        requests.push({ body: JSON.parse(body), authorization: req.headers.authorization });
        const hold = holdResponse; holdResponse = null;
        if (hold) await hold();
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end('ID3-test-audio');
    });
    await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-speech-'));
    const pinPlayUrl = `http://127.0.0.1:${pinPlay.address().port}`;
    const vars = { EDGE_TTS_URL: `http://127.0.0.1:${bridge.address().port}/tts`, EDGE_TTS_SECRET: 'server-only-test-secret' };
    let plaza = await startPlaza(pinPlayUrl, persistTo, vars);
    const sockets = [];
    try {
        let base = plaza.base;
        const session = (await api(base, '/api/teacher/login', { body: { password: PASSWORD } })).body.token;
        const teacher = (op, body) => api(base, `/api/teacher/${op}`, { session, body });
        PIN = (await teacher('class', { open: true })).body.pin;
        const chosen = 'en-IE-EmilyNeural';
        const alex = await enter(base, 'signed-a', { voice: chosen }); sockets.push(alex);
        const sam = await enter(base, 'signed-b', null); sockets.push(sam);
        const chris = await enter(base, 'signed-c', null); sockets.push(chris);
        assert.equal(alex.me.voice, chosen);
        // Students who never chose a voice each get their own, not the same default.
        assert.deepEqual([sam.me.voice, chris.me.voice], [voiceFor('stu_b'), voiceFor('stu_c')]);
        assert.equal((await alex.next(m => m.t === 'support')).history, true, 'restored teacher history is marked quiet');
        chris.send({ t: 'move', x: 100, y: 100 });
        await new Promise(resolve => setTimeout(resolve, 250));
        const speech = (id, token = 'signed-b', extra = {}) => fetch(`${base}/api/plaza/speech`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-student-token': token }, body: JSON.stringify({ id, ...extra }),
        });
        const preview = voice => api(base, '/api/plaza/voice-preview', { token: 'signed-b', body: { voice } });
        const text = 'The basket is near the cellar.';
        alex.send({ t: 'chat', text });
        await alex.next(m => m.t === 'notice' && /approval/.test(m.text));
        const id = (await teacher('status')).body.entries.find(e => e.text === text).id;
        assert.equal((await speech(id)).status, 404, 'pending text cannot be voiced');
        assert.equal((await speech(id, 'forged')).status, 401);
        assert.equal((await preview('not-an-English-voice')).status, 400);
        assert.equal(requests.length, 0, 'denied calls never reach the speech service');
        await teacher('review', { id, approve: true });
        const delivered = await sam.next(m => m.t === 'chat' && m.id === id);
        assert.equal(delivered.voice, chosen);
        sam.send({ t: 'move', x: 100, y: 100 });
        chris.send({ t: 'move', x: alex.me.x, y: alex.me.y });
        await new Promise(resolve => setTimeout(resolve, 250));
        const audio = await speech(id, 'signed-b', { text: 'Forged replacement', voice: 'en-GB-RyanNeural' });
        assert.equal(audio.status, 200);
        assert.equal(audio.headers.get('Content-Type'), 'audio/mpeg');
        assert.match(audio.headers.get('Cache-Control'), /private.*no-store/);
        assert.equal(await audio.text(), 'ID3-test-audio');
        assert.deepEqual(requests.at(-1).body, { text, voice: chosen, rate: '+0%' });
        assert.equal(requests.at(-1).authorization, 'Bearer server-only-test-secret');
        assert.equal((await speech(id, 'signed-c')).status, 404, 'moving closer later cannot grant an unheard message');

        // Each clip a device fetches is listed for the teacher with who wrote it, so a phrase heard in the room leads to its speakers.
        let sound = (await teacher('status')).body.sound;
        assert.deepEqual(sound.plays.map(play => [play.studentKey, play.senderKey, play.id, play.text]), [['stu_b', 'stu_a', id, text]]);
        assert.ok(sound.now >= sound.plays[0].at);
        // Sound off for Sam: the device is told at once, and its speech and voice samples are refused until it is back on.
        assert.equal((await sam.next(m => m.t === 'sound', 'sound state on joining')).off, false);
        await teacher('sound', { studentKey: 'stu_b', off: true });
        assert.equal((await sam.next(m => m.t === 'sound', 'sound off')).off, true);
        const asked = requests.length;
        assert.equal((await speech(id)).status, 403);
        assert.equal((await preview(chosen)).status, 403);
        assert.equal(requests.length, asked, 'a silenced device never reaches the speech service');
        sound = (await teacher('status')).body.sound;
        assert.deepEqual(sound.off, ['stu_b']);
        assert.equal(sound.plays.length, 1, 'refused clips are not listed as played');
        await teacher('sound', { studentKey: 'stu_b', off: false });
        assert.equal((await sam.next(m => m.t === 'sound', 'sound back on')).off, false);
        assert.deepEqual((await teacher('status')).body.sound.off, []);

        const changed = await enter(base, 'signed-a', { voice: 'en-AU-NatashaNeural' }); sockets.push(changed);
        assert.equal((await api(base, '/api/student/me', { token: 'signed-a' })).body.avatar.voice, 'en-AU-NatashaNeural');
        assert.equal((await speech(id)).status, 200);
        assert.equal(requests.at(-1).body.voice, chosen, 'old chat keeps the voice chosen when sent');

        // A private message to the teacher is echoed only to its own author.
        sam.send({ t: 'chat', to: 'teacher', text: 'Can you help me write my idea?' });
        const ownHelp = await sam.next(m => m.t === 'chat' && m.to === 'Teacher');
        assert.equal((await speech(ownHelp.id)).status, 200);
        assert.equal(requests.at(-1).body.text, ownHelp.text);
        const own = (await teacher('status')).body.sound.plays[0];
        assert.deepEqual([own.studentKey, own.senderKey, own.id, own.text], ['stu_b', 'stu_b', ownHelp.id, ownHelp.text]);
        assert.equal((await speech(ownHelp.id, 'signed-a')).status, 404);
        await teacher('help-message', { studentKey: 'stu_b', text: 'Tell me your idea.' });
        const support = await sam.next(m => m.t === 'support' && m.support.messages.length);
        assert.notEqual(support.history, true, 'live teacher replies arrive immediately');
        const reply = `teacher:${support.support.messages.at(-1).id}`;
        assert.equal((await speech(reply)).status, 404, 'teacher help is excluded from speech');
        assert.equal((await speech(reply, 'signed-a')).status, 404);

        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        plaza = await startPlaza(pinPlayUrl, persistTo, vars); base = plaza.base;
        assert.equal((await speech(id)).status, 200, 'delivery permissions survive a restart');
        assert.equal(requests.at(-1).body.voice, chosen);
        let entered; let release;
        const bridgeEntered = new Promise(resolve => { entered = resolve; });
        const bridgeRelease = new Promise(resolve => { release = resolve; });
        holdResponse = () => { entered(); return bridgeRelease; };
        const inFlight = speech(id);
        await bridgeEntered;
        assert.equal((await teacher('review', { id, approve: false })).status, 200);
        release();
        assert.equal((await inFlight).status, 404, 'withdrawal during synthesis prevents returning the generated clip');
        const before = requests.length;
        assert.equal((await speech(id)).status, 404, 'a withdrawn message can no longer be voiced');
        assert.equal(requests.length, before);
        const oversized = await fetch(`${base}/api/plaza/speech`, { method: 'POST', body: JSON.stringify({ id: 'x'.repeat(2000) }) });
        assert.equal(oversized.status, 413);
        const sample = await fetch(`${base}/api/plaza/voice-preview`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-student-token': 'signed-b' },
            body: JSON.stringify({ voice: chosen, text: 'Never synthesize this arbitrary text.' }),
        });
        assert.equal(sample.status, 200); await sample.arrayBuffer();
        assert.equal(requests.at(-1).body.text, 'Hello! This is my voice in Pixel Plaza.');
        assert.equal(requests.at(-1).body.voice, chosen);
        const tried = (await teacher('status')).body.sound.plays[0];
        assert.deepEqual([tried.studentKey, tried.senderKey, tried.id, tried.text], ['stu_b', 'stu_b', null, 'Hello! This is my voice in Pixel Plaza.'], 'voice samples are listed too');
        await teacher('game', { name: 'Another game', randomNames: false });
        assert.equal((await speech(reply)).status, 404, 'private help from another game remains private');
        assert.equal((await speech(ownHelp.id)).status, 404);
    } finally {
        for (const socket of sockets) socket.ws.close(); await plaza.stop();
        await Promise.all([new Promise(resolve => pinPlay.close(resolve)), new Promise(resolve => bridge.close(resolve))]);
        removeTemp(persistTo);
    }
});

test('mute all student sound stops every player, blocks in-flight speech and persists until restored', { timeout: 120000 }, async () => {
    let calls = 0, entered, release;
    const bridgeEntered = new Promise(resolve => { entered = resolve; });
    const bridgeRelease = new Promise(resolve => { release = resolve; });
    const bridge = http.createServer(async (req, res) => {
        for await (const chunk of req) { void chunk; }
        calls++;
        if (calls === 1) { entered(); await bridgeRelease; }
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end('ID3-muted-test');
    });
    await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
    const pinPlay = await startPinPlay();
    const pinPlayUrl = `http://127.0.0.1:${pinPlay.address().port}`;
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-sound-all-'));
    const vars = { EDGE_TTS_URL: `http://127.0.0.1:${bridge.address().port}/tts` };
    let plaza = await startPlaza(pinPlayUrl, persistTo, vars);
    const sockets = [];
    try {
        let session = (await api(plaza.base, '/api/teacher/login', { body: { password: PASSWORD } })).body.token;
        const teacher = (op, body) => api(plaza.base, `/api/teacher/${op}`, { session, body });
        PIN = (await teacher('game', { name: 'Quiet class', randomNames: false })).body.pin;
        assert.equal((await teacher('status')).body.sound.allOff, false);
        assert.equal((await api(plaza.base, '/api/teacher/sound-all', { body: { off: true } })).status, 401);
        assert.equal((await api(plaza.base, '/api/teacher/sound-all', { token: 'signed-a', body: { off: true } })).status, 401);
        let alex = await enter(plaza.base, 'signed-a', null), sam = await enter(plaza.base, 'signed-b', null); sockets.push(alex, sam);
        assert.equal((await alex.next(m => m.t === 'sound')).off, false); assert.equal((await sam.next(m => m.t === 'sound')).off, false);
        await teacher('sound', { studentKey: 'stu_b', off: true }); assert.equal((await sam.next(m => m.t === 'sound')).off, true);
        const preview = token => fetch(`${plaza.base}/api/plaza/voice-preview`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-student-token': token }, body: JSON.stringify({ voice: 'en-IE-EmilyNeural' }) });
        const inFlight = preview('signed-a'); await bridgeEntered;
        assert.equal((await teacher('sound-all', { off: true })).status, 200);
        assert.equal((await alex.next(m => m.t === 'sound')).off, true); assert.equal((await sam.next(m => m.t === 'sound')).off, true);
        release(); assert.equal((await inFlight).status, 403, 'mute while synthesis is running prevents returning a voice clip');
        assert.equal((await preview('signed-a')).status, 403); assert.equal((await preview('signed-b')).status, 403);
        assert.equal(calls, 1, 'muted requests do not reach TTS');
        const speech = await api(plaza.base, '/api/plaza/speech', { token: 'signed-a', body: { id: 'any-message' } });
        assert.equal(speech.status, 403);
        const state = (await teacher('status')).body;
        assert.equal(state.sound.allOff, true); assert.deepEqual(state.sound.off, ['stu_b']); assert.deepEqual(state.muted, [], 'sound mute does not mute chat');
        await teacher('sound', { studentKey: 'stu_a', off: false });
        assert.equal((await alex.next(m => m.t === 'sound')).off, true, 'an individual sound-on cannot bypass the master lock');
        const chris = await enter(plaza.base, 'signed-c', null); sockets.push(chris);
        assert.equal((await chris.next(m => m.t === 'sound')).off, true, 'late arrivals inherit the lock');
        for (const socket of sockets) socket.ws.close(); await plaza.stop();
        plaza = await startPlaza(pinPlayUrl, persistTo, vars);
        session = (await api(plaza.base, '/api/teacher/login', { body: { password: PASSWORD } })).body.token;
        alex = await enter(plaza.base, 'signed-a', null); sam = await enter(plaza.base, 'signed-b', null); sockets.push(alex, sam);
        assert.equal((await teacher('status')).body.sound.allOff, true);
        assert.equal((await alex.next(m => m.t === 'sound')).off, true); assert.equal((await sam.next(m => m.t === 'sound')).off, true);
        alex.send({ t: 'chat', text: 'We can still chat.', to: sam.me.id });
        const notice = await alex.next(m => m.t === 'notice' && /approval/.test(m.text));
        await teacher('review', { id: notice.id, approve: true });
        assert.equal((await sam.next(m => m.t === 'chat' && m.id === notice.id)).text, 'We can still chat.');
        const restored = (await teacher('sound-all', { off: false })).body.sound;
        assert.equal(restored.allOff, false); assert.deepEqual(restored.off, ['stu_b']);
        assert.equal((await alex.next(m => m.t === 'sound')).off, false); assert.equal((await sam.next(m => m.t === 'sound')).off, true, 'individual sound lock stays in place');
        const audio = await preview('signed-a'); assert.equal(audio.status, 200); await audio.arrayBuffer();
        assert.equal((await preview('signed-b')).status, 403);
    } finally {
        release(); for (const socket of sockets) socket.ws.close(); await plaza.stop();
        await Promise.all([new Promise(resolve => pinPlay.close(resolve)), new Promise(resolve => bridge.close(resolve))]);
        removeTemp(persistTo);
    }
});

test('student assistance: blocked submissions, help requests, private replies and complete history persist', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-assistance-'));
    let plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    try {
        let base = plaza.base;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const teacher = (op, body) => api(base, `/api/teacher/${op}`, { session, body });
        const opened = (await teacher('game', { name: 'Student assistance', randomNames: false })).body;
        const gameId = opened.game.id; PIN = opened.pin;
        let alex = await enter(base, 'signed-a', null); const sam = await enter(base, 'signed-b', null); sockets.push(alex, sam);
        await alex.next(m => m.t === 'support', 'initial help state');
        const sync = async () => { alex.send({ t: 'emote', emote: '❓' }); await sam.next(m => m.t === 'emote', 'audit processed'); };
        for (let index = 0; index < 3; index++) {
            alex.send({ t: 'attempt', id: `word-block-${index}`, text: `Quero explicar a minha ideia ${index}`, source: 'chat' });
            alex.send({ t: 'attempt-outcome', id: `word-block-${index}`, status: 'language-blocked', reason: 'Quero was not recognised as an English word.' });
        }
        await sync();
        assert.ok(alex.inbox.some(m => m.t === 'attempt-recorded' && m.id === 'word-block-0' && m.kind === 'attempt'));
        assert.ok(alex.inbox.some(m => m.t === 'attempt-recorded' && m.id === 'word-block-0' && m.kind === 'attempt-outcome'));
        let status = (await teacher('status')).body;
        assert.equal(status.support.alerts.length, 1); assert.equal(status.support.alerts[0].kind, 'suggested');
        assert.equal(status.support.alerts[0].studentKey, 'stu_a'); assert.equal(status.support.alerts[0].evidence.length, 3);
        assert.equal((await api(base, '/api/teacher/attempts')).status, 401, 'students cannot read teacher history');
        let page = (await teacher(`attempts?studentKey=stu_a&gameId=${gameId}`)).body;
        assert.equal(page.attempts.length, 3); assert.ok(page.attempts.every(a => a.status === 'language-blocked' && a.text.startsWith('Quero')));
        sam.send({ t: 'attempt-outcome', id: 'word-block-0', status: 'language-blocked', reason: 'Forged student outcome.' });
        await sync();
        assert.ok(!(await teacher('attempts?studentKey=stu_a')).body.attempts.some(a => a.reason === 'Forged student outcome.'), 'client IDs are scoped to the sender');
        alex.send({ t: 'help-request', topic: 'instructions', text: 'No entiendo qué tengo que hacer.' });
        const requested = (await alex.next(m => m.t === 'support' && m.support.request?.topic === 'instructions', 'manual request')).support;
        status = (await teacher('status')).body;
        assert.equal(status.support.alerts.length, 1, 'manual help coalesces the existing suggestion');
        assert.equal(status.support.alerts[0].kind, 'requested'); assert.match(status.support.alerts[0].note, /No entiendo/);
        assert.equal((await teacher('help-status', { gameId: 'old-game', id: requested.request.id, status: 'acknowledged' })).status, 409);
        await teacher('help-status', { gameId, id: requested.request.id, status: 'acknowledged' });
        await alex.next(m => m.t === 'support' && m.support.request?.status === 'acknowledged', 'teacher acknowledged');
        await teacher('help-message', { gameId, studentKey: 'stu_a', text: 'Tell me your idea in your own words. I can help you write it in English.' });
        const assisted = (await alex.next(m => m.t === 'support' && m.support.messages.length === 1, 'private teacher reply')).support;
        assert.match(assisted.messages[0].text, /your own words/);
        assert.equal(sam.inbox.some(m => m.t === 'support' && m.support.messages.some(reply => reply.id === assisted.messages[0].id)), false, 'teacher help remains private');
        alex.send({ t: 'chat', cid: 'teacher-reply', to: 'teacher', text: 'Mi idea es hablar con el conductor.' });
        assert.equal((await alex.next(m => m.t === 'chat' && m.to === 'Teacher', 'student private reply')).text, 'Mi idea es hablar con el conductor.');
        await alex.next(m => m.t === 'result' && m.cid === 'teacher-reply');
        assert.equal(sam.inbox.some(m => m.t === 'chat' && m.text === 'Mi idea es hablar con el conductor.'), false);
        alex.send({ t: 'attempt', id: 'stale-class', gameId: 'deleted-game', source: 'chat', text: 'An old class draft must not enter a new class.' });
        await alex.next(m => m.t === 'attempt-recorded' && m.id === 'stale-class', 'stale queue acknowledged');
        assert.ok(!(await teacher('attempts?studentKey=stu_a')).body.attempts.some(a => a.text === 'An old class draft must not enter a new class.'));
        alex.send({ t: 'chat', cid: 'first-chat', text: 'Hello class!' });
        await alex.next(m => m.t === 'notice' && m.cid === 'first-chat' && /approval/.test(m.text));
        const chat = (await teacher('status')).body.entries.find(e => e.text === 'Hello class!');
        await teacher('review', { id: chat.id, approve: true });
        assert.equal((await teacher('attempts?studentKey=stu_a')).body.attempts.find(a => a.chatId === chat.id).status, 'approved');
        await teacher('review', { id: chat.id, approve: false });
        assert.equal((await teacher('attempts?studentKey=stu_a')).body.attempts.find(a => a.chatId === chat.id).status, 'removed');
        alex.send({ t: 'chat', cid: 'too-soon', text: 'Please help me with this sentence.' });
        await alex.next(m => m.t === 'notice' && m.cid === 'too-soon' && /wait/.test(m.text));
        assert.ok((await teacher('attempts?studentKey=stu_a')).body.attempts.some(a => a.text === 'Please help me with this sentence.' && a.status === 'rate-limited'));
        for (let index = 0; index < 605; index++) alex.send({ t: 'attempt', id: `history-${index}`, source: 'chat', text: `Submitted draft ${index}` });
        await sync();
        let cursor = null; const seen = new Set(); let count = 0;
        do {
            page = (await teacher(`attempts?studentKey=stu_a&gameId=${gameId}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)).body;
            assert.ok(Array.isArray(page.attempts));
            for (const attempt of page.attempts) { assert.equal(seen.has(attempt.id), false); seen.add(attempt.id); count++; }
            cursor = page.next;
        } while (cursor);
        assert.ok(count > 610, 'every record is accessible beyond the old 500-message cap');
        await teacher('help-status', { gameId, id: requested.request.id, status: 'resolved' });
        await alex.next(m => m.t === 'support' && m.support.request?.status === 'resolved', 'help completed');
        alex.send({ t: 'attempt-outcome', id: 'word-block-0', status: 'language-blocked', reason: 'Retrying an old signal cannot create another alert.' });
        await sync(); assert.equal((await teacher('status')).body.support.alerts.length, 0);
        for (const socket of sockets) socket.ws.close(); await plaza.stop();
        plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo); base = plaza.base;
        alex = await enter(base, 'signed-a', null); sockets.push(alex);
        const resumed = (await alex.next(m => m.t === 'support', 'persisted assistance')).support;
        assert.equal(resumed.request.status, 'resolved'); assert.equal(resumed.messages[0].id, assisted.messages[0].id);
        assert.equal((await teacher('attempts?studentKey=stu_a')).body.attempts.length, 50);
        assert.equal((await teacher('help-message', { gameId, studentKey: 'stu_b', text: 'I will help you when you return.' })).status, 200, 'offline students can receive help');
        await teacher('class', { open: false });
        const second = (await teacher('game', { name: 'Other class', randomNames: false })).body;
        assert.deepEqual((await teacher('attempts')).body.attempts, []);
        assert.equal((await teacher(`attempts?gameId=${gameId}`)).status, 409, 'stale game history requests cannot leak the new game');
        await teacher('game/delete', { game: gameId, confirm: true });
        assert.equal(second.game.id, (await teacher('status')).body.game.id);
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop(); await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('moderation in flight stays in its original game and retains the refused submission', { timeout: 120000 }, async () => {
    let release; let started;
    const checking = new Promise(resolve => { started = resolve; });
    const openai = http.createServer((req, res) => {
        req.resume();
        req.on('end', () => { release = () => { if (!res.destroyed) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ results: [{ flagged: false, categories: {} }] })); } }; started(); });
    });
    await new Promise(resolve => openai.listen(0, '127.0.0.1', resolve));
    const pinPlay = await startPinPlay(); const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-chat-isolation-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo, { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${openai.address().port}/v1` });
    const sockets = [];
    try {
        const base = plaza.base;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const teacher = (op, body) => api(base, `/api/teacher/${op}`, { session, body });
        const first = (await teacher('game', { name: 'Original class', randomNames: false })).body;
        PIN = first.pin;
        const alex = await enter(base, 'signed-a', null); sockets.push(alex);
        await teacher('mode', { mode: 'review' });
        alex.send({ t: 'chat', text: 'This message belongs to the original class.', cid: 'held-message' });
        await checking;
        const nextGame = (await teacher('game', { name: 'Other class', randomNames: false })).body;
        release(); PIN = nextGame.pin;
        const currentAlex = await enter(base, 'signed-a', null); const sam = await enter(base, 'signed-b', null); sockets.push(currentAlex, sam);
        await new Promise(resolve => setTimeout(resolve, 200));
        assert.deepEqual((await teacher('status')).body.entries, []);
        assert.equal(currentAlex.inbox.some(m => m.t === 'chat' && m.text === 'This message belongs to the original class.'), false);
        assert.equal(sam.inbox.some(m => m.t === 'chat' && m.text === 'This message belongs to the original class.'), false);
        await teacher('class', { open: true, game: first.game.id });
        const audit = (await teacher('attempts')).body.attempts.find(a => a.text === 'This message belongs to the original class.');
        assert.equal(audit.status, 'unavailable'); assert.match(audit.reason, /unavailable/);
    } finally {
        release?.(); for (const socket of sockets) socket.ws.close();
        await plaza.stop(); await new Promise(resolve => pinPlay.close(resolve)); await new Promise(resolve => openai.close(resolve)); removeTemp(persistTo);
    }
});

test('witness investigations block guesses and unrelated chat, keep evidence private and survive restart', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-interviews-'));
    let plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    try {
        let base = plaza.base;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const teacher = (op, body) => api(base, `/api/teacher/${op}`, { session, body });
        PIN = (await teacher('game', { name: 'Witness class', randomNames: false })).body.pin;
        let alex = await enter(base, 'signed-a', null); let sam = await enter(base, 'signed-b', null); let chris = await enter(base, 'signed-c', null);
        sockets.push(alex, sam, chris);
        await teacher('campaign', { op: 'start', campaign: castanyadaInvestigations.id });
        await alex.next(m => m.t === 'quest' && m.quest?.campaign.id === castanyadaInvestigations.id, 'witness campaign');
        assert.equal(alex.state.quest.objectives.find(o => o.id === 'where').conversation.required, 1);
        await teacher('campaign', { op: 'reset', confirm: true });
        const created = (await teacher('missions/create', { id: 'two-witnesses', source: castanyadaInvestigations.id })).body.draft;
        created.campaign.chapters[0].objectives.find(o => o.id === 'where').conversation.witnesses = 2;
        created.campaign.chapters[0].objectives.push({ id: 'paper-check', text: 'Compare two witnesses before reporting the delivery.', accept: [], kind: 'report', optional: true, board: {}, conversation: { witnesses: 2 } });
        const saved = await teacher('missions/save', { id: 'two-witnesses', version: created.version, envelope: missionEnvelope(created.campaign) }); assert.equal(saved.status, 200);
        assert.equal((await teacher('missions/publish', { id: 'two-witnesses', version: saved.body.draft.version })).status, 200);
        await teacher('campaign', { op: 'start', campaign: 'two-witnesses' });
        await alex.next(m => m.t === 'quest' && m.quest?.campaign.id === 'two-witnesses', 'two witness campaign');
        const answer = async () => { alex.send({ t: 'answer', objective: 'where', text: 'park' }); return alex.next(m => m.t === 'answered' && m.objective === 'where'); };
        assert.equal((await answer()).correct, false, 'guessing the right answer cannot bypass witnesses');
        alex.send({ t: 'chat', text: 'The blue box is in the park.' });
        await alex.next(m => m.t === 'notice' && /Sent to your teacher/.test(m.text));
        const unrelated = (await teacher('status')).body.entries.find(e => e.status === 'pending');
        await teacher('review', { id: unrelated.id, approve: true });
        assert.equal((await answer()).correct, false, 'an approved ordinary chat message does not count');
        alex.send({ t: 'interview-ask', objective: 'where', witness: alex.me.id, clue: 'made-up', text: 'What did you see?' });
        assert.match((await alex.next(m => m.t === 'notice' && /Choose a classmate/.test(m.text))).text, /classmate/);
        alex.send({ t: 'interview-ask', objective: 'where', witness: sam.me.id, clue: 'made-up', text: 'What did you see?' });
        assert.match((await alex.next(m => m.t === 'notice' && /private clues/.test(m.text))).text, /private clues/);
        const first = await exchangeEvidence(teacher, alex, sam, 'where');
        assert.equal((await answer()).correct, false, 'one witness is insufficient for a two-witness objective');
        assert.ok(!chris.state.quest.interviews.some(i => i.id === first.id), 'bystanders cannot read the transcript');
        chris.send({ t: 'interview-reply', id: first.id, clue: chris.state.quest.clues[0].id, text: 'I want to impersonate the witness.' });
        await chris.next(m => m.t === 'notice' && /not ready/.test(m.text), 'forged reply rejected');
        await teacher('review', { id: first.replyId, approve: false });
        await alex.next(m => m.t === 'quest' && m.quest?.objectives.find(o => o.id === 'where')?.conversation.completed === 0, 'removed reply revokes participation');
        assert.equal((await answer()).correct, false);
        // The assigned witness can revise a removed reply, using their own server-known evidence.
        await new Promise(resolve => setTimeout(resolve, 1550));
        sam.send({ t: 'interview-reply', id: first.id, clue: sam.state.quest.clues[0].id, text: 'This is my corrected account of the delivery.' });
        await sam.next(m => m.t === 'notice' && /Sent to your teacher/.test(m.text));
        const corrected = (await teacher('status')).body.entries.find(e => e.status === 'pending' && e.sender === sam.me.name);
        await teacher('review', { id: corrected.id, approve: true });
        await exchangeEvidence(teacher, alex, chris, 'where');
        assert.equal(alex.state.quest.objectives.find(o => o.id === 'where').conversation.completed, 2);
        for (const socket of sockets) socket.ws.close(); await plaza.stop();
        plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo); base = plaza.base;
        alex = await enter(base, 'signed-a', null); sockets.push(alex);
        await alex.next(m => m.t === 'quest' && m.quest?.campaign.id === 'two-witnesses');
        assert.equal(alex.state.quest.objectives.find(o => o.id === 'where').conversation.completed, 2, 'approved participation persists while witnesses are offline');
        assert.equal((await answer()).correct, true);
        const evidence = (await teacher('status')).body.campaign.interviews;
        assert.equal(evidence.length, 2); assert.ok(evidence.every(i => i.questionStatus === 'approved' && i.answerStatus === 'approved' && i.shared && i.evidence));
        sam = await enter(base, 'signed-b', null); chris = await enter(base, 'signed-c', null); sockets.push(sam, chris);
        alex.send({ t: 'quest-accept', objective: 'paper-check' });
        await alex.next(m => m.t === 'quest' && m.quest?.board?.some(o => o.id === 'paper-check' && o.state === 'active'));
        assert.equal(alex.state.quest.board.find(o => o.id === 'paper-check').conversation.completed, 0, 'a board quest cannot reuse main-objective exchanges');
        await exchangeEvidence(teacher, alex, sam, 'paper-check'); await exchangeEvidence(teacher, alex, chris, 'paper-check');
        alex.send({ t: 'answer', objective: 'paper-check', text: 'We compared the two witness accounts.' });
        assert.equal((await alex.next(m => m.t === 'answered' && m.objective === 'paper-check')).correct, true, 'unassigned board questions can require two witnesses');
        await teacher('campaign', { op: 'reset', confirm: true }); await teacher('campaign', { op: 'start', campaign: 'two-witnesses' });
        assert.deepEqual((await teacher('status')).body.campaign.interviews, [], 'reset clears transcripts and credit');
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop(); await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('Live missions: reviewed additions preserve progress, enforce conflicts and survive restart', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay(); const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-live-'));
    let plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo); const sockets = [];
    try {
        let base = plaza.base;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const teacher = (route, body) => api(base, `/api/teacher/${route}`, { session, body });
        const live = (op, body) => teacher(`missions/${op}`, body);
        assert.equal((await api(base, '/api/teacher/missions/live')).status, 401);
        assert.equal((await api(base, '/api/teacher/missions/live-preview', { body: {} })).status, 401);
        assert.equal((await api(base, '/api/teacher/missions/live-release', { body: { previewId: 'fake' } })).status, 401);
        assert.equal((await api(base, '/api/teacher/missions/live-withdraw', { body: {} })).status, 401);
        assert.equal((await api(base, '/api/teacher/missions/live-inspect?id=live-puzzle')).status, 401);
        assert.equal((await live('live')).body.target, null);
        PIN = (await teacher('game', { name: 'Live class', randomNames: false })).body.pin;
        const game = (await teacher('status')).body.game.id;
        const solver = await enter(base, 'signed-a', null); const other = await enter(base, 'signed-b', null); sockets.push(solver, other);
        await teacher('campaign', { op: 'start', campaign: 'castanyada' });
        solver.send({ t: 'answer', objective: 'where', text: 'park' }); assert.equal((await solver.next(m => m.t === 'answered')).correct, true);
        const before = (await teacher('status')).body.campaign;
        const roleName = before.players.find(p => p.studentKey === 'stu_a').role;
        const roleId = castanyada.roles.find(r => r.name === roleName).id;
        let draft = (await teacher('missions/create', { id: 'live-source', source: 'castanyada' })).body.draft;
        const content = draft.campaign;
        content.title = 'A changed draft'; content.roles.forEach(r => { r.clue = 'Changed source secret'; }); content.chapters[0].objectives[0].accept = ['hotel'];
        content.chapters[0].objectives.push(
            { id: 'live-puzzle', text: 'How many invitations are missing?', accept: ['two', '2'], optional: true, after: 'where', board: { roles: [roleId], teacherReleased: true } },
            { id: 'live-followup', text: 'Write a report about the invitations.', accept: [], kind: 'report', optional: true, after: 'live-puzzle', board: {} },
            { id: 'next-live-quest', text: 'Write a report about the hotel.', accept: [], kind: 'report', optional: true, board: {} }
        );
        draft = (await teacher('missions/save', { id: content.id, version: draft.version, envelope: missionEnvelope(content) })).body.draft;
        let target = (await live('live')).body.target;
        const review = ids => live('live-preview', { gameId: target.game.id, targetVersion: target.version, targetEpoch: target.epoch, chapterId: target.chapter.id, sourceId: content.id, sourceVersion: draft.version, objectiveIds: ids });
        assert.equal((await review(['where'])).status, 400, 'cannot replace a main question');
        const reviewed = await review(['live-puzzle', 'live-followup']); assert.equal(reviewed.status, 200);
        assert.equal(reviewed.body.preview.quests[0].eligibleNow, 1);
        assert.equal(reviewed.body.preview.quests[0].audience, roleName);
        assert.deepEqual((await teacher('status')).body.campaign.players, before.players, 'preview preserves progress');
        const targetBeforePreview = (await live('live')).body.target; assert.deepEqual(targetBeforePreview.additions, []);
        const released = await live('live-release', { previewId: reviewed.body.preview.id, objectiveIds: ['where'] }); assert.equal(released.status, 200);
        assert.deepEqual(released.body.released, ['live-puzzle', 'live-followup']); target = released.body.target;
        const solverView = (await solver.next(m => m.t === 'quest' && m.quest.board?.some(q => q.id === 'live-puzzle'), 'live quest')).quest;
        assert.equal(solverView.board.find(q => q.id === 'live-puzzle').state, 'available');
        assert.equal(solverView.campaign.title, castanyada.title); assert.equal(JSON.stringify(solverView).includes('Changed source secret'), false);
        assert.equal(JSON.stringify(solverView).includes('"accept"'), false);
        const otherView = (await other.next(m => m.t === 'quest' && m.quest.board, 'other student live view')).quest;
        assert.equal(otherView.board.some(q => q.id === 'live-puzzle'), false, 'live audience restrictions stay private');
        const afterRelease = (await teacher('status')).body.campaign;
        assert.deepEqual(afterRelease.players, before.players); assert.equal(afterRelease.chapter, before.chapter);
        assert.equal((await live('live-release', { previewId: reviewed.body.preview.id })).status, 409, 'review token cannot be replayed');
        assert.equal((await review(['live-puzzle'])).status, 400, 'duplicate IDs cannot replace released content');
        const withdraw = id => live('live-withdraw', { gameId: target.game.id, targetVersion: target.version, targetEpoch: target.epoch, objectiveId: id });
        assert.equal((await withdraw('live-puzzle')).status, 409, 'dependencies prevent withdrawal');
        const withdrawn = await withdraw('live-followup'); assert.equal(withdrawn.status, 200); target = withdrawn.body.target;
        assert.equal((await review(['live-followup'])).status, 400, 'withdrawn IDs are reserved');
        const liveDefinition = (await live('live-inspect?id=live-puzzle')).body.inspection; assert.deepEqual(liveDefinition.definition.accept, ['two', '2']);
        solver.send({ t: 'quest-accept', objective: 'live-puzzle' });
        await solver.next(m => m.t === 'quest' && m.quest.board?.some(q => q.id === 'live-puzzle' && q.state === 'active'));
        assert.equal((await withdraw('live-puzzle')).status, 409, 'started quests cannot be withdrawn');
        solver.send({ t: 'answer', objective: 'live-puzzle', text: '2' }); assert.equal((await solver.next(m => m.t === 'answered' && m.objective === 'live-puzzle')).correct, true);
        const previewForChange = (await review(['next-live-quest'])).body.preview;
        content.chapters[0].objectives.find(o => o.id === 'live-puzzle').accept = ['3'];
        draft = (await teacher('missions/save', { id: content.id, version: draft.version, envelope: missionEnvelope(content) })).body.draft;
        assert.equal((await live('live-release', { previewId: previewForChange.id })).status, 409, 'changing a saved draft invalidates its preview');
        assert.deepEqual((await live('live-inspect?id=live-puzzle')).body.inspection.definition.accept, ['two', '2'], 'released definition stays frozen after edits');
        const a = (await review(['next-live-quest'])).body.preview; const b = (await review(['next-live-quest'])).body.preview;
        const added = await live('live-release', { previewId: a.id }); assert.equal(added.status, 200); target = added.body.target;
        assert.equal((await live('live-release', { previewId: b.id })).status, 409, 'concurrent previews cannot overwrite one another');
        content.chapters[0].objectives.push({ id: 'expiring-quest', text: 'Write another mystery report.', accept: [], kind: 'report', optional: true, board: {} });
        draft = (await teacher('missions/save', { id: content.id, version: draft.version, envelope: missionEnvelope(content) })).body.draft;
        const expiredPreview = (await review(['expiring-quest'])).body.preview;
        const canceled = (await review(['expiring-quest'])).body.preview;
        await live('live-cancel', { previewId: canceled.id });
        assert.equal((await live('live-release', { previewId: canceled.id })).status, 409, 'canceled selections cannot be released');
        await teacher('class', { open: false }); assert.equal((await review(['next-live-quest'])).status, 400, 'closed class cannot receive additions');
        await teacher('class', { open: true, game });
        await teacher('game', { name: 'Another class', randomNames: false }); await teacher('campaign', { op: 'start', campaign: 'castanyada' });
        assert.deepEqual((await live('live')).body.target.additions, [], 'another game does not inherit additions');
        assert.equal((await live('live-inspect?id=live-puzzle')).status, 404);
        await teacher('class', { open: true, game });
        for (const socket of sockets) socket.ws.close(); await plaza.stop();
        // Expire only this preview in the isolated database; no real-time ten-minute sleep.
        const { DatabaseSync } = await import('node:sqlite');
        const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
        let expired = false;
        for (const file of files(persistTo).filter(file => file.endsWith('.sqlite'))) {
            assert.ok(path.resolve(file).startsWith(path.resolve(persistTo) + path.sep));
            const db = new DatabaseSync(file);
            try {
                if (!db.prepare("SELECT name FROM sqlite_master WHERE name = 'mission_live_previews'").get()) continue;
                expired = db.prepare('UPDATE mission_live_previews SET expires = 0 WHERE preview_id = ?').run(expiredPreview.id).changes === 1;
            } finally { db.close(); }
        }
        assert.ok(expired);
        plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo); base = plaza.base;
        assert.equal((await live('live-release', { previewId: expiredPreview.id })).status, 409, 'expired review is rejected after restart');
        const resumed = await enter(base, 'signed-a', null); sockets.push(resumed);
        const resumedView = (await resumed.next(m => m.t === 'quest' && m.quest.board?.some(q => q.id === 'live-puzzle'), 'persisted live quests')).quest;
        assert.equal(resumedView.board.find(q => q.id === 'live-puzzle').state, 'done');
        assert.ok(resumedView.objectives.find(o => o.id === 'where').done);
        assert.ok(!resumedView.board.some(q => q.id === 'live-followup'));
        assert.deepEqual((await live('live-inspect?id=live-puzzle')).body.inspection.definition.accept, ['two', '2']);
        target = (await live('live')).body.target; const oldEpoch = target.epoch;
        await teacher('campaign', { op: 'reset', confirm: true }); await teacher('campaign', { op: 'start', campaign: 'castanyada' });
        const restarted = (await live('live')).body.target; assert.notEqual(restarted.epoch, oldEpoch); assert.deepEqual(restarted.additions, []);
        assert.equal((await live('live-withdraw', { gameId: game, targetVersion: restarted.version, targetEpoch: oldEpoch, objectiveId: 'live-puzzle' })).status, 409, 'requests cannot cross campaign resets');
        assert.equal((await live('live-inspect?id=live-puzzle')).status, 404);
        await teacher('campaign', { op: 'next' });
        assert.equal((await review(['next-live-quest'])).status, 409, 'chapter changes invalidate the old target');
        await teacher('campaign', { op: 'next' }); await teacher('campaign', { op: 'next' });
        assert.equal((await live('live-release', { previewId: 'old' })).status, 400, 'ended campaign cannot receive additions');
    } finally {
        for (const socket of sockets) socket.ws.close(); await plaza.stop(); await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('Side quest library: teachers add generic and story quests to Castanyada and to Plaza Free Play', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay(); const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-library-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo); const sockets = [];
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const teacher = (route, body) => api(base, `/api/teacher/${route}`, { session, body });
        const live = (op, body) => teacher(`missions/${op}`, body);
        assert.equal((await api(base, '/api/teacher/missions/library-preview', { body: {} })).status, 401);
        // A generic quest with a typed answer, a generic written one, and a story quest for chapter 1 with no prerequisite.
        const riddle = sideQuests.find(q => !q.chapter && q.answer === 'text' && q.format === 'solo');
        const report = sideQuests.find(q => !q.chapter && q.answer === 'report' && q.format === 'solo');
        const story = sideQuests.find(q => q.chapter === 'missing-chestnuts' && !q.after && !q.afterMain && !q.roles?.length);
        const elsewhere = sideQuests.find(q => q.chapter && q.chapter !== 'missing-chestnuts');
        assert.ok(riddle && report && story && elsewhere, 'the library has every kind of quest this test needs');

        PIN = (await teacher('game', { name: 'Library class', randomNames: false })).body.pin;
        const alex = await enter(base, 'signed-a', null); const sam = await enter(base, 'signed-b', null); sockets.push(alex, sam);
        await teacher('campaign', { op: 'start', campaign: 'castanyada-complete' });
        let target = (await live('live')).body.target;
        const review = (questIds, t = target) => live('library-preview', { gameId: t.game.id, targetVersion: t.version, targetEpoch: t.epoch, chapterId: t.chapter.id, questIds });
        assert.equal((await review(['not-a-library-quest'])).status, 400, 'only library quests');
        const wrongChapter = await review([elsewhere.id]); assert.equal(wrongChapter.status, 400, 'a story quest needs its own chapter');
        assert.match(wrongChapter.body.error, /chapter/);
        assert.equal((await live('library-preview', { gameId: target.game.id, targetVersion: target.version + 1, targetEpoch: target.epoch, chapterId: target.chapter.id, questIds: [riddle.id] })).status, 409);
        const reviewed = await review([riddle.id, report.id, story.id]); assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
        assert.deepEqual(reviewed.body.preview.quests.map(q => q.id), [riddle.id, report.id, story.id]);
        assert.equal(reviewed.body.preview.quests[0].eligibleNow, 2);
        const released = await live('live-release', { previewId: reviewed.body.preview.id }); assert.equal(released.status, 200, JSON.stringify(released.body));
        target = released.body.target;
        assert.deepEqual(target.additions.map(a => a.id), [riddle.id, report.id, story.id]);
        assert.equal((await live(`live-inspect?id=${riddle.id}`)).body.inspection.sourceId, SIDE_QUEST_SOURCE);
        assert.equal((await review([riddle.id])).status, 400, 'a library quest joins a game once');

        const view = (await alex.next(m => m.t === 'quest' && m.quest.board?.some(q => q.id === riddle.id), 'library quests on the board')).quest;
        assert.equal(view.board.find(q => q.id === riddle.id).text, `${riddle.title}: ${riddle.text}`);
        assert.equal(JSON.stringify(view).includes('"accept"'), false, 'answers stay on the server');
        alex.send({ t: 'quest-accept', objective: riddle.id });
        await alex.next(m => m.t === 'quest' && m.quest.board?.some(q => q.id === riddle.id && q.state === 'active'), 'accepted');
        alex.send({ t: 'answer', objective: riddle.id, text: `It is ${riddle.accept[0]}` });
        assert.equal((await alex.next(m => m.t === 'answered' && m.objective === riddle.id)).correct, true);
        alex.send({ t: 'quest-accept', objective: report.id });
        await alex.next(m => m.t === 'quest' && m.quest.board?.some(q => q.id === report.id && q.state === 'active'), 'accepted report');
        await new Promise(resolve => setTimeout(resolve, 3100)); // a wrong answer earlier would make the next one wait
        alex.send({ t: 'answer', objective: report.id, text: 'I asked two classmates and they told me their ideas.' });
        assert.equal((await alex.next(m => m.t === 'answered' && m.objective === report.id)).correct, true);

        // Between chapters, or any day: Plaza Free Play has no mystery, only a check-in and the library.
        await teacher('game', { name: 'Free play', randomNames: false });
        PIN = (await teacher('status')).body.pin;
        const chris = await enter(base, 'signed-c', null); sockets.push(chris);
        assert.ok((await teacher('status')).body.campaigns.some(c => c.id === 'plaza-free-play'));
        await teacher('campaign', { op: 'start', campaign: 'plaza-free-play' });
        const free = (await chris.next(m => m.t === 'quest' && m.quest, 'free play journal')).quest;
        assert.equal(free.chapter.title, 'Free play: session 1'); assert.equal(free.objectives[0].kind, 'report');
        let freeTarget = (await live('live')).body.target;
        assert.equal((await review([story.id], freeTarget)).status, 400, 'story quests stay with their story');
        const freeReview = await review([riddle.id], freeTarget); assert.equal(freeReview.status, 200, JSON.stringify(freeReview.body));
        assert.equal((await live('live-release', { previewId: freeReview.body.preview.id })).status, 200);
        await chris.next(m => m.t === 'quest' && m.quest.board?.some(q => q.id === riddle.id && q.state === 'available'), 'free play board');
        await teacher('campaign', { op: 'next' });
        freeTarget = (await live('live')).body.target;
        assert.equal(freeTarget.chapter.id, 'free-play-2'); assert.deepEqual(freeTarget.additions, [], 'each session starts with a fresh board');
    } finally {
        for (const socket of sockets) socket.ws.close(); await plaza.stop(); await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('Quest board: eligibility, release, assignments, partner replacement and restart persistence', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay(); const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-board-'));
    let plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo); const sockets = [];
    try {
        let base = plaza.base;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const teacher = (route, body) => api(base, `/api/teacher/${route}`, { session, body });
        const content = {
            id: 'board-test', title: 'Interview mystery', finale: 'The end.', roles: [
                { id: 'investigator', name: 'Investigator', card: 'Investigate the delivery.', clue: 'Ask about the hotel.' },
                { id: 'witness', name: 'Witness', card: 'Tell what you saw.', clue: 'A delivery arrived at the hotel.' }
            ], chapters: [{ id: 'interviews', title: 'Interviews', intro: 'Find the delivery.', recap: 'The delivery is missing.', ending: 'You found it.', share: 0.6,
                objectives: [
                    { id: 'location', text: 'Where did it go?', accept: ['hotel'] },
                    { id: 'time', text: 'When did it arrive?', accept: ['nine'], requires: { mode: 'all', objectives: ['location'] } },
                    { id: 'interview', text: 'Interview your assigned witness. Write what you learned.', accept: [], kind: 'report', optional: true, activity: 'interview', board: { roles: ['investigator'], partnerRole: 'witness', afterMain: true, minPlayers: 2, teacherReleased: true } },
                    { id: 'exchange', text: 'Compare your evidence with a partner.', accept: [], kind: 'report', optional: true, activity: 'exchange', requires: { mode: 'any', objectives: ['interview'] }, board: { afterMain: true } }
                ], discoveries: [], reveals: [] }]
        };
        const created = (await teacher('missions/create', { id: content.id })).body.draft;
        const saved = (await teacher('missions/save', { id: content.id, version: created.version, envelope: missionEnvelope(content) })).body.draft;
        assert.equal((await teacher('missions/publish', { id: content.id, version: saved.version })).status, 200);
        PIN = (await teacher('game', { name: 'Board class', randomNames: false })).body.pin;
        const game = (await teacher('status')).body.game.id;
        const byKey = {};
        for (const token of ['signed-a', 'signed-b', 'signed-c']) { const socket = await enter(base, token, null); sockets.push(socket); byKey[students[token].studentKey] = socket; }
        const status = (await teacher('campaign', { op: 'start', campaign: content.id })).body.campaign;
        const solver = status.players.find(p => p.role === 'Investigator');
        let partner = status.players.find(p => p.role === 'Witness');
        const spare = status.players.find(p => p.studentKey !== solver.studentKey && p.studentKey !== partner.studentKey);
        const view = (key, predicate) => byKey[key].next(m => m.t === 'quest' && m.quest && predicate(m.quest), 'board update').then(m => m.quest);
        const answer = async (key, objective, text) => {
            byKey[key].send({ t: 'answer', objective, text }); return byKey[key].next(m => m.t === 'answered' && m.objective === objective, 'answer');
        };
        const initial = await view(solver.studentKey, q => q.board && !q.board.some(o => o.id === 'interview'));
        assert.ok(!initial.objectives.some(o => o.id === 'time'), 'all prerequisite blocks time until location');
        assert.equal(JSON.stringify(initial).includes('"accept"'), false);
        assert.equal((await api(base, '/api/teacher/quest-release', { body: { objective: 'interview' } })).status, 401);
        assert.equal((await teacher('quest-release', { objective: 'location' })).status, 400, 'main questions cannot be released as quests');
        assert.equal((await teacher('quest-release', { objective: 'interview' })).status, 200);
        const released = await view(solver.studentKey, q => q.board?.some(o => o.id === 'interview' && o.state === 'waiting'));
        assert.match(released.board.find(o => o.id === 'interview').reason, /main mystery/);
        const witnessView = await view(partner.studentKey, q => q.board);
        assert.ok(!witnessView.board.some(o => o.id === 'interview'), 'role-limited content stays hidden');
        byKey[partner.studentKey].send({ t: 'quest-accept', objective: 'interview' });
        assert.match((await byKey[partner.studentKey].next(m => m.t === 'notice')).text, /another role/);
        assert.equal((await answer(solver.studentKey, 'location', 'hotel')).correct, true);
        assert.equal((await answer(solver.studentKey, 'time', 'nine')).correct, true);
        const waiting = await view(solver.studentKey, q => q.board?.some(o => o.id === 'interview' && o.reason?.includes('another investigator')));
        assert.ok(waiting.board.find(o => o.id === 'interview').reason, 'slow students are not assigned as fast-finisher partners');
        for (const key of [partner.studentKey, spare.studentKey]) {
            assert.equal((await answer(key, 'location', 'hotel')).correct, true);
            assert.equal((await answer(key, 'time', 'nine')).correct, true);
        }
        await view(solver.studentKey, q => q.board?.some(o => o.id === 'interview' && o.state === 'available'));
        byKey[solver.studentKey].send({ t: 'answer', objective: 'interview', text: 'The witness saw a large delivery.' });
        await new Promise(resolve => setTimeout(resolve, 200));
        assert.equal((await teacher('status')).body.campaign.reports.length, 0, 'cannot bypass acceptance');
        byKey[solver.studentKey].send({ t: 'quest-accept', objective: 'interview' });
        const accepted = await view(solver.studentKey, q => q.board?.some(o => o.id === 'interview' && o.state === 'active'));
        const assignedName = accepted.board.find(o => o.id === 'interview').partner.name;
        partner = status.players.find(p => p.name === assignedName);
        assert.notEqual(partner.studentKey, solver.studentKey);
        assert.ok(!JSON.stringify(accepted).includes('student_key'), 'assignment identities remain server-side');
        byKey[solver.studentKey].send({ t: 'quest-accept', objective: 'interview' });
        assert.equal((await teacher('status')).body.campaign.board.find(o => o.id === 'interview').accepted, 1, 'claim is idempotent');
        const assignedSocket = byKey[partner.studentKey]; assignedSocket.ws.close(); await assignedSocket.closed;
        const away = await view(solver.studentKey, q => q.board?.some(o => o.id === 'interview' && o.partner && !o.partner.online));
        assert.equal(away.board.find(o => o.id === 'interview').partner.name, assignedName);
        // Keep the original partner on reconnect; replacement is optional and only possible if a matching peer is there.
        const tokenFor = key => Object.keys(students).find(token => students[token].studentKey === key);
        byKey[partner.studentKey] = await enter(base, tokenFor(partner.studentKey), null); sockets.push(byKey[partner.studentKey]);
        const back = await view(solver.studentKey, q => q.board?.some(o => o.id === 'interview' && o.partner?.online));
        assert.equal(back.board.find(o => o.id === 'interview').partner.name, assignedName);
        byKey[solver.studentKey].send({ t: 'quest-accept', objective: 'interview', changePartner: true });
        assert.match((await byKey[solver.studentKey].next(m => m.t === 'notice')).text, /still in the plaza/);
        assert.equal((await answer(solver.studentKey, 'interview', 'The witness saw a large delivery.')).correct, false, 'a report cannot replace an evidence exchange');
        await byKey[solver.studentKey].next(m => m.t === 'notice' && /Exchange evidence/.test(m.text), 'report gate warning');
        await exchangeEvidence(teacher, byKey[solver.studentKey], byKey[partner.studentKey], 'interview');
        assert.equal((await answer(solver.studentKey, 'interview', 'The witness saw a large delivery.')).correct, true);
        const completed = await view(solver.studentKey, q => q.board?.some(o => o.id === 'interview' && o.state === 'done'));
        assert.ok(completed.board.some(o => o.id === 'exchange' && o.state === 'available'), 'any prerequisite unlocks the next social quest');
        const report = (await teacher('status')).body.campaign.reports[0]; assert.equal(report.partner, assignedName);
        byKey[solver.studentKey].send({ t: 'quest-accept', objective: 'interview' });
        assert.match((await byKey[solver.studentKey].next(m => m.t === 'notice' && /already finished/.test(m.text))).text, /already finished/);
        byKey[solver.studentKey].send({ t: 'quest-accept', objective: 'exchange' });
        const exchange = await view(solver.studentKey, q => q.board?.some(o => o.id === 'exchange' && o.state === 'active'));
        const exchangePartner = status.players.find(p => p.name === exchange.board.find(o => o.id === 'exchange').partner.name);
        const departing = byKey[exchangePartner.studentKey]; departing.ws.close(); await departing.closed;
        await view(solver.studentKey, q => q.board?.some(o => o.id === 'exchange' && o.partner && !o.partner.online));
        byKey[solver.studentKey].send({ t: 'quest-accept', objective: 'exchange', changePartner: true });
        const reassigned = await view(solver.studentKey, q => q.board?.some(o => o.id === 'exchange' && o.partner?.online && o.partner.name !== exchangePartner.name));
        const replacementName = reassigned.board.find(o => o.id === 'exchange').partner.name;
        const replacement = status.players.find(p => p.name === replacementName);
        await exchangeEvidence(teacher, byKey[solver.studentKey], byKey[replacement.studentKey], 'exchange');
        assert.equal((await teacher('status')).body.campaign.board.find(o => o.id === 'exchange').accepted, 1, 'replacement keeps the same assignment');
        for (const socket of sockets) socket.ws.close(); await plaza.stop();
        plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo); base = plaza.base;
        byKey[solver.studentKey] = await enter(base, tokenFor(solver.studentKey), null); sockets.push(byKey[solver.studentKey]);
        const resumed = await view(solver.studentKey, q => q.board?.some(o => o.id === 'exchange' && o.state === 'active'));
        assert.equal(resumed.board.find(o => o.id === 'interview').state, 'done');
        assert.equal(resumed.board.find(o => o.id === 'interview').partner.name, assignedName);
        assert.equal(resumed.board.find(o => o.id === 'exchange').partner.name, replacementName);
        assert.equal((await teacher('status')).body.campaign.board.find(o => o.id === 'interview').released, true);
        // A report remains submit-able after the conversation partner goes offline.
        assert.equal((await answer(solver.studentKey, 'exchange', 'We compared evidence and agreed on a plan.')).correct, true);
        await teacher('campaign', { op: 'reset', confirm: true });
        await teacher('campaign', { op: 'start', campaign: content.id });
        const reset = (await teacher('status')).body.campaign;
        assert.equal(reset.board.find(o => o.id === 'interview').accepted, 0); assert.equal(reset.board.find(o => o.id === 'interview').released, false);
        assert.deepEqual(reset.reports, []);
        await teacher('class', { open: false }); await teacher('class', { open: true, game });
        assert.equal((await teacher('status')).body.campaign.board.find(o => o.id === 'exchange').completed, 0);
    } finally {
        for (const socket of sockets) socket.ws.close(); await plaza.stop(); await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('Mission Studio: authorization, draft conflicts, published privacy and revision persistence', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-missions-'));
    let plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    try {
        let base = plaza.base;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const mission = (op, body) => api(base, `/api/teacher/missions/${op}`, { session, body });
        assert.equal((await api(base, '/api/teacher/missions/list')).status, 401);
        assert.equal((await api(base, '/api/teacher/missions/create', { token: 'signed-a', body: { id: 'stolen' } })).status, 401);
        assert.equal((await api(base, '/api/teacher/missions/save', { body: { id: 'castanyada', version: 1, envelope: missionEnvelope(castanyada) } })).status, 401);
        assert.equal((await api(base, '/api/teacher/missions/publish', { body: { id: 'castanyada', version: 1 } })).status, 401);
        assert.equal((await mission('list')).body.library[0].id, 'castanyada');
        const initial = (await mission('get?id=castanyada')).body.draft;
        assert.deepEqual(initial.campaign, castanyada);
        const created = (await mission('create', { id: 'winter', source: 'castanyada' })).body.draft;
        assert.equal(created.publishedRevision, null);
        assert.equal((await mission('create', { id: 'winter' })).status, 409);
        const teacher = (route, body) => api(base, `/api/teacher/${route}`, { session, body });
        PIN = (await teacher('game', { name: 'First revision', randomNames: false })).body.pin;
        const firstGame = (await teacher('status')).body.game.id;
        assert.equal((await teacher('campaign', { op: 'start', campaign: 'winter' })).status, 400, 'drafts cannot be played');
        const content = created.campaign; content.title = 'Winter original'; content.chapters[0].objectives[0].accept = ['hotel'];
        content.roles.forEach(role => { role.clue = 'The box is at the hotel.'; });
        const saved = (await mission('save', { id: 'winter', version: created.version, envelope: missionEnvelope(content) })).body.draft;
        assert.equal((await mission('save', { id: 'winter', version: created.version, envelope: missionEnvelope(content) })).status, 409);
        const published = (await mission('publish', { id: 'winter', version: saved.version })).body.draft;
        assert.ok(published.publishedRevision);
        assert.equal((await mission('publish', { id: 'winter', version: saved.version })).status, 409);
        await teacher('campaign', { op: 'start', campaign: 'winter' });
        const student = await enter(base, 'signed-a', null); sockets.push(student);
        const view = await student.next(m => m.t === 'quest' && m.quest, 'published quest');
        assert.equal(view.quest.campaign.title, 'Winter original');
        assert.equal(JSON.stringify(view).includes('"accept"'), false);
        assert.equal(view.quest.clues.some(c => c.text === content.roles.find(r => r.id === view.quest.role.id).clue), true);
        for (const other of content.roles.filter(r => r.id !== view.quest.role.id)) assert.equal(JSON.stringify(view).includes(other.card), false, 'other role cards stay private');
        student.send({ t: 'answer', objective: 'where', text: 'hotel' });
        assert.equal((await student.next(m => m.t === 'answered')).correct, true);
        const edited = structuredClone(published.campaign); edited.title = 'Winter revised'; edited.chapters[0].objectives[0].accept = ['park'];
        const savedAgain = (await mission('save', { id: 'winter', version: published.version, envelope: missionEnvelope(edited) })).body.draft;
        const publishedAgain = (await mission('publish', { id: 'winter', version: savedAgain.version })).body.draft;
        assert.notEqual(publishedAgain.publishedRevision, published.publishedRevision);
        assert.equal((await teacher('status')).body.campaign.title, 'Winter original', 'open game remains pinned');
        assert.ok((await teacher('status')).body.campaign.players[0].done.includes('where'));
        const incomplete = structuredClone(edited); incomplete.chapters[0].objectives[0].accept = [];
        const invalidDraft = (await mission('save', { id: 'winter', version: publishedAgain.version, envelope: missionEnvelope(incomplete) })).body.draft;
        assert.equal((await mission('publish', { id: 'winter', version: invalidDraft.version })).status, 400);
        assert.equal((await teacher('status')).body.campaigns.find(c => c.id === 'winter').title, 'Winter revised', 'invalid draft does not replace the published revision');
        const oversized = await fetch(`${base}/api/teacher/missions/save`, { method: 'POST', headers: { 'x-teacher-session': session, 'content-type': 'application/json' }, body: JSON.stringify({ padding: 'x'.repeat(520000) }) });
        assert.equal(oversized.status, 413);
        await teacher('game', { name: 'Second revision', randomNames: false });
        assert.equal((await teacher('campaign', { op: 'start', campaign: 'winter' })).body.campaign.title, 'Winter revised', 'new game uses latest published content');
        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo); base = plaza.base;
        const reopened = (await teacher('class', { open: true, game: firstGame })).body;
        PIN = reopened.pin;
        assert.equal(reopened.campaign.title, 'Winter original');
        assert.ok(reopened.campaign.players[0].done.includes('where'));
        const returning = await enter(base, 'signed-a', null); sockets.push(returning);
        const resumed = (await returning.next(m => m.t === 'quest' && m.quest)).quest;
        assert.equal(resumed.campaign.title, 'Winter original');
        assert.ok(resumed.objectives.find(o => o.id === 'where').done);
        assert.equal((await mission('get?id=winter')).body.draft.version, invalidDraft.version);
        assert.equal((await api(base, '/api/teacher/missions/delete', { body: { id: 'winter', version: invalidDraft.version } })).status, 401);
        assert.equal((await mission('delete', { id: 'winter', version: invalidDraft.version - 1 })).status, 409);
        const removed = (await mission('delete', { id: 'winter', version: invalidDraft.version })).body;
        assert.equal(removed.draft.deleted, true);
        assert.ok(!removed.library.some(c => c.id === 'winter')); assert.ok(removed.trash.some(c => c.id === 'winter'));
        const afterDelete = (await teacher('status')).body;
        assert.ok(!afterDelete.campaigns.some(c => c.id === 'winter'), 'deleted missions cannot start new games');
        assert.equal(afterDelete.campaign.title, 'Winter original');
        assert.ok(afterDelete.campaign.players[0].done.includes('where'), 'deletion preserves running progress');
        await plaza.stop(); plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo); base = plaza.base;
        assert.ok((await mission('list')).body.trash.some(c => c.id === 'winter'), 'Trash survives a restart');
        assert.equal((await teacher('status')).body.campaign.title, 'Winter original', 'pinned game survives deletion and restart');
        assert.equal((await mission('restore', { id: 'winter', version: removed.draft.version })).body.draft.deleted, false);
        assert.ok((await teacher('status')).body.campaigns.some(c => c.id === 'winter'));
    } finally {
        for (const socket of sockets) socket.ws.close(); await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('Mission Studio migration: legacy games retain roles, progress and thief assignments', { timeout: 120000 }, async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-legacy-missions-'));
    let plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    try {
        let base = plaza.base;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const teacher = (route, body) => api(base, `/api/teacher/${route}`, { session, body });
        PIN = (await teacher('game', { name: 'Legacy class', randomNames: false })).body.pin;
        for (const token of ['signed-a', 'signed-b', 'signed-c']) sockets.push(await enter(base, token, null));
        await teacher('campaign', { op: 'start', campaign: 'castanyada' });
        sockets[0].send({ t: 'answer', objective: 'where', text: 'park' });
        assert.equal((await sockets[0].next(m => m.t === 'answered')).correct, true);
        const before = (await teacher('campaign', { op: 'next' })).body.campaign;
        assert.equal(before.players.filter(p => p.thief).length, 1);
        for (const socket of sockets) socket.ws.close(); await plaza.stop();
        const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
        let migrated = false;
        for (const file of files(persistTo).filter(file => file.endsWith('.sqlite'))) {
            assert.ok(path.resolve(file).startsWith(path.resolve(persistTo) + path.sep));
            const db = new DatabaseSync(file);
            try {
                if (!db.prepare("SELECT name FROM sqlite_master WHERE name = 'campaigns'").get()) continue;
                // Reconstruct the actual pre-Studio table, rather than asking Node's SQLite
                // to rewrite a workerd table in place with DROP COLUMN.
                db.exec(`CREATE TABLE campaigns_legacy (
                    game_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, chapter INTEGER NOT NULL,
                    status TEXT NOT NULL, started INTEGER NOT NULL, revealed INTEGER NOT NULL DEFAULT 0);
                    INSERT INTO campaigns_legacy SELECT game_id, campaign_id, chapter, status, started, revealed FROM campaigns;
                    DROP TABLE campaigns;
                    ALTER TABLE campaigns_legacy RENAME TO campaigns;
                    DROP TABLE mission_drafts; DROP TABLE mission_revisions;`);
                migrated = true;
            } finally { db.close(); }
        }
        assert.ok(migrated, 'test found the isolated PlazaRoom database');
        plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo); base = plaza.base;
        const after = (await teacher('status')).body.campaign;
        const { guideVersion: beforeGuide, ...beforeProgress } = before;
        const { guideVersion: afterGuide, ...afterProgress } = after;
        assert.deepEqual(afterProgress, beforeProgress, 'migration preserves campaign state exactly');
        assert.notEqual(afterGuide, beforeGuide, 'a rebuilt mission epoch refreshes the teacher guide');
        const seed = (await api(base, '/api/teacher/missions/get?id=castanyada', { session })).body.draft;
        const edit = structuredClone(seed.campaign); edit.title = 'A new template';
        const saved = (await api(base, '/api/teacher/missions/save', { session, body: { id: 'castanyada', version: seed.version, envelope: missionEnvelope(edit) } })).body.draft;
        await api(base, '/api/teacher/missions/publish', { session, body: { id: 'castanyada', version: saved.version } });
        assert.equal((await teacher('status')).body.campaign.title, before.title, 'legacy game stays pinned after template publication');
    } finally {
        for (const socket of sockets) socket.ws.close(); await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('a lesson in the plaza, then a restart that keeps everyone\'s progress', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const pinPlayUrl = `http://127.0.0.1:${pinPlay.address().port}`;
    let plaza = await startPlaza(pinPlayUrl, persistTo);
    const sockets = [];
    try {
        let { base } = plaza;

        // Teacher signs in with the PinPlay password and opens the class.
        assert.equal((await api(base, '/api/teacher/login', { body: { password: 'nope' } })).status, 401);
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        assert.equal((await api(base, '/api/teacher/status', { session: 'forged' })).status, 401);
        const closedJoin = await api(base, '/api/plaza/join', { token: 'signed-a', body: { pin: PIN } });
        assert.equal(closedJoin.status, 403);
        assert.match(closedJoin.body.error, /not opened/);
        assert.equal((await api(base, '/api/teacher/status', { session })).body.pin, null);
        const opened = (await api(base, '/api/teacher/class', { session, body: { open: true } })).body;
        assert.equal(opened.open, true);
        assert.match(opened.pin, /^\d{6}$/);
        PIN = opened.pin;
        // Opening again mid-lesson keeps the PIN students already have.
        assert.equal((await api(base, '/api/teacher/class', { session, body: { open: true } })).body.pin, PIN);

        // The PIN and the PinPlay identity both gate the door.
        assert.equal((await api(base, '/api/plaza/join', { token: 'signed-a', body: { pin: '000000' } })).status, 403);
        assert.equal((await api(base, '/api/plaza/join', { token: 'fake', body: { pin: PIN } })).status, 401);
        assert.equal((await api(base, '/api/plaza/join', { token: 'signed-a', body: { pin: PIN, avatar: { hair: 99 } } })).status, 400);

        // Alex arrives with new looks and walks somewhere.
        const alex = await enter(base, 'signed-a', { skin: 2, hair: 3 });
        sockets.push(alex);
        assert.equal(alex.me.name, 'Alex');
        assert.equal(alex.me.hair, 3);
        alex.send({ t: 'move', x: 900, y: 800 });
        await new Promise(resolve => setTimeout(resolve, 300));

        // Sam sees Alex where Alex is, and Alex sees Sam arrive.
        const sam = await enter(base, 'signed-b', null);
        sockets.push(sam);
        const alexSeenBySam = sam.welcome.players.find(player => player.name === 'Alex');
        assert.deepEqual([alexSeenBySam.x, alexSeenBySam.y, alexSeenBySam.hair], [900, 800, 3]);
        assert.equal((await alex.next(message => message.t === 'join', 'join')).player.name, 'Sam');
        await alex.next(message => message.t === 'chat' && /Sam has joined/.test(message.text), 'join announcement');
        const moved = sam.next(message => message.t === 'move', 'move');
        alex.send({ t: 'move', x: 1100, y: 740 });
        assert.deepEqual([(await moved).x, (await moved).y], [1100, 740]);

        // Chat waits for the teacher.
        sam.send({ t: 'move', x: 920, y: 810 });
        await new Promise(resolve => setTimeout(resolve, 300));
        alex.send({ t: 'chat', text: 'Hello class!' });
        assert.match((await alex.next(message => message.t === 'notice', 'pending notice')).text, /approval/);
        let status = (await api(base, '/api/teacher/status', { session })).body;
        assert.deepEqual(status.online.map(student => student.name).sort(), ['Alex', 'Sam']);
        const alexLocation = status.online.find(student => student.studentKey === 'stu_a');
        assert.deepEqual([alexLocation.x, alexLocation.y], [1100, 740]);
        assert.equal(alexLocation.zone, null); // the path between the cafe and park
        assert.equal(status.entries[0].status, 'pending');
        assert.equal(status.entries[0].studentKey, 'stu_a');
        assert.equal(sam.inbox.some(message => message.t === 'chat' && message.text === 'Hello class!'), false);
        await api(base, '/api/teacher/review', { session, body: { id: status.entries[0].id, approve: true } });
        assert.equal((await sam.next(message => message.t === 'chat' && message.sender === 'Alex', 'approved chat')).text, 'Hello class!');
        assert.match((await alex.next(message => message.t === 'notice', 'decision')).text, /approved/);

        // Nearby chat stops at earshot; a whisper reaches only its target, and the teacher sees both.
        const chris = await enter(base, 'signed-c', null);
        sockets.push(chris);
        chris.send({ t: 'move', x: 100, y: 100 });
        await new Promise(resolve => setTimeout(resolve, 300));
        await new Promise(resolve => setTimeout(resolve, 1600)); // chat rate limit
        alex.send({ t: 'chat', text: 'Only people near me' });
        await alex.next(message => message.t === 'notice' && /approval/.test(message.text), 'nearby pending');
        await new Promise(resolve => setTimeout(resolve, 1600));
        alex.send({ t: 'chat', text: 'Secret for Chris', to: chris.welcome.id });
        await alex.next(message => message.t === 'notice' && /approval/.test(message.text), 'whisper pending');
        status = (await api(base, '/api/teacher/status', { session })).body;
        const nearby = status.entries.find(entry => entry.text === 'Only people near me');
        const whisper = status.entries.find(entry => entry.text === 'Secret for Chris');
        assert.equal(nearby.target, null);
        assert.equal(whisper.target, 'Chris');
        await api(base, '/api/teacher/review', { session, body: { id: nearby.id, approve: true } });
        await api(base, '/api/teacher/review', { session, body: { id: whisper.id, approve: true } });
        assert.equal((await sam.next(message => message.t === 'chat' && message.sender === 'Alex' && !message.whisper, 'near chat')).text, 'Only people near me');
        const heard = await chris.next(message => message.t === 'chat' && message.sender === 'Alex', 'whisper');
        assert.deepEqual([heard.text, heard.whisper, heard.to], ['Secret for Chris', true, 'Chris']);
        assert.equal((await alex.next(message => message.t === 'chat' && message.whisper, 'own whisper')).text, 'Secret for Chris');
        assert.equal(chris.inbox.some(message => message.text === 'Only people near me'), false);
        assert.equal(sam.inbox.some(message => message.text === 'Secret for Chris'), false);
        chris.ws.close();
        await chris.closed;

        const emote = sam.next(message => message.t === 'emote', 'emote');
        alex.send({ t: 'emote', emote: '👍' });
        assert.deepEqual([(await emote).id, (await emote).emote], [alex.welcome.id, '👍']);

        // A second window takes over Alex's avatar, quietly and in the same spot.
        const alexAgain = await enter(base, 'signed-a', null);
        sockets.push(alexAgain);
        assert.equal(await alex.closed, 4009);
        assert.deepEqual([alexAgain.me.x, alexAgain.me.y], [1100, 740]);
        assert.equal((await sam.next(message => message.t === 'leave' && message.id === alex.welcome.id, 'leave')).id, alex.welcome.id);
        assert.equal((await sam.next(message => message.t === 'join' && message.player.name === 'Alex', 'rejoin')).player.id, alexAgain.welcome.id);

        // A mute follows the student, not the connection.
        await api(base, '/api/teacher/mute', { session, body: { studentKey: 'stu_a', muted: true } });
        alexAgain.send({ t: 'chat', text: 'Can you hear me?', cid: 'draft-1' });
        const refusal = await alexAgain.next(message => message.t === 'notice', 'muted notice');
        assert.match(refusal.text, /unavailable/);
        assert.equal(refusal.cid, 'draft-1'); // the page can tell which message it was

        alexAgain.ws.close();
        await sam.next(message => message.t === 'chat' && /Alex left/.test(message.text), 'leave announcement');
        assert.equal(sam.inbox.filter(message => message.t === 'chat' && /Alex left/.test(message.text)).length, 0);
        sam.ws.close();
        await sam.closed;
        await new Promise(resolve => setTimeout(resolve, 300));

        // Restart: everything that matters is still there.
        await plaza.stop();
        plaza = await startPlaza(pinPlayUrl, persistTo);
        base = plaza.base;
        assert.deepEqual((await api(base, '/api/student/me', { token: 'signed-a' })).body.avatar,
            { head: 0, skin: 2, hairColor: 0, hair: 3, eyes: 0, mouth: 0, glasses: 0, shirt: 0, hat: 0 });
        assert.equal((await api(base, '/api/student/me', { token: 'signed-b' })).body.avatar, null);
        status = (await api(base, '/api/teacher/status', { session })).body;
        assert.equal(status.open, true);
        assert.equal(status.pin, PIN);
        assert.deepEqual(status.muted, ['stu_a']);
        assert.equal(status.entries.find(entry => entry.text === 'Hello class!').status, 'approved');

        const alexNextLesson = await enter(base, 'signed-a', null);
        sockets.push(alexNextLesson);
        assert.deepEqual([alexNextLesson.me.x, alexNextLesson.me.y, alexNextLesson.me.hair], [1100, 740, 3]);

        // Closing the game sends everyone out and keeps new students out; reopening it
        // brings back the same PIN and the same places.
        await api(base, '/api/teacher/class', { session, body: { open: false } });
        assert.equal(await alexNextLesson.closed, 4002);
        assert.equal((await api(base, '/api/plaza/join', { token: 'signed-b', body: { pin: PIN } })).status, 403);
        const reopened = (await api(base, '/api/teacher/class', { session, body: { open: true } })).body;
        assert.equal(reopened.pin, PIN);
        assert.equal((await api(base, '/api/plaza/join', { token: 'signed-b', body: { pin: PIN } })).status, 200);
        const alexBack = await enter(base, 'signed-a', null);
        sockets.push(alexBack);
        assert.deepEqual([alexBack.me.x, alexBack.me.y], [1100, 740]);

        // A second game has its own PIN, and its own places and chat; the first is kept.
        const second = (await api(base, '/api/teacher/game', { session, body: { name: '  3B   Winter ' } })).body;
        assert.equal(await alexBack.closed, 4002);
        assert.deepEqual(second.game.name, '3B Winter');
        assert.notEqual(second.pin, PIN);
        assert.equal(second.games.length, 2);
        assert.equal((await api(base, '/api/teacher/game', { session, body: { name: '   ' } })).status, 400);
        assert.equal((await api(base, '/api/plaza/join', { token: 'signed-a', body: { pin: PIN } })).status, 403);
        const firstPin = PIN;
        PIN = second.pin; // enter() joins with the current PIN
        const alexSecond = await enter(base, 'signed-a', null);
        sockets.push(alexSecond);
        assert.notDeepEqual([alexSecond.me.x, alexSecond.me.y], [1100, 740]);
        alexSecond.send({ t: 'move', x: 1300, y: 760 });
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.equal(second.entries.some(entry => entry.text === 'Hello class!'), false);

        // Back to the first game: Alex is where they were, and the old chat is there.
        await api(base, '/api/teacher/class', { session, body: { open: true, game: reopened.game.id } });
        assert.equal(await alexSecond.closed, 4002);
        PIN = firstPin;
        const firstAgain = (await api(base, '/api/teacher/status', { session })).body;
        assert.equal(firstAgain.pin, PIN);
        assert.equal(firstAgain.entries.find(entry => entry.text === 'Hello class!').status, 'approved');
        assert.equal(firstAgain.games.filter(game => game.open).length, 1);
        assert.equal((await api(base, '/api/teacher/class', { session, body: { open: true, game: 'nope' } })).status, 400);
        const alexOnceMore = await enter(base, 'signed-a', null);
        sockets.push(alexOnceMore);
        assert.deepEqual([alexOnceMore.me.x, alexOnceMore.me.y], [1100, 740]);
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test("the class plays on the teacher's laptop; students sign in online and are sent there", { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const pinPlayUrl = `http://127.0.0.1:${pinPlay.address().port}`;
    const dirs = [0, 1].map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-')));
    const lanUrl = 'http://192.168.1.20:8787';
    const online = await startPlaza(pinPlayUrl, dirs[0]);
    let laptop;
    try {
        laptop = await startPlaza(pinPlayUrl, dirs[1], { LAN_URL: lanUrl, CLOUD_URL: online.base });
        const laptopUrl = async () => (await api(online.base, '/api/student/config')).body.laptopUrl;
        assert.equal(await laptopUrl(), null);
        // Google cannot sign in on the laptop's address: students go online for it.
        assert.equal((await api(laptop.base, '/api/student/config')).body.signInUrl, online.base);

        // Only the teacher can point students somewhere.
        assert.equal((await api(online.base, '/api/laptop', { body: { password: 'nope', url: 'http://evil.example' } })).status, 401);
        assert.equal((await api(online.base, '/api/laptop', { body: { lease: 'forged', url: 'http://evil.example' } })).status, 401);
        assert.equal((await api(online.base, '/api/laptop', { body: { password: PASSWORD, url: 'javascript:alert(1)' } })).status, 400);
        assert.equal(await laptopUrl(), null);

        // Signing in on the laptop links it.
        const login = await api(laptop.base, '/api/teacher/login', { body: { password: PASSWORD } });
        assert.equal(login.body.notice, '');
        const session = login.body.token;
        assert.equal(await laptopUrl(), lanUrl);
        const opened = await api(laptop.base, '/api/teacher/class', { session, body: { open: true } });
        assert.equal(opened.body.notice, '');
        assert.deepEqual(opened.body.laptop, { url: lanUrl, signInUrl: online.base });
        PIN = opened.body.pin;

        // The PinPlay session from online carries the student's name onto the laptop.
        const alex = await enter(laptop.base, 'signed-a', { skin: 1 });
        assert.equal(alex.me.name, 'Alex');

        // On the laptop the server insists on English words, even if the page was bypassed.
        alex.send({ t: 'chat', text: 'Hola amigos, I recieve it' });
        const refused = await alex.next(message => message.t === 'notice', 'English-only notice');
        assert.equal(refused.level, 'warning');
        assert.match(refused.text, /English words only: Hola, recieve/);
        alex.send({ t: 'chat', text: 'Hello friends, I receive it' });
        assert.match((await alex.next(message => message.t === 'notice', 'accepted')).text, /approval/);
        alex.ws.close();
        await alex.closed;

        // Closing the class stops sending students to the laptop; opening it resumes.
        await api(laptop.base, '/api/teacher/class', { session, body: { open: false } });
        assert.equal(await laptopUrl(), null);
        await api(laptop.base, '/api/teacher/class', { session, body: { open: true } });
        assert.equal(await laptopUrl(), lanUrl);
    } finally {
        await laptop?.stop();
        await online.stop();
        await new Promise(resolve => pinPlay.close(resolve));
        for (const dir of dirs) removeTemp(dir);
    }
});

test('OpenAI moderation blocks flagged messages and never holds up the rest', { timeout: 120000 }, async () => {
    const seen = [];
    const openai = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            const { input } = JSON.parse(body);
            seen.push({ url: req.url, auth: req.headers.authorization, input });
            res.setHeader('content-type', 'application/json');
            if (/outage/.test(input)) { res.statusCode = 500; return res.end('{}'); }
            const flagged = /hate/.test(input);
            res.end(JSON.stringify({ results: [{ flagged, categories: { harassment: flagged, violence: false } }] }));
        });
    });
    await new Promise(resolve => openai.listen(0, '127.0.0.1', resolve));
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo,
        { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${openai.address().port}` });
    let alex, sam;
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        PIN = (await api(base, '/api/teacher/class', { session, body: { open: true } })).body.pin;
        // With an OpenAI key the default is to post what it clears; these first steps want the teacher as the gate.
        assert.equal((await api(base, '/api/teacher/status', { session })).body.mode, 'review');
        assert.equal((await api(base, '/api/teacher/mode', { session, body: { mode: 'approve' } })).body.mode, 'approve');
        alex = await enter(base, 'signed-a', null);
        const entries = async () => (await api(base, '/api/teacher/status', { session })).body.entries;
        const send = async text => {
            await new Promise(resolve => setTimeout(resolve, 1600)); // chat rate limit
            alex.send({ t: 'chat', text });
            return alex.next(message => message.t === 'notice', `reply to "${text}"`);
        };

        // Flagged by OpenAI: the student is told to rewrite it, the teacher sees why.
        const refused = await send('I hate you all');
        assert.equal(refused.level, 'warning');
        assert.match(refused.text, /rewrite/);
        let entry = (await entries()).find(e => e.text === 'I hate you all');
        assert.deepEqual([entry.status, entry.flag], ['blocked', 'harassment']);

        // Clean: goes to the teacher as before, with no flag.
        assert.match((await send('Nice to meet you')).text, /approval/);
        entry = (await entries()).find(e => e.text === 'Nice to meet you');
        assert.deepEqual([entry.status, entry.flag], ['pending', null]);

        // OpenAI down: the teacher is still the gate, and is told the check did not happen.
        assert.match((await send('outage please')).text, /approval/);
        entry = (await entries()).find(e => e.text === 'outage please');
        assert.deepEqual([entry.status, entry.flag], ['pending', 'moderation unavailable']);

        // The local word filter still runs first, so OpenAI is not asked about it.
        const before = seen.length;
        assert.match((await send('what the shit')).text, /rewrite/);
        assert.equal(seen.length, before);
        assert.ok(seen.every(call => call.url === '/v1/moderations' && call.auth === 'Bearer test-key'));

        // "Approve all" posts everything waiting, oldest first.
        const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
        await api(base, '/api/teacher/approve-all', { session, body: {} });
        const posted = [await alex.next(m => m.t === 'chat' && m.sender === 'Alex', 'first approved'),
            await alex.next(m => m.t === 'chat' && m.sender === 'Alex', 'second approved')];
        assert.deepEqual(posted.map(m => m.text), ['Nice to meet you', 'outage please']);
        assert.ok(posted.every(m => typeof m.id === 'string'));
        await alex.next(m => m.t === 'notice' && /approved/.test(m.text), 'approval notice');
        await alex.next(m => m.t === 'notice' && /approved/.test(m.text), 'approval notice');
        assert.equal((await entries()).filter(e => e.status === 'pending').length, 0);

        // Levels: the teacher stars a good message, once; the student sees the experience arrive, with why.
        const star = body => api(base, '/api/teacher/xp', { session, body });
        assert.equal((await star({ chatId: posted[0].id })).status, 200);
        const gained = await alex.next(m => m.t === 'xp' && m.gained, 'experience');
        assert.deepEqual([gained.xp, gained.gained], [5, 5]);
        assert.match(gained.reason, /Nice to meet you/);
        assert.equal((await star({ chatId: posted[0].id })).status, 400, 'a message earns one star');
        assert.equal((await star({ chatId: 'not-a-message' })).status, 400);
        assert.equal((await entries()).find(e => e.id === posted[0].id).starred, true);
        // A name colour waits for level 1, a flair for level 2, and the extra emotes for level 3.
        alex.send({ t: 'style', colour: 2, flair: null });
        alex.send({ t: 'emote', emote: '🎉' });
        alex.send({ t: 'emote', emote: '👍' });
        assert.equal((await alex.next(m => m.t === 'emote', 'emote')).emote, '👍', 'a locked emote is not sent');
        await star({ chatId: posted[1].id });
        assert.equal((await alex.next(m => m.t === 'xp' && m.gained, 'level 1')).xp, 10);
        alex.send({ t: 'style', colour: 2, flair: '⚽' });
        alex.send({ t: 'style', colour: 2, flair: null });
        assert.deepEqual((await alex.next(m => m.t === 'style', 'style')).style, { colour: 2, flair: null }, 'the flair is refused, the colour shown');
        // It stays for good: back in the plaza, everyone sees it, and the experience is there.
        alex.ws.close();
        await pause(300);
        alex = await enter(base, 'signed-a', null);
        assert.deepEqual(alex.me.style, { colour: 2, flair: null });
        assert.equal((await alex.next(m => m.t === 'xp', 'experience on joining')).xp, 10);
        assert.equal((await api(base, '/api/teacher/status', { session })).body.online.find(s => s.studentKey === 'stu_a').level, 1);

        // The class report: this lesson's log for each student, with the teacher's stars.
        const report = await fetch(`${base}/api/teacher/report?scope=lesson`, { headers: { 'x-teacher-session': session } }).then(r => r.json());
        const alexReport = report.students.find(student => student.studentKey === 'stu_a');
        assert.equal(alexReport.realName, 'Alex');
        assert.equal(alexReport.xp, 10);
        const nice = alexReport.lines.find(entry => entry.text === 'Nice to meet you');
        assert.deepEqual([nice.source, nice.status, nice.starred], ['chat', 'approved', true]);
        assert.equal((await fetch(`${base}/api/teacher/report`)).status, 401, 'teachers only');

        // Review mode: what OpenAI cleared posts at once, with no teacher click.
        const status = (await api(base, '/api/teacher/status', { session })).body;
        assert.deepEqual([status.mode, status.moderation], ['approve', true]);
        assert.equal((await api(base, '/api/teacher/mode', { session, body: { mode: 'review' } })).body.mode, 'review');
        sam = await enter(base, 'signed-b', null);
        await pause(1600);
        alex.send({ t: 'chat', text: 'Good morning everyone' });
        const live = await alex.next(m => m.t === 'chat' && m.text === 'Good morning everyone', 'instant post');
        await sam.next(m => m.t === 'chat' && m.text === 'Good morning everyone', 'heard at once');
        assert.equal((await entries()).find(e => e.text === 'Good morning everyone').status, 'approved');

        // A cleared whisper posts at once too, to its one reader...
        await pause(1600);
        alex.send({ t: 'chat', text: 'Psst, a whisper', to: sam.welcome.id });
        const whispered = await sam.next(m => m.t === 'chat' && m.text === 'Psst, a whisper', 'whisper at once');
        assert.deepEqual([whispered.whisper, whispered.to], [true, 'Sam']);
        assert.equal((await entries()).find(e => e.text === 'Psst, a whisper').status, 'approved');

        // An outage returns the draft for retry instead of creating an approval queue.
        await pause(1600);
        assert.match((await send('outage again')).text, /not sent.*try again/i);
        const waiting = (await entries()).filter(e => e.status === 'pending').map(e => e.text).sort();
        assert.deepEqual(waiting, []);
        assert.equal((await entries()).some(e => e.text === 'outage again'), false);
        const attempts = (await api(base, '/api/teacher/attempts?studentKey=stu_a', { session })).body.attempts;
        assert.ok(attempts.some(a => a.text === 'outage again' && a.status === 'not-sent' && /HTTP 500/.test(a.reason)));

        // The teacher can take a posted message down; it leaves every screen.
        await api(base, '/api/teacher/review', { session, body: { id: live.id, approve: false } });
        assert.equal((await alex.next(m => m.t === 'retract', 'retract')).id, live.id);
        assert.equal((await sam.next(m => m.t === 'retract', 'retract')).id, live.id);
        assert.equal((await entries()).find(e => e.text === 'Good morning everyone').status, 'removed');
    } finally {
        alex?.ws.close();
        sam?.ws.close();
        await plaza.stop();
        await new Promise(resolve => openai.close(resolve));
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test('first-message XP rewards a greeting once, after approval, across restarts and games without AI', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-first-message-'));
    let plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    let alex, sam;
    try {
        let base = plaza.base;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const teacher = (route, body) => api(base, `/api/teacher/${route}`, { session, ...(body ? { body } : {}) });
        const opened = (await teacher('class', { open: true })).body;
        PIN = opened.pin;
        const firstGame = opened.game.id;
        alex = await enter(base, 'signed-a', null); sam = await enter(base, 'signed-b', null);
        await alex.next(m => m.t === 'xp');
        alex.send({ t: 'chat', text: 'Please help me.', to: 'teacher', cid: 'help' });
        await alex.next(m => m.t === 'result' && m.cid === 'help');
        assert.equal(alex.inbox.some(m => m.t === 'xp' && m.gained), false, 'teacher help does not use the welcome bonus');

        const submit = async text => {
            alex.send({ t: 'chat', text, to: sam.me.id });
            await alex.next(m => m.t === 'notice' && /approval/.test(m.text));
            return (await teacher('status')).body.entries.find(e => e.text === text && e.status === 'pending');
        };
        const rejected = await submit('Hi');
        assert.equal(alex.inbox.some(m => m.t === 'xp' && m.gained), false, 'pending messages earn nothing');
        await teacher('review', { id: rejected.id, approve: false });
        await alex.next(m => m.t === 'notice' && /not posted/.test(m.text));
        assert.equal(alex.inbox.some(m => m.t === 'xp' && m.gained), false, 'a rejected message does not use the bonus');
        await new Promise(resolve => setTimeout(resolve, 1550));
        const first = await submit('Hello');
        await teacher('review', { id: first.id, approve: true });
        await sam.next(m => m.t === 'chat' && m.id === first.id);
        const gained = await alex.next(m => m.t === 'xp' && m.gained);
        assert.deepEqual([gained.xp, gained.gained], [1, 1]);
        assert.match(gained.reason, /first message/i);

        alex.ws.close(); sam.ws.close(); await Promise.all([alex.closed, sam.closed]); await plaza.stop();
        plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo); base = plaza.base;
        alex = await enter(base, 'signed-a', null); sam = await enter(base, 'signed-b', null);
        assert.equal((await alex.next(m => m.t === 'xp')).xp, 1, 'the bonus persists after a server restart');
        const repeated = await submit('Hi again');
        await teacher('review', { id: repeated.id, approve: true });
        await sam.next(m => m.t === 'chat' && m.id === repeated.id);

        const next = (await teacher('game', { name: 'Another lesson', randomNames: false })).body;
        PIN = next.pin;
        await Promise.all([alex.closed, sam.closed]);
        await teacher('game/delete', { game: firstGame, confirm: true });
        alex = await enter(base, 'signed-a', null); sam = await enter(base, 'signed-b', null);
        assert.equal((await alex.next(m => m.t === 'xp')).xp, 1, 'changing games and deleting old history cannot reset the bonus');
        const later = await submit('Hello again');
        await teacher('review', { id: later.id, approve: true });
        await sam.next(m => m.t === 'chat' && m.id === later.id);
        alex.ws.close(); await alex.closed;
        alex = await enter(base, 'signed-a', null);
        assert.equal((await alex.next(m => m.t === 'xp')).xp, 1, 'the next game cannot grant another welcome bonus');
    } finally {
        alex?.ws.close(); sam?.ws.close(); await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('small participation XP follows approved delivery, keeps durable limits and ignores removed messages', { timeout: 120000 }, async () => {
    const decisions = []; let releaseDecision, startedDecision;
    const ai = http.createServer(async (req, res) => {
        let body = ''; for await (const chunk of req) body += chunk;
        const request = JSON.parse(body);
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/moderations') return res.end(JSON.stringify({ results: [{ flagged: false, categories: {} }] }));
        assert.equal(req.url, '/v1/decisions');
        assert.equal(request.questions[0].name, 'useful_participation');
        const input = JSON.parse(request.input); decisions.push(input);
        if (input.message.startsWith('Could')) {
            startedDecision?.();
            await new Promise(resolve => { releaseDecision = resolve; });
        }
        res.end(JSON.stringify({ answers: [{ name: 'useful_participation', type: 'predicate', probability: 0.95 }] }));
    });
    await new Promise(resolve => ai.listen(0, '127.0.0.1', resolve));
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const vars = { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${ai.address().port}` };
    let plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo, vars);
    let alex, sam;
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
        let base = plaza.base;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        PIN = (await api(base, '/api/teacher/class', { session, body: { open: true } })).body.pin;
        const teacher = (route, body) => api(base, `/api/teacher/${route}`, { session, ...(body ? { body } : {}) });
        alex = await enter(base, 'signed-a', null);
        await alex.next(m => m.t === 'xp');
        alex.send({ t: 'chat', text: 'Where is the hotel?' });
        await alex.next(m => m.t === 'chat' && m.text === 'Where is the hotel?');
        assert.equal(decisions.length, 0, 'talking to an empty plaza earns nothing and costs no check');
        sam = await enter(base, 'signed-b', null);
        await sam.next(m => m.t === 'xp');
        sam.send({ t: 'chat', text: 'hi hello hi hello', to: alex.me.id });
        await alex.next(m => m.t === 'chat' && m.sender === 'Sam');
        const samFirst = await sam.next(m => m.t === 'xp' && m.gained);
        assert.deepEqual([samFirst.xp, samFirst.gained], [1, 1], 'the first greeting earns encouragement without AI');
        await pause(1550);
        alex.send({ t: 'chat', text: 'Hello Sam!', to: sam.me.id });
        await sam.next(m => m.t === 'chat' && m.text === 'Hello Sam!');
        const alexFirst = await alex.next(m => m.t === 'xp' && m.gained);
        assert.deepEqual([alexFirst.xp, alexFirst.gained], [1, 1]);
        assert.equal(decisions.length, 0, 'greeting loops are filtered locally');

        await teacher('mode', { mode: 'approve' });
        await pause(1550);
        alex.send({ t: 'chat', text: 'What did you find near the fountain?', to: sam.me.id });
        await alex.next(m => m.t === 'notice' && /approval/.test(m.text));
        let entry = (await teacher('status')).body.entries.find(e => e.text === 'What did you find near the fountain?');
        assert.equal(decisions.length, 0, 'pending messages cost no participation check');
        await teacher('review', { id: entry.id, approve: true });
        await sam.next(m => m.t === 'chat' && m.id === entry.id);
        const gained = await alex.next(m => m.t === 'xp' && m.gained);
        assert.deepEqual([gained.xp, gained.gained], [2, 1], 'a genuine question needs no answer yet');
        assert.equal(decisions.length, 1);
        assert.ok(decisions[0].previous.includes('Where is the hotel?'), 'history crosses recipient choices');
        assert.ok(decisions[0].conversation.some(line => !line.self), 'only delivered chat supplies peer context');
        await teacher('review', { id: entry.id, approve: true });
        assert.equal(decisions.length, 1, 'reviewing twice cannot reward twice');

        // Restart the real Worker and reconnect: XP and the API cooldown both persist.
        alex.ws.close(); sam.ws.close(); await pause(100);
        await plaza.stop();
        plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo, vars); base = plaza.base;
        alex = await enter(base, 'signed-a', null); sam = await enter(base, 'signed-b', null);
        assert.equal((await alex.next(m => m.t === 'xp')).xp, 2);
        await sam.next(m => m.t === 'xp');
        await teacher('mode', { mode: 'review' });
        alex.send({ t: 'chat', text: 'Do you enjoy playing football?', to: sam.me.id });
        await sam.next(m => m.t === 'chat' && m.text === 'Do you enjoy playing football?');
        assert.equal(decisions.length, 1, 'reconnecting cannot reset the cooldown');

        const started = new Promise(resolve => { startedDecision = resolve; });
        sam.send({ t: 'chat', text: 'Could you explain the clue about the box?', to: alex.me.id });
        const posted = await alex.next(m => m.t === 'chat' && m.text.startsWith('Could'));
        await started;
        await teacher('review', { id: posted.id, approve: false });
        releaseDecision(); releaseDecision = null;
        await sam.next(m => m.t === 'retract' && m.id === posted.id);
        await pause(200);
        assert.equal(sam.inbox.filter(m => m.t === 'xp' && m.gained).length, 0, 'removed while checking earns no XP');

        // A private request to the teacher never enters the participation pipeline.
        await pause(1550);
        sam.send({ t: 'chat', text: 'Please help me understand this.', to: 'teacher', cid: 'private-help' });
        await sam.next(m => m.t === 'result' && m.cid === 'private-help');
        assert.equal(decisions.length, 2);
        const report = await fetch(`${base}/api/teacher/report`, { headers: { 'x-teacher-session': session } }).then(r => r.json());
        assert.equal(report.students.find(s => s.studentKey === 'stu_a').xp, 2);
        assert.equal(report.students.find(s => s.studentKey === 'stu_b').xp, 1);
    } finally {
        releaseDecision?.(); alex?.ws.close(); sam?.ws.close();
        await plaza.stop(); await new Promise(resolve => pinPlay.close(resolve)); await new Promise(resolve => ai.close(resolve)); removeTemp(persistTo);
    }
});

test('grammar hints advise, never block, and the teacher sees what the student chose', { timeout: 120000 }, async () => {
    const calls = [];
    const openai = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            const request = JSON.parse(body);
            res.setHeader('content-type', 'application/json');
            if (req.url === '/v1/moderations') return res.end(JSON.stringify({ results: [{ flagged: false, categories: {} }] }));
            // The quick gate: sure of a mistake in the "She go" and "broken" messages, sure there is none elsewhere.
            if (req.url === '/v1/decisions') {
                const probability = /^She go |broken/.test(request.input) ? 0.9 : 0.02;
                return res.end(JSON.stringify({ answers: [{ type: 'predicate', name: 'grammar_mistake', probability }] }));
            }
            const text = JSON.parse(request.messages[1].content).message;
            calls.push({ auth: req.headers.authorization, model: request.model, text });
            if (/broken/.test(text)) { res.statusCode = 500; return res.end('{}'); }
            const wrong = /^She go /.test(text);
            const result = wrong ? { ok: false, corrected: 'She goes to school every day', why: 'Use "goes" with "she".' } : { ok: true, corrected: '', why: '' };
            res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
        });
    });
    await new Promise(resolve => openai.listen(0, '127.0.0.1', resolve));
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo,
        { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${openai.address().port}`, OPENAI_GRAMMAR_MODEL: 'test-model' });
    let alex;
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        PIN = (await api(base, '/api/teacher/class', { session, body: { open: true } })).body.pin;
        await api(base, '/api/teacher/mode', { session, body: { mode: 'approve' } }); // these steps want the teacher as the gate
        alex = await enter(base, 'signed-a', null);
        const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
        const hint = async (id, text, attemptId) => {
            await pause(900); // one hint at a time
            alex.send({ t: 'check', id, text, ...(attemptId ? { attemptId } : {}) });
            return alex.next(message => message.t === 'checked' && message.id === id, `hint ${id}`);
        };

        // A clear mistake gets a suggestion and a reason in simple English.
        const wrong = await hint('a', 'She go to school every day');
        assert.deepEqual([wrong.ok, wrong.corrected, wrong.why], [false, 'She goes to school every day', 'Use "goes" with "she".']);
        assert.deepEqual([calls[0].auth, calls[0].model], ['Bearer test-key', 'test-model']);

        // Correct English, a short message and a broken checker are all simply fine.
        assert.equal((await hint('b', 'I like to play games with you')).ok, true);
        const before = calls.length;
        assert.equal((await hint('c', 'hello there')).ok, true);
        assert.equal(calls.length, before, 'short messages cost nothing');
        assert.equal((await hint('d', 'this one is broken for sure')).ok, true);

        // Asking again at once is not allowed to cost another call.
        alex.send({ t: 'check', id: 'e1', text: 'She go to school every day' });
        await alex.next(message => message.t === 'checked' && message.id === 'e1', 'first');
        const spent = calls.length;
        alex.send({ t: 'check', id: 'e2', text: 'She go to school every day' });
        assert.equal((await alex.next(message => message.t === 'checked' && message.id === 'e2', 'second')).ok, true);
        assert.equal(calls.length, spent);

        // The message is sent either way; the teacher is told which the student chose.
        await pause(1600);
        alex.send({ t: 'chat', text: 'She go to school every day', better: 'She goes to school every day' });
        assert.match((await alex.next(message => message.t === 'notice', 'kept')).text, /approval/);
        await pause(1600);
        alex.send({ t: 'chat', text: 'She goes to school every day', was: 'She go to school every day' });
        assert.match((await alex.next(message => message.t === 'notice', 'used')).text, /approval/);
        await pause(1600);
        alex.send({ t: 'chat', text: 'No hint was involved here' });
        await alex.next(message => message.t === 'notice', 'plain');
        const entries = (await api(base, '/api/teacher/status', { session })).body.entries;
        const note = text => entries.find(entry => entry.text === text).note;
        assert.equal(note('She go to school every day'), 'Kept their own words. Suggested: "She goes to school every day"');
        assert.equal(note('She goes to school every day'), 'Used the suggestion. They wrote: "She go to school every day"');
        assert.equal(note('No hint was involved here'), null);

        // A message kept with its mistake reaches everyone with the wrong word marked; the corrected one has none.
        const kept = entries.find(entry => entry.text === 'She go to school every day');
        const used = entries.find(entry => entry.text === 'She goes to school every day');
        await api(base, '/api/teacher/review', { session, body: { id: kept.id, approve: true } });
        const shown = await alex.next(message => message.t === 'chat' && message.text === kept.text, 'kept message shown');
        assert.deepEqual(shown.marks, [[4, 6]]);
        await api(base, '/api/teacher/review', { session, body: { id: used.id, approve: true } });
        const clean = await alex.next(message => message.t === 'chat' && message.text === used.text, 'corrected message shown');
        assert.equal(clean.marks, undefined);
        // One original attempt counts once even when its checker toggles between results.
        const nextGame = (await api(base, '/api/teacher/game', { session, body: { name: 'Grammar assistance', randomNames: false } })).body;
        PIN = nextGame.pin; alex = await enter(base, 'signed-a', null);
        for (let index = 0; index < 3; index++) {
            const attemptId = `hint-attempt-${index}`;
            alex.send({ t: 'attempt', id: attemptId, source: 'chat', text: 'She go to school every day' });
            assert.equal((await hint(`new-hint-${index}`, 'She go to school every day', attemptId)).ok, false);
        }
        let support = (await api(base, '/api/teacher/status', { session })).body.support;
        assert.equal(support.alerts.length, 1); assert.equal(support.alerts[0].topic, 'writing');
        await api(base, '/api/teacher/help-status', { session, body: { id: support.alerts[0].id, status: 'resolved', gameId: nextGame.game.id } });
        assert.equal((await hint('repeat-fine', 'I like to play games with you', 'hint-attempt-2')).ok, true);
        assert.equal((await hint('repeat-hint', 'She go to school every day', 'hint-attempt-2')).ok, false);
        assert.equal((await api(base, '/api/teacher/status', { session })).body.support.alerts.length, 0, 'replaying a hint does not count again after resolution');
        alex.send({ t: 'chat', text: 'She goes to school every day', was: 'She go to school every day', attemptId: 'hint-attempt-2', cid: 'corrected-assistance' });
        await alex.next(m => m.t === 'notice' && m.cid === 'corrected-assistance');
        const audit = (await api(base, '/api/teacher/attempts?studentKey=stu_a', { session })).body.attempts;
        const corrected = audit.find(a => a.finalText === 'She goes to school every day');
        assert.equal(corrected.text, 'She go to school every day'); assert.equal(corrected.correction, 'She goes to school every day');
        assert.equal(corrected.status, 'pending');
        await api(base, '/api/teacher/campaign', { session, body: { op: 'start', campaign: 'castanyada' } });
        for (let index = 0; index < 3; index++) {
            if (index) await pause(3100);
            alex.send({ t: 'answer', objective: 'where', text: 'moon' });
            assert.equal((await alex.next(m => m.t === 'answered' && m.objective === 'where')).correct, false);
        }
        support = (await api(base, '/api/teacher/status', { session })).body.support;
        assert.equal(support.alerts.length, 1); assert.equal(support.alerts[0].topic, 'instructions');
        assert.ok(support.alerts[0].evidence.every(e => e.reason.includes('Where is the blue box?')));
    } finally {
        alex?.ws.close();
        await plaza.stop();
        await new Promise(resolve => openai.close(resolve));
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test('a campaign: random fixed roles, private clues, discoveries, answers, chapters, and resuming', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const join = async token => {
        const socket = await enter(plaza.base, token, null);
        sockets.push(socket);
        return { socket, quest: (await socket.next(message => message.t === 'quest', 'quest')).quest };
    };
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const opened = (await api(base, '/api/teacher/class', { session, body: { open: true } })).body;
        PIN = opened.pin;
        assert.equal(opened.campaign, null);
        assert.deepEqual(opened.campaigns.map(item => item.id), ['castanyada', 'castanyada-side-quests', 'castanyada-complete', 'castanyada-investigations', 'plaza-free-play']);
        assert.deepEqual(opened.campaigns.find(item => item.id === 'castanyada-investigations'),
            { id: 'castanyada-investigations', title: 'Castanyada: Witness Investigations', revision: opened.campaigns.find(item => item.id === 'castanyada-investigations').revision, chapters: ['The Missing Chestnuts', 'Conflicting Stories', 'The Hotel Cellar', 'The Missing Festival Plan', 'The Haunted Celebration'],
                mystery: true, partnerQuests: true, witnesses: true });

        // No story yet: nothing is sent.
        const early = await enter(base, 'signed-a', null);
        sockets.push(early);
        await pause(300);
        assert.equal(early.inbox.some(message => message.t === 'quest'), false);

        // The teacher starts it; everyone inside gets a role, and anyone arriving later does too.
        assert.equal((await api(base, '/api/teacher/campaign', { session, body: { op: 'start', campaign: 'nope' } })).status, 400);
        const started = (await api(base, '/api/teacher/campaign', { session, body: { op: 'start', campaign: 'castanyada' } })).body;
        assert.equal(started.campaign.status, 'active');
        assert.equal((await api(base, '/api/teacher/campaign', { session, body: { op: 'start', campaign: 'castanyada' } })).status, 400);
        const alexQuest = (await early.next(message => message.t === 'quest', 'alex quest')).quest;
        const sam = await join('signed-b');
        const chris = await join('signed-c');
        const quests = { alex: alexQuest, sam: sam.quest, chris: chris.quest };
        assert.equal(new Set(Object.values(quests).map(quest => quest.role.id)).size, 3, 'three students, three different roles');

        // Each student keeps their own job clue; missing roles have labeled notices.
        for (const quest of Object.values(quests)) {
            assert.equal(quest.clues.filter(clue => clue.from === 'job').length, 1);
            assert.equal(quest.status, 'active');
            assert.equal(quest.chapter.ending, null);
            assert.ok(quest.clues.filter(clue => clue.id.startsWith('fallback-')).every(clue => clue.from === 'town notice'));
        }

        // Walking into a named place reveals a clue, once.
        await pause(300); // Joining classmates also refresh absent-role notices.
        chris.socket.inbox.splice(0, chris.socket.inbox.length);
        chris.socket.send({ t: 'move', x: 1470, y: 1241 });
        const found = (await chris.socket.next(message => message.t === 'quest' && message.quest.clues.some(c => c.from === 'park'), 'park clue')).quest;
        assert.match(found.clues[1].text, /blue lock/);
        chris.socket.send({ t: 'move', x: 5, y: 5 });
        chris.socket.send({ t: 'move', x: 1470, y: 1241 });
        await pause(300);
        assert.equal(chris.socket.inbox.some(message => message.t === 'quest'), false, 'the same place gives nothing twice');

        // Closing the game is the checkpoint: reopening it brings back the same roles and finds.
        await api(base, '/api/teacher/class', { session, body: { open: false } });
        assert.equal(await chris.socket.closed, 4002);
        await api(base, '/api/teacher/class', { session, body: { open: true } });
        const alexBack = await join('signed-a');
        const samBack = await join('signed-b');
        const chrisBack = await join('signed-c');
        assert.equal(alexBack.quest.role.id, quests.alex.role.id);
        assert.equal(samBack.quest.role.id, quests.sam.role.id);
        assert.equal(chrisBack.quest.role.id, quests.chris.role.id);
        assert.ok(chrisBack.quest.clues.some(c => c.from === 'park'));
        assert.equal(alexBack.quest.recap, null, 'nothing to recall yet');
        assert.match(chrisBack.quest.recap, /Last time/);

        // Teacher reveals: prepared news goes to everyone, in order, until there is no more.
        const chapter = castanyada.chapters[0];
        const reveal = () => api(base, '/api/teacher/campaign', { session, body: { op: 'reveal' } });
        let revealed = (await reveal()).body.campaign;
        assert.deepEqual([revealed.reveals.shown, revealed.reveals.total], [1, 2]);
        for (const who of [alexBack, samBack, chrisBack]) {
            const news = (await who.socket.next(message => message.t === 'quest' && message.quest.clues.some(clue => clue.from === 'news'), 'news')).quest;
            assert.equal(news.clues.find(clue => clue.from === 'news').text, chapter.reveals[0].text);
        }
        // Leave one news item for students who are still working after the threshold.

        // Answers: questions open one after another; a wrong one must wait before another try;
        // a right one earns a clue for your role and opens the next question.
        const answer = (who, text, objective = 'where') => who.socket.send({ t: 'answer', objective, text });
        const result = who => who.socket.next(message => message.t === 'answered', 'answer result');
        answer(alexBack, '9:30', 'when');
        await pause(300);
        assert.equal(alexBack.socket.inbox.some(message => message.t === 'answered'), false, 'a locked question is not answered');
        answer(alexBack, 'In the hotel');
        assert.deepEqual((({ correct, wait }) => ({ correct, wait }))(await result(alexBack)), { correct: false, wait: false });
        answer(alexBack, 'the park');
        assert.equal((await result(alexBack)).wait, true);
        await pause(3200);
        answer(alexBack, 'It is in the park');
        assert.equal((await result(alexBack)).correct, true);
        // A right answer earns experience, once; wrong ones earn nothing.
        const earned = await alexBack.socket.next(message => message.t === 'xp' && message.gained, 'experience for the answer');
        assert.deepEqual([earned.gained, earned.reason], [2, 'Right answer in your journal']);
        const next = (await alexBack.socket.next(message => message.t === 'quest' && message.quest.objectives.some(item => item.id === 'when'), 'next question')).quest;
        assert.ok(next.clues.some(clue => clue.from === 'reward' && clue.text === chapter.objectives[0].rewards[next.role.id]), 'a clue for their role');
        assert.deepEqual(next.objectives.filter(item => item.optional).map(item => item.id).sort(), ['lock', 'note']);
        assert.equal(JSON.stringify(next).includes('"keys"'), false, 'later questions stay hidden');
        let status = (await api(base, '/api/teacher/status', { session })).body.campaign;
        assert.equal(status.status, 'active');

        // Sam answers all three main questions; Alex the other two. Two of three students finish the chapter.
        answer(samBack, 'park!');
        assert.equal((await result(samBack)).correct, true);
        answer(samBack, 'Half past nine', 'when');
        assert.equal((await result(samBack)).correct, true);
        answer(samBack, 'two', 'keys');
        assert.equal((await result(samBack)).correct, true);
        answer(alexBack, 'at 9:30', 'when');
        assert.equal((await result(alexBack)).correct, true);
        answer(alexBack, '2', 'keys');
        assert.equal((await result(alexBack)).correct, true);
        for (const who of [alexBack, samBack, chrisBack]) {
            const done = (await who.socket.next(message => message.t === 'quest' && message.quest.status === 'chapter_complete', 'chapter complete')).quest;
            if (who === chrisBack) assert.equal(done.chapter.ending, null, 'unfinished students do not see the ending at the class threshold');
            else assert.match(done.chapter.ending, /Who took the chestnuts/);
            assert.ok(done.objectives.some(item => !item.optional), 'main questions remain available');
            assert.deepEqual(done.team, { done: 6, total: 9 }, 'six of nine main answers: two students finished all three');
        }
        assert.equal((await reveal()).status, 200, 'teacher can still help students after the threshold');
        assert.equal((await reveal()).status, 400, 'no more news to reveal');

        // Both bonus questions and the remaining main questions can still be answered.
        answer(alexBack, 'a star', 'lock');
        assert.equal((await result(alexBack)).correct, true);
        answer(chrisBack, 'park', 'where');
        assert.equal((await result(chrisBack)).correct, true);
        const catchUp = (await chrisBack.socket.next(message => message.t === 'quest' && message.quest.objectives.some(item => item.id === 'when'), 'catch-up question')).quest;
        assert.equal(catchUp.status, 'chapter_complete');
        assert.equal(catchUp.chapter.ending, null);
        assert.ok(catchUp.clues.some(clue => clue.from === 'reward'));
        answer(chrisBack, '9:30', 'when');
        assert.equal((await result(chrisBack)).correct, true);
        answer(chrisBack, 'two', 'keys');
        assert.equal((await result(chrisBack)).correct, true);
        const personalEnding = (await chrisBack.socket.next(message => message.t === 'quest' && message.quest.chapter.ending !== null, 'personal ending after catch-up')).quest;
        assert.match(personalEnding.chapter.ending, /Who took the chestnuts/);
        status = (await api(base, '/api/teacher/status', { session })).body.campaign;
        assert.equal(status.status, 'chapter_complete');
        assert.deepEqual(status.players.map(player => player.done.length).sort(), [3, 3, 4]);

        // The teacher moves the story on to chapter 2, and from there to the end of the campaign.
        const second = (await api(base, '/api/teacher/campaign', { session, body: { op: 'next' } })).body.campaign;
        assert.deepEqual([second.status, second.chapter], ['active', 1]);
        const third = (await api(base, '/api/teacher/campaign', { session, body: { op: 'next' } })).body.campaign;
        assert.deepEqual([third.status, third.chapter], ['active', 2]);
        assert.equal((await api(base, '/api/teacher/campaign', { session, body: { op: 'next' } })).body.campaign.status, 'campaign_complete');
        const over = (await alexBack.socket.next(message => message.t === 'quest' && message.quest.status === 'campaign_complete', 'the end')).quest;
        assert.equal(over.finale, 'The end. Happy Castanyada!');
        assert.equal((await api(base, '/api/teacher/campaign', { session, body: { op: 'next' } })).status, 400);

        // Erasing it takes a confirmation, and everyone's story disappears.
        assert.equal((await api(base, '/api/teacher/campaign', { session, body: { op: 'reset' } })).status, 400);
        assert.equal((await api(base, '/api/teacher/campaign', { session, body: { op: 'reset', confirm: true } })).body.campaign, null);
        assert.equal((await alexBack.socket.next(message => message.t === 'quest' && message.quest === null, 'story removed')).quest, null);
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test('shown names: first name alone, then a surname letter for namesakes, updating the Rogers already there', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    const join = async token => { const socket = await enter(plaza.base, token, null); sockets.push(socket); return socket; };
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        PIN = (await api(base, '/api/teacher/game', { session, body: { name: 'First names', randomNames: false } })).body.pin;
        const nameOf = (socket, id) => socket.welcome.players.find(player => player.id === id)?.name;

        // The first Roger keeps just the first name while he is alone.
        const first = await join('roger-1');
        assert.equal(first.me.name, 'Roger');
        const ana = await join('signed-a');
        assert.equal(nameOf(ana, first.welcome.id), 'Roger');
        assert.equal(ana.me.name, 'Alex');

        // A second Roger arrives: he is Roger C, and the first one is renamed to Roger L on everyone's screen.
        const second = await join('roger-2');
        assert.equal(second.me.name, 'Roger C');
        assert.equal(nameOf(second, first.welcome.id), 'Roger L');
        const renamed = await first.next(message => message.t === 'rename' && message.id === first.welcome.id, 'rename');
        assert.equal(renamed.name, 'Roger L');
        assert.equal((await ana.next(message => message.t === 'rename' && message.id === first.welcome.id, 'rename seen')).name, 'Roger L');
        assert.equal(ana.inbox.some(message => message.t === 'rename' && message.id === ana.welcome.id), false, 'other names are left alone');

        // The teacher sees the same names, and chat carries them.
        const online = (await api(base, '/api/teacher/status', { session })).body.online.map(student => student.name).sort();
        assert.deepEqual(online, ['Alex', 'Roger C', 'Roger L']);

        // A third Roger with the same initial makes the two L's tell themselves apart.
        const third = await join('roger-3');
        assert.equal(third.me.name, 'Roger Ll');
        assert.equal((await first.next(message => message.t === 'rename' && message.id === first.welcome.id, 'second rename')).name, 'Roger Lo');
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test('random names: a made-up name to keep, hidden from classmates, known to the teacher', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    const join = async token => { const socket = await enter(plaza.base, token, null); sockets.push(socket); return socket; };
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        // Random names are the default for a new game.
        const created = (await api(base, '/api/teacher/game', { session, body: { name: '3A' } })).body;
        PIN = created.pin;
        assert.equal(created.game.randomNames, true);

        // Nobody is shown by a real name, and each student is offered a name to keep or change.
        const alex = await join('signed-a');
        const offered = await alex.next(message => message.t === 'alias', 'alias offered');
        assert.equal(offered.kept, false);
        assert.match(offered.name, /^[A-Z][a-z]+ [A-Za-z]+$/);
        assert.equal(alex.me.name, offered.name);
        assert.notEqual(alex.me.name, 'Alex');
        const sam = await join('signed-b');
        const samOffer = await sam.next(message => message.t === 'alias', 'alias for Sam');
        assert.notEqual(samOffer.name, offered.name);
        assert.equal(sam.welcome.players.find(player => player.id === alex.welcome.id).name, offered.name);

        // Until a name is kept, chat is refused and the draft comes back.
        alex.send({ t: 'chat', text: 'Hello there', cid: 'c1' });
        assert.match((await alex.next(message => message.t === 'notice', 'choose first')).text, /Choose your name first/);

        // Asking for another name renames them for everyone, and never repeats a name in use.
        await pause(400);
        alex.send({ t: 'reroll' });
        const another = await alex.next(message => message.t === 'alias', 'another name');
        assert.notEqual(another.name, offered.name);
        assert.equal((await sam.next(message => message.t === 'rename' && message.id === alex.welcome.id, 'rename seen')).name, another.name);

        // Keeping it is final: no more changes, and chat opens.
        alex.send({ t: 'keep' });
        assert.equal((await alex.next(message => message.t === 'alias' && message.kept, 'kept')).name, another.name);
        await pause(400);
        alex.send({ t: 'reroll' });
        assert.equal((await alex.next(message => message.t === 'alias', 'still the same')).name, another.name);
        await pause(1600);
        alex.send({ t: 'chat', text: 'Hello there' });
        assert.match((await alex.next(message => message.t === 'notice', 'sent')).text, /approval|posted/i);

        // The teacher sees the made-up name with the real one beside it.
        const status = (await api(base, '/api/teacher/status', { session })).body;
        const onlineAlex = status.online.find(student => student.studentKey === 'stu_a');
        assert.deepEqual({ studentKey: onlineAlex.studentKey, name: onlineAlex.name }, { studentKey: 'stu_a', name: another.name });
        assert.equal(status.realNames.stu_a, 'Alex');
        assert.equal(status.entries.find(entry => entry.text === 'Hello there').sender, another.name);

        // Closing and reopening the game brings back the kept name, already final.
        await api(base, '/api/teacher/class', { session, body: { open: false } });
        await alex.closed;
        await api(base, '/api/teacher/class', { session, body: { open: true } });
        const back = await join('signed-a');
        const backAlias = await back.next(message => message.t === 'alias', 'alias after reopening');
        assert.deepEqual([backAlias.name, backAlias.kept], [another.name, true]);
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test('movement: no walking through walls, no teleporting, but real walking is believed', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo, { MOVEMENT_CHECK: '1' });
    const sockets = [];
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        PIN = (await api(base, '/api/teacher/class', { session, body: { open: true } })).body.pin;
        const alex = await enter(base, 'signed-a', null);
        const sam = await enter(base, 'signed-b', null);
        sockets.push(alex, sam);
        const { x, y } = alex.me;
        const snapBack = () => alex.next(message => message.t === 'snap', 'put back');

        // A normal step. Moves reach others in batches, so the refused moves below go
        // straight after it, before the batch, to be judged against how little time has passed.
        await pause(300);
        alex.send({ t: 'move', x: x + 20, y });

        // Stepping into the fountain is refused, and Alex is told where they really are.
        alex.send({ t: 'move', x: 590, y: 1280 }); // the fountain basin: far, and a wall
        assert.deepEqual(((s) => [s.x, s.y])(await snapBack()), [x + 20, y]);

        // So is appearing across the map, even somewhere open.
        alex.send({ t: 'move', x: 1100, y: 740 });
        assert.deepEqual(((s) => [s.x, s.y])(await snapBack()), [x + 20, y]);

        // And a short hop into the top of the fountain.
        alex.send({ t: 'move', x: x + 20, y: y + 100 });
        await snapBack();
        // The step is passed on to everyone; the refused moves are not.
        const seen = await sam.next(message => message.t === 'move' && message.id === alex.welcome.id, 'a step');
        assert.deepEqual([seen.x, seen.y], [x + 20, y]);
        await pause(300);
        assert.equal(sam.inbox.filter(message => message.t === 'move' && message.id === alex.welcome.id && message.y !== y).length, 0, 'refused moves never reach anyone');

        // The same distance walked over time is fine: a long walk, given the seconds it takes.
        // Spawn positions vary; north can cross a tree. Choose a clear 100-pixel path so this
        // checks the server's timing allowance rather than assuming the terrain is empty.
        const destination = [{ x: x + 20, y: y - 100 }, { x: x + 120, y }, { x: x - 80, y }]
            .find(point => legalMove(x + 20, y, point.x, point.y, 1500));
        assert.ok(destination, 'there is a clear path for the timing check');
        await pause(1500);
        alex.send({ t: 'move', ...destination });
        const walked = await sam.next(message => message.t === 'move' && message.id === alex.welcome.id, 'a longer walk');
        assert.deepEqual([walked.x, walked.y], [destination.x, destination.y]);
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test('chapter 2: a secret thief among the students, clues that describe how they look, and names as answers', { timeout: 240000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        PIN = (await api(base, '/api/teacher/game', { session, body: { name: '3A', randomNames: true } })).body.pin;
        const byKey = {};
        for (const token of ['signed-a', 'signed-b', 'signed-c']) {
            const socket = await enter(base, token, null);
            sockets.push(socket);
            await socket.next(message => message.t === 'alias', 'alias');
            socket.send({ t: 'keep' });
            byKey[students[token].studentKey] = socket;
        }
        const teacher = body => api(base, '/api/teacher/campaign', { session, body });
        const status = async () => (await api(base, '/api/teacher/status', { session })).body.campaign;
        const lastQuest = key => [...byKey[key].inbox].reverse().find(message => message.t === 'quest')?.quest;

        // Roles and the thief are random: start chapter 2 over until a student who is not the thief has a
        // shopkeeper and a planner to find among the others.
        let campaign;
        let solver;
        for (let attempt = 0; attempt < 120 && !solver; attempt++) {
            if (attempt) await teacher({ op: 'reset', confirm: true });
            await teacher({ op: 'start', campaign: 'castanyada' });
            campaign = (await teacher({ op: 'next' })).body.campaign;
            solver = campaign.players.find(me => !me.thief
                && campaign.players.some(other => other.role === 'Shopkeeper' && other.studentKey !== me.studentKey)
                && campaign.players.some(other => other.role === 'Festival planner' && other.studentKey !== me.studentKey));
        }
        assert.ok(solver, 'found a setup to play');
        await pause(500);

        // Exactly one thief for three students, who alone has the secret and a story to tell.
        const thieves = campaign.players.filter(player => player.thief);
        assert.equal(thieves.length, 1);
        const thief = thieves[0];
        assert.equal(lastQuest(thief.studentKey).secret.title, 'You are the thief');
        assert.match(lastQuest(thief.studentKey).clues[0].text, /^Your story: At 9:25 I was at the hotel desk/);
        for (const player of campaign.players.filter(item => !item.thief)) assert.equal(lastQuest(player.studentKey).secret, null);
        assert.equal(lastQuest(thief.studentKey).objectives.some(item => item.id === 'thief'), false, 'the thief is never asked who the thief is');

        // The clues describe the thief's avatar (the default look here: black hair, no hat, no glasses).
        const clueFor = (role, from = 'job') => campaign.players.filter(player => player.role === role)
            .map(player => lastQuest(player.studentKey)?.clues.find(clue => clue.from === from)?.text).find(Boolean);
        const expected = { Baker: 'They wore no hat.', Shopkeeper: 'They had no glasses.', Driver: 'They had black hair.' };
        for (const [role, sentence] of Object.entries({ 'Café baker': expected.Baker, Shopkeeper: expected.Shopkeeper, Driver: expected.Driver })) {
            const text = clueFor(role);
            if (text && !campaign.players.find(player => player.role === role && player.thief)) assert.ok(text.endsWith(sentence), `${role}: ${text}`);
        }

        // Finding the shopkeeper, then the planner, then naming the thief, always by the made-up name.
        const answer = (key, objective, text) => byKey[key].send({ t: 'answer', objective, text });
        const result = key => byKey[key].next(message => message.t === 'answered', 'result');
        const names = Object.fromEntries(campaign.players.map(player => [player.studentKey, player.name]));
        const shop = campaign.players.find(player => player.role === 'Shopkeeper' && player.studentKey !== solver.studentKey);
        const planner = campaign.players.find(player => player.role === 'Festival planner' && player.studentKey !== solver.studentKey);
        answer(solver.studentKey, 'meet-shop', 'Banana Splits');
        assert.equal((await result(solver.studentKey)).correct, false);
        await pause(3200);
        answer(solver.studentKey, 'meet-shop', names[shop.studentKey]);
        assert.equal((await result(solver.studentKey)).correct, true);
        answer(solver.studentKey, 'meet-planner', names[planner.studentKey]);
        assert.equal((await result(solver.studentKey)).correct, true);
        await byKey[solver.studentKey].next(message => message.t === 'quest' && message.quest?.objectives.some(item => item.id === 'thief'), 'who took it');
        const innocent = campaign.players.find(player => !player.thief && player.studentKey !== solver.studentKey);
        answer(solver.studentKey, 'thief', names[(innocent ?? solver).studentKey]);
        assert.equal((await result(solver.studentKey)).correct, false, 'an innocent classmate is not the thief');
        await pause(3200);
        answer(solver.studentKey, 'thief', names[thief.studentKey]);
        assert.equal((await result(solver.studentKey)).correct, true);

        // The written bonus needs a few words, and the teacher can read it.
        answer(solver.studentKey, 'report-2', 'Maybe');
        assert.equal((await result(solver.studentKey)).correct, false, 'too short to count');
        await pause(3200);
        answer(solver.studentKey, 'report-2', 'The hotel was closed, so the story is false.');
        assert.equal((await result(solver.studentKey)).correct, true);
        assert.deepEqual((await status()).reports.map(report => [report.studentKey, report.text]), [[solver.studentKey, 'The hotel was closed, so the story is false.']]);
        // The made-up name is what works, not the real one.
        assert.notEqual(names[thief.studentKey], (await api(base, '/api/teacher/status', { session })).body.realNames[thief.studentKey]);
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test('the thief is never a student who is not there', { timeout: 240000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        PIN = (await api(base, '/api/teacher/game', { session, body: { name: '3A', randomNames: false } })).body.pin;
        const join = async token => { const socket = await enter(base, token, null); sockets.push(socket); return socket; };
        const teacher = body => api(base, '/api/teacher/campaign', { session, body });
        const a = await join('signed-a');
        const b = await join('signed-b');
        let c = await join('signed-c');
        for (let round = 0; round < 8; round++) {
            // Everyone has played chapter 1; then Chris goes home before chapter 2 starts.
            await teacher({ op: 'reset', confirm: true });
            await teacher({ op: 'start', campaign: 'castanyada' });
            c.ws.close();
            await c.closed;
            await new Promise(resolve => setTimeout(resolve, 200));
            const campaign = (await teacher({ op: 'next' })).body.campaign;
            const thieves = campaign.players.filter(player => player.thief).map(player => player.studentKey);
            assert.equal(thieves.length, 1, `one thief for a small class, round ${round}: ${JSON.stringify(campaign.players)}`);
            assert.notEqual(thieves[0], 'stu_c', 'the student who went home is never the thief');
            c = await join('signed-c');
        }
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test('limited vision: a radius per game that the teacher can change while students play', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const vision = radius => api(base, '/api/teacher/vision', { session, body: { radius } });

        // A new game limits vision by default, and a student is told as they arrive.
        const created = (await api(base, '/api/teacher/game', { session, body: { name: '3A', randomNames: false } })).body;
        PIN = created.pin;
        assert.equal(created.game.vision, 450);
        const alex = await enter(base, 'signed-a', null);
        sockets.push(alex);
        assert.equal((await alex.next(message => message.t === 'vision', 'told at arrival')).radius, 450);

        // The teacher can widen it, show everyone, or narrow it, and students hear at once.
        assert.equal((await vision(650)).body.game.vision, 650);
        assert.equal((await alex.next(message => message.t === 'vision', 'widened')).radius, 650);
        await vision(0);
        assert.equal((await alex.next(message => message.t === 'vision', 'everyone')).radius, 0);
        assert.equal((await vision(99999)).body.game.vision, 2000, 'a silly size is kept within reason');
        assert.equal((await alex.next(message => message.t === 'vision', 'clamped')).radius, 2000);
        assert.equal((await api(base, '/api/teacher/vision', { session, body: { radius: 'wide' } })).status, 400);

        // A game can be made with everyone visible, and a game from before this setting shows everyone too.
        const open = (await api(base, '/api/teacher/game', { session, body: { name: '3B', randomNames: false, vision: 0 } })).body;
        assert.equal(open.game.vision, 0);
        assert.equal(open.games.length, 2);
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test('the warm-up: a secret fact, someone to find by name, progress for everyone, and a late joiner', { timeout: 180000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        PIN = (await api(base, '/api/teacher/game', { session, body: { name: '3A', randomNames: true } })).body.pin;
        const players = {};
        const join = async token => {
            const socket = await enter(base, token, null);
            sockets.push(socket);
            const alias = await socket.next(message => message.t === 'alias', 'alias');
            socket.send({ t: 'keep' });
            players[students[token].studentKey] = socket;
            return alias.name;
        };
        const warmup = body => api(base, '/api/teacher/warmup', { session, body });

        // It needs at least two students in the plaza.
        await join('signed-a');
        assert.equal((await warmup({ op: 'start' })).status, 400);
        await join('signed-b');
        await join('signed-c');
        await pause(300);

        const started = (await warmup({ op: 'start' })).body.warmup;
        assert.equal(started.active, true);
        assert.equal(started.players.length, 3);
        const views = {};
        for (const [key, socket] of Object.entries(players)) {
            views[key] = (await socket.next(message => message.t === 'warmup' && message.warmup, 'warm-up')).warmup;
            assert.match(views[key].fact, /^You /);
            assert.match(views[key].task, /^Find someone who /);
            assert.deepEqual([views[key].step, views[key].of], [0, 2], 'two people to find among three students');
        }
        // A student sees only their own fact: nobody else's appears in their messages.
        for (const [key, socket] of Object.entries(players))
            for (const other of started.players.filter(player => player.studentKey !== key)) assert.equal(JSON.stringify(socket.inbox).includes(other.fact), false);

        // Naming a classmate who has the fact being looked for: the made-up name works, one's own and a wrong one do not.
        const names = Object.fromEntries(started.players.map(player => [player.studentKey, player.name]));
        const asker = 'stu_a';
        const wantedId = FACTS.find(fact => `Find someone who ${fact.find}.` === views[asker].task).id;
        const holder = started.players.find(player => player.studentKey !== asker && FACTS.find(fact => fact.mine === player.fact).id === wantedId);
        assert.ok(holder, 'someone else has the fact being looked for');
        const answer = text => players[asker].send({ t: 'warmup-answer', text });
        const result = () => players[asker].next(message => message.t === 'warmup-answered', 'result');
        answer(names[asker]);
        assert.equal((await result()).correct, false, 'your own name does not count');
        await pause(3200);
        answer(names[holder.studentKey]);
        assert.equal((await result()).correct, true);
        const next = (await players[asker].next(message => message.t === 'warmup' && message.warmup && message.warmup.step === 1, 'next person')).warmup;
        assert.notEqual(next.task, views[asker].task);
        assert.deepEqual(next.team, { done: 1, total: 6 }, 'one found of six in all');

        // Everyone else's bar moves too, and the teacher sees who has what.
        const other = await players.stu_b.next(message => message.t === 'warmup' && message.warmup && message.warmup.team.done === 1, 'progress for others');
        assert.equal(other.warmup.step, 0);
        const status = (await api(base, '/api/teacher/status', { session })).body;
        assert.equal(status.warmup.team.done, 1);
        assert.equal(status.realNames.stu_a, 'Alex');

        // Someone who arrives late is given a fact that is already in play, held by a classmate still here:
        // Chris has left, so nobody is sent looking for Chris's fact alone.
        players.stu_c.ws.close();
        await pause(500);
        const late = await enter(base, 'roger-1', null);
        sockets.push(late);
        await late.next(message => message.t === 'alias', 'alias');
        late.send({ t: 'keep' });
        const lateView = (await late.next(message => message.t === 'warmup' && message.warmup, 'late warm-up')).warmup;
        assert.match(lateView.fact, /^You /);
        assert.ok(lateView.of >= 1);
        const factOf = studentKey => FACTS.find(fact => fact.mine === started.players.find(player => player.studentKey === studentKey).fact);
        const wanted = FACTS.find(fact => `Find someone who ${fact.find}.` === lateView.task);
        assert.ok([factOf('stu_a'), factOf('stu_b')].includes(wanted), 'the late part looks for a classmate who is here');
        // ...and everyone's team total grows to include the newcomer's part.
        const grown = await players.stu_a.next(message => message.t === 'warmup' && message.warmup?.team.total === 6 + lateView.of, 'total includes the late part');
        assert.equal(grown.warmup.team.done, 1);

        // Ending it takes the panel away.
        assert.equal((await warmup({ op: 'end' })).body.warmup.active, false);
        assert.equal((await players.stu_b.next(message => message.t === 'warmup' && message.warmup === null, 'ended')).warmup, null);
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test('five-chapter Castanyada: new mysteries, private side notes, partnered reports and finale', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-five-chapters-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const teacher = (op, body) => api(base, `/api/teacher/${op}`, { session, body });
        PIN = (await teacher('game', { name: 'Five-chapter class', randomNames: false })).body.pin;
        const alex = await enter(base, 'signed-a', null); const sam = await enter(base, 'signed-b', null);
        sockets.push(alex, sam);
        const view = (socket, index, predicate) => socket.next(m => m.t === 'quest' && m.quest?.chapter.index === index && predicate(m.quest), 'five-chapter journal').then(m => m.quest);
        const answer = async (socket, objective, text) => {
            socket.send({ t: 'answer', objective, text });
            assert.equal((await socket.next(m => m.t === 'answered' && m.objective === objective, `answer ${objective}`)).correct, true);
        };
        assert.equal((await teacher('missions/get?id=castanyada-complete')).body.draft.campaign.chapters.length, 5);
        const started = (await teacher('campaign', { op: 'start', campaign: castanyadaComplete.id })).body.campaign;
        assert.equal(started.chapters, 5);
        await teacher('campaign', { op: 'next' }); await teacher('campaign', { op: 'next' });
        assert.equal((await teacher('campaign', { op: 'next' })).body.campaign.chapter, 3);
        const mainReport = 'We recommend the hotel hall for rehearsal at half past five. Keep both exits clear and use battery lights inside paper lanterns. The hot food table needs space away from decorations. We would discuss the delivery route and welcome area with the driver and receptionist before agreeing on the final layout.';
        assert.ok(mainReport.length > 200 && mainReport.length < 1000);
        const chapters = [
            { index: 3, answers: [['plan-location', 'hotel'], ['plan-rehearsal', '5:30'], ['plan-venue', 'hotel'], ['plan-proposal', mainReport]] },
            { index: 4, answers: [['lantern-location', 'park'], ['lantern-sound', 'wind'], ['festival-special-guests', 'new neighbors'], ['festival-welcome-proposal', 'Wind whistles through the torn paper lantern, and the sound stops when the wind stops. The surprise welcomes our new neighbors. We suggest offering a choice of conversation, food or a quiet seat so visitors can join comfortably.']] },
        ];
        for (const { index, answers } of chapters) {
            const chapter = castanyadaComplete.chapters[index];
            const boardQuests = chapter.objectives.filter(o => o.board);
            const initial = await view(alex, index, q => q.objectives.length === 1);
            assert.equal(initial.secret, null);
            assert.equal(initial.chapter.of, 5);
            assert.ok(initial.board.every(o => o.state === 'waiting'));
            for (const [objective, text] of answers) await answer(alex, objective, text);
            const waiting = await view(alex, index, q => q.board.some(o => o.reason?.includes('different role')));
            assert.equal(waiting.chapter.ending, null, 'one of two finished students does not trigger readiness');
            for (const [objective, text] of answers) await answer(sam, objective, text);
            const ready = await view(alex, index, q => q.status === 'chapter_complete' && q.board.some(o => o.state === 'available'));
            assert.ok(ready.chapter.ending);
            const samReady = await view(sam, index, q => q.status === 'chapter_complete');
            assert.notEqual(ready.role.id, samReady.role.id);
            const dossier = chapter.objectives.find(o => o.id === answers.at(-1)[0]).rewards;
            assert.ok(ready.clues.some(c => c.from === 'reward' && c.text === dossier[ready.role.id]));
            assert.ok(!ready.clues.some(c => c.text === dossier[samReady.role.id]), 'online partner keeps their distinct side notes private');
            for (const quest of boardQuests) {
                alex.send({ t: 'quest-accept', objective: quest.id });
                const active = await view(alex, index, q => q.board.some(o => o.id === quest.id && o.state === 'active'));
                assert.equal(active.board.find(o => o.id === quest.id).partner.name, sam.me.name);
                await exchangeEvidence(teacher, alex, sam, quest.id);
                await answer(alex, quest.id, 'My partner explained their evidence and I asked a follow-up question. We compared two possibilities, changed one part of our proposal after listening and agreed on a recommendation for the festival committee. Our report records both contributions and the reason for our final decision.');
                await view(alex, index, q => q.board.some(o => o.id === quest.id && o.state === 'done'));
            }
            const status = (await teacher('status')).body.campaign;
            assert.ok(status.reports.some(r => r.text === answers.at(-1)[1]));
            for (const quest of boardQuests) assert.equal(status.board.find(o => o.id === quest.id).completed, 1);
            await teacher('campaign', { op: 'next' });
        }
        const finale = await view(alex, 4, q => q.status === 'campaign_complete');
        assert.match(finale.finale, /welcomed the new neighbors/);
        assert.equal(finale.thieves, null);
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop(); await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('chapter 3: the thief hides the chestnuts, and the class opens the cellar with a code', { timeout: 180000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        PIN = (await api(base, '/api/teacher/game', { session, body: { name: '3A', randomNames: false } })).body.pin;
        const byKey = {};
        for (const token of ['signed-a', 'signed-b', 'signed-c']) {
            const socket = await enter(base, token, null);
            sockets.push(socket);
            byKey[students[token].studentKey] = socket;
        }
        const teacher = body => api(base, '/api/teacher/campaign', { session, body });
        const lastQuest = key => [...byKey[key].inbox].reverse().find(message => message.t === 'quest' && message.quest)?.quest;
        await teacher({ op: 'start', campaign: 'castanyada' });
        const chapter2 = (await teacher({ op: 'next' })).body.campaign;
        await pause(300);
        // A sole holder cannot name themself, and an absent holder cannot be met.
        const meetingSolver = chapter2.players.find(p => p.role === 'Shopkeeper') ?? chapter2.players[0];
        assert.match(lastQuest(meetingSolver.studentKey).objectives.find(o => o.id === 'meet-shop').text, /Type the role name \(Shopkeeper\)/);
        byKey[meetingSolver.studentKey].send({ t: 'answer', objective: 'meet-shop', text: 'Shopkeeper' });
        assert.equal((await byKey[meetingSolver.studentKey].next(m => m.t === 'answered' && m.objective === 'meet-shop', 'absent-role meeting substitute')).correct, true);
        const chapter3 = (await teacher({ op: 'next' })).body.campaign;
        assert.deepEqual([chapter3.chapter, chapter3.status], [2, 'active']);
        await pause(500);

        // The thief of chapter 2 is still the thief: the secret is theirs, and they are not asked where it is hidden.
        const thieves = chapter3.players.filter(player => player.thief);
        assert.equal(thieves.length, 1);
        assert.match(lastQuest(thieves[0].studentKey).secret.text, /You hid the chestnuts in the hotel cellar/);
        assert.match(lastQuest(thieves[0].studentKey).clues[0].text, /^Your plan: /);
        assert.equal(lastQuest(thieves[0].studentKey).objectives.some(item => item.id === 'hide'), false);
        assert.ok(lastQuest(thieves[0].studentKey).clues.some(c => c.from === 'reward' && c.text === castanyada.chapters[2].objectives[0].rewards[lastQuest(thieves[0].studentKey).role.id]), 'thief receives the code fragment from their already-known hiding-place objective');
        const solver = chapter3.players.find(player => !player.thief);
        assert.equal(lastQuest(solver.studentKey).secret, null);
        assert.deepEqual(lastQuest(solver.studentKey).objectives.map(item => item.id), ['hide']);
        assert.equal(lastQuest(solver.studentKey).thieves, null, 'who it was stays hidden until the chapter is over');

        // Each answer opens the next question and earns a clue; the code is four numbers.
        const answer = (objective, text) => byKey[solver.studentKey].send({ t: 'answer', objective, text });
        const result = () => byKey[solver.studentKey].next(message => message.t === 'answered', 'result');
        answer('hide', 'The hotel garden');
        assert.equal((await result()).correct, false);
        await pause(3200);
        answer('hide', 'In the cellar of the hotel');
        assert.equal((await result()).correct, true);
        await pause(300);
        const afterHide = lastQuest(solver.studentKey);
        assert.deepEqual(afterHide.objectives.map(item => item.id), ['hide', 'code']);
        assert.ok(afterHide.clues.some(clue => clue.from === 'reward' && clue.text === castanyada.chapters[2].objectives[0].rewards[afterHide.role.id]), 'code clue arrives before code is answered');
        const presentRoles = chapter3.players.map(p => lastQuest(p.studentKey).role.id);
        for (const role of castanyada.roles.filter(r => !presentRoles.includes(r.id))) {
            assert.ok(afterHide.clues.some(c => c.from === 'town notice' && c.text === castanyada.chapters[2].objectives[0].rewards[role.id]), 'absent roles supply their code fragments at the earned stage');
        }
        answer('code', '1 3 4 7');
        assert.equal((await result()).correct, false, 'the right numbers in the wrong order');
        await pause(3200);
        answer('code', '7431');
        assert.equal((await result()).correct, true);
        await pause(300);
        assert.ok(lastQuest(solver.studentKey).objectives.some(item => item.id === 'why'));
        assert.ok(lastQuest(solver.studentKey).clues.some(clue => clue.text === castanyada.chapters[2].objectives[1].rewards[afterHide.role.id]), 'motive clue arrives before why is answered');
        answer('why', 'For a surprise party');
        assert.equal((await result()).correct, true);
        await pause(300);
        assert.ok(lastQuest(solver.studentKey).objectives.some(item => item.id === 'report-3' && item.optional), 'the written bonus opens last');
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test('warm-up editor saves private content, pins running rounds and keeps custom mechanics after restart', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-warmup-editor-'));
    const vars = { LAN_URL: 'http://127.0.0.1', CLOUD_URL: '' };
    let plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo, vars);
    const sockets = [], pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
        let session = (await api(plaza.base, '/api/teacher/login', { body: { password: PASSWORD } })).body.token;
        const teacher = (op, body) => api(plaza.base, `/api/teacher/${op}`, { session, body });
        const config = (kind, definition, version) => teacher(`warmup-editor?kind=${kind}`, definition ? { definition, version } : undefined);
        assert.equal((await api(plaza.base, '/api/teacher/warmup-editor?kind=identity')).status, 401);
        assert.equal((await api(plaza.base, '/api/teacher/warmup-editor?kind=identity', { body: { version: 0, definition: defaultWarmup('identity') } })).status, 401);
        assert.equal((await config('missing')).status, 400);
        const definition = { kind: 'identity', title: 'Space identities', instructions: 'Ask yes or no questions about your classmate.', level: 'B1', identities: [
            { id: 'zorvax', name: 'Zorvax', accept: ['zorb'] }, { id: 'quenfli', name: 'Quenfli', accept: ['quen'] }, { id: 'vellora', name: 'Vellora', accept: ['vell'] },
        ] };
        assert.equal((await config('identity')).body.version, 0);
        assert.equal((await config('identity', definition, 0)).body.version, 1);
        assert.equal((await config('identity', definition, 0)).status, 409);
        assert.equal((await config('identity', { ...definition, identities: [] }, 1)).status, 400);
        assert.equal((await config('identity', { ...definition, instructions: 'x'.repeat(70_000) }, 1)).status, 413);
        PIN = (await teacher('game', { name: 'Edited warm-ups', randomNames: false })).body.pin;
        let alex = await enter(plaza.base, 'signed-a', null), sam = await enter(plaza.base, 'signed-b', null); sockets.push(alex, sam);
        await teacher('warmup', { op: 'start', type: 'identity' });
        const view = async (who, title) => (await who.next(m => m.t === 'warmup' && m.warmup?.title === title)).warmup;
        const a = await view(alex, definition.title), b = await view(sam, definition.title);
        assert.equal(a.level, 'B1'); assert.equal(a.instructions, definition.instructions);
        assert.ok(a.vocabulary.includes('Zorvax')); assert.ok(a.vocabulary.includes('zorb'));
        const name = card => card.fact.match(/^You are (.+?)\. Do not say/)[1];
        const secretA = name(a), oldAlias = definition.identities.find(i => i.name === secretA).accept[0];
        const future = { ...definition, title: 'Sea identities', identities: definition.identities.map(i => ({ ...i, name: `${i.name} the sailor`, accept: [`sailor ${i.name}`] })) };
        assert.equal((await config('identity', future, 1)).body.version, 2);
        assert.equal((await teacher('status')).body.warmup.title, definition.title, 'saving does not rewrite the current round');
        const send = async (who, text, to, cid) => {
            await pause(1550); who.send({ t: 'chat', text, to, cid });
            return who.next(m => m.t === 'notice' && m.cid === cid);
        };
        const rejected = await send(alex, `I am ${secretA}.`, sam.me.id, 'custom-reveal');
        assert.match(rejected.text, /Keep your secret identity hidden/, 'custom names pass the English dictionary and reach the identity rule');
        const question = await send(sam, `Are you ${secretA}?`, alex.me.id, 'custom-guess');
        assert.equal(question.level, 'info'); await teacher('review', { id: question.id, approve: true });
        assert.equal((await alex.next(m => m.t === 'chat' && m.id === question.id)).text, `Are you ${secretA}?`);
        const yes = await send(alex, 'Yes!', sam.me.id, 'custom-yes'); assert.equal(yes.level, 'info');
        const chris = await enter(plaza.base, 'signed-c', null); sockets.push(chris);
        const late = await view(chris, definition.title);
        assert.ok(![secretA, name(b)].includes(name(late)), 'late arrival uses the remaining original identity, not the edited template');
        sam.send({ t: 'warmup-answer', text: oldAlias });
        assert.equal((await sam.next(m => m.t === 'warmup-answered')).correct, true, 'original custom alias is still accepted');
        for (const socket of sockets) socket.ws.close(); await pause(200); await plaza.stop();
        plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo, vars);
        session = (await api(plaza.base, '/api/teacher/login', { body: { password: PASSWORD } })).body.token;
        alex = await enter(plaza.base, 'signed-a', null); sam = await enter(plaza.base, 'signed-b', null); sockets.push(alex, sam);
        assert.equal((await view(alex, definition.title)).fact, a.fact);
        assert.equal((await config('identity')).body.definition.title, future.title, 'saved template also survives restart');
        assert.equal((await send(alex, oldAlias, 'everyone', 'old-after-restart')).level, 'warning');
        await teacher('warmup', { op: 'start', type: 'identity' });
        assert.equal((await view(alex, future.title)).title, future.title, 'restarting opts into the new content');
        await teacher('warmup', { op: 'end' });
        const ended = await alex.next(m => m.t === 'warmup' && m.warmup === null);
        assert.ok(ended.vocabulary.includes('Zorvax the sailor'), 'custom proper names remain available to the word checker after the round');
        assert.equal((await send(alex, 'Zorvax the sailor', sam.me.id, 'after-custom-end')).level, 'info');
        const facts = { ...defaultWarmup('facts'), title: 'Travel facts', rounds: 1, facts: [
            { id: 'compass', mine: 'You have a compass.', find: 'has a compass' }, { id: 'map', mine: 'You have a map.', find: 'has a map' },
        ] };
        assert.equal((await config('facts', facts, 0)).status, 200); await teacher('warmup', { op: 'start', type: 'facts' });
        const af = await view(alex, facts.title), bf = await view(sam, facts.title);
        assert.equal(af.of, 1); assert.notEqual(af.fact, bf.fact);
        alex.send({ t: 'warmup-answer', text: 'Sam' }); assert.equal((await alex.next(m => m.t === 'warmup-answered')).correct, true);
        const pairs = { ...defaultWarmup('pairs'), title: 'Boat pairs', pairs: [['sail', 'anchor'], ['bow', 'arrow']] };
        assert.equal((await config('pairs', pairs, 0)).status, 200); await teacher('warmup', { op: 'start', type: 'pairs' });
        const ap = await view(alex, pairs.title); await view(sam, pairs.title);
        const c = await enter(plaza.base, 'signed-c', null); sockets.push(c); const cp = await view(c, pairs.title);
        c.send({ t: 'warmup-answer', text: cp.fact === ap.fact ? 'Sam' : 'Alex' });
        assert.equal((await c.next(m => m.t === 'warmup-answered')).correct, true, 'late pair always has a present partner');
    } finally {
        for (const socket of sockets) socket.ws.close(); await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('Who am I chat protects the helper, permits guesses and yes/no, and survives restart', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-identity-chat-'));
    let plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
        let session = (await api(plaza.base, '/api/teacher/login', { body: { password: PASSWORD } })).body.token;
        const teacher = (op, body) => api(plaza.base, `/api/teacher/${op}`, { session, body });
        PIN = (await teacher('game', { name: 'Identity rules', randomNames: false })).body.pin;
        let helper = await enter(plaza.base, 'signed-a', null), guesser = await enter(plaza.base, 'signed-b', null);
        sockets.push(helper, guesser);
        const send = async (who, text, to, cid) => {
            await pause(1550);
            who.send({ t: 'chat', text, to, cid });
            return who.next(m => m.t === 'notice' && m.cid === cid, cid);
        };
        // Queue names before the round. Which one becomes a secret is intentionally random.
        const batches = [''];
        for (const identity of IDENTITIES) {
            const alias = [...identity.accept].sort((a, b) => a.length - b.length)[0];
            if (batches.at(-1).length + alias.length + 2 > 180) batches.push('');
            batches[batches.length - 1] += `${batches.at(-1) ? ', ' : ''}${alias}`;
        }
        for (const [i, text] of batches.entries()) assert.equal((await send(helper, text, guesser.me.id, `before-${i}`)).level, 'info');
        const start = await teacher('warmup', { op: 'start', type: 'identity' }); assert.equal(start.status, 200);
        const view = async who => (await who.next(m => m.t === 'warmup' && m.warmup?.kind === 'identity')).warmup;
        const helperCard = await view(helper), guesserCard = await view(guesser);
        const name = card => card.fact.match(/^You are (.+?)\. Do not say/)[1];
        const secret = name(helperCard), guesserSecret = name(guesserCard);
        assert.notEqual(secret, guesserSecret);
        const identity = IDENTITIES.find(i => i.name === secret);
        const before = (await teacher('status')).body.entries;
        const queued = before.find(e => identity.accept.some(alias => e.text.split(', ').includes(alias)));
        assert.ok(queued);
        await teacher('approve-all', {});
        const protectedEntry = (await teacher('status')).body.entries.find(e => e.id === queued.id);
        assert.equal(protectedEntry.status, 'blocked', 'approve-all rechecks names queued before the activity');
        assert.match(protectedEntry.note, /Activity rule/);
        assert.equal(guesser.inbox.some(m => m.t === 'chat' && m.id === queued.id), false);
        for (const [i, to] of [guesser.me.id, undefined, 'everyone'].entries()) {
            const rejected = await send(helper, `I am ${secret}.`, to, `reveal-${i}`);
            assert.equal(rejected.level, 'warning'); assert.match(rejected.text, /Keep your secret identity hidden/);
        }
        const blocked = (await teacher('status')).body.entries.find(e => e.text === `I am ${secret}.`);
        assert.equal(blocked.status, 'blocked'); assert.match(blocked.note, /Who am I/);
        assert.equal((await teacher('review', { id: blocked.id, approve: true })).status, 400, 'a blocked reveal cannot be approved');
        const question = `Are you ${secret}?`;
        const questionNotice = await send(guesser, question, helper.me.id, 'guess'); assert.equal(questionNotice.level, 'info');
        await teacher('review', { id: questionNotice.id, approve: true });
        assert.equal((await helper.next(m => m.t === 'chat' && m.id === questionNotice.id)).text, question);
        const yes = await send(helper, 'Yes!', guesser.me.id, 'confirm'); assert.equal(yes.level, 'info');
        await teacher('review', { id: yes.id, approve: true });
        assert.equal((await guesser.next(m => m.t === 'chat' && m.id === yes.id)).text, 'Yes!');
        guesser.send({ t: 'warmup-answer', text: secret });
        assert.equal((await guesser.next(m => m.t === 'warmup-answered')).correct, true, 'private final answer is never blocked');
        const finished = await send(guesser, `I am ${guesserSecret}.`, 'everyone', 'finished-helper');
        assert.equal(finished.level, 'warning', 'finishing your guessing task does not release your own secret');
        helper.send({ t: 'chat', text: `I am ${secret}. Please help me.`, to: 'teacher', cid: 'teacher-help' });
        await helper.next(m => m.t === 'result' && m.cid === 'teacher-help');
        helper.ws.close(); guesser.ws.close(); await pause(200); await plaza.stop();
        plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
        session = (await api(plaza.base, '/api/teacher/login', { body: { password: PASSWORD } })).body.token;
        helper = await enter(plaza.base, 'signed-a', null); guesser = await enter(plaza.base, 'signed-b', null); sockets.push(helper, guesser);
        assert.equal((await send(helper, secret, 'everyone', 'after-restart')).level, 'warning');
        await teacher('warmup', { op: 'end' });
        const after = await send(helper, secret, guesser.me.id, 'after-end'); assert.equal(after.level, 'info', 'ending the warm-up removes its restriction');
        await teacher('review', { id: after.id, approve: true });
        assert.equal((await guesser.next(m => m.t === 'chat' && m.id === after.id)).text, secret);
        const history = (await teacher('status')).body.entries;
        assert.ok(history.some(e => e.id === queued.id && e.status === 'blocked'), 'teacher audit survives restart');
    } finally {
        for (const socket of sockets) socket.ws.close(); await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('the other warm-ups: Who am I? and Find your pair', { timeout: 180000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        PIN = (await api(base, '/api/teacher/game', { session, body: { name: '3A', randomNames: false } })).body.pin;
        const players = {};
        for (const token of ['signed-a', 'signed-b', 'signed-c', 'roger-1']) {
            const socket = await enter(base, token, null);
            sockets.push(socket);
            players[students[token].studentKey] = socket;
        }
        await pause(300);
        const start = type => api(base, '/api/teacher/warmup', { session, body: { op: 'start', type } });
        const view = async key => (await players[key].next(message => message.t === 'warmup' && message.warmup, 'warm-up')).warmup;
        const answer = (key, text) => players[key].send({ t: 'warmup-answer', text });
        const result = key => players[key].next(message => message.t === 'warmup-answered', 'result');
        const names = { stu_a: 'Alex', stu_b: 'Sam', stu_c: 'Chris', stu_r1: 'Roger' };

        // Who am I?: you hold a secret identity, and find out who one classmate is by asking.
        const started = (await start('identity')).body.warmup;
        assert.equal(started.kind, 'identity');
        const mine = {};
        for (const key of Object.keys(players)) {
            const card = await view(key);
            assert.equal(card.kind, 'identity');
            assert.match(card.fact, /^You are .*Do not say your name!/);
            assert.match(card.task, /^Find out who \w+ is\./);
            mine[key] = card;
        }
        // The teacher sees who is who and who asks about whom; the secret is not in anyone else's messages.
        const rows = Object.fromEntries(started.players.map(player => [player.studentKey, player.fact]));
        const secretOf = key => IDENTITIES_BY_NAME(rows[key].split(' (')[0]);
        function IDENTITIES_BY_NAME(name) { return ['messi', 'ronaldo', 'nadal', 'gasol', 'shakira', 'rosalia', 'taylor', 'beyonce', 'mozart', 'picasso', 'dali', 'gaudi', 'einstein', 'curie', 'davinci', 'columbus', 'cleopatra', 'napoleon', 'batman', 'superman', 'spiderman', 'hermione', 'harry', 'vader', 'sherlock', 'mario', 'pikachu', 'shrek', 'elsa', 'simba', 'sponge', 'mickey', 'yamal'].find(id => identityById(id).name === name); }
        const asker = 'stu_a';
        const target = Object.keys(names).find(key => mine[asker].task.includes(`who ${names[key]} is`));
        assert.ok(target && target !== asker, 'asked about a classmate, never themselves');
        // An actual identity can finish the task before the retry when roles are random.
        answer(asker, 'zzzzzzzzzzzzzzz');
        assert.equal((await result(asker)).correct, false);
        await pause(3200);
        answer(asker, identityById(secretOf(target)).name);
        const found = await result(asker);
        assert.ok(found.correct || found.wait === false);
        if (!found.correct) { await pause(3200); answer(asker, identityById(secretOf(target)).name); assert.equal((await result(asker)).correct, true); }

        // Find your pair: two words that go together; type the name of the person who has the other.
        const pairsStarted = (await start('pairs')).body.warmup;
        assert.equal(pairsStarted.kind, 'pairs');
        const cards = {};
        for (const key of Object.keys(players)) {
            cards[key] = (await players[key].next(message => message.t === 'warmup' && message.warmup && message.warmup.kind === 'pairs', 'pair card')).warmup;
            assert.match(cards[key].fact, /^Your word is \w+\./);
        }
        const wordOf = key => cards[key].fact.match(/word is (\w+)\./)[1];
        const partnerWords = { salt: 'pepper', pepper: 'salt', fish: 'chips', chips: 'fish', bread: 'butter', butter: 'bread', black: 'white', white: 'black', day: 'night', night: 'day', knife: 'fork', fork: 'knife', hot: 'cold', cold: 'hot', up: 'down', down: 'up', left: 'right', right: 'left', sun: 'moon', moon: 'sun', boy: 'girl', girl: 'boy', cat: 'mouse', mouse: 'cat', pen: 'paper', paper: 'pen', shoes: 'socks', socks: 'shoes', summer: 'winter', winter: 'summer', yes: 'no', no: 'yes', in: 'out', out: 'in', north: 'south', south: 'north' };
        const you = 'stu_b';
        const partner = Object.keys(names).find(key => key !== you && wordOf(key) === partnerWords[wordOf(you)]);
        assert.ok(partner, 'someone has the word that goes with yours');
        const other = Object.keys(names).find(key => key !== you && key !== partner && wordOf(key) !== partnerWords[wordOf(you)]);
        answer(you, names[other]);
        assert.equal((await result(you)).correct, false, 'a classmate with the wrong word');
        await pause(3200);
        answer(you, names[partner]);
        assert.equal((await result(you)).correct, true);
        const done = (await players[you].next(message => message.t === 'warmup' && message.warmup && message.warmup.step === 1, 'done')).warmup;
        assert.equal(done.task, null);
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test('deleting a game: it needs confirming, erases the game and what is saved in it, and keeps the others', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const remove = body => api(base, '/api/teacher/game/delete', { session, body });

        // Two games; the first gets some life: a student, chat, a story and a warm-up.
        const first = (await api(base, '/api/teacher/game', { session, body: { name: 'Doomed', randomNames: false } })).body;
        const firstId = first.game.id;
        PIN = first.pin;
        const alex = await enter(base, 'signed-a', null);
        sockets.push(alex);
        await api(base, '/api/teacher/campaign', { session, body: { op: 'start', campaign: 'castanyada' } });
        alex.send({ t: 'move', x: 600, y: 900 });
        const second = (await api(base, '/api/teacher/game', { session, body: { name: 'Keeper', randomNames: false } })).body;
        assert.equal(await alex.closed, 4002, 'opening another game sent the first one out');
        const secondId = second.game.id;
        assert.equal(second.games.length, 2);

        // Nothing happens without confirming, or for a game that is not there.
        assert.equal((await remove({ game: firstId })).status, 400);
        assert.equal((await remove({ game: firstId, confirm: false })).status, 400);
        assert.equal((await remove({ game: 'nope', confirm: true })).status, 400);
        assert.equal((await api(base, '/api/teacher/status', { session })).body.games.length, 2);

        // Deleting the closed game removes it, and the open one carries on.
        const afterFirst = (await remove({ game: firstId, confirm: true })).body;
        assert.deepEqual(afterFirst.games.map(game => game.name), ['Keeper']);
        assert.equal(afterFirst.game.id, secondId);
        assert.equal(afterFirst.open, true, 'the open game was not touched');
        PIN = first.pin;
        assert.equal((await api(base, '/api/plaza/join', { token: 'signed-b', body: { pin: first.pin } })).status, 403, 'its PIN no longer lets anyone in');

        // Deleting the open game closes it, sends students out, and leaves nothing open.
        PIN = second.pin;
        const sam = await enter(base, 'signed-b', null);
        sockets.push(sam);
        const afterSecond = (await remove({ game: secondId, confirm: true })).body;
        assert.equal(await sam.closed, 4002);
        assert.deepEqual([afterSecond.games.length, afterSecond.open, afterSecond.game], [0, false, null]);
        assert.equal((await api(base, '/api/plaza/join', { token: 'signed-b', body: { pin: second.pin } })).status, 403);
        assert.equal(afterSecond.campaign, null);

        // Students keep their avatars, and a new game starts clean.
        assert.equal((await api(base, '/api/student/me', { token: 'signed-a' })).status, 200);
        const fresh = (await api(base, '/api/teacher/game', { session, body: { name: 'Fresh', randomNames: false } })).body;
        assert.equal(fresh.campaign, null);
        assert.equal(fresh.warmup, null);
        assert.equal(fresh.entries.length, 0);
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});


test('teacher magic authorizes spells, blocks frozen movement and revives lightning after four seconds', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-magic-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const teacher = body => api(base, '/api/teacher/magic', { session, body });
        PIN = (await api(base, '/api/teacher/game', { session, body: { name: 'Magic', randomNames: false } })).body.pin;
        const alex = await enter(base, 'signed-a', null); const sam = await enter(base, 'signed-b', null); sockets.push(alex, sam);
        assert.equal((await api(base, '/api/teacher/magic', { token: 'signed-a', body: { power: 'rain' } })).status, 401);
        assert.equal((await teacher({ power: 'freeze', studentKey: 'offline' })).status, 400);
        assert.equal((await teacher({ power: 'freeze', studentKey: 'stu_a' })).status, 200);
        const ice = await sam.next(m => m.t === 'magic' && m.power === 'freeze');
        assert.ok(ice.frozenUntil > Date.now());
        alex.send({ t: 'move', x: alex.me.x + 10, y: alex.me.y });
        assert.equal((await alex.next(m => m.t === 'snap')).x, alex.me.x);
        await teacher({ power: 'thaw', studentKey: 'stu_a' });
        assert.equal((await sam.next(m => m.t === 'magic' && m.power === 'thaw')).frozenUntil, 0);
        await teacher({ power: 'teleport', studentKey: 'stu_a', x: alex.me.x + 10, y: alex.me.y });
        assert.equal((await alex.next(m => m.t === 'snap')).x, alex.me.x + 10);
        assert.equal((await teacher({ power: 'teleport', studentKey: 'stu_a', x: 'bad', y: 1 })).status, 400);
        const before = Date.now();
        await teacher({ power: 'lightning', studentKey: 'stu_a' });
        const zap = await sam.next(m => m.t === 'magic' && m.power === 'lightning');
        assert.ok(zap.downUntil >= before + 4000 && zap.downUntil <= Date.now() + 4000);
        alex.send({ t: 'move', x: alex.me.x + 20, y: alex.me.y });
        await alex.next(m => m.t === 'snap');
        await new Promise(resolve => setTimeout(resolve, Math.max(0, zap.downUntil - Date.now()) + 100));
        alex.send({ t: 'move', x: alex.me.x + 20, y: alex.me.y });
        assert.equal((await sam.next(m => m.t === 'move' && m.x === alex.me.x + 20)).x, alex.me.x + 20);
        await teacher({ power: 'rain' });
        assert.ok((await sam.next(m => m.t === 'rain')).until > Date.now());
    } finally {
        for (const socket of sockets) socket.ws.close(); await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('chat for everyone, who heard it, "is writing", and the lesson\'s chat back after a reload', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-chat-'));
    // Speech goes to a closed port: allowed requests fail as unavailable, refused ones as not found.
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo, { EDGE_TTS_URL: 'http://127.0.0.1:9/tts' });
    let alex, sam, chris;
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
        const base = plaza.base;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const teacher = (route, body) => api(base, `/api/teacher/${route}`, { session, ...(body ? { body } : {}) });
        PIN = (await teacher('class', { open: true })).body.pin;
        alex = await enter(base, 'signed-a', null); sam = await enter(base, 'signed-b', null); chris = await enter(base, 'signed-c', null);
        // Alex and Sam stand together; Chris is far away.
        alex.send({ t: 'move', x: 1100, y: 740 }); sam.send({ t: 'move', x: 920, y: 810 }); chris.send({ t: 'move', x: 100, y: 100 });
        await pause(400);

        // Waiting for the teacher, a message is named, so the page can show it waiting where it was written.
        alex.send({ t: 'chat', cid: 'near', text: 'Hello near me' });
        const near = await alex.next(m => m.t === 'notice' && m.cid === 'near', 'pending notice');
        assert.match(near.text, /approval/);
        assert.ok(near.id, 'the waiting message is named');
        await teacher('review', { id: near.id, approve: true });
        const own = await alex.next(m => m.t === 'chat' && m.id === near.id, 'own copy');
        assert.deepEqual([own.heard, own.all], [1, undefined], 'only Sam was near enough to hear it');
        assert.equal((await sam.next(m => m.t === 'chat' && m.id === near.id, 'nearby chat')).heard, undefined, 'only the sender learns who heard it');
        assert.equal((await alex.next(m => m.t === 'notice' && m.id === near.id, 'decision')).level, 'info', 'the decision names the message');
        assert.equal(chris.inbox.some(m => m.id === near.id), false);

        // A message for everyone reaches the whole plaza, however far, and the teacher sees who it was for.
        await pause(1600);
        alex.send({ t: 'chat', cid: 'all', text: 'Hello everyone', to: 'everyone' });
        const shout = await alex.next(m => m.t === 'notice' && m.cid === 'all', 'pending shout');
        const entries = (await teacher('status')).body.entries;
        assert.deepEqual([entries.find(e => e.id === shout.id).everyone, entries.find(e => e.id === shout.id).target], [true, null]);
        assert.equal(entries.find(e => e.id === near.id).everyone, false);
        await teacher('review', { id: shout.id, approve: true });
        assert.equal((await chris.next(m => m.t === 'chat' && m.id === shout.id, 'shout far away')).all, true);
        assert.equal((await alex.next(m => m.t === 'chat' && m.id === shout.id, 'own shout')).heard, 2);
        const report = await fetch(`${base}/api/teacher/report?scope=lesson`, { headers: { 'x-teacher-session': session } }).then(r => r.json());
        assert.equal(report.students.find(s => s.studentKey === 'stu_a').lines.find(line => line.text === 'Hello everyone').target, 'Everyone');

        // Nobody near: delivered to nobody, and the sender is told.
        chris.send({ t: 'chat', cid: 'alone', text: 'Is anybody there?' });
        const alone = await chris.next(m => m.t === 'notice' && m.cid === 'alone', 'pending alone');
        await teacher('review', { id: alone.id, approve: true });
        assert.equal((await chris.next(m => m.t === 'chat' && m.id === alone.id, 'own lonely message')).heard, 0);

        // A message the teacher does not post is named too.
        await pause(1600);
        sam.send({ t: 'chat', cid: 'no', text: 'Not this one' });
        const refused = await sam.next(m => m.t === 'notice' && m.cid === 'no', 'pending refused');
        await teacher('review', { id: refused.id, approve: false });
        assert.match((await sam.next(m => m.t === 'notice' && m.id === refused.id, 'not posted')).text, /not posted/);

        // "Is writing" carries no words and reaches whoever the message would reach, and only them.
        const writingFrom = (socket, from) => socket.inbox.filter(m => m.t === 'typing' && m.id === from.me.id);
        chris.send({ t: 'typing', to: sam.me.id });
        assert.deepEqual(await sam.next(m => m.t === 'typing', 'private writing'), { t: 'typing', id: chris.me.id, scope: 'private' });
        alex.send({ t: 'typing' });
        alex.send({ t: 'typing' }); // too soon: passed on once
        assert.equal((await sam.next(m => m.t === 'typing' && m.id === alex.me.id, 'nearby writing')).scope, 'nearby');
        await pause(1100);
        alex.send({ t: 'typing', to: 'everyone' });
        assert.equal((await chris.next(m => m.t === 'typing' && m.id === alex.me.id, 'writing to everyone')).scope, 'all');
        await sam.next(m => m.t === 'typing' && m.id === alex.me.id && m.scope === 'all', 'Sam hears it too');
        await pause(1100);
        alex.send({ t: 'typing', to: 'teacher' });
        await teacher('mute', { studentKey: 'stu_c', muted: true });
        chris.send({ t: 'typing', to: alex.me.id });
        await pause(400);
        assert.equal(writingFrom(sam, alex).length, 0, 'writing to the teacher reaches no classmate, and the first nearby report was passed on once');
        assert.equal(writingFrom(chris, alex).length, 0, 'nearby writing never reached Chris, far away');
        assert.equal(writingFrom(alex, chris).length, 0, 'a muted student cannot be seen writing, nor a private one to someone else');
        await teacher('mute', { studentKey: 'stu_c', muted: false });

        // A private message to the teacher, which a reload must keep with the teacher's replies.
        await pause(1600);
        alex.send({ t: 'chat', cid: 'help', text: 'Ajuda, si us plau', to: 'teacher' });
        const help = await alex.next(m => m.t === 'result' && m.cid === 'help', 'teacher message taken');
        assert.ok(help.id);

        // A whisper approved while Sam was away waits for Sam to come back.
        await pause(1600);
        alex.send({ t: 'chat', cid: 'psst', text: 'Psst, Sam', to: sam.me.id });
        const psst = await alex.next(m => m.t === 'notice' && m.cid === 'psst', 'pending whisper');
        sam.ws.close(); await sam.closed;
        await pause(200);
        await teacher('review', { id: psst.id, approve: true });
        assert.equal((await alex.next(m => m.t === 'notice' && m.id === psst.id, 'approved while away')).level, 'warning');

        // A reload brings back the lesson's chat: what reached Sam as history (shown, not read aloud), the whisper that
        // came while Sam was away as new, and nothing Sam was never meant to have.
        sam = await enter(base, 'signed-b', null);
        const back = (id, what) => sam.next(m => m.t === 'chat' && m.id === id, what);
        assert.equal((await back(near.id, 'nearby again')).history, true);
        assert.equal((await back(shout.id, 'shout again')).all, true);
        const missed = await back(psst.id, 'whisper back');
        assert.deepEqual([missed.whisper, missed.to, missed.sender, missed.history], [true, 'Sam', 'Alex', undefined], 'a whisper that came while away is new');
        await pause(200);
        assert.equal(sam.inbox.some(m => m.id === refused.id || m.id === alone.id || m.id === help.id), false, 'nothing that was not posted to Sam comes back');
        const speech = await fetch(`${base}/api/plaza/speech`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-student-token': 'signed-b' },
            body: JSON.stringify({ id: psst.id }) });
        assert.equal(speech.status, 503, 'Sam may now listen to the whisper that waited');

        alex.ws.close(); await alex.closed;
        alex = await enter(base, 'signed-a', null);
        const mine = await alex.next(m => m.t === 'chat' && m.id === shout.id, 'own shout again');
        assert.deepEqual([mine.heard, mine.history], [2, true], 'the sender still sees who heard it');
        const asked = await alex.next(m => m.t === 'chat' && m.id === help.id, 'teacher message again');
        assert.deepEqual([asked.to, asked.whisper, asked.text, asked.history], ['Teacher', true, 'Ajuda, si us plau', true]);
    } finally {
        for (const socket of [alex, sam, chris]) socket?.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('saved games keep their maps, authoritative geometry and positions across switches and restart', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-themes-'));
    const pinPlayUrl = `http://127.0.0.1:${pinPlay.address().port}`;
    const vars = { MOVEMENT_CHECK: '1' };
    let plaza = await startPlaza(pinPlayUrl, persistTo, vars), alex;
    try {
        let base = plaza.base;
        const session = (await api(base, '/api/teacher/login', { body: { password: PASSWORD } })).body.token;
        const teacher = (op, body) => api(base, `/api/teacher/${op}`, { session, body });
        const legacy = (await teacher('game', { name: 'Season 1', randomNames: false })).body;
        assert.equal(legacy.game.themeId, 'plaza', 'older creation requests keep the original map');
        const bad = await teacher('game', { name: 'Unknown map', themeId: '__proto__' });
        assert.equal(bad.status, 400);
        assert.equal((await teacher('status')).body.game.id, legacy.game.id, 'bad map selection does not switch the game');
        const garden = (await teacher('game', { name: 'Garden', themeId: 'commons-garden', randomNames: false })).body;
        PIN = garden.pin;
        alex = await enter(base, 'signed-a', null);
        assert.equal(alex.welcome.themeId, 'commons-garden');
        assert.equal(getWorld('plaza').isBlocked(680, 400), true);
        assert.equal(getWorld('commons-garden').isBlocked(680, 400), false);
        const moved = await teacher('magic', { power: 'teleport', studentKey: 'stu_a', x: 680, y: 400 });
        assert.equal(moved.status, 200, 'teleport uses this game’s geometry');
        await alex.next(m => m.t === 'snap' && m.x === 680 && m.y === 400);
        alex.send({ t: 'move', x: 680, y: 410 });
        await alex.next(m => m.t === 'move' && m.id === alex.me.id && m.y === 410, 'walk in the gap');
        alex.send({ t: 'move', x: 630, y: 410 });
        const snap = await alex.next(m => m.t === 'snap', 'blocked by this map');
        assert.deepEqual([snap.x, snap.y], [680, 410]);
        const invalid = await teacher('magic', { power: 'teleport', studentKey: 'stu_a', x: 400, y: 400 });
        assert.equal(invalid.status, 400);
        alex.ws.close(); await alex.closed;
        await plaza.stop();
        plaza = await startPlaza(pinPlayUrl, persistTo, vars); base = plaza.base;
        const resumed = (await teacher('status')).body;
        assert.equal(resumed.game.themeId, 'commons-garden');
        PIN = resumed.pin;
        alex = await enter(base, 'signed-a', null);
        assert.equal(alex.welcome.themeId, 'commons-garden');
        assert.deepEqual([alex.me.x, alex.me.y], [680, 410]);
        const autumn = (await teacher('game', { name: 'Autumn', themeId: 'commons-autumn', randomNames: false })).body;
        await alex.closed;
        PIN = autumn.pin; alex = await enter(base, 'signed-a', null);
        assert.equal(alex.welcome.themeId, 'commons-autumn');
        assert.notEqual(alex.me.x, 680, 'a new game has its own spawn and position');
        await teacher('class', { open: true, game: garden.game.id }); await alex.closed;
        PIN = garden.pin; alex = await enter(base, 'signed-a', null);
        assert.deepEqual([alex.me.x, alex.me.y], [680, 410]);
        assert.equal(alex.welcome.themeId, 'commons-garden');
        const original = (await teacher('class', { open: true, game: legacy.game.id })).body; await alex.closed;
        PIN = original.pin; alex = await enter(base, 'signed-a', null);
        assert.equal(alex.welcome.themeId, 'plaza');
        assert.deepEqual(new Set(original.games.map(g => g.themeId)), new Set(['plaza', 'commons-garden', 'commons-autumn']));
    } finally {
        alex?.ws.close(); await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('teacher guides are private and follow published previews, pinned games, live additions and current thieves', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-guide-'));
    const pinPlayUrl = `http://127.0.0.1:${pinPlay.address().port}`;
    let plaza = await startPlaza(pinPlayUrl, persistTo); const sockets = [];
    try {
        let base = plaza.base;
        assert.equal((await api(base, '/api/teacher/campaign-guide?campaign=castanyada')).status, 401);
        assert.equal((await api(base, '/api/teacher/campaign-guide?campaign=castanyada', { token: 'signed-a' })).status, 401);
        const session = (await api(base, '/api/teacher/login', { body: { password: PASSWORD } })).body.token;
        const teacher = (route, body) => api(base, `/api/teacher/${route}`, { session, body });
        const basic = await teacher('campaign-guide?campaign=castanyada');
        assert.equal(basic.status, 200); assert.equal(basic.body.chapters.length, 3);
        assert.equal(basic.body.chapters[0].main[0].witnesses, 0);
        assert.equal(basic.body.chapters[0].main[0].answer, 'park / pond');
        const strict = (await teacher('campaign-guide?campaign=castanyada-investigations')).body;
        assert.equal(strict.chapters.length, 5);
        assert.equal(strict.chapters[1].main.find(o => o.id === 'thief').witnesses, 2);
        assert.equal((await teacher('campaign-guide?campaign=not-published')).status, 404);

        let draft = (await teacher('missions/create', { id: 'guide-custom', source: 'castanyada' })).body.draft;
        draft.campaign.title = 'Original guide';
        draft = (await teacher('missions/save', { id: 'guide-custom', version: draft.version, envelope: missionEnvelope(draft.campaign) })).body.draft;
        draft = (await teacher('missions/publish', { id: 'guide-custom', version: draft.version })).body.draft;
        const opened = (await teacher('game', { name: 'Guide class', randomNames: false })).body;
        PIN = opened.pin; const game = opened.game.id;
        const alex = await enter(base, 'signed-a', null), sam = await enter(base, 'signed-b', null); sockets.push(alex, sam);
        const previousVisitor = await enter(base, 'signed-c', null); sockets.push(previousVisitor);
        previousVisitor.ws.close(); await previousVisitor.closed;
        await teacher('campaign', { op: 'start', campaign: 'guide-custom' });
        const beforeArrival = (await teacher('status')).body.campaign.guideVersion;
        const late = await enter(base, 'signed-c', null); sockets.push(late);
        assert.notEqual((await teacher('status')).body.campaign.guideVersion, beforeArrival, 'a returning student’s newly assigned role refreshes the guide');
        const student = (await alex.next(m => m.t === 'quest' && m.quest)).quest;
        assert.equal(JSON.stringify(student).includes('"unlockedClues"'), false, 'teacher clue trails never enter a student message');
        assert.equal(JSON.stringify(student).includes('"accept"'), false);
        let live = (await teacher(`campaign-guide?game=${game}`)).body;
        const originalRevision = live.campaign.revision;
        assert.equal(live.game.id, game); assert.equal(live.campaign.title, 'Original guide');
        assert.equal((await teacher(`campaign-guide?campaign=guide-custom&game=${game}`)).status, 400);
        draft.campaign.title = 'Revised guide'; draft.campaign.chapters[0].objectives[0].accept = ['cafe'];
        draft = (await teacher('missions/save', { id: 'guide-custom', version: draft.version, envelope: missionEnvelope(draft.campaign) })).body.draft;
        draft = (await teacher('missions/publish', { id: 'guide-custom', version: draft.version })).body.draft;
        const preview = (await teacher('campaign-guide?campaign=guide-custom')).body;
        assert.equal(preview.chapters[0].main[0].answer, 'cafe');
        assert.notEqual(preview.campaign.revision, originalRevision);
        assert.equal((await teacher('status')).body.campaigns.find(c => c.id === 'guide-custom').revision, preview.campaign.revision, 'the campaign picker can refresh an open preview after publication');
        live = (await teacher(`campaign-guide?game=${game}`)).body;
        assert.equal(live.campaign.revision, originalRevision);
        assert.equal(live.chapters[0].main[0].answer, 'park / pond', 'guide matches the played revision rather than a new draft');

        draft.campaign.chapters[0].objectives.push({ id: 'guide-addon', text: 'Interview your partner about the next delivery.', accept: [], kind: 'report', optional: true,
            activity: 'interview', board: { minPlayers: 2 } });
        draft = (await teacher('missions/save', { id: 'guide-custom', version: draft.version, envelope: missionEnvelope(draft.campaign) })).body.draft;
        const target = (await teacher('missions/live')).body.target;
        const beforeVersion = (await teacher('status')).body.campaign.guideVersion;
        const review = await teacher('missions/live-preview', { gameId: game, targetVersion: target.version, targetEpoch: target.epoch, chapterId: target.chapter.id,
            sourceId: 'guide-custom', sourceVersion: draft.version, objectiveIds: ['guide-addon'] });
        assert.equal(review.status, 200, JSON.stringify(review.body));
        assert.equal((await teacher('missions/live-release', { previewId: review.body.preview.id })).status, 200);
        assert.notEqual((await teacher('status')).body.campaign.guideVersion, beforeVersion);
        live = (await teacher(`campaign-guide?game=${game}`)).body;
        assert.ok(live.chapters[0].optional.some(o => o.id === 'guide-addon'));
        assert.equal(live.chapters[0].main[0].answer, 'park / pond');

        const advanced = (await teacher('campaign', { op: 'next' })).body.campaign;
        const culprit = advanced.players.find(p => p.thief); assert.ok(culprit);
        live = (await teacher(`campaign-guide?game=${game}`)).body;
        assert.equal(live.currentChapter, 1);
        assert.ok(live.chapters[1].main.find(o => o.id === 'thief').answer.includes(culprit.name));
        assert.equal(JSON.stringify(live.chapters[1].clues).includes('{hat}'), false);
        for (const socket of sockets) { socket.ws.close(); await socket.closed; }
        await plaza.stop(); plaza = await startPlaza(pinPlayUrl, persistTo); base = plaza.base;
        live = (await teacher(`campaign-guide?game=${game}`)).body;
        assert.equal(live.campaign.revision, originalRevision);
        assert.ok(live.chapters[0].optional.some(o => o.id === 'guide-addon'), 'live additions appear after restart');
        assert.ok(live.chapters[1].main.find(o => o.id === 'thief').answer.includes(culprit.name));
        await teacher('campaign', { op: 'reset', confirm: true });
        const restarted = (await teacher('campaign', { op: 'start', campaign: 'guide-custom' })).body.campaign.guideVersion;
        await teacher('campaign', { op: 'reset', confirm: true });
        const restartedAgain = (await teacher('campaign', { op: 'start', campaign: 'guide-custom' })).body.campaign.guideVersion;
        assert.notEqual(restartedAgain, restarted, 'resetting the same campaign refreshes an already open guide');
        await teacher('game', { name: 'Other class', randomNames: false });
        assert.equal((await teacher(`campaign-guide?game=${game}`)).status, 409, 'a stale tab cannot show another game’s answers');
        assert.equal((await teacher('campaign-guide')).status, 404);
    } finally {
        for (const socket of sockets) socket.ws.close(); await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('automatic chat safety: local blocks survive missed API flags, outages ask for retry, and normal chat posts without approval', { timeout: 120000 }, async () => {
    const calls = []; let recovered = false;
    const openai = http.createServer(async (req, res) => {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw); calls.push({ url: req.url, body });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/moderations') {
            if (body.input.includes('outage') && !recovered) { res.statusCode = 500; return res.end('{}'); }
            // Deliberately misses all harmful content: the local rule must still stop it.
            return res.end(JSON.stringify({ results: [{ flagged: false, categories: {} }] }));
        }
        if (req.url === '/v1/decisions') return res.end(JSON.stringify({ answers: [] })); // participation scoring
        const text = JSON.parse(body.messages[1].content).message;
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
            ok: false, corrected: text.replace('She go ', 'She goes '), why: 'Use goes with she.',
        }) } }] }));
    });
    await new Promise(resolve => openai.listen(0, '127.0.0.1', resolve));
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-auto-safety-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo,
        { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${openai.address().port}`, OPENAI_GRAMMAR_GATE: '0' });
    let alex, sam;
    try {
        const { base } = plaza;
        const session = (await api(base, '/api/teacher/login', { body: { password: PASSWORD } })).body.token;
        const teacher = (route, body) => api(base, `/api/teacher/${route}`, { session, body });
        PIN = (await teacher('class', { open: true })).body.pin;
        assert.equal((await teacher('status')).body.mode, 'review');
        alex = await enter(base, 'signed-a', null); sam = await enter(base, 'signed-b', null);
        const pause = () => new Promise(resolve => setTimeout(resolve, 1600));
        const attempt = async (id, text, to) => {
            alex.send({ t: 'attempt', id, text, source: 'chat', to });
            await alex.next(m => m.t === 'attempt-recorded' && m.id === id);
            alex.send({ t: 'check', id, text, attemptId: id });
            return alex.next(m => m.t === 'checked' && m.id === id);
        };
        const bad = 'i suck proffessors dick for good grade';
        for (const [index, to] of [undefined, 'everyone', sam.me.id].entries()) {
            await pause();
            const id = `local-block-${index}`;
            const before = calls.length;
            assert.equal((await attempt(id, bad, to)).ok, true, 'no grammar suggestion');
            assert.equal(calls.length, before, 'local blocking needs neither classifier nor grammar API');
            alex.send({ t: 'chat', cid: id, text: bad, to, attemptId: id });
            assert.match((await alex.next(m => m.t === 'notice' && m.cid === id)).text, /rewrite/);
            const status = (await teacher('status')).body;
            assert.equal(status.entries.filter(e => e.text === bad).every(e => e.status === 'blocked'), true);
            assert.equal(sam.inbox.some(m => m.t === 'chat' && m.text === bad), false, 'no classmate receives it');
            assert.equal(status.incidents.find(i => i.harm === 'sexual').count, index + 1, 'check and send count one incident per attempt');
        }
        await pause();
        const outage = 'She go to school during outage';
        const before = calls.filter(call => call.url === '/v1/chat/completions').length;
        assert.equal((await attempt('outage-check', outage)).ok, true, 'no hint without a safety clearance');
        assert.equal(calls.filter(call => call.url === '/v1/chat/completions').length, before);
        alex.send({ t: 'chat', cid: 'outage-send', text: outage, attemptId: 'outage-check', to: sam.me.id });
        const refusal = await alex.next(m => m.t === 'notice' && m.cid === 'outage-send');
        assert.equal(refusal.level, 'warning'); assert.match(refusal.text, /not sent.*try again/i);
        let status = (await teacher('status')).body;
        assert.equal(status.entries.some(e => e.status === 'pending' || e.text === outage), false, 'no approval queue is created');
        assert.equal(sam.inbox.some(m => m.t === 'chat' && m.text === outage), false);
        const audit = (await teacher('attempts?studentKey=stu_a')).body.attempts.find(a => a.text === outage);
        assert.equal(audit.status, 'not-sent'); assert.match(audit.reason, /HTTP 500/);

        // The student can retry the same draft after recovery without any teacher action.
        recovered = true; await pause();
        alex.send({ t: 'chat', cid: 'retry', text: outage, to: sam.me.id });
        assert.equal((await sam.next(m => m.t === 'chat' && m.text === outage)).text, outage);
        await alex.next(m => m.t === 'result' && m.cid === 'retry');

        await pause();
        const ordinary = 'She go to the park today';
        assert.equal((await attempt('ordinary-check', ordinary)).corrected, 'She goes to the park today');
        alex.send({ t: 'chat', cid: 'ordinary-send', text: ordinary, attemptId: 'ordinary-check' });
        await alex.next(m => m.t === 'result' && m.cid === 'ordinary-send');
        status = (await teacher('status')).body;
        assert.equal(status.entries.find(e => e.text === ordinary).status, 'approved');
        assert.equal(status.entries.some(e => e.status === 'pending'), false);
    } finally {
        alex?.ws.close(); sam?.ws.close(); await plaza.stop();
        await new Promise(resolve => openai.close(resolve));
        await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});

test('safety: harm gets no grammar hint, is caught even when the word check stopped it, and is flagged to the teacher once per attempt', { timeout: 120000 }, async () => {
    const grammarAsked = [];
    const openai = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            res.setHeader('content-type', 'application/json');
            if (req.url !== '/v1/moderations') { grammarAsked.push(body); res.statusCode = 500; return res.end('{}'); }
            const { input } = JSON.parse(body);
            const threat = /dox/.test(input);
            const sexual = /suck/.test(input);
            res.end(JSON.stringify({ results: [{ flagged: threat || sexual,
                categories: { harassment: threat, 'harassment/threatening': threat, sexual } }] }));
        });
    });
    await new Promise(resolve => openai.listen(0, '127.0.0.1', resolve));
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo,
        { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${openai.address().port}` });
    let alex;
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        PIN = (await api(base, '/api/teacher/class', { session, body: { open: true } })).body.pin;
        const status = async () => (await api(base, '/api/teacher/status', { session })).body;
        const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
        alex = await enter(base, 'signed-a', null);

        // A sexual message in good-enough English: no hint (the AI would only polish it), and the teacher is told.
        alex.send({ t: 'check', id: 'h1', text: 'i suck dicks for good grade', attemptId: 'try-1' });
        assert.equal((await alex.next(m => m.t === 'checked' && m.id === 'h1', 'no hint')).ok, true);
        assert.equal(grammarAsked.filter(body => body.includes('suck')).length, 0, 'the grammar AI never saw it');
        let incident = (await status()).incidents.find(item => item.studentKey === 'stu_a');
        assert.deepEqual([incident.harm, incident.count, incident.texts], ['sexual', 1, ['i suck dicks for good grade']]);
        // Sending the same attempt after the check is blocked, and still counts once.
        await pause(1600);
        alex.send({ t: 'chat', text: 'i suck dicks for good grade', cid: 'c1', attemptId: 'try-1' });
        assert.match((await alex.next(m => m.t === 'notice' && m.cid === 'c1', 'blocked')).text, /rewrite/);
        assert.equal((await status()).incidents.find(item => item.harm === 'sexual').count, 1);

        // An ordinary sentence still gets its grammar check.
        alex.send({ t: 'check', id: 'h2', text: 'she go to school every day', attemptId: 'try-2' });
        await alex.next(m => m.t === 'checked' && m.id === 'h2', 'checked');
        assert.ok(grammarAsked.some(body => body.includes('she go to school')), 'clean text is still checked for grammar');

        // Stopped by the word check in the browser ("dox" is not a dictionary word): the server still sees the threat.
        alex.send({ t: 'attempt', id: 'try-3', text: 'tell me or i will dox you', source: 'chat' });
        alex.send({ t: 'attempt-outcome', id: 'try-3', status: 'language-blocked', reason: 'English word check: dox' });
        await alex.next(m => m.t === 'attempt-recorded' && m.id === 'try-3' && m.kind === 'attempt-outcome', 'recorded');
        // And a slur stopped in the browser is hate speech, never a language check-in.
        for (const [id, text] of [['try-4', 'secret name nigga'], ['try-5', 'nigg'], ['try-6', 'nigge']]) {
            alex.send({ t: 'attempt', id, text, source: 'chat' });
            alex.send({ t: 'attempt-outcome', id, status: 'language-blocked', reason: `Not allowed: ${text}` });
            await alex.next(m => m.t === 'attempt-recorded' && m.id === id && m.kind === 'attempt-outcome', 'recorded');
        }
        let now = await status();
        assert.equal(now.incidents.find(item => item.harm === 'threat').texts[0], 'tell me or i will dox you');
        const hate = now.incidents.find(item => item.harm === 'hate');
        assert.deepEqual([hate.count, hate.texts], [3, ['nigge', 'nigg', 'secret name nigga']]);
        assert.equal(now.support.alerts.length, 0, 'three slurs are not "may need help"');
        // Sent anyway, a stand-in is blocked as well.
        await pause(1600);
        alex.send({ t: 'chat', text: 'HEllo juan nigh', cid: 'c2' });
        assert.match((await alex.next(m => m.t === 'notice' && m.cid === 'c2', 'blocked')).text, /rewrite/);
        assert.equal((await status()).incidents.find(item => item.harm === 'hate').count, 4);

        // Seen: off the list.
        assert.equal((await api(base, '/api/teacher/incident', { session, body: { id: hate.id } })).status, 200);
        now = await status();
        assert.equal(now.incidents.some(item => item.harm === 'hate'), false);
        assert.equal((await api(base, '/api/teacher/incident', { session, body: { id: hate.id } })).status, 400);
    } finally {
        alex?.ws.close();
        await plaza.stop();
        await new Promise(resolve => openai.close(resolve));
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test('a student is told every classmate in the game, here or not, so naming an absent one is English', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        PIN = (await api(base, '/api/teacher/class', { session, body: { open: true } })).body.pin;
        const sam = await enter(base, 'signed-b', null); sockets.push(sam);
        sam.ws.close();
        await new Promise(resolve => setTimeout(resolve, 300));
        const alex = await enter(base, 'signed-a', null); sockets.push(alex);
        assert.ok(!alex.welcome.players.some(player => player.name === 'Sam'), 'Sam has left');
        assert.ok(alex.welcome.names.includes('Sam'), 'but is still a classmate in this game');
        assert.ok(alex.welcome.names.includes('Alex'));
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test("a student's conversations for the teacher: one thread per person or place, sent or not, with the teacher's messages", { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-'));
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo);
    const sockets = [];
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
        const { base } = plaza;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const teacher = (route, body) => api(base, `/api/teacher/${route}`, { session, ...(body ? { body } : {}) });
        const opened = (await teacher('game', { name: 'Conversations', randomNames: false })).body;
        PIN = opened.pin;
        const alex = await enter(base, 'signed-a', null); const sam = await enter(base, 'signed-b', null); sockets.push(alex, sam);
        assert.equal((await api(base, '/api/teacher/conversations?studentKey=stu_a')).status, 401, 'only the teacher reads them');
        assert.equal((await teacher('conversations')).status, 400, 'a student must be chosen');

        // Alex writes nearby, to everyone, to Sam (once stopped by the word check) and to the teacher; Sam whispers back.
        alex.send({ t: 'chat', cid: 'near', text: 'Hello near me' });
        await alex.next(m => m.t === 'notice' && m.cid === 'near', 'nearby message waiting');
        await pause(1600);
        alex.send({ t: 'chat', cid: 'all', text: 'Hello everyone', to: 'everyone' });
        await alex.next(m => m.t === 'notice' && m.cid === 'all', 'message for everyone waiting');
        await pause(1600);
        alex.send({ t: 'chat', cid: 'whisper', text: 'Hello Sam', to: sam.me.id });
        await alex.next(m => m.t === 'notice' && m.cid === 'whisper', 'whisper waiting');
        alex.send({ t: 'attempt', id: 'word-block', text: 'Quero ir contigo', source: 'chat', to: sam.me.id });
        alex.send({ t: 'attempt-outcome', id: 'word-block', status: 'language-blocked', reason: 'Quero was not recognised as an English word.' });
        await alex.next(m => m.t === 'attempt-recorded' && m.id === 'word-block' && m.kind === 'attempt-outcome', 'stopped attempt');
        alex.send({ t: 'chat', cid: 'teacher', to: 'teacher', text: 'I need help with my sentence.' });
        await alex.next(m => m.t === 'result' && m.cid === 'teacher', 'message to the teacher');
        sam.send({ t: 'chat', cid: 'back', text: 'Hi Alex', to: alex.me.id });
        await sam.next(m => m.t === 'notice' && m.cid === 'back', 'reply waiting');
        await teacher('help-message', { gameId: opened.game.id, studentKey: 'stu_a', text: 'Try: I want to go with you.' });

        const { status, body } = await teacher('conversations?studentKey=stu_a');
        assert.equal(status, 200);
        const thread = key => body.lines.filter(line => line.thread === key).map(line => [line.mine, line.text, line.status]);
        assert.deepEqual(thread('nearby'), [[true, 'Hello near me', 'pending']]);
        assert.deepEqual(thread('everyone'), [[true, 'Hello everyone', 'pending']], 'a message for everyone is not a private one');
        assert.deepEqual(thread('p:stu_b'), [[true, 'Hello Sam', 'pending'], [true, 'Quero ir contigo', 'language-blocked'], [false, 'Hi Alex', 'pending']],
            'what Alex sent Sam, or tried to, and what Sam sent back');
        assert.deepEqual(thread('teacher'), [[true, 'I need help with my sentence.', 'teacher-inbox'], [false, 'Try: I want to go with you.', 'sent']]);
        assert.equal(new Set(body.lines.map(line => line.thread)).size, 4);
        assert.equal(body.names.stu_b, 'Sam');
        assert.ok(body.lines.every((line, index) => index === 0 || body.lines[index - 1].at <= line.at), 'oldest first');
        assert.ok(body.lines.find(line => line.status === 'language-blocked').reason.includes('Quero'), 'why a line was not sent');

        // Sam's side: the same private conversation, from Sam.
        const fromSam = (await teacher('conversations?studentKey=stu_b')).body;
        assert.deepEqual(fromSam.lines.filter(line => line.thread === 'p:stu_a').map(line => [line.mine, line.text]), [[false, 'Hello Sam'], [true, 'Hi Alex']],
            'what Alex tried and could not send stays Alex’s');
    } finally {
        for (const socket of sockets) socket.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve));
        removeTemp(persistTo);
    }
});

test('missions live online: the laptop sends every change at once, fetches what changed online, waits offline and never overwrites', { timeout: 240000 }, async () => {
    const pinPlay = await startPinPlay();
    const pinPlayUrl = `http://127.0.0.1:${pinPlay.address().port}`;
    const dirs = [0, 1].map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-test-')));
    const onlinePort = await freePort();
    // The online server starts empty: the laptop's missions and library are its first content, as on the day they moved online.
    let online = await startPlaza(pinPlayUrl, dirs[0], {}, { content: false, port: onlinePort });
    let laptop;
    try {
        laptop = await startPlaza(pinPlayUrl, dirs[1], { LAN_URL: 'http://192.168.1.20:8787', CLOUD_URL: online.base });
        assert.equal((await api(online.base, '/api/missions/sync', { body: { lease: 'forged', op: 'pull' } })).status, 401, 'only the linked laptop syncs');
        const onlineSession = (await api(online.base, '/api/teacher/login', { body: { password: PASSWORD } })).body.token;
        const laptopSession = (await api(laptop.base, '/api/teacher/login', { body: { password: PASSWORD } })).body.token;
        const studio = (base, session) => (op, body) => api(base, `/api/teacher/missions/${op}`, { session, body });
        const here = studio(laptop.base, laptopSession); const there = studio(online.base, onlineSession);
        const save = async (call, id, change) => {
            const draft = (await call(`get?id=${id}`)).body.draft;
            const campaign = structuredClone(draft.campaign); change(campaign);
            return (await call('save', { id, version: draft.version, envelope: missionEnvelope(campaign) })).body;
        };
        const titles = async call => Object.fromEntries((await call('list')).body.library.map(item => [item.id, item.title]));

        // Signing in on the laptop links it; opening Mission Studio there uploads all of it.
        let listed = (await here('list')).body;
        assert.deepEqual(listed.sync, { state: 'synced', waiting: 0, keptBoth: [] });
        assert.equal((await there('list')).body.sync.state, 'home', 'the online server is where missions live');
        assert.deepEqual(await titles(there), await titles(here));
        const onlineStatus = (await api(online.base, '/api/teacher/status', { session: onlineSession })).body;
        assert.deepEqual(onlineStatus.campaigns.map(item => item.id), ['castanyada', 'castanyada-side-quests', 'castanyada-complete', 'castanyada-investigations', 'plaza-free-play'], 'in the same order');
        assert.equal((await api(online.base, '/api/teacher/quest-library', { session: onlineSession })).body.library.quests.length, library.quests.length);

        // A save on the laptop is online at once, at the same version, and so is a publication.
        let saved = await save(here, 'castanyada', campaign => { campaign.title = 'Castanyada, laptop edit'; });
        assert.equal(saved.sync.state, 'synced');
        let mirrored = (await there('get?id=castanyada')).body.draft;
        assert.equal(mirrored.campaign.title, 'Castanyada, laptop edit'); assert.equal(mirrored.version, saved.draft.version);
        const published = (await here('publish', { id: 'castanyada', version: saved.draft.version })).body;
        assert.equal((await there('get?id=castanyada')).body.draft.publishedRevision, published.draft.publishedRevision);
        assert.equal((await api(online.base, '/api/teacher/status', { session: onlineSession })).body.campaigns[0].title, 'Castanyada, laptop edit');

        // Published online: the laptop has it the next time Mission Studio opens, ready to start in a game.
        const freePlay = await save(there, 'plaza-free-play', campaign => { campaign.title = 'Free play, online edit'; });
        await there('publish', { id: 'plaza-free-play', version: freePlay.draft.version });
        assert.equal((await titles(here))['plaza-free-play'], 'Free play, online edit');
        assert.equal((await api(laptop.base, '/api/teacher/status', { session: laptopSession })).body.campaigns.find(item => item.id === 'plaza-free-play').title, 'Free play, online edit');

        // No internet: the laptop keeps working and says what waits.
        await online.stop();
        saved = await save(here, 'castanyada', campaign => { campaign.title = 'Castanyada, offline edit'; });
        assert.equal(saved.draft.campaign.title, 'Castanyada, offline edit');
        assert.deepEqual(saved.sync, { state: 'offline', waiting: 1, keptBoth: [] });
        saved = await save(here, 'castanyada-side-quests', campaign => { campaign.title = 'Side mysteries, offline edit'; });
        assert.equal(saved.sync.waiting, 2);

        // Meanwhile the same mission changes online. Back online, the laptop's other change goes up, and the clash keeps both.
        online = await startPlaza(pinPlayUrl, dirs[0], {}, { content: false, port: onlinePort });
        await save(there, 'castanyada', campaign => { campaign.title = 'Castanyada, online edit'; });
        listed = (await here('list')).body;
        assert.deepEqual(listed.sync, { state: 'synced', waiting: 0, keptBoth: [{ id: 'castanyada', copy: 'castanyada-laptop', title: 'Castanyada, offline edit (laptop)' }] });
        const both = await titles(there);
        assert.equal(both.castanyada, 'Castanyada, online edit');
        assert.equal(both['castanyada-laptop'], 'Castanyada, offline edit (laptop)');
        assert.equal(both['castanyada-side-quests'], 'Side mysteries, offline edit');
        assert.deepEqual(await titles(here), both, 'nothing lost, and the same everywhere');

        // A new library online reaches the laptop.
        const smaller = { ...library, quests: library.quests.slice(0, 100) };
        const loaded = await fetch(`${online.base}/api/content`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-content-token': CONTENT_TOKEN }, body: JSON.stringify({ library: smaller }) });
        assert.equal(loaded.status, 200);
        await here('list');
        assert.equal((await api(laptop.base, '/api/teacher/quest-library', { session: laptopSession })).body.library.quests.length, 100);
        assert.equal((await api(online.base, '/api/content', { body: { library: smaller } })).status, 404, 'files load only with the token');
    } finally {
        await laptop?.stop(); await online.stop();
        await new Promise(resolve => pinPlay.close(resolve)); for (const dir of dirs) removeTemp(dir);
    }
});

test('blocked words: what the class keeps writing is offered for blocking, then stopped however it is spelt, for one lesson', { timeout: 120000 }, async () => {
    const pinPlay = await startPinPlay();
    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-plaza-blocked-'));
    // On the class laptop, where every word must be English and blocked words are looked for first.
    const plaza = await startPlaza(`http://127.0.0.1:${pinPlay.address().port}`, persistTo, { LAN_URL: 'http://192.168.1.20:8787' });
    let alex, sam, chris;
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const BLOCKED = 'Not sent: your teacher blocked that for this lesson.';
    try {
        const base = plaza.base;
        const { body: { token: session } } = await api(base, '/api/teacher/login', { body: { password: PASSWORD } });
        const teacher = (route, body) => api(base, `/api/teacher/${route}`, { session, ...(body ? { body } : {}) });
        assert.equal((await teacher('block', { words: ['free sam'] })).status, 400, 'blocked words belong to a lesson: the class must be open');
        PIN = (await teacher('class', { open: true })).body.pin;
        alex = await enter(base, 'signed-a', null); sam = await enter(base, 'signed-b', null); chris = await enter(base, 'signed-c', null);
        const say = (student, cid, text, to = 'everyone') => { student.send({ t: 'chat', cid, text, ...(to ? { to } : {}) }); return student.next(m => m.cid === cid, cid); };
        const wave = async (cid, texts) => {
            for (const [index, student] of [alex, sam, chris].entries()) assert.match((await say(student, `${cid}-${index}`, texts[index])).text, /approval/);
            await teacher('approve-all', {});
        };

        // The whole class writes the same thing to everyone: the teacher is offered to block it.
        await wave('wave', ['free sam', 'FREE SAM!!', 'free saaam']);
        let blocked = (await teacher('status')).body.blocked;
        assert.deepEqual(blocked.repeats.map(repeat => [repeat.words, repeat.students.length]), [['free sam', 3]]);

        // Blocking it takes what already said it off every screen, and tells each student once.
        blocked = (await teacher('block', { words: [blocked.repeats[0].words] })).body.blocked;
        assert.deepEqual(blocked.repeats, []);
        assert.deepEqual(blocked.words.map(word => [word.words, word.removed, word.stopped]), [['free sam', 3, 0]]);
        for (const student of [alex, sam, chris]) assert.equal((await student.next(m => m.t === 'notice' && /removed/.test(m.text), 'told')).text, 'Your teacher removed one of your messages.');
        for (let taken = 0; taken < 3; taken++) await chris.next(m => m.t === 'retract', 'off every screen');

        // However it is disguised, it is not sent: the box empties, nobody else sees it, and the teacher sees who tried.
        await pause(1600);
        const disguised = await say(alex, 'try-1', 'fr33 s4m!!');
        assert.deepEqual([disguised.t, disguised.level, disguised.text, disguised.id], ['notice', 'info', BLOCKED, undefined]);
        await pause(1600);
        assert.equal((await say(alex, 'try-2', '#freesamforever', null)).text, BLOCKED, 'inside a longer word: blocked, rather than told it is not English');
        assert.equal((await say(sam, 'try-3', 'f r e e  s a m', alex.me.id)).text, BLOCKED, 'in a private message too');
        await pause(300);
        assert.equal([...alex.inbox, ...sam.inbox, ...chris.inbox].some(m => m.t === 'chat' && ['fr33 s4m!!', '#freesamforever', 'f r e e  s a m'].includes(m.text)), false);
        let status = (await teacher('status')).body;
        assert.deepEqual(status.blocked.words[0].by, [{ studentKey: 'stu_a', name: 'Alex', count: 2 }, { studentKey: 'stu_b', name: 'Sam', count: 1 }]);
        assert.equal(status.entries.filter(entry => entry.status === 'blocked' && entry.note === 'Blocked for this lesson: “free sam”').length, 3, 'kept in the chat log');
        assert.equal(status.support.alerts.length, 0, 'tries are counted under the word, not as students who may be stuck');
        await pause(1600);
        assert.ok((await say(alex, 'to-teacher', 'free sam please', 'teacher')).id, 'a message to the teacher always gets there');

        // A message still waiting for the teacher is not posted once it says a newly blocked word; unblocked, it can be said.
        const waiting = await say(chris, 'cake', 'I like cake', null);
        assert.match(waiting.text, /approval/);
        blocked = (await teacher('block', { words: ['cake'] })).body.blocked;
        assert.equal((await chris.next(m => m.t === 'notice' && m.id === waiting.id, 'not posted')).text, 'Your message was not posted.');
        assert.deepEqual(blocked.words.map(word => [word.words, word.removed]), [['free sam', 3], ['cake', 1]]);
        await teacher('unblock', { key: 'cake' });
        await pause(1600);
        assert.match((await say(chris, 'cake-2', 'cake please', null)).text, /approval/);

        // Something else the class repeats that the teacher is happy with: left alone, it is not offered again.
        await pause(1600);
        await wave('pizza', ['pizza party', 'pizza party!', 'Pizza party']);
        const pizza = (await teacher('status')).body.blocked.repeats.find(repeat => repeat.words === 'pizza party');
        assert.ok(pizza, 'offered');
        assert.deepEqual((await teacher('let-through', { key: pizza.key, words: pizza.words })).body.blocked.repeats, []);

        // The next lesson starts with nothing blocked, and the last lesson's words are one click away.
        await teacher('class', { open: false });
        blocked = (await teacher('class', { open: true })).body.blocked;
        assert.deepEqual([blocked.words, blocked.before, blocked.repeats], [[], ['free sam'], []]);
        assert.deepEqual((await teacher('block', { words: blocked.before })).body.blocked.words.map(word => word.words), ['free sam']);
    } finally {
        for (const socket of [alex, sam, chris]) socket?.ws.close();
        await plaza.stop();
        await new Promise(resolve => pinPlay.close(resolve)); removeTemp(persistTo);
    }
});
