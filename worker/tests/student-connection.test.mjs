import test from 'node:test';
import assert from 'node:assert/strict';
import { PlazaConnection } from '../../src/plaza.ts';

// The server sends the game's map with every welcome; the page has none of its own.
const theme = { id: 'plaza', name: 'Pixel Plaza', image: '/assets/maps/plaza.webp' };

test('explicit chat attempts survive disconnects and reloads until acknowledged without crossing students or games', async () => {
    // Plain HTTP classroom browsers expose getRandomValues, but not randomUUID.
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const browserCrypto = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: browserCrypto });
    const originals = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
    const sockets = [];
    class Socket {
        static OPEN = 1;
        readyState = 0;
        sent = [];
        constructor() { sockets.push(this); }
        send(text) { this.sent.push(JSON.parse(text)); }
        close() { this.readyState = 3; }
        open() { this.readyState = 1; this.onopen?.(); }
        receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
        drop() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
    }
    const browser = new EventTarget();
    const storage = new Map();
    Object.assign(browser, { location: { href: 'http://localhost/' }, setTimeout, clearTimeout, setInterval, clearInterval,
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
    const page = new EventTarget();
    page.visibilityState = 'visible';
    globalThis.window = browser;
    globalThis.document = page;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ticket: 'temporary-join-ticket' }) });
    globalThis.WebSocket = Socket;
    const connections = [];
    const connect = (pin, student, token = 'private-student-credential') => {
        const connection = new PlazaConnection(pin, token, null, student);
        connections.push(connection);
        return connection;
    };
    let plaza = connect('123456', 'student-a');
    const tick = () => new Promise(resolve => setImmediate(resolve));
    try {
        const first = plaza.recordAttempt('No entenc', 'teacher');
        plaza.recordAttemptOutcome(first, 'language-blocked', 'English word check: entenc');
        assert.equal(storage.size, 1, 'explicit submissions are saved before they can reach the network');
        assert.ok(!JSON.stringify([...storage]).includes('private-student-credential'), 'neither storage keys nor saved messages include authentication credentials');
        await tick();
        const socket = sockets[0];
        socket.open();
        assert.equal(socket.sent.length, 0, 'the server welcome must precede audit messages');
        socket.receive({ t: 'welcome', id: 'socket-a', gameId: 'game-a', players: [], theme });
        assert.deepEqual(socket.sent.map(message => message.t), ['attempt', 'attempt-outcome']);
        assert.equal(socket.sent[0].text, 'No entenc');
        assert.equal(socket.sent[0].to, 'teacher');
        assert.equal(socket.sent[1].id, first);
        assert.equal(socket.sent[0].gameId, 'game-a');
        assert.ok(!JSON.stringify(socket.sent).includes('private-student-credential'), 'audit events never include the student credential');
        assert.equal(JSON.parse([...storage.values()][0]).length, 2, 'a socket send leaves both events saved until the server confirms them');
        socket.receive({ t: 'attempt-recorded', id: 'unrelated', kind: 'attempt' });
        assert.equal(JSON.parse([...storage.values()][0]).length, 2, 'an unrelated acknowledgement cannot discard an attempt');
        socket.receive({ t: 'attempt-recorded', id: first, kind: 'attempt' });
        assert.equal(JSON.parse([...storage.values()][0]).length, 1, 'an attempt acknowledgement preserves its unacknowledged outcome');
        socket.receive({ t: 'attempt-recorded', id: first, kind: 'attempt-outcome' });
        assert.equal(storage.size, 0, 'fully acknowledged records are removed from browser storage');

        socket.drop();
        const retry = plaza.recordAttempt('Same draft');
        plaza.recordAttemptOutcome(retry, 'language-blocked', 'English word check: draft');
        const journal = plaza.recordAttempt('I think the box is near the pond.', undefined, 'answer', 'where');
        plaza.recordAttemptOutcome(journal, 'not-sent', 'Not connected; this submission did not reach its recipient.');
        assert.notEqual(first, retry, 'each explicit retry receives its own submission id');
        browser.dispatchEvent(new Event('online'));
        await tick();
        const rejoined = sockets[1];
        rejoined.open();
        rejoined.receive({ t: 'welcome', id: 'socket-b', gameId: 'game-a', players: [], theme });
        assert.equal(rejoined.sent[0].id, retry);
        assert.equal(rejoined.sent[1].id, retry);
        assert.equal(rejoined.sent[2].id, journal);
        assert.equal(rejoined.sent[2].source, 'answer');
        assert.equal(rejoined.sent[2].objective, 'where');
        assert.equal(rejoined.sent[3].status, 'not-sent');
        assert.equal(rejoined.sent.length, 4, 'rejoining flushes chat and offline journal entries once');

        plaza.close(); // Simulate leaving and reopening the page before the ACK arrives.
        const otherStudent = connect('123456', 'student-b');
        await tick();
        sockets.at(-1).open();
        sockets.at(-1).receive({ t: 'welcome', id: 'socket-other-student', gameId: 'game-a', players: [], theme });
        assert.equal(sockets.at(-1).sent.length, 0, 'another student never restores this student’s messages');
        otherStudent.close();
        const otherRoom = connect('654321', 'student-a');
        await tick();
        sockets.at(-1).open();
        sockets.at(-1).receive({ t: 'welcome', id: 'socket-other-room', gameId: 'game-b', players: [], theme });
        assert.equal(sockets.at(-1).sent.length, 0, 'another room never receives the saved submissions');
        otherRoom.close();
        plaza = connect('123456', 'student-a', 'rotated-private-credential');
        await tick();
        const restored = sockets.at(-1);
        restored.open();
        restored.receive({ t: 'welcome', id: 'socket-reloaded', gameId: 'game-b', players: [], theme });
        assert.deepEqual(restored.sent.map(message => [message.t, message.id]), [['attempt', retry], ['attempt-outcome', retry], ['attempt', journal], ['attempt-outcome', journal]], 'reloading restores exact IDs and outcomes that the server has not confirmed');
        assert.equal(restored.sent[2].source, 'answer');
        assert.equal(restored.sent[2].objective, 'where');
        assert.equal(restored.sent[0].gameId, 'game-a', 'the original game binding survives a reused room PIN');
        restored.receive({ t: 'attempt-recorded', id: retry, kind: 'attempt' });
        restored.receive({ t: 'attempt-recorded', id: retry, kind: 'attempt-outcome' });
        restored.receive({ t: 'attempt-recorded', id: journal, kind: 'attempt' });
        restored.receive({ t: 'attempt-recorded', id: journal, kind: 'attempt-outcome' });
        assert.equal(storage.size, 0);

        const firstTab = plaza.recordAttempt('First tab pending');
        const secondTabConnection = connect('123456', 'student-a');
        await tick();
        const secondTab = sockets.at(-1);
        secondTab.open();
        secondTab.receive({ t: 'welcome', id: 'socket-second-tab', gameId: 'game-b', players: [], theme });
        const secondTabAttempt = secondTabConnection.recordAttempt('Second tab pending');
        restored.receive({ t: 'attempt-recorded', id: firstTab, kind: 'attempt' });
        assert.deepEqual(JSON.parse([...storage.values()][0]).map(message => message.id), [secondTabAttempt], 'acknowledging one tab preserves a newer submission queued by another tab');
        secondTab.receive({ t: 'attempt-recorded', id: firstTab, kind: 'attempt' });
        secondTab.receive({ t: 'attempt-recorded', id: secondTabAttempt, kind: 'attempt' });
        restored.receive({ t: 'attempt-recorded', id: secondTabAttempt, kind: 'attempt' });
        assert.equal(storage.size, 0);
        secondTabConnection.close();

        // A welcome without its map (an older server) cannot draw a game: the page says to reload instead.
        const mapless = connect('123456', 'student-c');
        await tick();
        const maplessSocket = sockets.at(-1);
        maplessSocket.open();
        maplessSocket.receive({ t: 'welcome', id: 'socket-mapless', gameId: 'game-b', players: [] });
        assert.deepEqual([mapless.status.state, mapless.theme], ['stopped', null]);
        assert.match(mapless.status.message, /Reload/);
        mapless.close();

        const hint = plaza.check('He walk home', retry);
        const check = restored.sent.at(-1);
        assert.equal(check.t, 'check');
        assert.equal(check.attemptId, retry);
        restored.receive({ t: 'checked', id: check.id, ok: false, corrected: 'He walks home.', why: 'Use walks with he.' });
        assert.deepEqual(await hint, { ok: false, corrected: 'He walks home.', why: 'Use walks with he.' });

        // Appearance updates replace the figure data in place, keeping its socket identity, position and rewards.
        restored.receive({ t: 'join', player: { id: 'classmate', name: 'Sam', x: 300, y: 420, shirt: 1, hair: 2, style: { colour: 1, flair: null } } });
        const classmate = plaza.players.get('classmate');
        let changedAppearance;
        const stopAppearance = plaza.subscribe(event => { if (event.t === 'avatar') changedAppearance = event; });
        restored.receive({ t: 'avatar', id: 'classmate', avatar: { shirt: 12, hair: 4, head: 3, voice: 'en-AU-NatashaNeural' } });
        assert.equal(plaza.players.get('classmate'), classmate);
        assert.deepEqual([classmate.name, classmate.x, classmate.y, classmate.shirt, classmate.hair, classmate.head, classmate.style.colour], ['Sam', 300, 420, 12, 4, 3, 1]);
        assert.equal(changedAppearance.id, 'classmate');
        stopAppearance();

        let support;
        const unsubscribe = plaza.subscribe(event => { if (event.t === 'support') support = event.support; });
        restored.receive({ t: 'support', support: { request: { id: 'help-1', topic: 'writing', status: 'acknowledged' }, messages: [{ id: 'reply-1', text: 'Tell me your idea.', timestamp: 100 }] } });
        assert.equal(support.messages[0].id, 'reply-1');
        assert.equal(support.request.status, 'acknowledged');
        unsubscribe();
    } finally {
        Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
        for (const connection of connections) connection.close();
        for (const [key, original] of Object.entries(originals)) {
            if (original === undefined) delete globalThis[key];
            else globalThis[key] = original;
        }
    }
});
