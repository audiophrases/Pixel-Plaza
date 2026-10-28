import test from 'node:test';
import assert from 'node:assert/strict';
import { boardWait, isUnlocked, sideQuestWait } from '../../shared/campaign.ts';
import { castanyada, castanyadaSideQuests } from './fixtures/season-1.mjs';
import { missionEnvelope, missionJson, parseMission, validateMission } from '../../shared/missionSchema.ts';
import { importMission } from '../../shared/missionImport.ts';

test('all and any prerequisites unlock branches while legacy after stays compatible', () => {
    const all = { requires: { mode: 'all', objectives: ['a', 'b'] } };
    const any = { requires: { mode: 'any', objectives: ['a', 'b'] } };
    assert.equal(isUnlocked(all, ['a']), false); assert.equal(isUnlocked(all, ['a', 'b']), true);
    assert.equal(isUnlocked(any, []), false); assert.equal(isUnlocked(any, ['b']), true);
    assert.equal(isUnlocked({ after: 'a' }, ['b']), false); assert.equal(isUnlocked({ after: 'a' }, ['a']), true);
});

test('v2 board template roundtrips while unchanged v1 files keep their format', () => {
    assert.equal(missionEnvelope(castanyada).schemaVersion, 1);
    assert.equal(missionEnvelope(castanyadaSideQuests).schemaVersion, 2);
    assert.deepEqual(parseMission(missionJson(castanyadaSideQuests)).campaign, castanyadaSideQuests);
    const legacy = missionEnvelope(castanyadaSideQuests); legacy.schemaVersion = 1;
    assert.equal(validateMission(legacy).campaign, null);
});

test('graph cycles, optional gates and malformed social activities cannot publish', () => {
    const variants = [
        c => { c.chapters[0].objectives[0].requires = { mode: 'all', objectives: ['where'] }; },
        c => { c.chapters[0].objectives[0].requires = { mode: 'any', objectives: ['where', 'when'] }; },
        c => { c.chapters[0].objectives[0].after = 'note'; },
        c => { c.chapters[0].objectives[1].requires = { mode: 'all', objectives: ['where'] }; }, // ambiguous after + requires
        c => { c.chapters[0].objectives.at(-1).board.partnerRole = 'missing'; },
        c => { c.chapters[0].objectives.at(-1).board.roles = ['missing']; },
        c => { c.chapters[0].objectives.at(-1).optional = false; },
        c => { c.chapters[0].objectives.at(-1).kind = undefined; },
        c => { c.chapters[0].objectives.at(-1).board.minPlayers = 41; },
    ];
    for (const mutate of variants) { const c = structuredClone(castanyadaSideQuests); mutate(c); assert.equal(validateMission(missionEnvelope(c)).campaign, null); }
});

test('board availability enforces audience, main-story work, teacher release and class size', () => {
    const chapter = castanyadaSideQuests.chapters[0]; const quest = structuredClone(chapter.objectives.at(-2));
    quest.board = { roles: ['baker'], afterMain: true, minPlayers: 3, teacherReleased: true };
    const done = chapter.objectives.filter(o => !o.optional).map(o => o.id);
    assert.match(boardWait(quest, chapter, 'driver', done, true, 3), /another role/);
    assert.match(boardWait(quest, chapter, 'baker', [], true, 3), /main mystery/);
    assert.match(boardWait(quest, chapter, 'baker', done, false, 3), /teacher/);
    assert.match(boardWait(quest, chapter, 'baker', done, true, 2), /more classmates/);
    assert.equal(boardWait(quest, chapter, 'baker', done, true, 3), null);
});

test('side quests wait until the main questions and the warm-up are done', () => {
    const chapter = castanyadaSideQuests.chapters[0];
    const main = chapter.objectives.filter(o => !o.optional).map(o => o.id);
    assert.match(sideQuestWait(chapter, main.slice(1), false), /main questions/);
    assert.match(sideQuestWait(chapter, main, true), /warm-up/);
    assert.equal(sideQuestWait(chapter, main, false), null);
    assert.equal(sideQuestWait({ ...chapter, objectives: chapter.objectives.filter(o => o.optional) }, [], false), null, 'a chapter with no main questions is free at once');
});

test('append remaps all/any graph links without changing the existing campaign', () => {
    const incoming = structuredClone(castanyadaSideQuests); incoming.chapters = [incoming.chapters[0]];
    incoming.chapters[0].objectives.at(-1).requires = { mode: 'all', objectives: ['where', 'delivery-interview'] };
    const result = importMission(castanyadaSideQuests, missionJson(incoming), 'append');
    assert.deepEqual(result.errors, []);
    const appended = result.campaign.chapters.at(-1);
    assert.deepEqual(appended.objectives.at(-1).requires.objectives, ['where-2', 'delivery-interview-2']);
    assert.equal(appended.objectives.at(-1).board.teacherReleased, true);
});
