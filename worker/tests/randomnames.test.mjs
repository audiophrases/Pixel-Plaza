// The made-up names: friendly, short enough for a nameplate, and never a name already in use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NAME_ADJECTIVES, NAME_PEOPLE, randomName } from '../../shared/randomNames.ts';

test('every name fits a nameplate and says nothing unkind', () => {
    for (const adjective of NAME_ADJECTIVES) for (const person of NAME_PEOPLE) assert.ok(`${adjective} ${person}`.length <= 24, `${adjective} ${person}`);
    // Nothing about looks, mood or faults that a classmate could tease with.
    for (const unkind of ['Chubby', 'Skinny', 'Bald', 'Lazy', 'Rude', 'Toxic', 'Savage', 'Cruel', 'Nasty', 'Clumsy', 'Shy', 'Awkward'])
        assert.equal(NAME_ADJECTIVES.includes(unkind), false, unkind);
    assert.ok(NAME_ADJECTIVES.length >= 60 && NAME_PEOPLE.length >= 300);
});

test('a name already in use is never given again', () => {
    const taken = new Set();
    for (let i = 0; i < 500; i++) {
        const name = randomName(taken);
        assert.equal(taken.has(name.toLowerCase()), false);
        taken.add(name.toLowerCase());
    }
    // With almost everything taken it still finds the free one.
    const all = new Set(NAME_ADJECTIVES.flatMap(adjective => NAME_PEOPLE.map(person => `${adjective} ${person}`.toLowerCase())));
    const free = `${NAME_ADJECTIVES[3]} ${NAME_PEOPLE[7]}`;
    all.delete(free.toLowerCase());
    assert.equal(randomName(all, () => 0.5), free);
});
