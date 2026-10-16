// The side quest library: hundreds of optional quests a teacher can search and add to a running game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, LEVELS, STORY_CHAPTERS, THEMES, matchesFilters, questFacets, questFit, questObjective, searchQuests, sideQuestById, sideQuests } from '../../shared/sideQuests.ts';
import { answerMatches, castanyada, castanyadaComplete, castanyadaInvestigations, castanyadaSideQuests, plazaFreePlay } from '../../shared/campaign.ts';
import { missionEnvelope, missionId, validateMission } from '../../shared/missionSchema.ts';
import { liveMissionCandidate } from '../../shared/missionLive.ts';

const generic = sideQuests.filter(q => q.chapter === null);
const story = sideQuests.filter(q => q.chapter !== null);
const castanyadaTemplates = [castanyada, castanyadaSideQuests, castanyadaComplete, castanyadaInvestigations];
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
// Add quests to one chapter of a copy of a campaign and validate it as a publishable campaign.
function withQuests(campaign, chapterId, quests) {
    const copy = structuredClone(campaign);
    copy.chapters.find(c => c.id === chapterId).objectives.push(...quests.map(questObjective));
    return validateMission(missionEnvelope(copy));
}

test('the library is large, varied and fully labelled', () => {
    assert.ok(generic.length >= 500, `${generic.length} generic quests`);
    assert.ok(story.length >= 50, `${story.length} story quests`);
    for (const chapter of STORY_CHAPTERS) assert.ok(story.filter(q => q.chapter === chapter.id).length >= 10, `chapter ${chapter.number} has ten story quests`);
    for (const level of LEVELS) assert.ok(generic.filter(q => q.level === level.id).length >= 100, `${level.id} has at least 100 generic quests`);
    for (const theme of THEMES) assert.ok(sideQuests.some(q => q.theme === theme.id), `${theme.name} has quests`);
    for (const format of FORMATS) assert.ok(generic.some(q => q.format === format.id), `${format.name} quests exist`);
    assert.ok(generic.filter(q => q.answer === 'text').length >= 50, 'plenty of quests have an answer the game checks');
    assert.ok(generic.filter(q => q.tags.includes('warm-up')).length >= 50, 'plenty of warm-ups');

    assert.equal(new Set(sideQuests.map(q => q.id)).size, sideQuests.length, 'IDs are unique');
    assert.equal(new Set(sideQuests.map(q => q.title.toLowerCase())).size, sideQuests.length, 'titles are unique');
    for (const q of sideQuests) {
        const where = `${q.id} (${q.title})`;
        assert.ok(missionId(q.id) && q.id.startsWith('sq-'), `${where}: a library ID`);
        assert.ok(THEMES.some(t => t.id === q.theme) && LEVELS.some(l => l.id === q.level) && FORMATS.some(f => f.id === q.format), `${where}: known labels`);
        assert.equal(q.theme === 'castanyada', q.chapter !== null, `${where}: only Castanyada quests belong to a chapter`);
        assert.ok(q.chapter === null || STORY_CHAPTERS.some(c => c.id === q.chapter), `${where}: a known chapter`);
        assert.ok(Number.isInteger(q.minutes) && q.minutes >= 2 && q.minutes <= 20, `${where}: minutes`);
        assert.ok(q.title.trim() && q.title.length <= 60 && q.category.trim() && q.teacherNote.trim(), `${where}: title, category, teacher note`);
        assert.ok(q.focus.length >= 1 && q.tags.length >= 1 && q.tags.every(tag => tag === tag.toLowerCase()), `${where}: focus and lowercase tags`);
        assert.ok(q.text.trim().length >= 20 && q.text.length <= 1200 && !/[\n\r]/.test(q.text) && !/\*\*|#/.test(q.text), `${where}: plain one-paragraph instructions`);
        assert.ok(!/\p{Extended_Pictographic}/u.test(q.title + q.text), `${where}: no emoji`);
        if (q.answer === 'report') assert.deepEqual(q.accept, [], `${where}: reports have no accepted answers`);
        else {
            assert.ok(q.accept.length >= 1, `${where}: typed answers list what to accept`);
            for (const phrase of q.accept) assert.ok(answerMatches({ accept: [phrase] }, `I think it is ${phrase}`), `${where}: "${phrase}" can be typed`);
        }
        if (q.chapter === null) assert.ok(!q.roles && !q.after && !q.afterMain, `${where}: generic quests need no story`);
    }
});

test('every generic quest is a valid board quest in Plaza Free Play and in every Castanyada chapter', () => {
    for (const batch of chunks(generic, 90)) {
        const free = withQuests(plazaFreePlay, plazaFreePlay.chapters[0].id, batch);
        assert.deepEqual(free.errors, [], 'valid in Plaza Free Play');
        for (const quest of batch) assert.equal(questFit(quest, plazaFreePlay, plazaFreePlay.chapters[0].id), null);
    }
    for (const chapter of castanyadaComplete.chapters) {
        assert.deepEqual(withQuests(castanyadaComplete, chapter.id, generic.slice(0, 90)).errors, [], `valid in ${chapter.title}`);
        for (const quest of generic) assert.equal(questFit(quest, castanyadaComplete, chapter.id), null);
    }
    const objective = questObjective(generic.find(q => q.format === 'pair'));
    assert.equal(objective.optional, true); assert.equal(objective.board.minPlayers, 2, 'pair quests wait for a second student');
    assert.ok(!('afterMain' in objective.board), 'generic quests do not wait for the main mystery');
});

test('story quests fit their own chapter in every Castanyada template that has it, and nowhere else', () => {
    for (const template of castanyadaTemplates) {
        for (const chapter of STORY_CHAPTERS) {
            const quests = story.filter(q => q.chapter === chapter.id);
            if (!template.chapters.some(c => c.id === chapter.id)) {
                for (const quest of quests) assert.ok(questFit(quest, template, chapter.id), `${template.id} has no ${chapter.title}`);
                continue;
            }
            for (const quest of quests) assert.equal(questFit(quest, template, chapter.id), null, `${quest.id} fits ${template.id}`);
            assert.deepEqual(withQuests(template, chapter.id, quests).errors, [], `${template.id}: ${chapter.title}`);
            const other = template.chapters.find(c => c.id !== chapter.id);
            for (const quest of quests) assert.match(questFit(quest, template, other.id), /chapter/i, `${quest.id} does not fit ${other.id}`);
        }
    }
    for (const quest of story) assert.ok(questFit(quest, plazaFreePlay, plazaFreePlay.chapters[0].id), 'story quests stay with their story');
    // A live release of ten story quests checks the same rules the server uses.
    const chapter = castanyadaComplete.chapters[0];
    const source = structuredClone(castanyadaComplete); const quests = story.filter(q => q.chapter === chapter.id).slice(0, 10);
    source.chapters[0].objectives.push(...quests.map(questObjective));
    const live = liveMissionCandidate(castanyadaComplete, source, chapter.id, quests.map(q => q.id));
    assert.deepEqual(live.errors, []); assert.equal(live.quests.length, quests.length);
});

test('Plaza Free Play is a valid campaign of sessions with a check-in each', () => {
    const checked = validateMission(missionEnvelope(plazaFreePlay));
    assert.deepEqual(checked.errors, []);
    assert.ok(plazaFreePlay.chapters.length >= 6);
    for (const chapter of plazaFreePlay.chapters) {
        assert.equal(chapter.objectives.length, 1); assert.equal(chapter.objectives[0].kind, 'report');
        assert.equal(chapter.objectives.some(o => o.board), false, 'the teacher fills the board from the library');
    }
});

test('search finds quests by words, tags, labels and filters, title matches first', () => {
    assert.equal(searchQuests('').length, sideQuests.length);
    const sample = generic.find(q => q.answer === 'text');
    assert.equal(searchQuests(sample.title)[0].id, sample.id, 'an exact title comes first');
    assert.ok(searchQuests(sample.title.toUpperCase().replace(/ /g, '  ')).some(q => q.id === sample.id), 'case and spacing do not matter');
    const tag = sample.tags[0];
    assert.ok(searchQuests(tag).every(q => q.tags.includes(tag) || JSON.stringify(q).toLowerCase().includes(tag.toLowerCase())));
    assert.ok(searchQuests('starter').every(q => q.level === 'A1' || JSON.stringify(q).toLowerCase().includes('starter')), 'level names are searchable');
    assert.deepEqual(searchQuests('zzzz-no-such-word'), []);

    const filters = { levels: ['A1', 'A2'], formats: ['pair'], answers: ['report'], maxMinutes: 8, kind: 'generic' };
    const found = searchQuests('', filters);
    assert.ok(found.length > 0);
    assert.ok(found.every(q => ['A1', 'A2'].includes(q.level) && q.format === 'pair' && q.answer === 'report' && q.minutes <= 8 && q.chapter === null));
    assert.ok(searchQuests('', { kind: 'story' }).every(q => q.chapter !== null));
    assert.ok(searchQuests('', { chapters: ['haunted-festival'] }).every(q => q.chapter === 'haunted-festival'));
    assert.ok(sideQuests.every(q => matchesFilters(q, {})));

    // Each count shows how many quests choosing that value would show, keeping the other choices.
    const facets = questFacets('', { levels: ['B1'] });
    for (const theme of THEMES) assert.equal(facets.themes[theme.id], searchQuests('', { levels: ['B1'], themes: [theme.id] }).length);
    for (const level of LEVELS) assert.equal(facets.levels[level.id], searchQuests('', { levels: [level.id] }).length, 'a facet ignores its own choice');
    assert.equal(sideQuestById(sample.id), sample); assert.equal(sideQuestById('nope'), undefined);
});
