// The campaign rules that need no server: spreading roles, when a chapter is done, where a place is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { castanyada, chapterDone, pickRole } from '../../shared/campaign.ts';
import { zoneAt, worldZones } from '../../shared/plazaMap.ts';

test('roles are spread across the class before any repeats, with ties broken at random', () => {
    const taken = [];
    for (let student = 0; student < 5; student++) taken.push(pickRole(castanyada.roles, taken, Math.random()).id);
    assert.equal(new Set(taken).size, 5);
    // The sixth student repeats one, but only once every role is in use.
    assert.ok(taken.includes(pickRole(castanyada.roles, taken, 0.99).id));
    // Each pick is the role with the fewest students so far.
    assert.equal(pickRole(castanyada.roles, ['baker', 'baker', 'driver'], 0).id, 'shopkeeper');
    assert.equal(pickRole(castanyada.roles, ['baker', 'baker', 'driver'], 0.99).id, 'planner');
});

test('a chapter is done once enough of the class has finished every objective', () => {
    const chapter = castanyada.chapters[0]; // 60% of the class
    const done = ids => ({ done: ids });
    assert.equal(chapterDone(chapter, []), false);
    assert.equal(chapterDone(chapter, [done([]), done([]), done([])]), false);
    assert.equal(chapterDone(chapter, [done(['where']), done([]), done([])]), false);
    assert.equal(chapterDone(chapter, [done(['where']), done(['where']), done([])]), true);
    assert.equal(chapterDone({ ...chapter, objectives: [] }, [done([])]), false);
});

test('every discovery and the story itself are well formed', () => {
    const zones = new Set(worldZones.map(zone => zone.id));
    for (const chapter of castanyada.chapters) {
        for (const discovery of chapter.discoveries) assert.ok(zones.has(discovery.zone), `${discovery.id} is in a place that exists`);
        for (const objective of chapter.objectives) assert.ok(objective.choices.some(choice => choice.id === objective.correct));
    }
    // Objective and discovery ids are what a student's progress is saved under, so they must not repeat.
    const ids = castanyada.chapters.flatMap(chapter => [...chapter.objectives.map(item => item.id), ...chapter.discoveries.map(item => item.id)]);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(new Set(castanyada.roles.map(role => role.id)).size, castanyada.roles.length);
});

test('a point is in the named place it stands in', () => {
    assert.equal(zoneAt(1470, 1241), 'park');
    assert.equal(zoneAt(490, 629), 'hotel');
    assert.equal(zoneAt(5, 5), null);
});
