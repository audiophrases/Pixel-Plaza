// The warm-up that opens a lesson: every student is given a made-up fun fact about themselves and is asked to find
// classmates who have other facts, by asking around and typing the classmate's name. Nobody's real life is involved.
// Plain data and functions, so the worker, the page and the tests use the same file.

import type { WarmupKind } from './warmupKinds.ts';

export type Fact = { id: string; mine: string; find: string };

export const FACTS: Fact[] = [
    { id: 'cat', mine: 'You have a cat.', find: 'has a cat' },
    { id: 'dog', mine: 'You have a dog.', find: 'has a dog' },
    { id: 'football', mine: 'You play football.', find: 'plays football' },
    { id: 'guitar', mine: 'You play the guitar.', find: 'plays the guitar' },
    { id: 'pizza', mine: 'You like pizza.', find: 'likes pizza' },
    { id: 'swim', mine: 'You can swim very fast.', find: 'can swim very fast' },
    { id: 'horror', mine: 'You like horror movies.', find: 'likes horror movies' },
    { id: 'games', mine: 'You play video games every day.', find: 'plays video games every day' },
    { id: 'chocolate', mine: 'You love chocolate.', find: 'loves chocolate' },
    { id: 'bike', mine: 'You have a red bike.', find: 'has a red bike' },
    { id: 'spicy', mine: 'You like spicy food.', find: 'likes spicy food' },
    { id: 'basketball', mine: 'You play basketball.', find: 'plays basketball' },
    { id: 'drawing', mine: 'You like drawing.', find: 'likes drawing' },
    { id: 'late', mine: 'You go to bed very late.', find: 'goes to bed very late' },
    { id: 'dancing', mine: 'You like dancing.', find: 'likes dancing' },
    { id: 'chess', mine: 'You play chess.', find: 'plays chess' },
    { id: 'reading', mine: 'You love reading.', find: 'loves reading' },
    { id: 'fish', mine: 'You have a pet fish.', find: 'has a pet fish' },
    { id: 'rain', mine: 'You like rainy days.', find: 'likes rainy days' },
    { id: 'pasta', mine: 'You can cook pasta.', find: 'can cook pasta' },
    { id: 'pumpkins', mine: 'You like pumpkins.', find: 'likes pumpkins' },
    { id: 'spiders', mine: 'You are afraid of spiders.', find: 'is afraid of spiders' },
    { id: 'chestnuts', mine: 'You love hot chestnuts.', find: 'loves hot chestnuts' },
    { id: 'singing', mine: 'You sing in the shower.', find: 'sings in the shower' },
];

// How many people each student has to find
export const WARMUP_ROUNDS = 3;

export const factById = (id: string, facts: readonly Fact[] = FACTS): Fact | undefined => facts.find(fact => fact.id === id);

export type Assignment = { fact: string; targets: string[] };

// Gives each student a fact and a list of facts to find. Enough different facts are used for everyone to have
// something to look for, every fact in use is held by at least one student, and nobody is sent to look for their own.
// `random` returns a number in [0, 1). With fewer than two students there is nobody to find, so nothing is assigned.
export function assignWarmup(students: readonly string[], random: () => number = Math.random, facts: readonly Fact[] = FACTS, rounds = WARMUP_ROUNDS): Map<string, Assignment> {
    const result = new Map<string, Assignment>();
    if (students.length < 2) return result;
    const shuffle = <T,>(items: readonly T[]): T[] => {
        const copy = [...items];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    };
    const used = shuffle(facts.map(fact => fact.id)).slice(0, Math.min(facts.length, Math.max(3, Math.ceil(students.length / 2)), students.length));
    shuffle(students).forEach((student, index) => result.set(student, { fact: used[index % used.length], targets: [] }));
    for (const [student, assignment] of result) {
        assignment.targets = shuffle(used.filter(id => id !== assignment.fact)).slice(0, rounds);
        result.set(student, assignment);
    }
    return result;
}

// A student who arrives after the warm-up has started: a fact from those already in use, and facts to find.
export function assignLateJoiner(inUse: readonly string[], random: () => number = Math.random, rounds = WARMUP_ROUNDS): Assignment | null {
    const facts = [...new Set(inUse)];
    if (facts.length < 2) return null;
    const pick = Math.floor(random() * facts.length);
    const fact = facts[pick];
    const others = facts.filter(id => id !== fact);
    for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [others[i], others[j]] = [others[j], others[i]];
    }
    return { fact, targets: others.slice(0, rounds) };
}

// What one student is shown: their own fact and the one they are looking for now.
export type WarmupView = {
    runId?: string; // Distinguishes a restarted warm-up from another progress update.
    title?: string; instructions?: string; level?: string; vocabulary?: string[];
    kind: WarmupKind;
    fact: string;                 // "You have a cat."
    task: string | null;          // "Find someone who plays football." or null when they have found everyone
    step: number;                 // people found so far
    of: number;                   // people to find in all
    team: { done: number; total: number };
};
