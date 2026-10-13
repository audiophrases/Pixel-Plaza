// A campaign: a story told over several lessons. Plain data and plain functions, no
// imports, so the worker, the page and the tests all read the same file.
//
// How it plays: each student gets a role at random and keeps it for the whole campaign.
// A role knows one thing the others do not (its clue). Walking into a place can reveal
// more. The students must talk to each other to put the clues together and type the answer
// to each question. Answering a question earns a new clue for your role, and unlocks the
// next question. Bonus questions are for students who finish early and do not hold the
// chapter up. When enough of the class has finished the main questions, the chapter ends on
// a cliffhanger, and the teacher starts the next one whenever the class is ready. If the
// class is stuck, the teacher can reveal a prepared piece of news to everyone.

// The student types the answer. `accept` lists the words or short phrases that make an answer right;
// "the park", "In the park!" and a small spelling slip in a long word all count for "park".
export type Objective = {
    id: string; text: string; accept: string[];
    after?: string;                   // asked only once this question has been answered
    optional?: boolean;               // a bonus: it never holds the chapter up
    rewards?: Record<string, string>; // the new clue each role earns by answering, by role id
};
// A clue everyone finds by standing in a named place (see `zones` in plazaMap.ts).
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
};
export type Role = { id: string; name: string; card: string; clue: string };
export type Campaign = { id: string; title: string; roles: Role[]; chapters: Chapter[]; finale: string };

// What one student is allowed to see: only their own role and what they found.
export type QuestView = {
    campaign: { id: string; title: string };
    status: 'active' | 'chapter_complete' | 'campaign_complete';
    chapter: { index: number; of: number; title: string; intro: string; ending: string | null };
    role: { id: string; name: string; card: string };
    // `from` says where a clue came from: "job", a place, "reward" or "news"
    clues: { id: string; text: string; from: string }[];
    objectives: { id: string; text: string; done: boolean; optional: boolean }[];
    recap: string | null; // sent when the student comes back to a story already under way
    finale: string | null;
};

export const castanyada: Campaign = {
    id: 'castanyada',
    title: 'The Haunted Castanyada',
    finale: 'To be continued…',
    roles: [
        { id: 'baker', name: 'Café baker', card: 'You roast the chestnuts.',
            clue: 'No blue box came to the café.' },
        { id: 'shopkeeper', name: 'Shopkeeper', card: 'You pack the boxes.',
            clue: 'A blue box left the shop at 9:00.' },
        { id: 'driver', name: 'Driver', card: 'You carry the boxes.',
            clue: 'I carried a blue box. I left it near the water.' },
        { id: 'receptionist', name: 'Hotel receptionist', card: 'You work at the hotel desk.',
            clue: 'No box came to the hotel.' },
        { id: 'planner', name: 'Festival planner', card: 'You plan the party.',
            clue: 'The only water in town is the pond in the park.' },
    ],
    chapters: [{
        id: 'missing-chestnuts', title: 'The Missing Chestnuts', share: 0.6,
        intro: 'The chestnuts are gone. Ask your classmates. Each of you knows something different.',
        recap: 'Last time: the big box of chestnuts disappeared. You are still looking for it.',
        ending: 'Two people have a key: the shopkeeper and the planner. But the lock is open and the box is empty! Who took the chestnuts?',
        objectives: [
            {
                id: 'where', text: 'Where is the blue box?', accept: ['park', 'pond'],
                rewards: {
                    baker: 'The café needs 20 chestnuts. That is half of the box.',
                    shopkeeper: 'I packed 40 chestnuts in the box.',
                    driver: 'The ride from the shop to the park takes 30 minutes.',
                    receptionist: 'A man in a green coat asked me about the park at 9:15.',
                    planner: 'The party starts at 6:00. We need the chestnuts before 5:00.',
                },
            },
            {
                id: 'when', text: 'What time did the box get to the park?', after: 'where',
                accept: ['9 30', 'nine thirty', 'half past nine'],
                rewards: {
                    baker: 'There is no key at the café.',
                    shopkeeper: 'I have one key. It is on my belt.',
                    driver: 'I never have a key. I only carry the box.',
                    receptionist: 'There is no key at the hotel.',
                    planner: 'I have one key. The other key is in the shop.',
                },
            },
            { id: 'keys', text: 'How many people have a key?', after: 'when', accept: ['two', '2'] },
            // Bonus questions: they need clues from other students, and never hold the class up.
            { id: 'note', text: 'What does the note on the hotel door say?', after: 'where', optional: true, accept: ['safe', 'not worry'] },
            { id: 'lock', text: 'What is on the lock?', after: 'where', optional: true, accept: ['star'] },
            { id: 'chestnuts', text: 'How many chestnuts were in the box?', after: 'when', optional: true, accept: ['40', 'forty'] },
        ],
        discoveries: [
            { id: 'hotel-note', zone: 'hotel', text: 'A note on the hotel door: "The chestnuts are safe. Do not worry."' },
            { id: 'park-lock', zone: 'park', text: 'A small blue lock with a star on it, on the grass.' },
        ],
        reveals: [
            { id: 'coat', text: 'News: a neighbor saw a person in a green coat near the park at 9:20.' },
            { id: 'click', text: 'News: somebody heard a lock click in the park.' },
        ],
    }],
};

export const campaigns: Campaign[] = [castanyada];
export const campaignById = (id: string): Campaign | undefined => campaigns.find(campaign => campaign.id === id);

// The role the fewest students have so far, so a class is spread across the roles; ties are
// broken at random. `random` is a number in [0, 1).
export function pickRole(roles: readonly Role[], taken: readonly string[], random: number): Role {
    const count = (role: Role) => taken.filter(id => id === role.id).length;
    const fewest = Math.min(...roles.map(count));
    const options = roles.filter(role => count(role) === fewest);
    return options[Math.min(options.length - 1, Math.floor(random * options.length))];
}

// A question can be asked once the one it follows has been answered.
export const isUnlocked = (objective: Objective, done: readonly string[]) => !objective.after || done.includes(objective.after);

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
