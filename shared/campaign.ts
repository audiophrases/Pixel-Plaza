// A campaign: a story told over several lessons. Plain data and plain functions, no
// imports, so the worker, the page and the tests all read the same file.
//
// How it plays: each student gets a role at random and keeps it for the whole campaign.
// A role knows one thing the others do not (its clue). Walking into a place can reveal
// more. The students must talk to each other to put the clues together and answer
// each chapter's question. When enough of the class has answered, the chapter ends on a
// cliffhanger, and the teacher starts the next one whenever the class is ready.

export type Choice = { id: string; text: string };
export type Objective = { id: string; text: string; choices: Choice[]; correct: string };
// A clue everyone finds by standing in a named place (see `zones` in plazaMap.ts).
export type Discovery = { id: string; zone: string; text: string };
export type Chapter = {
    id: string; title: string;
    intro: string;       // read when the chapter opens
    ending: string;      // read when the class has done it: the hook for next time
    objectives: Objective[];
    share: number;       // the fraction of the class that must finish every objective (0 to 1)
    discoveries: Discovery[];
};
export type Role = { id: string; name: string; card: string; clue: string };
export type Campaign = { id: string; title: string; roles: Role[]; chapters: Chapter[]; finale: string };

// What one student is allowed to see: only their own role and what they found.
export type QuestView = {
    campaign: { id: string; title: string };
    status: 'active' | 'chapter_complete' | 'campaign_complete';
    chapter: { index: number; of: number; title: string; intro: string; ending: string | null };
    role: { id: string; name: string; card: string };
    clues: { id: string; text: string; from: string }[];
    objectives: { id: string; text: string; choices: Choice[]; done: boolean }[];
    finale: string | null;
};

export const castanyada: Campaign = {
    id: 'castanyada',
    title: 'The Haunted Castanyada',
    finale: 'To be continued…',
    roles: [
        { id: 'baker', name: 'Café baker', card: 'You work at the café. You roast the chestnuts and bake panellets for tonight.',
            clue: 'No blue box came to the café today.' },
        { id: 'shopkeeper', name: 'Shopkeeper', card: 'You run the shop. You pack the boxes for the festival.',
            clue: 'A blue box of chestnuts left the shop at 9:00.' },
        { id: 'driver', name: 'Driver', card: 'You carry boxes from place to place in town.',
            clue: 'I carried a blue box at 9:30. I left it near the water.' },
        { id: 'receptionist', name: 'Hotel receptionist', card: 'You work at the front desk of the hotel. You see everyone who comes and goes.',
            clue: 'No box came to the hotel today.' },
        { id: 'planner', name: 'Festival planner', card: 'You plan the Castanyada party in the square. You know the town very well.',
            clue: 'The only water in town is the pond in the park.' },
    ],
    chapters: [{
        id: 'missing-chestnuts', title: 'The Missing Chestnuts', share: 0.6,
        intro: 'It is Castanyada night in Pixel Plaza. The big box of chestnuts is gone! Talk to your classmates. Each of you knows something different.',
        ending: 'You found the blue box in the park. The lock is open and the box is empty. Who took the chestnuts?',
        objectives: [{
            id: 'where', text: 'Where is the blue box of chestnuts now?',
            choices: [{ id: 'hotel', text: 'At the hotel' }, { id: 'cafe', text: 'At the café' }, { id: 'shop', text: 'At the shop' }, { id: 'park', text: 'In the park' }],
            correct: 'park',
        }],
        discoveries: [
            { id: 'hotel-note', zone: 'hotel', text: 'A note on the hotel door says: "The chestnuts are safe. Do not worry."' },
            { id: 'park-lock', zone: 'park', text: 'In the park, you see a small blue lock on the grass.' },
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

// True when enough of the class has finished every objective in the chapter.
export function chapterDone(chapter: Chapter, players: readonly { done: readonly string[] }[]): boolean {
    if (players.length === 0 || chapter.objectives.length === 0) return false;
    const finished = players.filter(player => chapter.objectives.every(objective => player.done.includes(objective.id)));
    return finished.length / players.length >= chapter.share;
}
