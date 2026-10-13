// Which words a correction changed: what the hint highlights and what a kept mistake is marked with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wordDiff } from '../../shared/diff.ts';

const words = (text, spans) => spans.map(([start, end]) => text.slice(start, end));

test('the changed word is found on both sides', () => {
    const original = 'she go to school every day';
    const corrected = 'she goes to school every day';
    const diff = wordDiff(original, corrected);
    assert.deepEqual(words(original, diff.original), ['go']);
    assert.deepEqual(words(corrected, diff.corrected), ['goes']);
});

test('capitals and punctuation are not differences', () => {
    assert.deepEqual(wordDiff('She goes to school.', 'she goes to school'), { original: [], corrected: [] });
    assert.deepEqual(wordDiff('Hello, class!', 'hello class'), { original: [], corrected: [] });
});

test('an added word shows only in the correction, a removed one only in the original', () => {
    const added = wordDiff('I going to school', 'I am going to school');
    assert.deepEqual(added.original, []);
    assert.deepEqual(words('I am going to school', added.corrected), ['am']);
    const removed = wordDiff('I like the the park', 'I like the park');
    assert.deepEqual(words('I like the the park', removed.original), ['the']);
    assert.deepEqual(removed.corrected, []);
});

test('several changes and a swapped word are all found', () => {
    const original = 'He have two dog in house';
    const corrected = 'He has two dogs in the house';
    const diff = wordDiff(original, corrected);
    assert.deepEqual(words(original, diff.original), ['have', 'dog']);
    assert.deepEqual(words(corrected, diff.corrected), ['has', 'dogs', 'the']);
});
