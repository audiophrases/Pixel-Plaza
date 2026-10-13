// The other warm-ups: Who am I? and Find your pair.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITIES, PAIRS, WARMUP_KINDS, assignIdentities, assignLateIdentity, assignLatePair, assignPairs, complementOf, identityById, isWarmupKind } from '../../shared/warmupKinds.ts';
import { answerMatches } from '../../shared/campaign.ts';

const students = count => Array.from({ length: count }, (_, index) => `s${index}`);

test('the three warm-ups are named, and only those can be asked for', () => {
    assert.deepEqual(WARMUP_KINDS.map(kind => kind.id), ['facts', 'identity', 'pairs']);
    assert.equal(isWarmupKind('pairs'), true);
    assert.equal(isWarmupKind('bingo'), false);
});

test('Who am I? gives everyone a different person and a classmate to find out about, in a circle', () => {
    for (const count of [2, 3, 7, 20, 30]) {
        const assigned = assignIdentities(students(count));
        assert.equal(assigned.size, count);
        assert.equal(new Set([...assigned.values()].map(item => item.fact)).size, count, 'nobody is the same person');
        const asked = [];
        for (const [student, { fact, targets }] of assigned) {
            assert.ok(identityById(fact), fact);
            assert.equal(targets.length, 1);
            assert.notEqual(targets[0], student, 'nobody finds out about themselves');
            asked.push(targets[0]);
        }
        assert.equal(new Set(asked).size, count, 'everybody is asked about by someone');
    }
    assert.equal(assignIdentities(['only']).size, 0);
});

test('each person can be named in the ways students will type them', () => {
    const accepts = (id, text) => answerMatches({ id: 'x', text: 'x', accept: identityById(id).accept }, text);
    assert.equal(accepts('messi', 'Lionel Messi'), true);
    assert.equal(accepts('messi', 'is it messi?'), true);
    assert.equal(accepts('spiderman', 'Spider-Man'), true);
    assert.equal(accepts('rosalia', 'Rosalía'), true);
    assert.equal(accepts('messi', 'Ronaldo'), false);
    assert.equal(new Set(IDENTITIES.map(identity => identity.id)).size, IDENTITIES.length);
});

test('Find your pair gives each pair of students the two words that go together', () => {
    for (const count of [2, 3, 6, 7, 20]) {
        const assigned = assignPairs(students(count));
        assert.equal(assigned.size, count);
        const holders = new Map();
        for (const [student, { fact }] of assigned) holders.set(fact, [...(holders.get(fact) ?? []), student]);
        for (const [student, { fact, targets }] of assigned) {
            assert.equal(targets[0], complementOf(fact), 'looks for the word that goes with theirs');
            const partners = (holders.get(targets[0]) ?? []).filter(other => other !== student);
            assert.ok(partners.length >= 1, `${count} students: someone has ${targets[0]}`);
        }
    }
    assert.equal(complementOf('salt'), 'pepper');
    assert.equal(complementOf('pepper'), 'salt');
    assert.equal(complementOf('nonsense'), undefined);
    assert.equal(new Set(PAIRS.flat()).size, PAIRS.length * 2, 'no word is in two pairs');
});

test('someone arriving late fits in with those already playing', () => {
    const identity = assignLateIdentity(['messi', 'mozart'], ['s0', 's1']);
    assert.ok(!['messi', 'mozart'].includes(identity.fact), 'a person nobody else is');
    assert.ok(['s0', 's1'].includes(identity.targets[0]));
    assert.equal(assignLateIdentity(['messi'], []), null);
    const pair = assignLatePair(['salt', 'pepper', 'fish']);
    assert.equal(pair.targets[0], complementOf(pair.fact));
    assert.equal(assignLatePair([]), null);
});
