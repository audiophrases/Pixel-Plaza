// What counts as a believable grammar correction, and when no call is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGrammar, verdict } from '../grammar.ts';

const answer = (corrected, why = 'Use "goes" with "she".') => ({ ok: false, corrected, why });

test('a real correction is passed on', () => {
    assert.deepEqual(verdict('She go to school every day', answer('She goes to school every day')),
        { ok: false, corrected: 'She goes to school every day', why: 'Use "goes" with "she".' });
});

test('anything doubtful means the message is fine', () => {
    const original = 'She go to school every day';
    assert.deepEqual(verdict(original, { ok: true, corrected: '', why: '' }), { ok: true });
    assert.deepEqual(verdict(original, null), { ok: true });
    assert.deepEqual(verdict(original, 'nonsense'), { ok: true });
    assert.deepEqual(verdict(original, { ok: false, corrected: 5, why: 'x' }), { ok: true });
    assert.deepEqual(verdict(original, answer('')), { ok: true });                       // nothing to offer
    assert.deepEqual(verdict(original, answer(original)), { ok: true });                 // the same sentence
    assert.deepEqual(verdict(original, answer('  she go to SCHOOL every  day ')), { ok: true });
    assert.deepEqual(verdict(original, answer('Yes')), { ok: true });                    // not a correction
    assert.deepEqual(verdict(original, answer('She goes to school every day, and she also goes to the library, the park and the shops')), { ok: true });
    assert.deepEqual(verdict(original, answer('She goes to school every day', '')), { ok: true });
    assert.deepEqual(verdict(original, answer('She goes to school every day', 'x'.repeat(200))), { ok: true });
});

test('no call is made without a key, for short messages, or for long ones', async () => {
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls += 1; throw new Error('should not be called'); };
    try {
        assert.deepEqual(await checkGrammar('She go to school every day', {}), { ok: true });
        assert.deepEqual(await checkGrammar('hello there', { OPENAI_API_KEY: 'k' }), { ok: true });
        assert.deepEqual(await checkGrammar('word '.repeat(60), { OPENAI_API_KEY: 'k' }), { ok: true });
        assert.equal(calls, 0);
        // A failing network is "fine", not an error.
        assert.deepEqual(await checkGrammar('She go to school every day', { OPENAI_API_KEY: 'k' }), { ok: true });
        assert.equal(calls, 1);
    } finally {
        globalThis.fetch = realFetch;
    }
});
