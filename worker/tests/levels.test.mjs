import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_EMOTES, EXTRA_EMOTES, checkStyle, emotesFor, levelOf, needFor, readStyle, unlockedAt } from '../../shared/levels.ts';

test('levels fill like Minecraft: each needs a little more than the last', () => {
    assert.deepEqual([needFor(0), needFor(1), needFor(2)], [10, 15, 20]);
    assert.deepEqual(levelOf(0), { level: 0, into: 0, need: 10 });
    assert.deepEqual(levelOf(9), { level: 0, into: 9, need: 10 });
    assert.deepEqual(levelOf(10), { level: 1, into: 0, need: 15 });
    assert.deepEqual(levelOf(26), { level: 2, into: 1, need: 20 });
    assert.equal(levelOf(-5).level, 0, 'never below zero');
});

test('levels unlock a name colour, then a flair, then more emotes', () => {
    assert.deepEqual(unlockedAt(1), ['Name colour']);
    assert.deepEqual(unlockedAt(4), []);
    assert.deepEqual(emotesFor(2), [...BASE_EMOTES]);
    assert.deepEqual(emotesFor(3), [...BASE_EMOTES, ...EXTRA_EMOTES]);

    assert.deepEqual(checkStyle({ colour: 0, flair: null }, 0), { colour: 0, flair: null }, 'the usual look is for everyone');
    assert.equal(checkStyle({ colour: 2, flair: null }, 0), null, 'a colour needs level 1');
    assert.deepEqual(checkStyle({ colour: 2 }, 1), { colour: 2, flair: null });
    assert.equal(checkStyle({ colour: 2, flair: '⚽' }, 1), null, 'a flair needs level 2');
    assert.deepEqual(checkStyle({ colour: 2, flair: '⚽' }, 2), { colour: 2, flair: '⚽' });
    assert.equal(checkStyle({ colour: 99 }, 9), null, 'only the listed colours');
    assert.equal(checkStyle({ flair: 'anything' }, 9), null, 'only the listed flairs');
    assert.equal(checkStyle('red', 9), null);

    assert.deepEqual(readStyle(JSON.stringify({ colour: 3, flair: '🚀' }), 5), { colour: 3, flair: '🚀' });
    assert.deepEqual(readStyle('not json', 5), { colour: 0, flair: null });
    assert.deepEqual(readStyle(null, 5), { colour: 0, flair: null });
});
