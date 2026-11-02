import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_EMOTES, CLOTH_COLOURS, DEFAULT_STYLE, EXTRA_EMOTES, LIGHT_COLOURS, REWARDS, checkStyle, emotesFor, levelOf, needFor, nextReward, readStyle, unlockedBetween } from '../../shared/levels.ts';

test('levels fill like Minecraft: the first comes quickly, each needs a little more than the last', () => {
    assert.deepEqual([needFor(0), needFor(1), needFor(2), needFor(3)], [3, 5, 7, 9]);
    assert.deepEqual(levelOf(0), { level: 0, into: 0, need: 3 });
    assert.deepEqual(levelOf(2), { level: 0, into: 2, need: 3 });
    assert.deepEqual(levelOf(3), { level: 1, into: 0, need: 5 });
    assert.deepEqual(levelOf(9), { level: 2, into: 1, need: 7 });
    assert.equal(levelOf(-5).level, 0, 'never below zero');
});

test('every reward the old, slower levels gave is open at the same experience or sooner', () => {
    // Before: 10 experience for a name colour, 25 for a flair, 45 for more emotes.
    for (const [xp, id] of [[10, 'colour'], [25, 'flair'], [45, 'emotes']]) {
        assert.ok(levelOf(xp).level >= REWARDS.find(reward => reward.id === id).level, id);
    }
});

test('one small reward per level, each shown as it opens, and the next one waiting', () => {
    assert.deepEqual(REWARDS.map(reward => reward.level), REWARDS.map((_, index) => index + 1));
    assert.deepEqual(unlockedBetween(0, 1), ['🎨 Name colour']);
    assert.deepEqual(unlockedBetween(1, 3), ['👖 Trousers', '🌟 Flair'], 'a jump of two levels shows both');
    assert.deepEqual(unlockedBetween(3, 3), []);
    assert.equal(nextReward(0).id, 'colour');
    assert.equal(nextReward(6).id, 'pet');
    assert.equal(nextReward(REWARDS.length), null, 'nothing left');
    assert.deepEqual(emotesFor(4), [...BASE_EMOTES]);
    assert.deepEqual(emotesFor(5), [...BASE_EMOTES, ...EXTRA_EMOTES]);
});

test('a look is checked against the level, piece by piece', () => {
    assert.deepEqual(checkStyle({ colour: 0, flair: null }, 0), DEFAULT_STYLE, 'the usual look is for everyone');
    assert.equal(checkStyle({ colour: 2, flair: null }, 0), null, 'a colour needs level 1');
    assert.deepEqual(checkStyle({ colour: 2 }, 1), { ...DEFAULT_STYLE, colour: 2 });
    assert.equal(checkStyle({ colour: 2, flair: '⚽' }, 2), null, 'a flair needs level 3');
    assert.deepEqual(checkStyle({ colour: 2, flair: '⚽' }, 3), { ...DEFAULT_STYLE, colour: 2, flair: '⚽' });
    assert.equal(checkStyle({ colour: 99 }, 9), null, 'only the listed colours');
    assert.equal(checkStyle({ flair: 'anything' }, 9), null, 'only the listed flairs');
    assert.equal(checkStyle('red', 9), null);

    // Clothes and the things around the figure.
    assert.equal(checkStyle({ pants: CLOTH_COLOURS[0] }, 1), null, 'trousers need level 2');
    assert.equal(checkStyle({ pants: CLOTH_COLOURS[0] }, 2).pants, CLOTH_COLOURS[0]);
    assert.equal(checkStyle({ pants: '#123456' }, 20), null, 'only the listed cloth colours');
    assert.equal(checkStyle({ glow: CLOTH_COLOURS[0] }, 20), null, 'a glow takes a light colour');
    assert.equal(checkStyle({ glow: LIGHT_COLOURS[2], trail: LIGHT_COLOURS[2] }, 8), null, 'a trail needs level 9');
    assert.deepEqual(checkStyle({ shoes: CLOTH_COLOURS[1], glow: LIGHT_COLOURS[2], cape: CLOTH_COLOURS[3], trail: LIGHT_COLOURS[2] }, 9),
        { ...DEFAULT_STYLE, shoes: CLOTH_COLOURS[1], glow: LIGHT_COLOURS[2], cape: CLOTH_COLOURS[3], trail: LIGHT_COLOURS[2] });
    assert.equal(checkStyle({ pet: '🐶' }, 7).pet, '🐶');
    assert.equal(checkStyle({ pet: '🐉' }, 7), null, 'rare pets need level 10');
    assert.equal(checkStyle({ pet: '🐉' }, 10).pet, '🐉');
    assert.equal(checkStyle({ pet: 7 }, 10), null);

    // Looks saved before there were clothes still read, with the rest the usual.
    assert.deepEqual(readStyle(JSON.stringify({ colour: 3, flair: '🚀' }), 5), { ...DEFAULT_STYLE, colour: 3, flair: '🚀' });
    assert.deepEqual(readStyle('not json', 5), DEFAULT_STYLE);
    assert.deepEqual(readStyle(null, 5), DEFAULT_STYLE);
});
