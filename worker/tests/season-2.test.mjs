import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { missionEnvelope, missionJson, parseMission, validateMission } from '../../shared/missionSchema.ts';
import { importMission } from '../../shared/missionImport.ts';
import { absentRoleClues, rewardClues } from '../../shared/campaign.ts';
import { parseTheme } from '../../shared/theme.ts';
import { walkReport } from '../../shared/walk.ts';
import { createChecker } from '../../src/spelling.ts';

const read = file => JSON.parse(fs.readFileSync(new URL(`../../content/season-2/${file}`, import.meta.url), 'utf8'));
const envelope = read('campaign.json');
const campaign = envelope.campaign;
const theme = parseTheme(read('theme.json'));
const words = text => text.trim().split(/\s+/).length;

test('Season 2 is a valid modular three-chapter pack with concise bilingual student content and reachable map clues', () => {
    assert.equal(campaign.chapters.length, 3);
    assert.deepEqual(validateMission(envelope, 'publish', new Set(theme.zones.map(z => z.id))).errors, []);
    assert.deepEqual(walkReport(theme).problems, []);
    assert.deepEqual(parseMission(missionJson(campaign)).campaign, campaign, 'export/import preserves every authored help field');
    for (const role of campaign.roles) { assert.ok(role.help.card.ca); assert.ok(role.help.clue.ca); }
    assert.ok(campaign.help.finale.ca);
    for (const [i, chapter] of campaign.chapters.entries()) {
        assert.ok(words(chapter.intro) <= 40);
        for (const key of ['intro', 'recap', 'ending']) assert.ok(chapter.help[key].ca);
        for (const id of Object.keys(chapter.roleClues ?? {})) assert.ok(chapter.roleClueHelp[id].ca);
        for (const item of [...chapter.objectives, ...chapter.discoveries, ...chapter.reveals]) assert.ok(item.help.ca, item.id);
        assert.equal(chapter.objectives.filter(o => !o.optional).length, 3);
        assert.ok(chapter.objectives.every(o => words(o.text) < 25));
        const module = read(`chapters/0${i + 1}.json`);
        assert.deepEqual(validateMission(module, 'publish', new Set(theme.zones.map(z => z.id))).errors, []);
        assert.deepEqual(module.campaign.chapters, [chapter]);
        if (i < 2) assert.equal(module.campaign.finale, chapter.ending, 'standalone early chapters do not reveal the final resolution');
    }
    const bytes = fs.readFileSync(new URL('../../content/season-2/art/campus.png', import.meta.url));
    assert.ok(bytes.length < 8_000_000, 'the actual art fits the server upload limit');
    assert.equal(bytes.readUInt32BE(16), bytes.readUInt32BE(20), 'the background is square');
});

test('chapter copies retain translations when append remaps duplicate IDs', () => {
    const appended = importMission(campaign, JSON.stringify(read('chapters/02.json')), 'append');
    assert.deepEqual(appended.errors, []);
    const copy = appended.campaign.chapters.at(-1), original = campaign.chapters[1];
    assert.notEqual(copy.id, original.id);
    assert.deepEqual(copy.help, original.help);
    assert.deepEqual(copy.roleClueHelp, original.roleClueHelp);
    assert.deepEqual(copy.objectives.map(o => o.help), original.objectives.map(o => o.help));
    assert.equal(copy.objectives[1].after, copy.objectives[0].id);
});

test('language help is bounded, text only, and cannot reference nonexistent reward or role clues', () => {
    for (const mutate of [
        c => { c.chapters[0].objectives[0].help.ca = { answer: 'secret' }; },
        c => { c.help.finale.ca = 'x'.repeat(6001); },
        c => { c.chapters[0].help.answer = { ca: 'hidden' }; },
        c => { c.chapters[0].roleClueHelp = { unknown: { ca: 'hidden' } }; },
        c => { c.chapters[0].objectives[0].rewardHelp = { 'media-analyst': { ca: 'unearned' } }; },
    ]) {
        const changed = structuredClone(campaign); mutate(changed);
        assert.equal(validateMission(missionEnvelope(changed)).campaign, null);
    }
});

test('private and missing-role reward help follows the original unlock stage', () => {
    const c = structuredClone(campaign), chapter = c.chapters[0], [first, second] = c.roles;
    const objective = chapter.objectives[0];
    objective.rewards = { [second.id]: 'Earned private clue' };
    objective.rewardHelp = { [second.id]: { ca: 'Pista privada guanyada' } };
    assert.deepEqual(rewardClues(chapter, second.id, []), []);
    assert.ok(!JSON.stringify(absentRoleClues(c, chapter, first.id, [], [first.id], [first.id])).includes('Pista privada guanyada'));
    const earned = absentRoleClues(c, chapter, first.id, [objective.id], [first.id], [first.id]);
    assert.ok(earned.some(clue => clue.help?.ca === 'Pista privada guanyada'));
    assert.ok(!JSON.stringify(absentRoleClues(c, chapter, first.id, [objective.id], c.roles.map(r => r.id), c.roles.map(r => r.id))).includes('Pista privada guanyada'));
});

test('story names are accepted as authored vocabulary without making Catalan prose valid English', () => {
    const dictionary = name => fs.readFileSync(new URL(`../../node_modules/dictionary-en/index.${name}`, import.meta.url), 'utf8');
    const check = createChecker(dictionary('aff'), dictionary('dic'));
    assert.deepEqual(check('Karina told Youssef that Diop warned El Idrissi.', campaign.vocabulary), []);
    assert.ok(check('La professora va amagar les proves.', campaign.vocabulary).length > 0);
    assert.ok(check('Ionescu told Sokolova.', []).length > 0, 'the names do not become global built-in exceptions');
});
