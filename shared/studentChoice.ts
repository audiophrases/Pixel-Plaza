import type { Objective } from './campaign.ts';
import type { QuestFormat, QuestLevel, SideQuest } from './sideQuests.ts';

export const STUDENT_CHOICE_PAGE_SIZE = 12;
const FORMAT_ORDER: Record<QuestFormat, number> = { pair: 0, group: 0, mingle: 1, solo: 2 };
export type StudentChoiceQuery = { search: string; format: QuestFormat | ''; level: QuestLevel | ''; page: number };
// A deliberate allowlist: accepted answers, criteria and teacher notes stay on the server.
export type StudentChallenge = Pick<SideQuest, 'id' | 'title' | 'text' | 'category' | 'format' | 'level' | 'minutes'> & {
    state: 'available' | 'waiting' | 'active' | 'done'; reason: string | null; joining: string[];
};
export type StudentChoicePage = { requestId: string; enabled: boolean; items: StudentChallenge[]; total: number; page: number; pages: number; error?: string };
export const studentChoiceEligible = (quest: SideQuest): boolean => quest.chapter === null && quest.theme !== 'story';
export function studentChallenge(quest: SideQuest, pinned?: Objective): Omit<StudentChallenge, 'state' | 'reason' | 'joining'> {
    const separator = pinned?.text.indexOf(': ') ?? -1;
    return { id: quest.id, title: pinned && separator >= 0 ? pinned.text.slice(0, separator) : quest.title,
        text: pinned ? separator >= 0 ? pinned.text.slice(separator + 2) : pinned.text : quest.text,
        category: quest.category, format: pinned ? pinned.board?.minPlayers === 2 ? 'pair' : pinned.board?.minPlayers === 3 ? 'group' : pinned.board?.minPlayers === 4 ? 'mingle' : 'solo' : quest.format,
        level: pinned?.level ?? quest.level, minutes: quest.minutes };
}
export function studentChoiceQuery(input: Record<string, unknown>): StudentChoiceQuery {
    return { search: typeof input.search === 'string' ? input.search.trim().slice(0, 120) : '',
        format: ['solo', 'pair', 'group', 'mingle'].includes(String(input.format)) ? input.format as QuestFormat : '',
        level: ['A1', 'A2', 'B1', 'B2'].includes(String(input.level)) ? input.level as QuestLevel : '',
        page: typeof input.page === 'number' && Number.isSafeInteger(input.page) ? Math.max(0, Math.min(166, input.page)) : 0 };
}
export function studentChoicePage(items: StudentChallenge[], query: StudentChoiceQuery): Pick<StudentChoicePage, 'items' | 'total' | 'page' | 'pages'> {
    const terms = query.search.toLowerCase().split(/\s+/).filter(Boolean);
    const matching = items.filter(item => (!query.format || item.format === query.format) && (!query.level || item.level === query.level)
        && terms.every(term => `${item.title} ${item.text} ${item.category}`.toLowerCase().includes(term)));
    matching.sort((a, b) => Number(b.state === 'available' && b.joining.length > 0) - Number(a.state === 'available' && a.joining.length > 0)
        || Number(a.state === 'done') - Number(b.state === 'done')
        || Number(b.state === 'available') - Number(a.state === 'available')
        || FORMAT_ORDER[a.format] - FORMAT_ORDER[b.format] || a.title.localeCompare(b.title));
    const pages = Math.ceil(matching.length / STUDENT_CHOICE_PAGE_SIZE), page = Math.min(query.page, Math.max(0, pages - 1));
    return { items: matching.slice(page * STUDENT_CHOICE_PAGE_SIZE, (page + 1) * STUDENT_CHOICE_PAGE_SIZE), total: matching.length, page, pages };
}
