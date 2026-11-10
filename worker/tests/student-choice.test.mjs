import test from 'node:test';
import assert from 'node:assert/strict';
import { studentChallenge, studentChoiceEligible, studentChoicePage, studentChoiceQuery } from '../../shared/studentChoice.ts';
import { questObjective } from '../../shared/sideQuests.ts';
import { sideQuests } from './fixtures/season-1.mjs';

test('student catalog exposes only public instructions, and preserves the chosen game version', () => {
    const quest = sideQuests.find(q => q.chapter === null && q.format === 'pair');
    const card = studentChallenge(quest);
    assert.deepEqual(Object.keys(card).sort(), ['category', 'format', 'id', 'level', 'minutes', 'text', 'title']);
    const changed = { ...quest, title: 'Edited later', text: 'New instructions', format: 'solo', level: 'B2' };
    const pinned = studentChallenge(changed, questObjective(quest));
    for (const field of ['title', 'text', 'format', 'level']) assert.equal(pinned[field], quest[field]);
    assert.ok(sideQuests.filter(q => q.chapter !== null).every(q => !studentChoiceEligible(q)));
    assert.equal(studentChoiceEligible({ ...quest, theme: 'story' }), false);
});

test('student catalog search, pagination and waiting partners use only public data', () => {
    const quest = sideQuests.find(studentChoiceEligible);
    const cards = Array.from({ length: 30 }, (_, i) => ({ ...studentChallenge(quest), id: String(i), title: `Challenge ${i}`, format: 'pair', level: 'A2',
        state: 'available', reason: null, joining: i === 29 ? ['Sam'] : [] }));
    const first = studentChoicePage(cards, studentChoiceQuery({}));
    assert.equal(first.total, 30); assert.equal(first.items.length, 12); assert.equal(first.pages, 3);
    assert.equal(first.items[0].id, '29', 'a classmate waiting for a partner comes first');
    assert.equal(studentChoicePage(cards, studentChoiceQuery({ page: 999 })).page, 2);
    assert.equal(studentChoicePage(cards, studentChoiceQuery({ format: 'solo' })).total, 0);
    assert.equal(studentChoicePage(cards, studentChoiceQuery({ search: 'Challenge 29', level: 'A2', format: 'pair' })).total, 1);
    const secret = studentChallenge({ ...quest, teacherNote: 'hidden-sentinel', accept: ['hidden-sentinel'], successCriteria: 'hidden-sentinel' });
    assert.equal(studentChoicePage([{ ...secret, state: 'available', reason: null, joining: [] }], studentChoiceQuery({ search: 'hidden-sentinel' })).total, 0);
    assert.deepEqual(studentChoiceQuery({ search: {}, format: 'class', level: 'secret', page: -10 }), { search: '', format: '', level: '', page: 0 });
});

test('ready pairs and groups come before solo tasks, while unavailable and completed tasks wait', () => {
    const base = { ...studentChallenge(sideQuests.find(studentChoiceEligible)), state: 'available', reason: null, joining: [] };
    const cards = [
        { ...base, id: 'solo', title: 'A solo challenge', format: 'solo' },
        { ...base, id: 'group', title: 'Z group challenge', format: 'group' },
        { ...base, id: 'pair', title: 'Y pair challenge', format: 'pair' },
        { ...base, id: 'waiting', title: 'A waiting group', format: 'group', state: 'waiting' },
        { ...base, id: 'done', title: 'A finished pair', format: 'pair', state: 'done' },
        { ...base, id: 'join', title: 'Z waiting partner', format: 'pair', joining: ['Sam'] },
        { ...base, id: 'mingle', title: 'A mingle challenge', format: 'mingle' },
    ];
    assert.deepEqual(studentChoicePage(cards, studentChoiceQuery({})).items.map(item => item.id),
        ['join', 'pair', 'group', 'mingle', 'solo', 'waiting', 'done']);
});
