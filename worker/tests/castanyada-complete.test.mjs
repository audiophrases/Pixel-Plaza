import test from 'node:test';
import assert from 'node:assert/strict';
import { absentRoleClues, isUnlocked } from '../../shared/campaign.ts';
import { castanyada, castanyadaComplete } from './fixtures/season-1.mjs';
import { missionJson, parseMission, validateMission, missionEnvelope } from '../../shared/missionSchema.ts';
import { QuestBoard } from '../questBoard.ts';

test('five-chapter template publishes and roundtrips without rewriting the original campaign', () => {
    assert.deepEqual(parseMission(missionJson(castanyadaComplete)).errors, []);
    assert.deepEqual(parseMission(missionJson(castanyadaComplete)).campaign, castanyadaComplete);
    assert.equal(castanyada.chapters.length, 3);
    assert.equal(castanyadaComplete.chapters.length, 5);
    assert.notEqual(castanyada.chapters[2].ending, castanyadaComplete.chapters[2].ending);
    assert.match(castanyadaComplete.chapters[2].intro, /afternoon/);
    assert.equal(castanyada.chapters[0].objectives.find(o => o.id === 'keys').rewards, undefined);
    for (const chapter of castanyadaComplete.chapters) {
        const social = chapter.objectives.filter(o => o.board);
        assert.equal(social.length, 2);
        assert.deepEqual(social.map(o => o.activity), ['interview', 'exchange']);
        assert.ok(social.every(o => o.optional && o.board.afterMain && o.board.differentRole));
        const main = chapter.objectives.filter(o => !o.optional);
        assert.ok(isUnlocked(social[0], main.map(o => o.id)));
        assert.equal(isUnlocked(social[1], main.map(o => o.id)), false);
        assert.ok(isUnlocked(social[1], [...main.map(o => o.id), social[0].id]));
    }
});

test('new mysteries supply information before consuming it, including missing-role rewards', () => {
    const four = castanyadaComplete.chapters[3]; const five = castanyadaComplete.chapters[4];
    const fallback = (chapter, done) => absentRoleClues(castanyadaComplete, chapter, 'baker', done, ['baker'], ['baker']).map(c => c.text).join(' ');
    assert.match(fallback(four, []), /hotel/);
    assert.ok(!fallback(four, []).includes('half past five'));
    assert.match(fallback(four, ['plan-location']), /half past five/);
    assert.match(fallback(four, ['plan-location', 'plan-rehearsal']), /two clear exits/);
    assert.ok(!fallback(five, []).includes('new neighbors'));
    assert.match(fallback(five, ['lantern-location']), /Wind through/);
    assert.match(fallback(five, ['lantern-location', 'lantern-sound']), /new neighbors/);
    for (const chapter of [four, five]) {
        assert.equal(chapter.thieves, undefined, 'the resolved thief plot does not restart');
        assert.equal(chapter.objectives.filter(o => !o.optional).length, 4);
        assert.equal(chapter.objectives.filter(o => !o.optional).at(-1).kind, 'report');
    }
});

test('different-role information exchanges exclude same-role and unfinished partners', () => {
    const chapter = castanyadaComplete.chapters[0]; const objective = chapter.objectives.find(o => o.board);
    const done = chapter.objectives.filter(o => !o.optional).map(o => o.id);
    const player = { student_key: 'a', role_id: 'baker', done };
    const players = [player, { student_key: 'b', role_id: 'baker', done }, { student_key: 'c', role_id: 'driver', done }, { student_key: 'd', role_id: 'planner', done: [] }];
    const ctx = { game: 'test', chapterIndex: 0, chapter, status: 'active', player, players, online: new Set(['a', 'b', 'c', 'd']), names: new Map() };
    const board = new QuestBoard({ exec() { throw new Error('Partner selection must not query storage.'); } });
    assert.deepEqual(board.partners(ctx, objective).map(p => p.student_key), ['c']);
    ctx.online.delete('c');
    assert.deepEqual(board.partners(ctx, objective), []);
    assert.deepEqual(board.partners(ctx, { ...objective, board: { ...objective.board, differentRole: false } }).map(p => p.student_key), ['b']);
    const invalid = structuredClone(castanyadaComplete);
    invalid.chapters[0].objectives.find(o => o.board).board.differentRole = 'yes';
    assert.equal(validateMission(missionEnvelope(invalid)).campaign, null);
});
