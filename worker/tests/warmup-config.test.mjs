import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWarmup, validateWarmup, warmupVocabulary } from '../../shared/warmupConfig.ts';
import { assignWarmup, assignLateJoiner, factById } from '../../shared/warmup.ts';
import { assignIdentities, identityById, assignPairs, assignLatePair, complementOf } from '../../shared/warmupKinds.ts';
import { identityRevealProblem } from '../../shared/activityChat.ts';
import { answerMatches } from '../../shared/campaign.ts';

const custom = () => ({ kind: 'identity', title: 'Scientists', level: 'B1', instructions: 'Ask yes/no questions.', identities: [
    { id: 'ada', name: 'Ada Lovelace', accept: ['Ada', 'Lovelace'] }, { id: 'alan', name: 'Alan Turing', accept: ['Alan', 'Turing'] }, { id: 'grace', name: 'Grace Hopper', accept: ['Grace', 'Hopper'] },
] });

test('all built-in warm-up definitions remain valid and are independent copies', () => {
    for (const kind of ['identity', 'facts', 'pairs']) assert.deepEqual(validateWarmup(defaultWarmup(kind)).errors, []);
    const first = defaultWarmup('identity'); first.identities[0].name = 'Changed';
    assert.notEqual(defaultWarmup('identity').identities[0].name, 'Changed');
});

test('custom identities drive assignments, accepted answers, vocabulary and secret protection', () => {
    const result = validateWarmup(custom()); assert.deepEqual(result.errors, []);
    const definition = result.definition, assigned = assignIdentities(['a', 'b', 'c'], () => .5, definition.identities);
    assert.equal(new Set([...assigned.values()].map(a => a.fact)).size, 3);
    assert.equal(assigned.size, 3);
    for (const [key, own] of assigned) {
        const identity = identityById(own.fact, definition.identities), target = identityById(assigned.get(own.targets[0]).fact, definition.identities);
        assert.notEqual(own.targets[0], key);
        assert.ok(identityRevealProblem(`I am ${identity.name}`, identity.id, definition.identities));
        assert.equal(identityRevealProblem(`Are you ${target.name}?`, identity.id, definition.identities), null);
        assert.equal(identityRevealProblem('Yes!', identity.id, definition.identities), null);
        assert.ok(answerMatches({ accept: target.accept }, target.name), 'primary name is accepted without manually repeating it as an alias');
    }
    assert.ok(warmupVocabulary(definition).includes('Lovelace'));
    assert.ok(warmupVocabulary(definition).includes('Ada Lovelace'));
});

test('ambiguous identities, reserved reply words and malformed or oversized data are rejected', () => {
    for (const value of [null, {}, { ...custom(), identities: [] }, { ...custom(), instructions: '' }, { ...custom(), title: 'x'.repeat(121) },
        { ...custom(), level: 'C3' }, { ...custom(), identities: [{ id: 'bad', name: 'Yes', accept: [] }, custom().identities[1]] },
        { ...custom(), identities: [custom().identities[0], { ...custom().identities[1], accept: ['Ada'] }] },
        { ...custom(), identities: [custom().identities[0], { ...custom().identities[1], id: 'ada' }] },
        { ...custom(), unrelated: 'x'.repeat(65_000) }]) assert.equal(validateWarmup(value).definition, null);
    const pairs = { ...defaultWarmup('pairs'), pairs: [['cat', 'dog'], ['CAT', 'fish']] };
    assert.equal(validateWarmup(pairs).definition, null, 'each word has one unambiguous partner');
});

test('custom facts and pairs stay solvable, including late arrivals and configured round counts', () => {
    const facts = [{ id: 'parrot', mine: 'You have a parrot.', find: 'has a parrot' }, { id: 'sailing', mine: 'You like sailing.', find: 'likes sailing' }, { id: 'juggling', mine: 'You can juggle.', find: 'can juggle' }];
    const config = { ...defaultWarmup('facts'), facts, rounds: 1 };
    assert.deepEqual(validateWarmup(config).errors, []);
    const people = ['a', 'b', 'c', 'd'], assigned = assignWarmup(people, () => .5, facts, 1);
    for (const [key, own] of assigned) {
        assert.equal(own.targets.length, 1); assert.ok(factById(own.fact, facts));
        assert.ok([...assigned].some(([other, p]) => other !== key && p.fact === own.targets[0]));
    }
    assert.equal(assignLateJoiner([...assigned.values()].map(p => p.fact), () => .5, 1).targets.length, 1);
    const pairs = [['earth', 'moon'], ['pen', 'ink']];
    assert.deepEqual(validateWarmup({ ...defaultWarmup('pairs'), pairs }).errors, []);
    const paired = assignPairs(people, () => .5, pairs);
    for (const [key, own] of paired) {
        assert.equal(own.targets[0], complementOf(own.fact, pairs));
        assert.ok([...paired].some(([other, p]) => other !== key && p.fact === own.targets[0]));
    }
    assert.ok(complementOf(assignLatePair(['earth', 'moon'], () => .5, pairs).fact, pairs));
});
