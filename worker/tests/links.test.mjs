// The join link a teacher posts for a game: sign in, then arrive with the PIN already filled in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { joinLink } from '../../src/studentAuth.ts';

test('a join link is the sign-in address with the PIN on the end', () => {
    assert.equal(joinLink('https://pixel-plaza.eugenime.workers.dev', '123456'), 'https://pixel-plaza.eugenime.workers.dev/?pin=123456');
    assert.equal(joinLink('https://pixel-plaza.eugenime.workers.dev/', '123456'), 'https://pixel-plaza.eugenime.workers.dev/?pin=123456', 'no double slash');
    assert.equal(joinLink('http://localhost:8787', '482913'), 'http://localhost:8787/?pin=482913');
});
