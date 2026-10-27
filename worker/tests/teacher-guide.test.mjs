import test from 'node:test';
import assert from 'node:assert/strict';
import { missions as campaigns, castanyada, castanyadaSideQuests, castanyadaComplete, castanyadaInvestigations } from './fixtures/season-1.mjs';
import { buildGuide } from '../../shared/teacherGuide.ts';

test('every campaign has a concise guide for every main and optional task in the actual definition', () => {
    for (const campaign of campaigns) {
        const guide = buildGuide(campaign);
        assert.equal(guide.chapters.length, campaign.chapters.length);
        for (const [index, chapter] of campaign.chapters.entries()) {
            const item = guide.chapters[index];
            assert.deepEqual(item.main.map(o => o.id), chapter.objectives.filter(o => !o.optional).map(o => o.id));
            assert.deepEqual(item.optional.map(o => o.id), chapter.objectives.filter(o => o.optional).map(o => o.id));
            assert.ok(item.mission.length <= 300);
            for (const task of [...item.main, ...item.optional]) assert.ok(task.steps.length && task.answer && task.task);
        }
    }
    assert.equal(buildGuide(castanyada).chapters.length, 3);
    assert.equal(buildGuide(castanyadaComplete).chapters.length, 5);
    assert.match(buildGuide(castanyada).chapters[2].mission, /find them/i, 'mission includes the goal, not only the time of day');
});

test('plain chat, chosen witnesses and assigned-partner quests have different, accurate instructions', () => {
    const plain = buildGuide(castanyada), strict = buildGuide(castanyadaInvestigations);
    assert.equal(plain.chapters[0].main[0].witnesses, 0);
    assert.match(plain.summary, /share clues in chat/);
    const thief = strict.chapters[1].main.find(o => o.id === 'thief');
    assert.equal(thief.witnesses, 2); assert.equal(thief.minimumPlayers, 3);
    assert.match(thief.steps.join(' '), /two different witnesses/);
    assert.match(thief.steps.join(' '), /Approve the question/);
    assert.match(thief.steps.join(' '), /Approve the reply/);
    assert.ok(strict.chapters.every(c => c.main.every(o => o.witnesses > 0)));
    const side = buildGuide(castanyadaSideQuests).chapters[0].optional.find(o => o.id === 'festival-exchange');
    assert.match(side.steps.join(' '), /Release quest/);
    assert.match(side.steps.join(' '), /app assigns a partner/);
    assert.doesNotMatch(side.steps.join(' '), /choose.*witness/);
    assert.match(side.prerequisites, /After either/);
    const partner = buildGuide(castanyadaComplete).chapters[0].optional.find(o => o.id === 'moon-delivery-audit');
    assert.match(partner.steps.join(' '), /different role/);
    assert.match(partner.steps.join(' '), /Both students finish/);
    assert.ok(partner.before.includes('keys'), 'after-main quests can use the private notes earned at the end of the main mystery');
});

test('answers, evidence and report criteria follow source edits, prerequisites and live additions', () => {
    const edited = structuredClone(castanyadaComplete);
    edited.chapters[0].objectives[0].accept = ['cafe'];
    edited.chapters[0].objectives[0].rewards.driver = 'A new delivery arrived at 10:00.';
    edited.chapters[0].objectives.push({ id: 'live-task', text: 'Explain your plan to a partner.', accept: [], kind: 'report', optional: true, activity: 'exchange', board: { differentRole: true } });
    const guide = buildGuide(edited);
    assert.equal(guide.chapters[0].main[0].answer, 'cafe');
    assert.ok(guide.chapters[0].main[0].unlockedClues.some(c => c.text === 'A new delivery arrived at 10:00.'));
    assert.deepEqual(guide.chapters[0].main[1].before, ['where']);
    assert.deepEqual(guide.chapters[0].main[0].before, [], 'a later reward is not presented as an initial clue');
    assert.match(guide.chapters[0].optional.at(-1).answer, /at least 5 words/);
    assert.match(guide.chapters[0].optional.at(-1).answer, /you assess/);
    assert.ok(!guide.chapters[0].optional.at(-1).steps.join(' ').includes('Both students finish'), 'after-main rules come from the actual task');
    assert.equal(guide.chapters[3].main.find(o => o.id === 'plan-location').answer, 'hotel');
    assert.match(guide.chapters[3].main.find(o => o.id === 'plan-rehearsal').answer, /5 30/);
    assert.match(guide.chapters[4].main.find(o => o.id === 'lantern-sound').answer, /wind/);
    assert.match(guide.chapters[4].main.find(o => o.id === 'festival-special-guests').answer, /new neighbors/);
    assert.match(guide.chapters[1].thiefBrief.story, /hotel desk/);
    assert.equal(guide.chapters[2].thiefBrief.carry, true);
    assert.equal(guide.chapters[4].thiefBrief, null);
    edited.chapters[0].roleClues = { baker: 'A changed clue for this role only.' };
    const partial = buildGuide(edited).chapters[0].clues;
    assert.equal(partial.length, edited.roles.length, 'partial chapter overrides keep the other roles’ starting clues');
    assert.equal(partial.find(c => c.role === 'Driver').text, edited.roles.find(r => r.id === 'driver').clue);
});

test('live role and thief names appear only when supplied, without choosing or inventing a culprit', () => {
    const live = buildGuide(castanyada, { roleNames: { shopkeeper: ['Brave Owl'], planner: ['Happy Fox'] }, thiefNames: [[], ['Brave Owl']], clueText: text => text.replace('{hat}', 'They wore a red hat.') });
    assert.match(live.chapters[1].main.find(o => o.id === 'meet-shop').answer, /Brave Owl/);
    assert.match(live.chapters[1].main.find(o => o.id === 'thief').answer, /Brave Owl/);
    assert.ok(live.chapters[1].clues.some(c => c.text.includes('red hat')));
    assert.match(buildGuide(castanyada).chapters[1].main.find(o => o.id === 'thief').answer, /when this chapter starts/);
});
