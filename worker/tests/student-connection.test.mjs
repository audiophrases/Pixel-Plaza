import test from 'node:test';
import assert from 'node:assert/strict';
import { PlazaConnection } from '../../src/plaza.ts';

test('explicit chat attempts survive a disconnected connection and grammar hints keep their submission id', async () => {
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
    Object.assign(browser, { location: { href: 'http://localhost/' }, setTimeout, clearTimeout, setInterval, clearInterval });
    const page = new EventTarget();
    page.visibilityState = 'visible';
    globalThis.window = browser;
    globalThis.document = page;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ticket: 'temporary-join-ticket' }) });
    globalThis.WebSocket = Socket;
    const plaza = new PlazaConnection('123456', 'private-student-credential', null);
    const tick = () => new Promise(resolve => setImmediate(resolve));
    try {
        const first = plaza.recordAttempt('No entenc', 'teacher');
        plaza.recordAttemptOutcome(first, 'language-blocked', 'English word check: entenc');
        await tick();
        const socket = sockets[0];
        socket.open();
        assert.equal(socket.sent.length, 0, 'the server welcome must precede audit messages');
        socket.receive({ t: 'welcome', id: 'socket-a', players: [] });
        assert.deepEqual(socket.sent.map(message => message.t), ['attempt', 'attempt-outcome']);
        assert.equal(socket.sent[0].text, 'No entenc');
        assert.equal(socket.sent[0].to, 'teacher');
        assert.equal(socket.sent[1].id, first);
        assert.ok(!JSON.stringify(socket.sent).includes('private-student-credential'), 'audit events never include the student credential');

        socket.drop();
        const retry = plaza.recordAttempt('Same draft');
        plaza.recordAttemptOutcome(retry, 'language-blocked', 'English word check: draft');
        assert.notEqual(first, retry, 'each explicit retry receives its own submission id');
        browser.dispatchEvent(new Event('online'));
        await tick();
        const rejoined = sockets[1];
        rejoined.open();
        rejoined.receive({ t: 'welcome', id: 'socket-b', players: [] });
        assert.equal(rejoined.sent[0].id, retry);
        assert.equal(rejoined.sent[1].id, retry);
        assert.equal(rejoined.sent.length, 2, 'rejoining flushes queued events once');

        const hint = plaza.check('He walk home', retry);
        const check = rejoined.sent.at(-1);
        assert.equal(check.t, 'check');
        assert.equal(check.attemptId, retry);
        rejoined.receive({ t: 'checked', id: check.id, ok: false, corrected: 'He walks home.', why: 'Use walks with he.' });
        assert.deepEqual(await hint, { ok: false, corrected: 'He walks home.', why: 'Use walks with he.' });

        let support;
        const unsubscribe = plaza.subscribe(event => { if (event.t === 'support') support = event.support; });
        rejoined.receive({ t: 'support', support: { request: { id: 'help-1', topic: 'writing', status: 'acknowledged' }, messages: [{ id: 'reply-1', text: 'Tell me your idea.', timestamp: 100 }] } });
        assert.equal(support.messages[0].id, 'reply-1');
        assert.equal(support.request.status, 'acknowledged');
        unsubscribe();
    } finally {
        plaza.close();
        for (const [key, original] of Object.entries(originals)) {
            if (original === undefined) delete globalThis[key];
            else globalThis[key] = original;
        }
    }
});
