// The other warm-ups: "Who am I?" and "Find your pair". Like the first one, they end with a student typing a
// classmate's name or secret. Plain data and functions, so the worker, the page and the tests use the same file.
import type { Assignment } from './warmup.ts';

// The warm-ups a teacher can start.
export type WarmupKind = 'facts' | 'identity' | 'pairs';
export const WARMUP_KINDS: { id: WarmupKind; label: string; blurb: string }[] = [
    { id: 'facts', label: 'Find someone who…', blurb: 'Everyone has a made-up fun fact and looks for classmates with other facts.' },
    { id: 'identity', label: 'Who am I?', blurb: 'Everyone is a famous person, and finds out who one classmate is by asking yes or no questions.' },
    { id: 'pairs', label: 'Find your pair', blurb: 'Everyone has a word and finds the classmate whose word goes with it, like salt and pepper.' },
];
export const isWarmupKind = (value: unknown): value is WarmupKind => WARMUP_KINDS.some(kind => kind.id === value);

function shuffled<T>(items: readonly T[], random: () => number): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// ---------- Who am I? ----------

export type Identity = { id: string; name: string; accept: string[] };

// Famous people and characters that most students of this age know. `accept` is what may be typed for each.
export const IDENTITIES: Identity[] = [
    { id: 'messi', name: 'Messi', accept: ['messi', 'lionel messi'] },
    { id: 'ronaldo', name: 'Cristiano Ronaldo', accept: ['ronaldo', 'cristiano ronaldo', 'cristiano'] },
    { id: 'nadal', name: 'Rafa Nadal', accept: ['nadal', 'rafa nadal', 'rafael nadal'] },
    { id: 'gasol', name: 'Pau Gasol', accept: ['gasol', 'pau gasol'] },
    { id: 'shakira', name: 'Shakira', accept: ['shakira'] },
    { id: 'rosalia', name: 'Rosalía', accept: ['rosalia'] },
    { id: 'taylor', name: 'Taylor Swift', accept: ['taylor swift', 'swift', 'taylor'] },
    { id: 'beyonce', name: 'Beyoncé', accept: ['beyonce'] },
    { id: 'mozart', name: 'Mozart', accept: ['mozart'] },
    { id: 'picasso', name: 'Picasso', accept: ['picasso', 'pablo picasso'] },
    { id: 'dali', name: 'Dalí', accept: ['dali', 'salvador dali'] },
    { id: 'gaudi', name: 'Gaudí', accept: ['gaudi', 'antoni gaudi'] },
    { id: 'einstein', name: 'Einstein', accept: ['einstein', 'albert einstein'] },
    { id: 'curie', name: 'Marie Curie', accept: ['curie', 'marie curie'] },
    { id: 'davinci', name: 'Leonardo da Vinci', accept: ['da vinci', 'leonardo da vinci', 'leonardo'] },
    { id: 'columbus', name: 'Columbus', accept: ['columbus', 'christopher columbus'] },
    { id: 'cleopatra', name: 'Cleopatra', accept: ['cleopatra'] },
    { id: 'napoleon', name: 'Napoleon', accept: ['napoleon'] },
    { id: 'batman', name: 'Batman', accept: ['batman'] },
    { id: 'superman', name: 'Superman', accept: ['superman'] },
    { id: 'spiderman', name: 'Spider-Man', accept: ['spiderman', 'spider man'] },
    { id: 'hermione', name: 'Hermione', accept: ['hermione', 'hermione granger'] },
    { id: 'harry', name: 'Harry Potter', accept: ['harry potter', 'harry'] },
    { id: 'vader', name: 'Darth Vader', accept: ['darth vader', 'vader'] },
    { id: 'sherlock', name: 'Sherlock Holmes', accept: ['sherlock holmes', 'sherlock', 'holmes'] },
    { id: 'mario', name: 'Mario', accept: ['mario', 'super mario'] },
    { id: 'pikachu', name: 'Pikachu', accept: ['pikachu'] },
    { id: 'shrek', name: 'Shrek', accept: ['shrek'] },
    { id: 'elsa', name: 'Elsa', accept: ['elsa'] },
    { id: 'simba', name: 'Simba', accept: ['simba'] },
    { id: 'sponge', name: 'SpongeBob', accept: ['spongebob', 'sponge bob'] },
    { id: 'mickey', name: 'Mickey Mouse', accept: ['mickey mouse', 'mickey'] },
    { id: 'yamal', name: 'Lamine Yamal', accept: ['yamal', 'lamine yamal', 'lamine'] },
];

// Every name of the famous people above, for the English word check: guessing "Is it Lamine Yamal?" is English.
export const IDENTITY_NAMES: string[] = IDENTITIES.flatMap(identity => [identity.name, ...identity.accept]);

export const identityById = (id: string): Identity | undefined => IDENTITIES.find(identity => identity.id === id);

// Each student is a different person, and is asked to find out who one classmate is, in a circle, so everybody has
// someone to ask about and everybody is asked about. `targets` holds the classmate to find out about.
export function assignIdentities(students: readonly string[], random: () => number = Math.random): Map<string, Assignment> {
    const result = new Map<string, Assignment>();
    if (students.length < 2) return result;
    const order = shuffled(students, random);
    const people = shuffled(IDENTITIES.map(identity => identity.id), random);
    order.forEach((student, index) => result.set(student, { fact: people[index % people.length], targets: [order[(index + 1) % order.length]] }));
    return result;
}

// Someone arriving late is a person nobody else is, and is asked about one classmate already there.
export function assignLateIdentity(taken: readonly string[], classmates: readonly string[], random: () => number = Math.random): Assignment | null {
    if (classmates.length === 0) return null;
    const free = IDENTITIES.map(identity => identity.id).filter(id => !taken.includes(id));
    const pool = free.length ? free : IDENTITIES.map(identity => identity.id);
    return { fact: pool[Math.floor(random() * pool.length)], targets: [classmates[Math.floor(random() * classmates.length)]] };
}

// ---------- Find your pair ----------

// Two words that go together. A student with one word looks for the person with the other.
export const PAIRS: [string, string][] = [
    ['salt', 'pepper'], ['fish', 'chips'], ['bread', 'butter'], ['black', 'white'], ['day', 'night'], ['knife', 'fork'],
    ['hot', 'cold'], ['up', 'down'], ['left', 'right'], ['sun', 'moon'], ['boy', 'girl'], ['cat', 'mouse'],
    ['pen', 'paper'], ['shoes', 'socks'], ['summer', 'winter'], ['yes', 'no'], ['in', 'out'], ['north', 'south'],
];

export const complementOf = (word: string): string | undefined => {
    const pair = PAIRS.find(([a, b]) => a === word || b === word);
    return pair ? (pair[0] === word ? pair[1] : pair[0]) : undefined;
};

// Each pair of students gets the two words of one pair. With an odd number the extra student gets a second copy of
// one of the words, so two classmates are right for the student who has the other word.
export function assignPairs(students: readonly string[], random: () => number = Math.random): Map<string, Assignment> {
    const result = new Map<string, Assignment>();
    if (students.length < 2) return result;
    const people = shuffled(students, random);
    const pairs = shuffled(PAIRS, random);
    for (let index = 0; index + 1 < people.length; index += 2) {
        const pair = pairs[(index / 2) % pairs.length];
        const [first, second] = random() < 0.5 ? pair : [pair[1], pair[0]];
        result.set(people[index], { fact: first, targets: [second] });
        result.set(people[index + 1], { fact: second, targets: [first] });
    }
    if (people.length % 2 === 1) {
        const copy = [...result.values()][Math.floor(random() * result.size)];
        result.set(people[people.length - 1], { fact: copy.fact, targets: [...copy.targets] });
    }
    return result;
}

// Someone arriving late has the word of someone already there, so a partner exists.
export function assignLatePair(inUse: readonly string[], random: () => number = Math.random): Assignment | null {
    const words = inUse.filter(word => complementOf(word));
    if (words.length === 0) return null;
    const word = words[Math.floor(random() * words.length)];
    return { fact: word, targets: [complementOf(word)!] };
}
