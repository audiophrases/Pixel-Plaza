// The other warm-ups: "Who am I?", "Find your pair", "What comes next?" and "Find your team". Like the first one,
// they end with a student typing a classmate's name or secret. Plain data and functions, so the worker, the page and the tests use the same file.
import type { Assignment } from './warmup.ts';

// The warm-ups a teacher can start.
export type WarmupKind = 'facts' | 'identity' | 'pairs' | 'order' | 'groups';
export const WARMUP_KINDS: { id: WarmupKind; label: string; blurb: string }[] = [
    { id: 'facts', label: 'Find someone who…', blurb: 'Everyone has a made-up fun fact and looks for classmates with other facts.' },
    { id: 'identity', label: 'Who am I?', blurb: 'Everyone is a famous person, and finds out who one classmate is by asking yes or no questions.' },
    { id: 'pairs', label: 'Find your pair', blurb: 'Everyone has a word and finds the classmate whose word goes with it, like salt and pepper.' },
    { id: 'order', label: 'What comes next?', blurb: 'Everyone has one card from a list in order, like the steps of a day, and finds the classmate whose card comes next.' },
    { id: 'groups', label: 'Find your team', blurb: 'Everyone has a word and finds a classmate whose word is the same kind of thing, like apple and banana.' },
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

export const identityById = (id: string, identities: readonly Identity[] = IDENTITIES): Identity | undefined => identities.find(identity => identity.id === id);

// Each student is a different person, and is asked to find out who one classmate is, in a circle, so everybody has
// someone to ask about and everybody is asked about. `targets` holds the classmate to find out about.
export function assignIdentities(students: readonly string[], random: () => number = Math.random, identities: readonly Identity[] = IDENTITIES): Map<string, Assignment> {
    const result = new Map<string, Assignment>();
    if (students.length < 2) return result;
    const order = shuffled(students, random);
    const people = shuffled(identities.map(identity => identity.id), random);
    order.forEach((student, index) => result.set(student, { fact: people[index % people.length], targets: [order[(index + 1) % order.length]] }));
    return result;
}

// Someone arriving late is a person nobody else is, and is asked about one classmate already there.
export function assignLateIdentity(taken: readonly string[], classmates: readonly string[], random: () => number = Math.random, identities: readonly Identity[] = IDENTITIES): Assignment | null {
    if (classmates.length === 0) return null;
    const free = identities.map(identity => identity.id).filter(id => !taken.includes(id));
    const pool = free.length ? free : identities.map(identity => identity.id);
    return { fact: pool[Math.floor(random() * pool.length)], targets: [classmates[Math.floor(random() * classmates.length)]] };
}

// ---------- Find your pair ----------

// Two words that go together. A student with one word looks for the person with the other.
export const PAIRS: [string, string][] = [
    ['salt', 'pepper'], ['fish', 'chips'], ['bread', 'butter'], ['black', 'white'], ['day', 'night'], ['knife', 'fork'],
    ['hot', 'cold'], ['up', 'down'], ['left', 'right'], ['sun', 'moon'], ['boy', 'girl'], ['cat', 'mouse'],
    ['pen', 'paper'], ['shoes', 'socks'], ['summer', 'winter'], ['yes', 'no'], ['in', 'out'], ['north', 'south'],
];

export const complementOf = (word: string, pairs: readonly (readonly [string, string])[] = PAIRS): string | undefined => {
    const pair = pairs.find(([a, b]) => a === word || b === word);
    return pair ? (pair[0] === word ? pair[1] : pair[0]) : undefined;
};

// Each pair of students gets the two words of one pair. With an odd number the extra student gets a second copy of
// one of the words, so two classmates are right for the student who has the other word.
export function assignPairs(students: readonly string[], random: () => number = Math.random, wordPairs: readonly (readonly [string, string])[] = PAIRS): Map<string, Assignment> {
    const result = new Map<string, Assignment>();
    if (students.length < 2) return result;
    const people = shuffled(students, random);
    const pairs = shuffled(wordPairs, random);
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

// Someone arriving late gets the complement of a present classmate's word.
export function assignLatePair(inUse: readonly string[], random: () => number = Math.random, pairs: readonly (readonly [string, string])[] = PAIRS): Assignment | null {
    const words = inUse.filter(word => complementOf(word, pairs));
    if (words.length === 0) return null;
    const word = words[Math.floor(random() * words.length)];
    return { fact: complementOf(word, pairs)!, targets: [word] };
}

// ---------- What comes next? ----------

// A list in order: the steps of a school day. A student with one card looks for the person with the next one.
export const SEQUENCE: string[] = [
    'wake up at 7:00 am', 'get up at 7:05 am', 'have a shower at 7:10 am', 'get dressed at 7:20 am', 'have breakfast at 7:30 am',
    'brush your teeth at 7:45 am', 'leave home at 8:00 am', 'arrive at school at 8:20 am', 'start lessons at 8:30 am', 'have a break at 10:30 am',
    'have maths at 11:00 am', 'have lunch at 1:00 pm', 'play football at 1:30 pm', 'have English at 2:30 pm', 'finish school at 4:30 pm',
    'get home at 5:00 pm', 'have a snack at 5:15 pm', 'do your homework at 5:30 pm', 'meet your friends at 6:30 pm', 'walk the dog at 7:15 pm',
    'help make dinner at 8:00 pm', 'have dinner at 8:30 pm', 'wash the dishes at 9:00 pm', 'watch TV at 9:15 pm', 'put on your pyjamas at 9:45 pm',
    'read in bed at 10:00 pm', 'turn off the light at 10:20 pm', 'fall asleep at 10:30 pm',
];

// True when the card being looked for comes before one's own: the holder of the last card looks for the first.
export const wrapsAround = (card: string, next: string, items: readonly string[] = SEQUENCE): boolean => items.indexOf(next) <= items.indexOf(card);

// The students get cards that follow one another in the list, and each looks for the card after their own; the
// holder of the last card looks for the first, so everybody is looked for. With more students than cards, some
// cards are held twice, and either holder is right.
export function assignOrder(students: readonly string[], random: () => number = Math.random, items: readonly string[] = SEQUENCE): Map<string, Assignment> {
    const result = new Map<string, Assignment>();
    if (students.length < 2 || items.length < 2) return result;
    const count = Math.min(students.length, items.length);
    const start = Math.floor(random() * (items.length - count + 1));
    const cards = items.slice(start, start + count);
    shuffled(students, random).forEach((student, index) => result.set(student, { fact: cards[index % count], targets: [cards[(index + 1) % count]] }));
    return result;
}

// Someone arriving late gets a second copy of a present classmate's card, whose next card is also present.
export function assignLateOrder(inUse: readonly Assignment[], random: () => number = Math.random): Assignment | null {
    const held = new Set(inUse.map(part => part.fact));
    const solvable = inUse.filter(part => part.targets[0] !== part.fact && held.has(part.targets[0]));
    if (solvable.length === 0) return null;
    const copy = solvable[Math.floor(random() * solvable.length)];
    return { fact: copy.fact, targets: [...copy.targets] };
}

// ---------- Find your team ----------

// Words of the same kind. A student with one word looks for a classmate with another word from the same group.
export type WordGroup = { id: string; name: string; words: string[] };

export const GROUPS: WordGroup[] = [
    { id: 'fruit', name: 'Fruit', words: ['apple', 'banana', 'orange', 'strawberry'] },
    { id: 'animals', name: 'Animals', words: ['horse', 'rabbit', 'elephant', 'monkey'] },
    { id: 'clothes', name: 'Clothes', words: ['jacket', 'trousers', 'scarf', 'gloves'] },
    { id: 'weather', name: 'Weather', words: ['rain', 'snow', 'wind', 'storm'] },
    { id: 'transport', name: 'Transport', words: ['bus', 'train', 'plane', 'bicycle'] },
    { id: 'school', name: 'School things', words: ['ruler', 'notebook', 'pencil case', 'rubber'] },
    { id: 'body', name: 'Parts of the body', words: ['elbow', 'knee', 'shoulder', 'ankle'] },
    { id: 'jobs', name: 'Jobs', words: ['nurse', 'firefighter', 'chef', 'pilot'] },
    { id: 'house', name: 'Rooms', words: ['kitchen', 'bedroom', 'bathroom', 'garage'] },
    { id: 'sports', name: 'Sports', words: ['tennis', 'swimming', 'volleyball', 'skiing'] },
];

export const groupOf = (word: string, groups: readonly WordGroup[] = GROUPS): WordGroup | undefined => groups.find(group => group.words.includes(word));

// Teams of about three, never fewer than two, each with the words of one group. Team-mates have different words
// while the group has enough. `targets` holds the group, so any team-mate is right.
export function assignGroups(students: readonly string[], random: () => number = Math.random, groups: readonly WordGroup[] = GROUPS): Map<string, Assignment> {
    const result = new Map<string, Assignment>();
    if (students.length < 2 || groups.length === 0) return result;
    const teams = Math.max(1, Math.min(groups.length, Math.floor(students.length / (students.length < 6 ? 2 : 3))));
    const chosen = shuffled(groups, random).slice(0, teams).map(group => ({ id: group.id, words: shuffled(group.words, random) }));
    shuffled(students, random).forEach((student, index) => {
        const team = chosen[index % teams];
        result.set(student, { fact: team.words[Math.floor(index / teams) % team.words.length], targets: [team.id] });
    });
    return result;
}

// Someone arriving late joins a team that is playing, with a word nobody there has yet when one is left.
export function assignLateGroup(inUse: readonly string[], random: () => number = Math.random, groups: readonly WordGroup[] = GROUPS): Assignment | null {
    const playing = groups.filter(group => group.words.some(word => inUse.includes(word)));
    if (playing.length === 0) return null;
    const group = playing[Math.floor(random() * playing.length)];
    const free = group.words.filter(word => !inUse.includes(word));
    const pool = free.length ? free : group.words;
    return { fact: pool[Math.floor(random() * pool.length)], targets: [group.id] };
}
