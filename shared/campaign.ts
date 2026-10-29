// A campaign: a story told over several lessons. Its types and the rules of play, no imports, so the worker, the
// page and the tests all read the same file. The campaigns themselves are not here: they are missions, data that
// teachers write and change in Mission Studio, kept on the online server (worker/missions.ts).
//
// How it plays: each student gets a role at random and keeps it for the whole campaign.
// A role knows one thing the others do not (its clue). Walking into a place can reveal
// more. The students must talk to each other to put the clues together and type the answer
// to each question. Answering a question earns a new clue for your role, and unlocks the
// next question. Bonus questions are for students who finish early and do not hold the
// chapter up. When enough of the class has finished the main questions, finished students see a
// cliffhanger, but questions stay open until the teacher starts the next chapter. If the
// class is stuck, the teacher can reveal a prepared piece of news to everyone.

import type { ReportCheck, ReportLevel } from './reportFeedback.ts';
export const REPORT_MAX_LENGTH = 1000;

// The student types the answer. `accept` lists the words or short phrases that make an answer right;
// "the park", "In the park!" and a small spelling slip in a long word all count for "park".
export type Objective = {
    id: string; text: string; accept: string[];
    answerThief?: boolean;            // the answer is the name of the chapter's thief (the thief does not get this question)
    thiefKnows?: boolean;             // the thief already knows the answer, so is not asked
    answerRole?: string;              // the answer is the name of a classmate who has this role (so students must meet people)
    kind?: 'report';                  // writing checked automatically on submission
    successCriteria?: string;        // private, concise requirements/reference facts for written answers
    level?: ReportLevel;
    after?: string;                   // asked only once this question has been answered
    requires?: { mode: 'all' | 'any'; objectives: string[] };
    optional?: boolean;               // a bonus: it never holds the chapter up
    activity?: 'interview' | 'exchange'; // a partnered report on a quest board
    conversation?: { witnesses: 1 | 2 }; // approved, quest-linked evidence exchanges before a conclusion
    board?: { roles?: string[]; afterMain?: boolean; minPlayers?: number; teacherReleased?: boolean; partnerRole?: string; differentRole?: boolean };
    rewards?: Record<string, string>; // the new clue each role earns by answering, by role id
};
// A clue everyone finds by standing in a named place: a zone of the game's map.
export type Discovery = { id: string; zone: string; text: string };
export type Chapter = {
    id: string; title: string;
    intro: string;       // read when the chapter opens
    recap: string;       // "Previously": what the class was doing, shown when a game reopens mid-chapter
    ending: string;      // read when the class has done it: the hook for next time
    objectives: Objective[];
    share: number;       // the fraction of the class that must finish every main question (0 to 1)
    discoveries: Discovery[];
    reveals: { id: string; text: string }[]; // news the teacher releases to everyone, in this order
    // Each student's own clue for this chapter, instead of the one their role brings. {hat}, {glasses} and {hair} are filled
    // in with how the thief looks, so the clues point at a real avatar in the plaza.
    roleClues?: Record<string, string>;
    // A secret thief among the students: one for a class, two above fifteen, chosen at random. The thief gets this card
    // and this story to tell, and never sees the question about who took the chestnuts.
    // `carry` keeps the thieves of the chapter before; `label` heads the thief's own clue ("Your story" by default).
    thieves?: { card: string; story: string; label?: string; carry?: boolean };
};
export type Role = { id: string; name: string; card: string; clue: string };
export type Campaign = { id: string; title: string; roles: Role[]; chapters: Chapter[]; finale: string };
export type AnswerFeedback = { objective: string; correct: boolean; wait: boolean; message?: string };
export type ReportSubmission = { text: string; version: number; submitted: boolean; check?: ReportCheck };

// What one student is allowed to see: only their own role and what they found.
export type QuestView = {
    runId?: string; // Stable across reconnects; new when the teacher restarts this campaign.
    campaign: { id: string; title: string };
    status: 'active' | 'chapter_complete' | 'campaign_complete';
    chapter: { index: number; of: number; title: string; intro: string; ending: string | null };
    role: { id: string; name: string; card: string };
    // `from` says where a clue came from: "job", a place, "reward" or "news"
    clues: { id: string; text: string; from: string }[];
    secret: { title: string; text: string } | null; // only for the thief
    thieves: string[] | null; // who it was, once the chapter is over
    objectives: { id: string; text: string; done: boolean; optional: boolean; kind: 'text' | 'name' | 'report'; conversation?: ConversationView; report?: ReportSubmission }[];
    interviews?: InterviewView[];
    team: { done: number; total: number }; // how far the whole class is through this chapter's main questions
    recap: string | null; // sent when the student comes back to a story already under way
    finale: string | null;
};

export type BoardQuestView = {
    id: string; text: string; kind: 'text' | 'name' | 'report'; activity: Objective['activity'] | null;
    state: 'available' | 'active' | 'done' | 'waiting'; reason: string | null;
    partner: { name: string; online: boolean } | null;
    conversation?: ConversationView;
    report?: ReportSubmission;
    sideQuest?: boolean;
    ended?: boolean; // a quest of the mission, which has ended: it can no longer be answered
    // A pair or group side quest: the student's own group (names, how many it needs, whether it is still waiting, and
    // from when its members may start with who is there), or the classmates waiting in the group they would join.
    group?: { members: string[]; size: number; state: 'open' | 'playing' | 'done'; startAt: number | null };
    joining?: string[];
};
// Where a student stands with the side quests. "choose": nothing else to do, with `waiting` quests to pick one from (the
// game picks after a minute). "open": `waiting` quests to take whenever they like, beside a warm-up or mission still
// under way. "active": doing one. "empty": nothing to pick (`reason` says why).
export type SideQuestsView = { state: 'choose' | 'open' | 'active' | 'empty'; reason: string | null; waiting: number };
// A student's quest board, with or without a mission: the game's side quests and the mission's own board quests.
export type BoardView = { board: BoardQuestView[]; sideQuests: SideQuestsView };

export type InterviewView = {
    id: string; objective: string; task: string; incoming: boolean; name: string;
    question: string; questionStatus: string; answer: string | null; answerStatus: string | null;
    evidence: string | null; shared: string | null;
};
export type ConversationView = {
    required: number; completed: number;
    witnesses: { id: string; name: string }[];
};

// The role the fewest students have so far, so a class is spread across the roles; ties are
// broken at random. `random` is a number in [0, 1).
export function pickRole(roles: readonly Role[], taken: readonly string[], random: number): Role {
    const count = (role: Role) => taken.filter(id => id === role.id).length;
    const fewest = Math.min(...roles.map(count));
    const options = roles.filter(role => count(role) === fewest);
    return options[Math.min(options.length - 1, Math.floor(random * options.length))];
}

// A question can be asked once the one it follows has been answered.
export const prerequisiteIds = (objective: Objective): readonly string[] => objective.requires?.objectives ?? (objective.after ? [objective.after] : []);
export const isUnlocked = (objective: Objective, done: readonly string[]) => {
    const ids = prerequisiteIds(objective);
    return !ids.length || (objective.requires?.mode === 'any' ? ids.some(id => done.includes(id)) : ids.every(id => done.includes(id)));
};
export const mainFinished = (chapter: Chapter, done: readonly string[]) => chapter.objectives.filter(o => !o.optional).every(o => done.includes(o.id));

// Side quests never wait for other work. A student with nothing else to do (no warm-up part left and, in a mission,
// the chapter's main questions answered) is asked to choose one; anyone else can take one whenever they like.
export function nothingElseToDo(chapter: Chapter | null, done: readonly string[], warmupLeft: boolean): boolean {
    return !warmupLeft && (!chapter || mainFinished(chapter, done));
}

export function boardWait(objective: Objective, chapter: Chapter, role: string, done: readonly string[], released: boolean, online: number): string | null {
    if (!objective.board || !objective.optional) return 'This is not a board quest.';
    if (objective.board.roles?.length && !objective.board.roles.includes(role)) return 'This quest is for another role.';
    if (!isUnlocked(objective, done)) return 'Finish the linked objectives first.';
    if (objective.board.afterMain && !mainFinished(chapter, done)) return 'Finish your main mystery first.';
    if (objective.board.teacherReleased && !released) return 'Your teacher will release this quest.';
    if (online < (objective.board.minPlayers ?? (objective.activity ? 2 : 1))) return 'Wait for more classmates to join.';
    return null;
}

// True when enough of the class has finished every main question in the chapter. Bonus questions never count.
export function chapterDone(chapter: Chapter, players: readonly { done: readonly string[] }[]): boolean {
    const main = chapter.objectives.filter(objective => !objective.optional);
    if (players.length === 0 || main.length === 0) return false;
    const finished = players.filter(player => main.every(objective => player.done.includes(objective.id)));
    return finished.length / players.length >= chapter.share;
}

// The clues a student has earned by answering questions, for their role.
export function rewardClues(chapter: Chapter, roleId: string, done: readonly string[]): { id: string; text: string }[] {
    return chapter.objectives.flatMap(objective => {
        const text = objective.rewards?.[roleId];
        return text && done.includes(objective.id) ? [{ id: `reward-${objective.id}`, text }] : [];
    });
}

// Missing classmates must not make a mystery impossible. Reward fallbacks still
// require this investigator to finish the objective that earns the information.
export function absentRoleClues(campaign: Campaign, chapter: Chapter, roleId: string, done: readonly string[], startingRoles: readonly string[], rewardRoles: readonly string[]) {
    return campaign.roles.flatMap(role => [
        ...(!startingRoles.includes(role.id) && role.id !== roleId
            ? [{ id: `fallback-role-${role.id}`, text: chapter.roleClues?.[role.id] ?? role.clue, from: 'town notice' }] : []),
        ...(!rewardRoles.includes(role.id) && role.id !== roleId
            ? rewardClues(chapter, role.id, done).map(clue => ({ ...clue, id: `fallback-${role.id}-${clue.id}`, from: 'town notice' })) : []),
    ]);
}

// Lower case, without accents or punctuation, as separate words.
const wordsOf = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// One slip in a word of five letters or more is forgiven; shorter words must be exact.
function sameWord(typed: string, wanted: string): boolean {
    if (typed === wanted) return true;
    if (wanted.length < 5 || Math.abs(typed.length - wanted.length) > 1) return false;
    const [short, long] = typed.length <= wanted.length ? [typed, wanted] : [wanted, typed];
    let i = 0;
    while (i < short.length && short[i] === long[i]) i++;
    // One letter changed, added or missing: the rest must then match exactly.
    return short.slice(i + (short.length === long.length ? 1 : 0)) === long.slice(i + 1);
}

// True when what the student typed contains one of the accepted answers as whole words.
export function answerMatches(objective: Objective, typed: string): boolean {
    const words = wordsOf(typed);
    if (words.length === 0 || words.length > 12) return false;
    return objective.accept.some(answer => {
        const wanted = wordsOf(answer);
        return wanted.length > 0 && words.some((_, start) => wanted.every((word, offset) => start + offset < words.length && sameWord(words[start + offset], word)));
    });
}

// What a student may type to name a classmate: the whole shown name, and for a two-part made-up name
// ("Happy Plato") the second part alone, or the first part too when nobody else in the game starts with it
// (`everyone` is every name in the game).
export function acceptedNames(shown: readonly string[], everyone: readonly string[] = shown): string[] {
    const first = (name: string) => name.trim().split(/\s+/)[0].toLowerCase();
    return shown.flatMap(name => {
        const parts = name.trim().split(/\s+/);
        if (parts.length !== 2 || parts[1].length < 3) return [name];
        const shared = everyone.filter(other => first(other) === first(name)).length > 1;
        return shared || parts[0].length < 3 ? [name, parts[1]] : [name, parts[1], parts[0]];
    });
}

// How far the whole class is through the main questions: answers given out of answers possible.
// A thief is never asked who the thief is, or what they already know, so those questions are left out of their share.
export function teamProgress(chapter: Chapter, players: readonly { done: readonly string[]; thief?: boolean }[]): { done: number; total: number } {
    const main = chapter.objectives.filter(objective => !objective.optional);
    const asked = (player: { thief?: boolean }) => main.filter(objective => !(player.thief && (objective.answerThief || objective.thiefKnows)));
    return {
        done: players.reduce((sum, player) => sum + asked(player).filter(objective => player.done.includes(objective.id)).length, 0),
        total: players.reduce((sum, player) => sum + asked(player).length, 0),
    };
}
