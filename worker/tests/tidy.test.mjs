import test from 'node:test';
import assert from 'node:assert/strict';
import { groupRepeats, isGlitch, tidy } from '../../shared/tidy.ts';

test('glitch text is cut back to its letters, accents stay, and it counts as spam', () => {
    const glitch = 'H̶̢̧̡̢̡̛̛̛̦̗̣͖͓̭̪̖̦̻̪̲͕̩̟̙̪̩̙͙͚̦̹̱̹̱̘͉̦E̴̎͝lo';
    assert.ok(tidy(glitch).length < 12, `short enough: ${tidy(glitch).length}`);
    assert.equal(tidy(glitch).normalize('NFD').replace(/\p{M}/gu, ''), 'HElo');
    assert.equal(tidy('Àlvaro, café, niño'), 'Àlvaro, café, niño');
    assert.equal(isGlitch(glitch), true);
    assert.equal(isGlitch('Àlvaro, café, niño, pingüino'), false);
});

test('repeats one after the other become one item with a count', () => {
    const lines = ['nigg', 'nigg', 'nigge', 'hello', 'hello', 'hello', 'nigg'];
    assert.deepEqual(groupRepeats(lines, (a, b) => a === b).map(({ item, count }) => `${item}×${count}`), ['nigg×2', 'nigge×1', 'hello×3', 'nigg×1']);
    assert.deepEqual(groupRepeats([], () => true), []);
});
