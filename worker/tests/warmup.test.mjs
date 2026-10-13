// The warm-up's facts: everyone has something to find, and nobody is sent to look for themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FACTS, WARMUP_ROUNDS, assignLateJoiner, assignWarmup, factById } from '../../shared/warmup.ts';

const students = count => Array.from({ length: count }, (_, index) => `s${index}`);

test('the facts are all different, and each reads as a sentence about you and as something to find', () => {
    assert.equal(new Set(FACTS.map(fact => fact.id)).size, FACTS.length);
    for (const fact of FACTS) {
        assert.match(fact.mine, /^You .*\.$/, fact.mine);
        assert.ok(fact.find.length > 3, fact.id);
        assert.equal(factById(fact.id), fact);
    }
});

test('with fewer than two students there is nobody to find', () => {
    assert.equal(assignWarmup([]).size, 0);
    assert.equal(assignWarmup(['only']).size, 0);
});

test('every student gets a fact, someone else holds each fact they look for, and nobody looks for their own', () => {
    for (const count of [2, 3, 5, 8, 15, 20, 30]) {
        for (let run = 0; run < 20; run++) {
            const assigned = assignWarmup(students(count));
            assert.equal(assigned.size, count);
            const held = new Map();
            for (const [student, { fact }] of assigned) held.set(fact, [...(held.get(fact) ?? []), student]);
            for (const [student, { fact, targets }] of assigned) {
                assert.ok(targets.length >= 1 && targets.length <= WARMUP_ROUNDS, `${count} students: ${targets.length} targets`);
                assert.equal(new Set(targets).size, targets.length, 'no fact twice');
                for (const target of targets) {
                    assert.notEqual(target, fact, 'not their own fact');
                    assert.ok((held.get(target) ?? []).some(holder => holder !== student), `${count} students: someone holds ${target}`);
                }
            }
        }
    }
});

test('a bigger class uses more facts, so a fact is shared by only a few students', () => {
    const used = size => new Set([...assignWarmup(students(size)).values()].map(item => item.fact)).size;
    assert.equal(used(2), 2);
    assert.equal(used(3), 3);
    assert.ok(used(20) >= 10);
});

test('someone arriving late gets a fact already in play and facts to find', () => {
    const late = assignLateJoiner(['cat', 'dog', 'cat', 'pizza']);
    assert.ok(['cat', 'dog', 'pizza'].includes(late.fact));
    assert.ok(late.targets.length >= 1 && !late.targets.includes(late.fact));
    assert.equal(assignLateJoiner(['cat', 'cat']), null, 'one fact in play leaves nothing to find');
});
