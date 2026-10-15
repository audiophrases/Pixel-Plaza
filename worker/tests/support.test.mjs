import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { StudentAssistance } from '../support.ts';

function repository() {
    const db = new DatabaseSync(':memory:');
    const sql = { exec(query, ...args) {
        if (!args.length && query.includes(';')) { db.exec(query); return { toArray: () => [] }; }
        const statement = db.prepare(query);
        const rows = statement.columns().length ? statement.all(...args) : (statement.run(...args), []);
        return { toArray: () => rows };
    } };
    const support = new StudentAssistance(sql); support.initialize();
    return { support, db, sql };
}

const attempt = (support, overrides = {}) => support.begin({ game: 'game', studentKey: 'alex', name: 'Alex',
    text: 'I want tell my clue.', source: 'chat', ...overrides });

test('AI help allowance is atomic, durable, scoped to a classroom session and not consumed on failure', t => {
    const { support, db, sql } = repository(); t.after(() => db.close());
    support.joinSession('session-one', 'game', 'alex'); support.joinSession('session-one', 'game', 'sam');
    support.joinSession('session-one', 'game', 'alex');
    assert.deepEqual({ ...support.aiCount('session-one') }, { used: 0, students: 2 });
    assert.equal(support.reserveAi('session-one', 'alex', 'first', 100000), true);
    assert.equal(support.reserveAi('session-one', 'alex', 'concurrent', 100001), false);
    assert.equal(support.aiState('session-one', 'alex', true, 100001).pending, true);
    const restored = new StudentAssistance(sql); restored.initialize();
    assert.equal(restored.reserveAi('session-one', 'alex', 'reconnected', 100002), false);
    assert.equal(restored.finishAi('session-one', 'alex', 'wrong-reservation', 'wrong'), false);
    assert.equal(restored.finishAi('session-one', 'alex', 'first', null), true);
    assert.equal(restored.aiState('session-one', 'alex', true).used, false);
    assert.equal(restored.reserveAi('session-one', 'alex', 'retry-too-soon', 100003), false);
    assert.equal(restored.reserveAi('session-one', 'alex', 'retry', 131000), true);
    assert.equal(restored.finishAi('session-one', 'alex', 'retry', 'Try: “I want to ___.”'), true);
    assert.equal(restored.reserveAi('session-one', 'alex', 'third', 200000), false);
    assert.deepEqual({ ...restored.aiCount('session-one') }, { used: 1, students: 2 });
    restored.joinSession('session-two', 'game', 'alex');
    assert.equal(restored.reserveAi('session-two', 'alex', 'new-class', 200000), true);
    assert.equal(restored.reserveAi('session-two', 'sam', 'forged-student', 200000), false);
});

test('every original submission remains available after corrections, filtering, review, and restart', t => {
    const { support, db, sql } = repository(); t.after(() => db.close());
    const original = '  i want tell my clue.  ';
    const id = attempt(support, { id: 'client-one', text: original });
    support.update(id, 'grammar-hint', 'Check the verb.', 'I want to tell my clue.');
    assert.equal(attempt(support, { id: 'client-one', text: 'a forged replacement' }), id);
    assert.equal(support.get(id).text, original, 'deduplicated client events cannot rewrite the original');
    support.submitted(id, 'I want to tell my clue.');
    support.update(id, 'pending', null, 'I want to tell my clue.', 'chat-one');
    support.chatStatus('chat-one', 'removed');
    const blocked = attempt(support, { text: 'a blocked message', source: 'interview', target: 'sam', objective: 'witness' });
    support.update(blocked, 'blocked', 'Language filter prevented sending.');
    const restarted = new StudentAssistance(sql); restarted.initialize();
    const rows = restarted.page('game').attempts;
    const corrected = rows.find(row => row.id === id);
    assert.equal(corrected.status, 'removed');
    assert.equal(corrected.text, original);
    assert.equal(corrected.finalText, 'I want to tell my clue.');
    assert.equal(corrected.correction, 'I want to tell my clue.');
    assert.equal(corrected.chatId, 'chat-one');
    assert.equal(rows.find(row => row.id === blocked).status, 'blocked');
    assert.equal(rows.find(row => row.id === blocked).target, 'sam');
    assert.equal(rows.find(row => row.id === blocked).objective, 'witness');
});

test('client ids and audit pages are scoped to their game and student', t => {
    const { support, db } = repository(); t.after(() => db.close());
    const alex = attempt(support, { id: 'same-id' });
    const sam = attempt(support, { id: 'same-id', studentKey: 'sam', name: 'Sam', text: 'Sam private clue' });
    const otherGame = attempt(support, { id: 'same-id', game: 'other-game', text: 'Other game private clue' });
    assert.notEqual(alex, sam); assert.notEqual(alex, otherGame);
    assert.equal(support.owned('game', 'alex', 'same-id'), alex);
    assert.equal(support.owned('game', 'alex', sam), null, 'server ids cannot claim another student\'s attempt');
    assert.deepEqual(support.page('game', 'sam').attempts.map(row => row.id), [sam]);
    assert.deepEqual(support.page('other-game').attempts.map(row => row.id), [otherGame]);
    assert.equal(support.get('unknown'), null);
});

test('keyset pagination remains complete with equal timestamps and concurrent newer messages', t => {
    const { support, db } = repository(); t.after(() => db.close());
    t.mock.method(Date, 'now', () => 1000);
    const expected = new Set(Array.from({ length: 7 }, (_, i) => attempt(support, { text: `message ${i}` })));
    const first = support.page('game', 'alex', undefined, 2);
    assert.equal(first.attempts.length, 2); assert.ok(first.next);
    assert.throws(() => support.page('other-game', 'alex', first.next, 2), /Invalid audit cursor/);
    assert.throws(() => support.page('game', 'sam', first.next, 2), /Invalid audit cursor/);
    assert.throws(() => support.page('game', undefined, first.next, 2), /Invalid audit cursor/);
    assert.throws(() => support.page('game', 'alex', 'garbage', 2), /Invalid audit cursor/);
    t.mock.method(Date, 'now', () => 2000);
    attempt(support, { text: 'newer message' });
    const found = first.attempts.map(row => row.id);
    let next = first.next;
    while (next) {
        const page = support.page('game', 'alex', next, 2);
        found.push(...page.attempts.map(row => row.id)); next = page.next;
    }
    assert.equal(found.length, expected.size);
    assert.equal(new Set(found).size, expected.size);
    assert.deepEqual(new Set(found), expected);
});

test('automatic suggestions need three recent observations and reset after teacher resolution', t => {
    const { support, db, sql } = repository(); t.after(() => db.close());
    let now = 100_000; t.mock.method(Date, 'now', () => now);
    assert.equal(support.signal('game', 'alex', 'Alex', 'Language filter', 'one'), null);
    assert.equal(support.signal('game', 'alex', 'Alex', 'Language filter', 'two'), null);
    assert.equal(support.signal('game', 'sam', 'Sam', 'Language filter', 'unrelated student'), null);
    assert.equal(support.signal('other-game', 'alex', 'Alex', 'Language filter', 'unrelated game'), null);
    assert.equal(support.signal('game', 'alex', 'Alex', 'Incorrect conclusion', 'different topic', 'instructions'), null);
    const suggested = support.signal('game', 'alex', 'Alex', 'Language filter', 'three');
    assert.equal(suggested.kind, 'suggested');
    assert.equal(support.alerts('game', new Map([['alex', 'Alex Realname']]))[0].name, 'Alex Realname');
    assert.ok(suggested.evidence.some(item => item.text === 'three'));
    now += 10 * 60_000;
    const restarted = new StudentAssistance(sql); restarted.initialize();
    assert.ok(restarted.alerts('game', {})[0].evidence.length, 'teacher review evidence outlasts the detection window');
    assert.equal(restarted.helpStatus('other-game', suggested.id, 'resolved'), false);
    assert.equal(restarted.helpStatus('game', suggested.id, 'resolved'), true);
    assert.deepEqual(restarted.alerts('game', {}), []);
    // These arrive in the same millisecond as resolution: row ids distinguish new events.
    assert.equal(restarted.signal('game', 'alex', 'Alex', 'Language filter', 'four'), null);
    assert.equal(restarted.signal('game', 'alex', 'Alex', 'Language filter', 'five'), null);
    assert.equal(restarted.signal('game', 'alex', 'Alex', 'Language filter', 'six').kind, 'suggested');
    assert.deepEqual(restarted.alerts('game', {})[0].evidence.map(item => item.text), ['four', 'five', 'six']);
});

test('old observations do not cause suggestions and successful submissions do not infer struggle', t => {
    const { support, db } = repository(); t.after(() => db.close());
    let now = 100_000; t.mock.method(Date, 'now', () => now);
    support.signal('game', 'alex', 'Alex', 'Language filter', 'one');
    support.signal('game', 'alex', 'Alex', 'Language filter', 'two');
    now += 5 * 60_000 + 1;
    assert.equal(support.signal('game', 'alex', 'Alex', 'Language filter', 'three'), null);
    for (let i = 0; i < 5; i++) support.update(attempt(support), 'approved');
    assert.deepEqual(support.alerts('game', {}), []);
});

test('manual help requests coalesce, preserve acknowledgement, and retain all notes in the audit', t => {
    const { support, db } = repository(); t.after(() => db.close());
    const first = support.request('game', 'alex', 'Alex', 'writing', 'I have an idea but need a word.');
    assert.equal(first.request.status, 'open');
    assert.equal(support.helpStatus('game', first.request.id, 'acknowledged'), true);
    const second = support.request('game', 'alex', 'Alex', 'instructions', 'Please explain this instruction.');
    assert.equal(second.request.id, first.request.id);
    assert.equal(second.request.status, 'acknowledged');
    assert.equal(second.request.topic, 'instructions');
    const alerts = support.alerts('game', {});
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].note, 'Please explain this instruction.');
    assert.equal(support.page('game', 'alex').attempts.filter(row => row.source === 'help').length, 2);
    const chat = attempt(support, { text: 'Can you help in chat?', target: 'teacher' });
    support.update(chat, 'teacher-inbox');
    support.request('game', 'alex', 'Alex', 'writing', 'Can you help in chat?', false);
    assert.equal(support.page('game', 'alex').attempts.length, 3, 'already audited teacher chat does not create a second help row');
    support.helpStatus('game', first.request.id, 'resolved');
    assert.equal(support.studentState('game', 'alex').request.status, 'resolved');
    const next = support.request('game', 'alex', 'Alex', 'classmate-message', 'What does this message mean?');
    assert.notEqual(next.request.id, first.request.id);
    assert.equal(next.request.status, 'open');
});

test('explicit requests promote a suggestion instead of generating duplicate alerts', t => {
    const { support, db } = repository(); t.after(() => db.close());
    for (const text of ['one', 'two', 'three']) support.signal('game', 'alex', 'Alex', 'Language filter', text);
    const suggested = support.alerts('game', {})[0];
    support.helpStatus('game', suggested.id, 'acknowledged');
    const request = support.request('game', 'alex', 'Alex', 'other', 'Please come to my desk.');
    assert.equal(request.request.id, suggested.id);
    assert.equal(request.request.status, 'acknowledged');
    assert.equal(support.alerts('game', {}).length, 1);
    assert.equal(support.alerts('game', {})[0].kind, 'requested');
});

test('teacher replies persist privately, are audited, and game deletion clears only that game', t => {
    const { support, db, sql } = repository(); t.after(() => db.close());
    support.request('game', 'alex', 'Alex', 'writing', 'Help please.');
    const state = support.teacherMessage('game', 'alex', 'Try starting with “I think…”');
    assert.equal(state.messages[0].text, 'Try starting with “I think…”');
    assert.equal(support.studentState('game', 'sam').messages.length, 0);
    assert.equal(support.studentState('other-game', 'alex').messages.length, 0);
    const reply = support.page('game', 'alex').attempts.find(row => row.source === 'teacher');
    assert.equal(reply.sender, 'Teacher'); assert.equal(reply.target, 'alex'); assert.equal(reply.status, 'sent');
    const restarted = new StudentAssistance(sql); restarted.initialize();
    assert.deepEqual(restarted.studentState('game', 'alex').messages, state.messages);
    restarted.request('other-game', 'sam', 'Sam', 'other', 'Other game help.');
    restarted.teacherMessage('other-game', 'sam', 'Other reply.');
    restarted.clear('game');
    assert.deepEqual(restarted.page('game').attempts, []);
    assert.deepEqual(restarted.alerts('game', {}), []);
    assert.deepEqual(restarted.studentState('game', 'alex'), { request: null, messages: [] });
    assert.equal(restarted.page('other-game').attempts.length, 2);
    assert.equal(restarted.alerts('other-game', {}).length, 1);
    assert.equal(restarted.studentState('other-game', 'sam').messages.length, 1);
});

test('submission storage bounds original text, final text, suggestions, requests, and teacher replies', t => {
    const { support, db } = repository(); t.after(() => db.close());
    const text = 'x'.repeat(1500);
    const id = attempt(support, { text });
    support.submitted(id, text); support.update(id, 'blocked', text, text);
    const row = support.get(id);
    for (const field of ['text', 'finalText', 'correction', 'reason']) assert.equal(row[field].length, 1000);
    support.request('game', 'alex', 'Alex', 'writing', text);
    assert.equal(support.alerts('game', {})[0].note.length, 1000);
    assert.equal(support.teacherMessage('game', 'alex', text).messages[0].text.length, 1000);
});

test('retained chat backfills idempotently without duplicating linked attempts or losing later audit history', t => {
    const { support, db, sql } = repository(); t.after(() => db.close());
    sql.exec(`CREATE TABLE chat (id TEXT PRIMARY KEY, game_id TEXT, student_key TEXT NOT NULL, sender TEXT NOT NULL,
        text TEXT NOT NULL, ts INTEGER NOT NULL, status TEXT NOT NULL, flag TEXT, note TEXT, target_key TEXT);`);
    sql.exec('INSERT INTO chat VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'old', 'game', 'alex', 'Alex', 'Old blocked text', 100, 'blocked', 'language', null, 'sam');
    const current = attempt(support, { text: 'Current submitted text' });
    support.update(current, 'approved', null, null, 'current');
    sql.exec('INSERT INTO chat VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'current', 'game', 'alex', 'Alex', 'Current chat text', 200, 'approved', null, null, null);
    support.backfillChat(); support.backfillChat();
    const restarted = new StudentAssistance(sql); restarted.initialize();
    const rows = restarted.page('game').attempts;
    assert.equal(rows.length, 2);
    const old = rows.find(row => row.chatId === 'old');
    assert.equal(old.id, 'legacy-chat:old'); assert.equal(old.status, 'blocked');
    assert.equal(old.reason, 'language'); assert.equal(old.target, 'sam');
    sql.exec('DELETE FROM chat WHERE game_id = ?', 'game');
    restarted.backfillChat();
    assert.equal(restarted.page('game').attempts.length, 2, 'pruning chat never prunes audit');
    restarted.chatStatus('old', 'removed');
    assert.equal(restarted.get(old.id).status, 'removed');
});


test('teacher alert exposes pending AI help and feedback without losing the original note', t => {
    const { support, db } = repository(); t.after(() => db.close());
    const id = attempt(support, { source: 'help', text: 'Vull explicar una idea.' });
    support.update(id, 'ai-help-pending');
    support.request('game', 'alex', 'Alex', 'writing', 'Vull explicar una idea.', false);
    assert.equal(support.alerts('game', {})[0].ai.pending, true);
    support.update(id, 'ai-help', 'Try: I want to ___.');
    const alert = support.alerts('game', {})[0];
    assert.equal(alert.note, 'Vull explicar una idea.');
    assert.deepEqual(alert.ai, { pending: false, tip: 'Try: I want to ___.' });
    const second = attempt(support, { source: 'help', text: 'More help' });
    support.update(second, 'help-requested');
    support.request('game', 'alex', 'Alex', 'writing', 'More help', false);
    assert.equal(support.alerts('game', {}).length, 1);
    assert.equal(support.alerts('game', {})[0].ai, undefined);
});
