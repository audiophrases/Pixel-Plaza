import test from 'node:test';
import assert from 'node:assert/strict';
import { castanyada } from '../../shared/campaign.ts';
import { liveMissionCandidate } from '../../shared/missionLive.ts';

function source() {
    const campaign = structuredClone(castanyada);
    campaign.chapters[0].objectives.push({ id: 'new-interview', text: 'Interview a witness and report what you learned.', accept: [], kind: 'report', optional: true, activity: 'interview', board: { afterMain: true } });
    return campaign;
}

test('live additions ignore source changes to stories, roles and accepted answers', () => {
    const draft = source(); draft.title = 'Edited title'; draft.roles[0].clue = 'Changed secret';
    draft.chapters[0].objectives[0].accept = ['hotel']; draft.chapters[0].intro = 'Changed story';
    const before = JSON.stringify(castanyada);
    const result = liveMissionCandidate(castanyada, draft, castanyada.chapters[0].id, ['new-interview']);
    assert.deepEqual(result.errors, []);
    assert.equal(result.campaign.title, castanyada.title); assert.deepEqual(result.campaign.roles, castanyada.roles);
    assert.deepEqual(result.campaign.chapters[0].objectives[0], castanyada.chapters[0].objectives[0]);
    assert.equal(result.campaign.chapters[0].intro, castanyada.chapters[0].intro);
    assert.equal(result.quests[0].id, 'new-interview'); assert.equal(JSON.stringify(castanyada), before);
});

test('live additions reject main objectives, existing/tombstoned IDs, invalid audiences and dangling links', () => {
    const draft = source(); const chapter = castanyada.chapters[0].id;
    assert.equal(liveMissionCandidate(castanyada, draft, chapter, ['where']).campaign, null);
    assert.equal(liveMissionCandidate(castanyada, draft, chapter, ['new-interview'], ['new-interview']).campaign, null);
    assert.equal(liveMissionCandidate(castanyada, draft, 'wrong-chapter', ['new-interview']).campaign, null);
    assert.equal(liveMissionCandidate(castanyada, draft, chapter, []).campaign, null);
    assert.equal(liveMissionCandidate(castanyada, draft, chapter, ['new-interview', 'new-interview']).campaign, null);
    draft.chapters[0].objectives.at(-1).board.roles = ['invented'];
    assert.equal(liveMissionCandidate(castanyada, draft, chapter, ['new-interview']).campaign, null);
    draft.chapters[0].objectives.at(-1).board.roles = [];
    draft.chapters[0].objectives.at(-1).after = 'not-in-this-game';
    assert.equal(liveMissionCandidate(castanyada, draft, chapter, ['new-interview']).campaign, null);
});

test('a reviewed batch can link new quests together and to existing main progress', () => {
    const draft = source(); const first = draft.chapters[0].objectives.at(-1); first.requires = { mode: 'all', objectives: ['where', 'keys'] };
    draft.chapters[0].objectives.push({ ...structuredClone(first), id: 'new-exchange', requires: { mode: 'any', objectives: ['new-interview'] }, activity: 'exchange' });
    const chapter = castanyada.chapters[0].id;
    assert.equal(liveMissionCandidate(castanyada, draft, chapter, ['new-exchange']).campaign, null);
    const result = liveMissionCandidate(castanyada, draft, chapter, ['new-interview', 'new-exchange']);
    assert.deepEqual(result.errors, []); assert.deepEqual(result.quests.map(q => q.id), ['new-interview', 'new-exchange']);
});
