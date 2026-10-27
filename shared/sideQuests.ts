// The side quest library: ready-made optional quests a teacher can search and add to any running game, for fast
// finishers, warm-ups and short sessions between chapters. The quests are data on the online server, like missions
// (worker/questLibrary.ts); this file holds their shape and plain functions, shared by the teacher's library page, the
// worker (which checks every addition) and the tests.
//
// Two kinds of quest:
// - story quests belong to one chapter of a story mission and use its people and clues;
// - generic quests (social, plaza, puzzle, seasonal) work in any game, including a free-play mission.
// Each quest becomes an optional quest-board objective with the library ID, so it can be added to a game once.
import type { Campaign, Objective } from './campaign.ts';

export type QuestLevel = 'A1' | 'A2' | 'B1' | 'B2';
export type QuestFormat = 'solo' | 'pair' | 'group' | 'class';
export type QuestAnswer = 'report' | 'text';
export type QuestTheme = 'story' | 'social' | 'plaza' | 'puzzle' | 'seasonal';

export type SideQuest = {
    id: string; title: string;
    theme: QuestTheme; category: string;
    chapter: string | null;      // the chapter ID a story quest belongs to; null for generic quests
    level: QuestLevel; format: QuestFormat; answer: QuestAnswer; minutes: number;
    focus: string[]; tags: string[];
    text: string;                // what the student reads on the quest board
    accept: string[];            // typed answers only
    teacherNote: string;
    roles?: string[];            // story quests for some roles only (secret missions)
    after?: string;              // story quests that use what a main question reveals
    afterMain?: boolean;         // story quests about the chapter's solution
};
// A story chapter the library has quests for, in story order. Its ID is the same in every mission telling that story.
export type StoryChapter = { id: string; campaign: string; number: number; title: string };
export type SideQuestLibrary = { chapters: StoryChapter[]; quests: SideQuest[] };

export const LEVELS: { id: QuestLevel; name: string; description: string }[] = [
    { id: 'A1', name: 'Starter', description: 'Very short instructions, a sentence frame, one simple task.' },
    { id: 'A2', name: 'Elementary', description: 'Short sentences with useful phrases; two or three sentences to write.' },
    { id: 'B1', name: 'Intermediate', description: 'Opinions with reasons, comparisons and follow-up questions.' },
    { id: 'B2', name: 'Advanced', description: 'Persuading, negotiating and summarising different views.' },
];
export const THEMES: { id: QuestTheme; name: string; kind: 'story' | 'generic'; description: string }[] = [
    { id: 'story', name: 'Story', kind: 'story', description: 'Uses the people, places and clues of one chapter of a story mission. Add it while that chapter is running.' },
    { id: 'social', name: 'Social', kind: 'generic', description: 'Social missions for fun: chatting, opinions, games and stories. No map or story needed.' },
    { id: 'plaza', name: 'Plaza', kind: 'generic', description: 'Uses the plaza: its places, buildings and avatars.' },
    { id: 'puzzle', name: 'Puzzles', kind: 'generic', description: 'Riddles, word games and logic puzzles, most with a typed answer the game checks.' },
    { id: 'seasonal', name: 'Seasonal', kind: 'generic', description: 'Festivals and seasons: autumn, winter holidays, spring and summer.' },
];
export const FORMATS: { id: QuestFormat; name: string; players: number }[] = [
    { id: 'solo', name: 'Solo', players: 1 },
    { id: 'pair', name: 'Pair', players: 2 },
    { id: 'group', name: 'Small group', players: 3 },
    { id: 'class', name: 'Whole class', players: 4 },
];
export const ANSWERS: { id: QuestAnswer; name: string }[] = [
    { id: 'report', name: 'Written report' },
    { id: 'text', name: 'Typed answer' },
];

export const findQuest = (library: SideQuestLibrary, id: string): SideQuest | undefined => library.quests.find(quest => quest.id === id);
export const isStoryQuest = (quest: SideQuest) => quest.chapter !== null;

// A short fingerprint of the library, so a reviewed release can tell when the library changed under it.
const fingerprints = new WeakMap<SideQuestLibrary, number>();
export function libraryVersion(library: SideQuestLibrary): number {
    let hash = fingerprints.get(library);
    if (hash !== undefined) return hash;
    hash = 0;
    for (const char of JSON.stringify(library.quests)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    fingerprints.set(library, Math.abs(hash));
    return Math.abs(hash);
}
// The source a live release records for library quests. The colon keeps it apart from any Mission Studio draft ID.
export const SIDE_QUEST_SOURCE = 'library:side-quests';

// The quest-board objective a library quest becomes in a game.
export function questObjective(quest: SideQuest): Objective {
    const players = FORMATS.find(format => format.id === quest.format)?.players ?? 1;
    return {
        id: quest.id,
        text: `${quest.title}: ${quest.text}`,
        accept: quest.answer === 'text' ? [...quest.accept] : [],
        ...(quest.answer === 'report' ? { kind: 'report' as const } : {}),
        optional: true,
        ...(quest.after ? { after: quest.after } : {}),
        board: {
            ...(quest.roles?.length ? { roles: [...quest.roles] } : {}),
            ...(quest.afterMain ? { afterMain: true } : {}),
            ...(players > 1 ? { minPlayers: players } : {}),
        },
    };
}

// Why a quest cannot go into this chapter of this campaign, or null when it fits. Generic quests fit any chapter;
// a story quest needs its own chapter, its audience roles and the main question it follows.
export function questFit(quest: SideQuest, campaign: Pick<Campaign, 'roles' | 'chapters'>, chapterId: string, chapters: readonly StoryChapter[]): string | null {
    const chapter = campaign.chapters.find(item => item.id === chapterId);
    if (!chapter) return 'The game has no such chapter.';
    if (!isStoryQuest(quest)) return null;
    if (quest.chapter !== chapterId) {
        const home = chapters.find(item => item.id === quest.chapter);
        return home ? `Belongs to ${home.campaign} chapter ${home.number}: ${home.title}.` : 'Belongs to another story.';
    }
    if (quest.roles?.some(role => !campaign.roles.some(item => item.id === role))) return 'Needs a role this campaign does not have.';
    if (quest.after && !chapter.objectives.some(objective => objective.id === quest.after)) return 'Follows a question this chapter does not have.';
    return null;
}

export type QuestFilters = {
    themes?: QuestTheme[]; chapters?: string[]; levels?: QuestLevel[]; formats?: QuestFormat[]; answers?: QuestAnswer[];
    categories?: string[]; maxMinutes?: number; kind?: 'story' | 'generic';
};

// Lower case, without accents or punctuation, so "café", "Cafe" and "cafe!" all match.
const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// Each quest's words, folded once per library.
const folded = new WeakMap<readonly SideQuest[], Map<string, { title: string; rest: string }>>();
function searchable(quests: readonly SideQuest[]) {
    let words = folded.get(quests);
    if (!words) {
        words = new Map(quests.map(quest => [quest.id, {
            title: fold(quest.title),
            rest: fold([quest.text, quest.category, quest.theme, THEMES.find(t => t.id === quest.theme)?.name ?? '', quest.level,
                LEVELS.find(l => l.id === quest.level)?.name ?? '', quest.format, ...quest.focus, ...quest.tags, quest.teacherNote].join(' ')),
        }]));
        folded.set(quests, words);
    }
    return words;
}

export function matchesFilters(quest: SideQuest, filters: QuestFilters): boolean {
    const kind = isStoryQuest(quest) ? 'story' : 'generic';
    return (!filters.kind || filters.kind === kind)
        && (!filters.themes?.length || filters.themes.includes(quest.theme))
        && (!filters.chapters?.length || (quest.chapter !== null && filters.chapters.includes(quest.chapter)))
        && (!filters.levels?.length || filters.levels.includes(quest.level))
        && (!filters.formats?.length || filters.formats.includes(quest.format))
        && (!filters.answers?.length || filters.answers.includes(quest.answer))
        && (!filters.categories?.length || filters.categories.includes(quest.category))
        && (!filters.maxMinutes || quest.minutes <= filters.maxMinutes);
}

// Every word of the query must appear somewhere in the quest; quests with the words in their title come first.
export function searchQuests(quests: readonly SideQuest[], query: string, filters: QuestFilters = {}): SideQuest[] {
    const words = fold(query).split(' ').filter(Boolean);
    const known = searchable(quests);
    const scored: { quest: SideQuest; score: number; index: number }[] = [];
    quests.forEach((quest, index) => {
        if (!matchesFilters(quest, filters)) return;
        const text = known.get(quest.id) ?? { title: fold(quest.title), rest: fold(quest.text) };
        let score = 0;
        for (const word of words) {
            if (text.title.split(' ').includes(word)) score += 3;
            else if (text.title.includes(word)) score += 2;
            else if (text.rest.includes(word)) score += 1;
            else return;
        }
        scored.push({ quest, score, index });
    });
    return scored.sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.quest);
}

// How many quests each filter value would show, given everything else that is chosen.
export function questFacets(library: SideQuestLibrary, query: string, filters: QuestFilters) {
    const count = <K extends keyof QuestFilters>(key: K, values: readonly string[], pick: (quest: SideQuest) => string | null) => {
        const others = searchQuests(library.quests, query, { ...filters, [key]: undefined });
        return Object.fromEntries(values.map(value => [value, others.filter(quest => pick(quest) === value).length]));
    };
    return {
        themes: count('themes', THEMES.map(t => t.id), quest => quest.theme),
        chapters: count('chapters', library.chapters.map(c => c.id), quest => quest.chapter),
        levels: count('levels', LEVELS.map(l => l.id), quest => quest.level),
        formats: count('formats', FORMATS.map(f => f.id), quest => quest.format),
        answers: count('answers', ANSWERS.map(a => a.id), quest => quest.answer),
    };
}

export const questCategories = (quests: readonly SideQuest[]): { theme: QuestTheme; category: string; count: number }[] => {
    const seen = new Map<string, { theme: QuestTheme; category: string; count: number }>();
    for (const quest of quests) {
        const entry = seen.get(quest.category) ?? { theme: quest.theme, category: quest.category, count: 0 };
        entry.count++; seen.set(quest.category, entry);
    }
    return [...seen.values()];
};

// A library loaded from a file: the shape the page and the worker rely on, or what is wrong with it.
const isText = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max;
const isTexts = (value: unknown) => Array.isArray(value) && value.length <= 40 && value.every(item => typeof item === 'string' && item.length <= 200);
export function checkLibrary(value: unknown): { library: SideQuestLibrary } | { error: string } {
    const data = value as Partial<SideQuestLibrary> | null;
    if (!data || typeof data !== 'object' || !Array.isArray(data.chapters) || !Array.isArray(data.quests)) return { error: 'A library has chapters and quests.' };
    if (data.quests.length > 2000 || data.chapters.length > 200) return { error: 'The library is too big.' };
    for (const chapter of data.chapters) {
        if (!chapter || !isText(chapter.id, 64) || !isText(chapter.campaign, 120) || !isText(chapter.title, 120) || !Number.isInteger(chapter.number)) return { error: 'Every chapter needs an ID, a story, a number and a title.' };
    }
    const ids = new Set<string>();
    for (const quest of data.quests) {
        const where = `Quest ${typeof quest?.id === 'string' ? quest.id : ids.size + 1}`;
        if (!quest || !isText(quest.id, 64) || !isText(quest.title, 120) || !isText(quest.text, 2000) || !isText(quest.category, 120)) return { error: `${where}: needs an ID, a title, a category and a text.` };
        if (ids.has(quest.id)) return { error: `${where}: the ID is used twice.` };
        ids.add(quest.id);
        if (!THEMES.some(t => t.id === quest.theme) || !LEVELS.some(l => l.id === quest.level) || !FORMATS.some(f => f.id === quest.format) || !ANSWERS.some(a => a.id === quest.answer)) return { error: `${where}: unknown theme, level, format or answer.` };
        if (quest.chapter !== null && !data.chapters.some(chapter => chapter.id === quest.chapter)) return { error: `${where}: belongs to a chapter the library does not list.` };
        if (typeof quest.minutes !== 'number' || !isTexts(quest.focus) || !isTexts(quest.tags) || !isTexts(quest.accept) || typeof quest.teacherNote !== 'string') return { error: `${where}: minutes, focus, tags, answers and teacher note are needed.` };
        if (quest.answer === 'text' && !quest.accept.length) return { error: `${where}: a typed answer needs accepted answers.` };
    }
    return { library: data as SideQuestLibrary };
}
