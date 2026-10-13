// The campaign rules that need no server: spreading roles, when a chapter is done, where a place is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerMatches, castanyada, chapterDone, isUnlocked, pickRole, rewardClues } from '../../shared/campaign.ts';
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

test('a chapter is done once enough of the class has finished every main question; bonus ones never count', () => {
    const chapter = castanyada.chapters[0]; // 60% of the class
    const main = chapter.objectives.filter(objective => !objective.optional).map(objective => objective.id);
    const done = ids => ({ done: ids });
    assert.equal(chapterDone(chapter, []), false);
    assert.equal(chapterDone(chapter, [done([]), done([]), done([])]), false);
    assert.equal(chapterDone(chapter, [done(main), done(main.slice(0, 1)), done([])]), false, 'one question of three is not the chapter');
    assert.equal(chapterDone(chapter, [done(main), done(main), done(main.slice(0, 2))]), true);
    // Bonus answers do not help a student finish the chapter.
    const bonus = chapter.objectives.filter(objective => objective.optional).map(objective => objective.id);
    assert.equal(chapterDone(chapter, [done(bonus), done(bonus), done(bonus)]), false);
    assert.equal(chapterDone({ ...chapter, objectives: [] }, [done([])]), false);
});

test('questions open one after another, and each answer earns a clue for your role', () => {
    const chapter = castanyada.chapters[0];
    const objective = id => chapter.objectives.find(item => item.id === id);
    assert.equal(isUnlocked(objective('where'), []), true);
    assert.equal(isUnlocked(objective('when'), []), false);
    assert.equal(isUnlocked(objective('when'), ['where']), true);
    assert.equal(isUnlocked(objective('chestnuts'), ['where']), false);
    assert.deepEqual(rewardClues(chapter, 'driver', []), []);
    assert.match(rewardClues(chapter, 'driver', ['where'])[0].text, /30 minutes/);
    assert.equal(rewardClues(chapter, 'driver', ['where', 'when']).length, 2);
    assert.deepEqual(rewardClues(chapter, 'nobody', ['where', 'when']), []);
});

test('every discovery and the story itself are well formed', () => {
    const zones = new Set(worldZones.map(zone => zone.id));
    for (const chapter of castanyada.chapters) {
        for (const discovery of chapter.discoveries) assert.ok(zones.has(discovery.zone), `${discovery.id} is in a place that exists`);
        const ids = chapter.objectives.map(objective => objective.id);
        for (const objective of chapter.objectives) {
            assert.ok(objective.accept.length > 0, `${objective.id} accepts something`);
            assert.ok(!objective.after || ids.includes(objective.after), `${objective.id} follows a question that exists`);
            for (const roleId of Object.keys(objective.rewards ?? {})) assert.ok(castanyada.roles.some(role => role.id === roleId), `${objective.id} rewards a real role`);
        }
        // Every role earns a clue from the questions that give rewards, so nobody is left out of the sharing.
        for (const objective of chapter.objectives.filter(item => item.rewards))
            for (const role of castanyada.roles) assert.ok(objective.rewards[role.id], `${objective.id} rewards the ${role.id}`);
        assert.ok(chapter.objectives.some(objective => objective.optional), 'there is something for fast finishers');
        assert.ok(chapter.reveals.length > 0 && chapter.recap.length > 0);
    }
    // Objective and discovery ids are what a student's progress is saved under, so they must not repeat.
    const ids = castanyada.chapters.flatMap(chapter => [...chapter.objectives.map(item => item.id), ...chapter.discoveries.map(item => item.id), ...chapter.reveals.map(item => item.id)]);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(new Set(castanyada.roles.map(role => role.id)).size, castanyada.roles.length);
});

test('a point is in the named place it stands in', () => {
    assert.equal(zoneAt(1470, 1241), 'park');
    assert.equal(zoneAt(490, 629), 'hotel');
    assert.equal(zoneAt(5, 5), null);
});

test('a typed answer counts in any sensible wording, and a guess does not', () => {
    const where = castanyada.chapters[0].objectives[0]; // the blue box is in the park
    for (const right of ['park', 'The park', 'in the PARK!', 'It is in the park.', 'near the pond'])
        assert.equal(answerMatches(where, right), true, right);
    for (const wrong of ['', '   ', 'hotel', 'the hotel', 'cafe', 'shop', 'park hotel cafe shop and the square and the fountain and many more places', 'parking', 'pa'])
        assert.equal(answerMatches(where, wrong), false, wrong);
    // One slip is forgiven only in longer words: "cat" is not "car".
    assert.equal(answerMatches({ id: 'x', text: 'x', accept: ['car'] }, 'cat'), false);
    assert.equal(answerMatches({ id: 'x', text: 'x', accept: ['chestnuts'] }, 'chestnut'), true);
    assert.equal(answerMatches({ id: 'x', text: 'x', accept: ['the old fountain'] }, 'at the old fontain'), true);
});
