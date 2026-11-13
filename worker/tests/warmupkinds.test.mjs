// The other warm-ups: Who am I? and Find your pair.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPS, IDENTITIES, PAIRS, SEQUENCE, WARMUP_KINDS, assignGroups, assignLateGroup, assignLateOrder, assignOrder, groupOf, wrapsAround, assignIdentities, assignLateIdentity, assignLatePair, assignPairs, complementOf, identityById, isWarmupKind } from '../../shared/warmupKinds.ts';
import { answerMatches } from '../../shared/campaign.ts';

const students = count => Array.from({ length: count }, (_, index) => `s${index}`);

test('the warm-ups are named, and only those can be asked for', () => {
    assert.deepEqual(WARMUP_KINDS.map(kind => kind.id), ['facts', 'identity', 'pairs', 'order', 'groups']);
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

test('What comes next? gives cards that follow one another, and everyone looks for the next one', () => {
    for (const count of [2, 3, 7, 28, 40]) {
        const assigned = assignOrder(students(count));
        assert.equal(assigned.size, count);
        const held = [...new Set([...assigned.values()].map(item => item.fact))].sort((a, b) => SEQUENCE.indexOf(a) - SEQUENCE.indexOf(b));
        assert.equal(held.length, Math.min(count, SEQUENCE.length), 'different cards while the list lasts');
        assert.equal(SEQUENCE.indexOf(held.at(-1)) - SEQUENCE.indexOf(held[0]), held.length - 1, 'no gaps between the cards in play');
        let last = 0;
        for (const [student, { fact, targets }] of assigned) {
            const wraps = wrapsAround(fact, targets[0]);
            assert.equal(targets[0], wraps ? held[0] : SEQUENCE[SEQUENCE.indexOf(fact) + 1]);
            if (wraps) { assert.equal(fact, held.at(-1)); last++; }
            assert.ok([...assigned].some(([other, part]) => other !== student && part.fact === targets[0]), 'someone else has the next card');
        }
        assert.ok(last >= 1, 'the last card leads back to the first');
    }
    assert.equal(assignOrder(['only']).size, 0);
    assert.equal(new Set(SEQUENCE).size, SEQUENCE.length);
    const custom = assignOrder(students(3), () => 0, ['one', 'two', 'three', 'four']);
    assert.deepEqual([...custom.values()].map(part => part.fact).sort(), ['one', 'three', 'two']);
});

test('Find your team puts at least two students in every team, each with a word of its group', () => {
    for (const count of [2, 3, 4, 5, 6, 7, 20, 30, 45]) {
        const assigned = assignGroups(students(count));
        assert.equal(assigned.size, count);
        const teams = new Map();
        for (const { fact, targets } of assigned.values()) {
            assert.equal(groupOf(fact)?.id, targets[0], 'the word belongs to the team');
            teams.set(targets[0], [...(teams.get(targets[0]) ?? []), fact]);
        }
        for (const words of teams.values()) {
            assert.ok(words.length >= 2, `${count} students: nobody is alone`);
            assert.equal(new Set(words).size, Math.min(words.length, 4), 'team-mates have different words while there are enough');
        }
        if (count >= 4) assert.ok(teams.size >= 2, 'more than one team to tell apart');
    }
    assert.equal(assignGroups(['only']).size, 0);
    assert.equal(new Set(GROUPS.flatMap(group => group.words)).size, GROUPS.length * 4, 'no word is in two groups');
});

test('late arrivals fit into the order and into a team that is playing', () => {
    const order = assignLateOrder([{ fact: 'a', targets: ['b'] }, { fact: 'b', targets: ['gone'] }]);
    assert.deepEqual(order, { fact: 'a', targets: ['b'] }, 'only a card whose next card is present');
    assert.equal(assignLateOrder([{ fact: 'a', targets: ['gone'] }]), null);
    const team = assignLateGroup(['apple', 'banana']);
    assert.equal(team.targets[0], 'fruit');
    assert.ok(['orange', 'strawberry'].includes(team.fact), 'a word nobody has yet');
    assert.equal(assignLateGroup([]), null);
});
