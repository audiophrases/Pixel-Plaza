import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PARTICIPATION, Participation, participationDecision, variedMessage } from '../participation.ts';

function repository(t) {
    const db = new DatabaseSync(':memory:'); t.after(() => db.close());
    const sql = { exec(query, ...args) {
        if (!args.length && query.includes(';')) { db.exec(query); return { toArray: () => [] }; }
        const statement = db.prepare(query);
        const rows = statement.columns().length ? statement.all(...args) : (statement.run(...args), []);
        return { toArray: () => rows };
    } };
    const participation = new Participation(sql); participation.initialize();
    return { participation, sql };
}

test('local filtering blocks greeting loops and cosmetic copies while allowing real questions and short follow-ups', () => {
    for (const text of ['hi', 'HELLO!!!', 'hi hello hi hello', 'okay thank you', 'yes yes yes', '???']) assert.equal(variedMessage(text, []), false, text);
    assert.equal(variedMessage('Where is the missing box?', []), true);
    assert.equal(variedMessage('Why?', ['What did you find?']), true);
    assert.equal(variedMessage('At 6', ['At 5']), true, 'new numbers can convey useful information');
    assert.equal(variedMessage('WHERE is the missing box!!!', ['Where is the missing box?']), false);
    assert.equal(variedMessage('Where is the missing box please?', ['Where is the missing box?']), false);
    assert.equal(variedMessage('box missing the is where', ['Where is the missing box?']), false);
    assert.equal(variedMessage('What is your favorite food?', ['What is your favorite sport?']), true);
});

test('reservations survive reconnects, reject concurrent requests and share one quota across recipients and games', t => {
    const { participation, sql } = repository(t);
    const first = 'What did you find near the hotel?';
    assert.equal(participation.reserve('lesson', 'game', 'alex', 'one', first, [], 100000), true);
    const restored = new Participation(sql); restored.initialize();
    assert.equal(restored.reserve('lesson', 'game', 'alex', 'two', 'Do you like football?', [], 100001), false);
    assert.equal(restored.reserve('lesson', 'another-game', 'alex', 'three', first.toUpperCase(), [], 200000), false);
    assert.equal(restored.reserve('lesson', 'game', 'alex', 'one', first, [], 200000), false);
    assert.equal(restored.reward('one'), true);
    assert.equal(restored.reward('one'), false, 'a duplicate completion cannot award twice');
    assert.equal(restored.reserve('lesson', 'game', 'sam', 'four', first, [], 100001), true, 'students have independent quotas');
    assert.equal(restored.reserve('new-lesson', 'game', 'alex', 'five', 'Why do you think that?', [], 100002), true);
});

const topics = ['apples', 'bananas', 'pears', 'oranges', 'grapes', 'lemons', 'mangoes', 'peaches', 'cherries', 'plums', 'melons', 'berries', 'kiwis'];
test('failed or negative decisions still consume the bounded check allowance', t => {
    const { participation } = repository(t);
    for (let i = 0; i < PARTICIPATION.checks; i++) {
        assert.equal(participation.reserve('lesson', 'game', 'alex', `c${i}`, `Describe ${topics[i]}`, [], 100000 + i * PARTICIPATION.gap), true);
    }
    assert.equal(participation.reserve('lesson', 'game', 'alex', 'overflow', 'Where is the shop?', [], 1000000), false);
});

test('participation stops at eight rewards, and deleting a game clears its records', t => {
    const { participation, sql } = repository(t);
    for (let i = 0; i < PARTICIPATION.awards; i++) {
        assert.equal(participation.reserve('lesson', 'game', 'alex', `c${i}`, `Describe ${topics[i]}`, [], 100000 + i * PARTICIPATION.gap), true);
        assert.equal(participation.reward(`c${i}`), true);
    }
    assert.equal(participation.reserve('lesson', 'game', 'alex', 'overflow', 'Where is the shop?', [], 1000000), false);
    participation.clear('game');
    assert.equal(sql.exec('SELECT * FROM participation_checks').toArray().length, 0);
});

test('late or out-of-order decisions cannot exceed the reward cap', t => {
    const { participation } = repository(t);
    for (let i = 0; i < PARTICIPATION.checks; i++) {
        assert.equal(participation.reserve('lesson', 'game', 'alex', `c${i}`, `Describe ${topics[i]}`, [], 100000 + i * PARTICIPATION.gap), true);
    }
    let awarded = 0;
    for (let i = PARTICIPATION.checks - 1; i >= 0; i--) awarded += Number(participation.reward(`c${i}`));
    assert.equal(awarded, PARTICIPATION.awards);
});

test('Decisions uses one bounded yes/no request, handles refusal and failures conservatively, and never generates text', async () => {
    const realFetch = globalThis.fetch;
    const calls = []; let response;
    globalThis.fetch = async (url, init) => { calls.push({ url, ...init }); if (response instanceof Error) throw response; return response; };
    const context = { message: 'Why?', previous: Array(40).fill('a'.repeat(300)), conversation: Array(20).fill({ self: false, text: 'b'.repeat(300), secret: 'not sent' }) };
    const reply = answers => new Response(JSON.stringify({ answers }));
    try {
        assert.equal(await participationDecision(context, {}), false);
        assert.equal(await participationDecision(context, { OPENAI_API_KEY: 'k', OPENAI_PARTICIPATION: '0' }), false);
        assert.equal(calls.length, 0);
        response = reply([{ name: 'useful_participation', type: 'predicate', probability: 0.9 }]);
        assert.equal(await participationDecision(context, { OPENAI_API_KEY: 'k' }), true);
        assert.equal(calls.length, 1);
        assert.ok(calls[0].url.endsWith('/v1/decisions'));
        const request = JSON.parse(calls[0].body); const input = JSON.parse(request.input);
        assert.equal(request.questions.length, 1);
        assert.equal(input.previous.length, PARTICIPATION.history);
        assert.equal(input.previous[0].length, 200);
        assert.equal(input.conversation.length, PARTICIPATION.peers);
        assert.deepEqual(Object.keys(input.conversation[0]), ['self', 'text']);
        for (const answers of [[], [{ name: 'useful_participation', type: 'refusal', probability: 1 }],
            [{ name: 'useful_participation', type: 'predicate', probability: 0.79 }],
            [{ name: 'useful_participation', type: 'predicate', probability: 2 }],
            [{ name: 'grammar_mistake', type: 'predicate', probability: 1 }]]) {
            response = reply(answers);
            assert.equal(await participationDecision(context, { OPENAI_API_KEY: 'k' }), false);
        }
        for (const failure of [new Response('{}', { status: 429 }), new Response('broken'), new Error('timeout')]) {
            response = failure;
            const before = calls.length;
            assert.equal(await participationDecision(context, { OPENAI_API_KEY: 'k' }), false);
            assert.equal(calls.length, before + 1, 'no retry or fallback');
        }
    } finally { globalThis.fetch = realFetch; }
});
