// The side quest library: hundreds of optional quests a teacher can write, search and add to a running game. The
// quests are data on the server, one record each; these tests use the frozen copy in fixtures/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, LEVELS, THEMES, checkQuest, checkQuestFile, findQuest, groupSize, matchesFilters, newQuestId, questFacets, questFit, questObjective, searchQuests, storyChapters as chaptersOf } from '../../shared/sideQuests.ts';
import { answerMatches } from '../../shared/campaign.ts';
import { castanyada, castanyadaComplete, castanyadaInvestigations, castanyadaSideQuests, library, plazaFreePlay, sideQuests, storyChapters } from './fixtures/season-1.mjs';
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
    assert.deepEqual(checkQuestFile(library), { quests: sideQuests }, 'every quest passes the check unchanged');
    assert.ok(generic.length >= 500, `${generic.length} generic quests`);
    assert.ok(story.length >= 50, `${story.length} story quests`);
    for (const chapter of storyChapters) assert.ok(story.filter(q => q.chapter === chapter.id).length >= 10, `chapter ${chapter.number} has ten story quests`);
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
        assert.equal(q.theme === 'story', q.chapter !== null, `${where}: only story quests belong to a chapter`);
        assert.ok(q.chapter === null || storyChapters.some(c => c.id === q.chapter), `${where}: a known chapter`);
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
        for (const quest of batch) assert.equal(questFit(quest, plazaFreePlay, plazaFreePlay.chapters[0].id, storyChapters), null);
    }
    for (const chapter of castanyadaComplete.chapters) {
        assert.deepEqual(withQuests(castanyadaComplete, chapter.id, generic.slice(0, 90)).errors, [], `valid in ${chapter.title}`);
        for (const quest of generic) assert.equal(questFit(quest, castanyadaComplete, chapter.id, storyChapters), null);
    }
    const objective = questObjective(generic.find(q => q.format === 'pair'));
    assert.equal(objective.optional, true); assert.equal(objective.board.minPlayers, 2, 'pair quests wait for a second student');
    const sizes = Object.fromEntries(FORMATS.map(f => [f.id, groupSize(questObjective(generic.find(q => q.format === f.id)))]));
    assert.deepEqual(sizes, { solo: 1, pair: 2, group: 3, mingle: 1 }, 'pairs and groups play together; a mingle is done alone');
    assert.ok(!('afterMain' in objective.board), 'generic quests do not wait for the main mystery');
});

test('story quests fit their own chapter in every Castanyada template that has it, and nowhere else', () => {
    for (const template of castanyadaTemplates) {
        for (const chapter of storyChapters) {
            const quests = story.filter(q => q.chapter === chapter.id);
            if (!template.chapters.some(c => c.id === chapter.id)) {
                for (const quest of quests) assert.ok(questFit(quest, template, chapter.id, storyChapters), `${template.id} has no ${chapter.title}`);
                continue;
            }
            for (const quest of quests) assert.equal(questFit(quest, template, chapter.id, storyChapters), null, `${quest.id} fits ${template.id}`);
            assert.deepEqual(withQuests(template, chapter.id, quests).errors, [], `${template.id}: ${chapter.title}`);
            const other = template.chapters.find(c => c.id !== chapter.id);
            for (const quest of quests) assert.match(questFit(quest, template, other.id, storyChapters), /chapter/i, `${quest.id} does not fit ${other.id}`);
        }
    }
    for (const quest of story) assert.ok(questFit(quest, plazaFreePlay, plazaFreePlay.chapters[0].id, storyChapters), 'story quests stay with their story');
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
    assert.equal(searchQuests(sideQuests, '').length, sideQuests.length);
    const sample = generic.find(q => q.answer === 'text');
    assert.equal(searchQuests(sideQuests, sample.title)[0].id, sample.id, 'an exact title comes first');
    assert.ok(searchQuests(sideQuests, sample.title.toUpperCase().replace(/ /g, '  ')).some(q => q.id === sample.id), 'case and spacing do not matter');
    const tag = sample.tags[0];
    assert.ok(searchQuests(sideQuests, tag).every(q => q.tags.includes(tag) || JSON.stringify(q).toLowerCase().includes(tag.toLowerCase())));
    assert.ok(searchQuests(sideQuests, 'starter').every(q => q.level === 'A1' || JSON.stringify(q).toLowerCase().includes('starter')), 'level names are searchable');
    assert.deepEqual(searchQuests(sideQuests, 'zzzz-no-such-word'), []);

    const filters = { levels: ['A1', 'A2'], formats: ['pair'], answers: ['report'], maxMinutes: 8, kind: 'generic' };
    const found = searchQuests(sideQuests, '', filters);
    assert.ok(found.length > 0);
    assert.ok(found.every(q => ['A1', 'A2'].includes(q.level) && q.format === 'pair' && q.answer === 'report' && q.minutes <= 8 && q.chapter === null));
    assert.ok(searchQuests(sideQuests, '', { kind: 'story' }).every(q => q.chapter !== null));
    assert.ok(searchQuests(sideQuests, '', { chapters: ['haunted-festival'] }).every(q => q.chapter === 'haunted-festival'));
    assert.ok(sideQuests.every(q => matchesFilters(q, {})));

    // Each count shows how many quests choosing that value would show, keeping the other choices.
    const facets = questFacets(library, '', { levels: ['B1'] });
    for (const theme of THEMES) assert.equal(facets.themes[theme.id], searchQuests(sideQuests, '', { levels: ['B1'], themes: [theme.id] }).length);
    for (const level of LEVELS) assert.equal(facets.levels[level.id], searchQuests(sideQuests, '', { levels: [level.id] }).length, 'a facet ignores its own choice');
    assert.equal(findQuest(library, sample.id), sample); assert.equal(findQuest(library, 'nope'), undefined);
});

test('every quest is checked before a server keeps it, from the editor, a file or the other server', () => {
    const broken = change => { const copy = structuredClone(library); change(copy); return checkQuestFile(copy).error; };
    assert.match(checkQuestFile(null).error, /list of quests/);
    assert.deepEqual(checkQuestFile(sideQuests.slice(0, 3)), { quests: sideQuests.slice(0, 3) }, 'a plain list, as an export saves it');
    assert.match(broken(copy => { copy.quests[1].id = copy.quests[0].id; }), /used twice/);
    assert.match(broken(copy => { copy.quests.find(q => q.chapter).chapter = null; }), /belongs to one chapter/);
    assert.match(broken(copy => { copy.quests.find(q => !q.chapter).chapter = 'missing-chestnuts'; }), /only story quests/);
    assert.match(broken(copy => { const q = copy.quests.find(item => item.answer === 'text'); q.accept = [' ']; }), /accepted answers/);
    assert.match(broken(copy => { copy.quests[0].level = 'C2'; }), /unknown theme, level/);
    assert.match(broken(copy => { delete copy.quests[0].title; }), /needs a title/);
    assert.match(broken(copy => { copy.quests[0].id = 'Not An ID'; }), /needs an ID/);
    assert.match(broken(copy => { copy.quests[0].minutes = 2.5; }), /minutes/);

    // Stored the same way everywhere: known fields only, in one order, tidied; a "whole class" quest is a mingle now.
    const mingle = sideQuests.find(q => q.format === 'mingle');
    const old = { ...mingle, teacherNote: ` ${mingle.teacherNote} `, format: 'class', extra: 'dropped', tags: mingle.tags.map(tag => tag.toUpperCase()) };
    const { quest } = checkQuest(old);
    assert.deepEqual(quest, mingle); assert.equal(JSON.stringify(checkQuest(structuredClone(mingle)).quest), JSON.stringify(quest), 'the same JSON');
    const report = sideQuests.find(q => q.answer === 'report' && !q.chapter);
    assert.deepEqual(checkQuest({ ...report, accept: ['ignored'], roles: ['witness'] }).quest, report, 'reports accept nothing; generic quests have no roles');
});

test('story chapters come from the published missions, and new quests get an ID of their own', () => {
    const chapters = chaptersOf([castanyada, castanyadaComplete, plazaFreePlay]);
    assert.equal(new Set(chapters.map(c => c.id)).size, chapters.length, 'each chapter once');
    for (const chapter of storyChapters) assert.ok(chapters.some(c => c.id === chapter.id), `${chapter.title} is offered`);
    const first = chapters.find(c => c.id === castanyada.chapters[0].id);
    assert.deepEqual(first, { id: castanyada.chapters[0].id, campaign: castanyada.title, number: 1, title: castanyada.chapters[0].title }, 'named after the first mission that has it');
    assert.ok(chapters.some(c => c.id === plazaFreePlay.chapters[0].id));

    assert.equal(newQuestId('Café Order!', () => false), 'sq-cafe-order');
    assert.equal(newQuestId('Café Order!', id => id === 'sq-cafe-order' || id === 'sq-cafe-order-2'), 'sq-cafe-order-3');
    assert.equal(newQuestId('!!!', () => false), 'sq-quest');
    assert.ok(newQuestId('a'.repeat(100), () => false).length <= 43);
});
