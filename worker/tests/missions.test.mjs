import test from 'node:test';
import assert from 'node:assert/strict';
import { castanyada } from '../../shared/campaign.ts';
import { missionEnvelope, missionJson, parseMission, validateMission } from '../../shared/missionSchema.ts';
import { importMission } from '../../shared/missionImport.ts';
import { buildMissionPrompt } from '../../shared/missionPrompt.ts';

test('campaign export and import preserve every answer, role secret and prerequisite', () => {
    const result = parseMission(missionJson(castanyada));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.campaign, castanyada);
    assert.ok(result.warnings.some(w => w.message.includes('Thieves')));
});

test('malformed or unsupported AI output cannot become a published campaign', () => {
    const variants = [
        data => { data.schemaVersion = 99; },
        data => { data.campaign.roles = [null]; },
        data => { data.campaign.chapters[0].share = 0; },
        data => { data.campaign.chapters[0].objectives[0].kind = 'delivery'; },
        data => { data.campaign.chapters[0].objectives[0].accept = []; },
        data => { data.campaign.chapters[0].objectives[0].after = 'absent'; },
        data => { data.campaign.chapters[0].discoveries[0].zone = 'moon'; },
        data => { data.campaign.chapters[1].objectives[0].id = 'where'; },
        data => { data.campaign.chapters[0].objectives[0].rewards.missing = 'secret'; },
        data => { data.campaign.chapters[0].objectives[0].script = 'execute me'; },
        data => { data.campaign.chapters[0].thieves = { card: 'A', story: 'B', carry: true }; },
        data => { data.campaign.chapters[0].objectives[0].after = 'keys'; },
    ];
    for (const mutate of variants) {
        const data = structuredClone(missionEnvelope(castanyada)); mutate(data);
        const result = validateMission(data);
        assert.equal(result.campaign, null); assert.ok(result.errors.length);
    }
    assert.equal(parseMission('```json\n{}\n```').campaign, null);
    assert.equal(parseMission('x'.repeat(512001)).campaign, null);
});

test('incomplete drafts can be saved but cannot be published; malformed fields cannot be saved', () => {
    const draft = structuredClone(missionEnvelope(castanyada));
    draft.campaign.title = ''; draft.campaign.chapters[0].objectives[0].accept = []; draft.campaign.chapters[0].objectives[1].after = 'not-yet-written';
    assert.ok(validateMission(draft, 'draft').campaign);
    assert.equal(validateMission(draft).campaign, null);
    draft.campaign.chapters[0].objectives[1].accept = 'invalid';
    assert.equal(validateMission(draft, 'draft').campaign, null);
});

test('append preserves input, rewrites collided links and reserves incoming suffixed IDs', () => {
    const current = structuredClone(castanyada);
    const incoming = structuredClone(castanyada); incoming.chapters = [incoming.chapters[0]];
    incoming.chapters[0].objectives.push({ id: 'where-2', text: 'A bonus report', kind: 'report', accept: [], optional: true });
    const before = JSON.stringify(current);
    const result = importMission(current, missionJson(incoming), 'append');
    assert.deepEqual(result.errors, []); assert.equal(JSON.stringify(current), before);
    const appended = result.campaign.chapters.at(-1);
    const renamed = appended.objectives.find(o => o.text === 'Where is the blue box?');
    assert.equal(renamed.id, 'where-3');
    assert.equal(appended.objectives.find(o => o.id === 'when-2').after, 'where-3');
    assert.ok(result.changes.some(c => c.includes('where → where-3')));
});

test('append refuses conflicting role content; replace keeps the library identity', () => {
    const incoming = structuredClone(castanyada); incoming.id = 'another'; incoming.roles[0].clue = 'Different secret';
    assert.equal(importMission(castanyada, missionJson(incoming), 'append').campaign, null);
    const replaced = importMission(castanyada, missionJson(incoming), 'replace');
    assert.equal(replaced.campaign.id, castanyada.id); assert.equal(replaced.campaign.roles[0].clue, 'Different secret');
});

test('AI prompt includes the actual mechanics, roles and map, and quotes the teacher brief', () => {
    const brief = 'Make three A2 side mysteries.';
    const prompt = buildMissionPrompt(castanyada, brief, 'A2', 'extend');
    assert.ok(prompt.includes(JSON.stringify(brief)));
    assert.ok(prompt.includes(missionJson(castanyada)));
    assert.ok(prompt.includes('schemaVersion 1'));
    assert.ok(prompt.includes('not implemented'));
    assert.ok(prompt.includes('BEFORE'));
});

test('chapter extension adds linked side quests without replacing the authored story', () => {
    const incoming = structuredClone(castanyada); incoming.chapters = [incoming.chapters[0]];
    incoming.chapters[0].objectives = [{ id: 'new-interview', text: 'Interview a witness. Write three sentences.', accept: [], kind: 'report', optional: true, after: 'where' }];
    incoming.chapters[0].discoveries = []; incoming.chapters[0].reveals = [];
    const result = importMission(castanyada, missionJson(incoming), 'extend', castanyada.chapters[0].id);
    assert.deepEqual(result.errors, []);
    assert.equal(result.campaign.chapters.length, castanyada.chapters.length);
    assert.equal(result.campaign.chapters[0].intro, castanyada.chapters[0].intro);
    assert.equal(result.campaign.chapters[0].objectives.at(-1).after, 'where');
    incoming.chapters[0].objectives[0].after = 'does-not-exist';
    assert.equal(importMission(castanyada, missionJson(incoming), 'extend', castanyada.chapters[0].id).campaign, null);
});
