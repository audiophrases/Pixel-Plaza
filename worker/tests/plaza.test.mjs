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
import { castanyada } from '../../shared/campaign.ts';

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

async function startPlaza(pinPlayUrl, persistTo, vars = {}) {
    const port = await freePort();
    const child = spawn(process.execPath, [wrangler, 'dev', '--port', String(port), '--inspector-port', '0',
        '--persist-to', persistTo, '--show-interactive-dev-session=false',
        '--var', `CREATE_PASSWORD_HASH:${await sha256Hex(PASSWORD)}`,
        '--var', `PINPLAY_API_URL:${pinPlayUrl}`,
        // No OpenAI key unless a test brings its own: the one in .dev.vars must not change the results.
        ...Object.entries({ OPENAI_API_KEY: '', MOVEMENT_CHECK: '0', ...vars }).flatMap(([key, value]) => ['--var', `${key}:${value}`])], {
        cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let log = '';
    child.stdout.on('data', chunk => { log += chunk; });
    child.stderr.on('data', chunk => { log += chunk; });
    const base = `http://127.0.0.1:${port}`;
    const stop = () => new Promise(resolve => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', resolve);
        // wrangler runs workerd as a child process; take the whole tree down.
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
        else child.kill('SIGTERM');
    });
    for (let attempt = 0; attempt < 120; attempt++) {
        try { if ((await fetch(`${base}/api/health`)).ok) return { base, stop }; } catch { /* starting */ }
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
    ws.onmessage = event => { if (event.data !== 'pong') { inbox.push(JSON.parse(event.data)); deliver(); } };
    const closed = new Promise(resolve => { ws.onclose = event => resolve(event.code); });
    return {
        ws, closed, inbox,
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
            { skin: 2, hairColor: 0, hair: 3, eyes: 0, mouth: 0, glasses: 0, shirt: 0, hat: 0 });
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

        // ...but not what OpenAI could not check, nor a whisper.
        assert.match((await send('outage again')).text, /approval/);
        await pause(1600);
        alex.send({ t: 'chat', text: 'Psst, a whisper', to: sam.welcome.id });
        assert.match((await alex.next(m => m.t === 'notice', 'whisper waits')).text, /approval/);
        const waiting = (await entries()).filter(e => e.status === 'pending').map(e => e.text).sort();
        assert.deepEqual(waiting, ['Psst, a whisper', 'outage again']);

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
        const hint = async (id, text) => {
            await pause(900); // one hint at a time
            alex.send({ t: 'check', id, text });
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
        assert.deepEqual(opened.campaigns.map(item => item.id), ['castanyada']);

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

        // Each student is handed only their own job's clue, never anyone else's.
        const clueOf = quest => quest.clues[0].text;
        for (const quest of Object.values(quests)) {
            assert.equal(quest.clues.length, 1);
            assert.equal(quest.status, 'active');
            assert.equal(quest.chapter.ending, null);
            const others = Object.values(quests).filter(other => other !== quest);
            for (const other of others) assert.equal(JSON.stringify(quest).includes(clueOf(other)), false);
        }
        assert.equal(JSON.stringify(sam.socket.inbox).includes(clueOf(quests.alex)), false);

        // Walking into a named place reveals a clue, once.
        chris.socket.send({ t: 'move', x: 1470, y: 1241 });
        const found = (await chris.socket.next(message => message.t === 'quest' && message.quest.clues.length === 2, 'park clue')).quest;
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
        assert.equal(chrisBack.quest.clues.length, 2);
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
        await reveal();
        assert.equal((await reveal()).status, 400, 'no more news to reveal');

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
            assert.match(done.chapter.ending, /Who took the chestnuts/);
            assert.equal(done.objectives.every(item => item.optional), true, 'only bonus questions stay open');
            assert.deepEqual(done.team, { done: 6, total: 9 }, 'six of nine main answers: two students finished all three');
        }
        assert.equal((await reveal()).status, 400, 'no news once the chapter is over');

        // A bonus question can still be answered after the chapter is finished; a main one cannot.
        answer(alexBack, 'a star', 'lock');
        assert.equal((await result(alexBack)).correct, true);
        answer(chrisBack, 'park', 'where');
        await pause(300);
        assert.equal(chrisBack.socket.inbox.some(message => message.t === 'answered'), false);
        status = (await api(base, '/api/teacher/status', { session })).body.campaign;
        assert.equal(status.status, 'chapter_complete');
        assert.deepEqual(status.players.map(player => player.done.length).sort(), [0, 3, 4]);

        // The teacher moves the story on to chapter 2, and from there to the end of the campaign.
        const second = (await api(base, '/api/teacher/campaign', { session, body: { op: 'next' } })).body.campaign;
        assert.deepEqual([second.status, second.chapter], ['active', 1]);
        assert.equal((await api(base, '/api/teacher/campaign', { session, body: { op: 'next' } })).body.campaign.status, 'campaign_complete');
        const over = (await alexBack.socket.next(message => message.t === 'quest' && message.quest.status === 'campaign_complete', 'the end')).quest;
        assert.equal(over.finale, 'To be continued…');
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
        assert.deepEqual(status.online.find(student => student.studentKey === 'stu_a'), { studentKey: 'stu_a', name: another.name });
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

        // A normal few steps are passed on to everyone.
        await pause(300);
        alex.send({ t: 'move', x: x + 20, y });
        const seen = await sam.next(message => message.t === 'move' && message.id === alex.welcome.id, 'a step');
        assert.deepEqual([seen.x, seen.y], [x + 20, y]);

        // Stepping into the fountain is refused, and Alex is told where they really are.
        alex.send({ t: 'move', x: 590, y: 1280 }); // the fountain basin: far, and a wall
        assert.deepEqual(((s) => [s.x, s.y])(await snapBack()), [x + 20, y]);

        // So is appearing across the map, even somewhere open.
        alex.send({ t: 'move', x: 1100, y: 740 });
        assert.deepEqual(((s) => [s.x, s.y])(await snapBack()), [x + 20, y]);

        // And a short hop into the top of the fountain.
        alex.send({ t: 'move', x: x + 20, y: y + 100 });
        await snapBack();
        assert.equal(sam.inbox.filter(message => message.t === 'move' && message.id === alex.welcome.id && message.y !== y).length, 0, 'refused moves never reach anyone');

        // The same distance walked over time is fine: a long walk, given the seconds it takes.
        await pause(1500);
        alex.send({ t: 'move', x: x + 20, y: y - 100 });
        assert.equal((await sam.next(message => message.t === 'move' && message.id === alex.welcome.id, 'a longer walk')).y, y - 100);
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
            assert.equal(thieves.length, 1, 'one thief for a small class');
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
