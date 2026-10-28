// The side quest library: optional quests a teacher can write, search and add to any running game, for fast
// finishers, warm-ups and short sessions between chapters. Each quest is its own record on the online server, edited
// on the library page and synced like missions (worker/sideQuestStore.ts); this file holds their shape and plain
// functions, shared by the teacher's library page, the worker (which checks every quest it keeps) and the tests.
//
// Two kinds of quest:
// - story quests belong to one chapter of a story mission and use its people and clues;
// - generic quests (social, plaza, puzzle, seasonal) work in any game, including a free-play mission.
// Each quest becomes an optional quest-board objective with the library ID, so it can be added to a game once.
import type { Campaign, Objective } from './campaign.ts';
import { missionId } from './missionSchema.ts';

export type QuestLevel = 'A1' | 'A2' | 'B1' | 'B2';
export type QuestFormat = 'solo' | 'pair' | 'group' | 'mingle';
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
// A chapter of a published mission that story quests can belong to. Its ID is the same in every mission telling that
// story, so the server lists each chapter once, under the first mission that has it.
export type StoryChapter = { id: string; campaign: string; number: number; title: string };
export type SideQuestLibrary = { chapters: StoryChapter[]; quests: SideQuest[] };
// A quest as it travels between the teacher's laptop and the online server, like a mission (MissionCopy): the quest as
// stored (content is its JSON). `updated` 0 means nobody has edited it since it arrived from a file.
export type SideQuestCopy = { id: string; content: string; version: number; updated: number; created: number; deleted: boolean };
// What the online server made of a laptop's copy: kept as the quest, or, when it had changed online too, kept beside
// it as a new quest marked "(laptop)".
export type SideQuestPushResult = { outcome: 'saved' | 'kept-both'; version: number; copy?: { id: string; content: string; deleted: boolean } };

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
// `players`: how many students must be online before the quest can be accepted. A mingle is done alone, by talking
// to several classmates (it was called "whole class" before).
export const FORMATS: { id: QuestFormat; name: string; players: number }[] = [
    { id: 'solo', name: 'Solo', players: 1 },
    { id: 'pair', name: 'Pair', players: 2 },
    { id: 'group', name: 'Small group', players: 3 },
    { id: 'mingle', name: 'Mingle', players: 4 },
];
export const ANSWERS: { id: QuestAnswer; name: string }[] = [
    { id: 'report', name: 'Written report' },
    { id: 'text', name: 'Typed answer' },
];

export const findQuest = (library: SideQuestLibrary, id: string): SideQuest | undefined => library.quests.find(quest => quest.id === id);
export const isStoryQuest = (quest: SideQuest) => quest.chapter !== null;

// A short fingerprint of the quests, so a reviewed release can tell when the library changed under it.
const fingerprints = new WeakMap<readonly SideQuest[], number>();
export function libraryVersion(quests: readonly SideQuest[]): number {
    let hash = fingerprints.get(quests);
    if (hash !== undefined) return hash;
    hash = 0;
    for (const char of JSON.stringify(quests)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    fingerprints.set(quests, Math.abs(hash));
    return Math.abs(hash);
}

// The chapters story quests can belong to: every chapter of the published missions, each once, numbered as in the
// first mission that has it.
export function storyChapters(campaigns: readonly Pick<Campaign, 'title' | 'chapters'>[]): StoryChapter[] {
    const seen = new Map<string, StoryChapter>();
    for (const campaign of campaigns) campaign.chapters.forEach((chapter, index) => {
        if (!seen.has(chapter.id)) seen.set(chapter.id, { id: chapter.id, campaign: campaign.title, number: index + 1, title: chapter.title });
    });
    return [...seen.values()];
}

// An ID for a new quest: "sq-" and the title's words, and a number when that is taken.
export function newQuestId(title: string, taken: (id: string) => boolean): string {
    const words = title.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
    const stem = `sq-${words || 'quest'}`;
    if (!taken(stem)) return stem;
    let n = 2;
    while (taken(`${stem}-${n}`)) n++;
    return `${stem}-${n}`;
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

export const QUEST_LIMIT = 2000; // quests a server keeps, Trash included

// One quest from the editor, a file or the other server: rebuilt with only the fields the game knows, in one order (so
// the same quest is the same JSON everywhere), or what is wrong with it. A "whole class" quest from before is a mingle.
const isText = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const isTexts = (value: unknown) => Array.isArray(value) && value.length <= 40 && value.every(item => typeof item === 'string' && item.length <= 200);
export function checkQuest(value: unknown): { quest: SideQuest } | { error: string } {
    const quest = value as Omit<Partial<SideQuest>, 'format'> & { format?: string } | null;
    const where = typeof quest?.title === 'string' && quest.title.trim() ? `“${quest.title.trim().slice(0, 60)}”` : typeof quest?.id === 'string' ? `Quest ${quest.id}` : 'A quest';
    if (!quest || typeof quest !== 'object' || typeof quest.id !== 'string' || !missionId(quest.id)) return { error: `${where}: needs an ID of lower-case letters, numbers and dashes.` };
    if (!isText(quest.title, 120) || !isText(quest.text, 2000) || !isText(quest.category, 120)) return { error: `${where}: needs a title, a category and instructions.` };
    const format = quest.format === 'class' ? 'mingle' : quest.format;
    if (!THEMES.some(t => t.id === quest.theme) || !LEVELS.some(l => l.id === quest.level) || !FORMATS.some(f => f.id === format) || !ANSWERS.some(a => a.id === quest.answer)) return { error: `${where}: unknown theme, level, format or answer.` };
    if (quest.theme === 'story' ? typeof quest.chapter !== 'string' || !missionId(quest.chapter) : quest.chapter !== null && quest.chapter !== undefined) return { error: `${where}: a story quest belongs to one chapter, and only story quests do.` };
    if (!Number.isInteger(quest.minutes) || quest.minutes! < 1 || quest.minutes! > 60) return { error: `${where}: minutes must be a whole number from 1 to 60.` };
    if (!isTexts(quest.focus) || !isTexts(quest.tags) || !isTexts(quest.accept) || typeof quest.teacherNote !== 'string' || quest.teacherNote.length > 4000) return { error: `${where}: focus, tags, answers and teacher note are needed.` };
    const accept = quest.answer === 'text' ? quest.accept!.map(answer => answer.trim()).filter(Boolean) : [];
    if (quest.answer === 'text' && !accept.length) return { error: `${where}: a typed answer needs accepted answers.` };
    if ((quest.roles !== undefined && !isTexts(quest.roles)) || (quest.after !== undefined && (typeof quest.after !== 'string' || !missionId(quest.after))) || (quest.afterMain !== undefined && typeof quest.afterMain !== 'boolean')) return { error: `${where}: roles, "after" and "after the main mystery" are not valid.` };
    const story = quest.theme === 'story';
    const roles = story ? quest.roles?.map(role => role.trim()).filter(Boolean) : undefined;
    return { quest: {
        id: quest.id, title: quest.title!.trim(), theme: quest.theme!, category: quest.category!.trim(), chapter: story ? quest.chapter! : null,
        level: quest.level!, format: format as QuestFormat, answer: quest.answer!, minutes: quest.minutes!,
        focus: quest.focus!.map(item => item.trim()).filter(Boolean), tags: quest.tags!.map(tag => tag.trim().toLowerCase()).filter(Boolean),
        text: quest.text!.trim(), accept, teacherNote: quest.teacherNote.trim(),
        ...(roles?.length ? { roles } : {}), ...(story && quest.after ? { after: quest.after } : {}), ...(story && quest.afterMain ? { afterMain: true } : {}),
    } };
}

// A file of quests (an export from the library page, or a library from before): a list of quests, or an object with
// one. Every quest must pass, and IDs must be unique.
export function checkQuestFile(value: unknown): { quests: SideQuest[] } | { error: string } {
    const list = Array.isArray(value) ? value : value && typeof value === 'object' && Array.isArray((value as { quests?: unknown }).quests) ? (value as { quests: unknown[] }).quests : null;
    if (!list) return { error: 'A side quest file holds a list of quests.' };
    if (list.length > QUEST_LIMIT) return { error: `A file can hold at most ${QUEST_LIMIT} quests.` };
    const quests: SideQuest[] = []; const ids = new Set<string>();
    for (const item of list) {
        const checked = checkQuest(item);
        if ('error' in checked) return checked;
        if (ids.has(checked.quest.id)) return { error: `Quest ${checked.quest.id}: the ID is used twice.` };
        ids.add(checked.quest.id); quests.push(checked.quest);
    }
    return { quests };
}
