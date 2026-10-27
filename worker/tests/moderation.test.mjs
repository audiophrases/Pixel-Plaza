import test from 'node:test';
import assert from 'node:assert/strict';
import { moderate } from '../moderation.ts';

test('moderation keeps clean, flagged and unavailable results distinct', async () => {
    const original = globalThis.fetch;
    const env = { OPENAI_API_KEY: 'test-only' };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
    try {
        globalThis.fetch = async () => reply({ results: [{ flagged: false, categories: {} }] });
        assert.deepEqual(await moderate('Canary', env), { result: 'clean' });
        globalThis.fetch = async () => reply({ results: [{ flagged: false, categories: { sexual: true } }] });
        assert.deepEqual(await moderate('Canary', env), { result: 'flagged', categories: ['sexual'] });
        globalThis.fetch = async () => reply({}, 503);
        assert.deepEqual(await moderate('Canary', env), { result: 'unchecked', reason: 'HTTP 503' });
        globalThis.fetch = async () => reply({ results: [] });
        assert.deepEqual(await moderate('Canary', env), { result: 'unchecked', reason: 'invalid response' });
        globalThis.fetch = async () => { throw new DOMException('Timed out', 'TimeoutError'); };
        assert.deepEqual(await moderate('Canary', env), { result: 'unchecked', reason: 'timeout' });
        globalThis.fetch = async () => { throw new TypeError('Network failed'); };
        assert.deepEqual(await moderate('Canary', env), { result: 'unchecked', reason: 'network or response error' });
        globalThis.fetch = async () => { throw new Error('No call without a key'); };
        assert.deepEqual(await moderate('Canary', {}), { result: 'off' });
    } finally { globalThis.fetch = original; }
});
