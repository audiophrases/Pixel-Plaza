// Words and phrases a teacher blocks for one lesson, found however students disguise them, and what the whole
// plaza suddenly writes all at once, to offer blocking it. No imports, so the worker, the tests and the page share it.

// Letters from other alphabets and "fancy" fonts that look like plain ones (fullwidth and maths letters are
// plain after NFKD already).
const PLAIN = new Map('аa еe оo рp сc уy хx іi јj ѕs ԁd ɡg ӏl αa εe ιi κk νv οo ρp τt υu χx ᴀa ʙb ᴄc ᴅd ᴇe ꜰf ɢg ʜh ɪi ᴊj ᴋk ʟl ᴍm ɴn ᴏo ᴘp ʀr ꜱs ᴛt ᴜu ᴠv ᴡw ʏy ᴢz'
    .split(' ').map(pair => [pair[0], pair[1]]));
// Digits and signs written for letters, as in "fr33 4ndr3i" and "@ndrei". A 1 is an i or an l.
const SIGNS: Record<string, string> = { '0': 'o', '!': 'i', '|': 'l', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '6': 'g', '9': 'g' };

// The ways a message can be read: lower case, without accents, look-alikes as plain letters, and the signs as
// letters (a 1 as an i, then as an l) or as spaces. A ! | @ or $ is a letter only with more of the word after it:
// "fr33 s4m!!" is "free sam".
function readings(text: string): string[] {
    const plain = [...text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()].map(char => PLAIN.get(char) ?? char).join('');
    const signs = (one: string) => plain.replace(/[0-9]|[!|@$](?=[\p{L}0-9])/gu, sign => sign === '1' ? one : SIGNS[sign] ?? ' ');
    return [...new Set([signs('i'), signs('l'), plain.replace(/[^\p{L}]+/gu, ' ')])];
}
const wordsIn = (reading: string) => reading.split(/[^\p{L}]+/u).filter(Boolean);

// Letters typed one at a time ("a n d r e i") read as the word they spell.
function joinSpelt(tokens: string[]): string[] {
    const joined: string[] = [];
    let run: string[] = [];
    const flush = () => { joined.push(...(run.length >= 3 ? [run.join('')] : run)); run = []; };
    for (const token of tokens) {
        if ([...token].length === 1) { run.push(token); continue; }
        flush();
        joined.push(token);
    }
    flush();
    return joined;
}

// A word as runs of one letter, so a letter held longer still spells it: "freee" is f, r, e×3.
type Run = [letter: string, count: number];
const runsOf = (word: string): Run[] => (word.match(/(\p{L})\1*/gu) ?? []).map(run => [[...run][0], [...run].length]);
// Each run as one letter: "freee" and "free" are both "fre".
const collapse = (word: string) => word.replace(/(\p{L})\1+/gu, '$1');

// The word spells the term, any letter held longer: "freeee" spells "free", "fre" does not.
function spells(word: Run[], term: Run[]): boolean {
    return word.length === term.length && term.every(([letter, count], i) => word[i][0] === letter && word[i][1] >= count);
}
// The term somewhere inside a longer word: "freeandrei" holds "andrei".
function holds(word: Run[], term: Run[]): boolean {
    for (let start = 0; start + term.length <= word.length; start++) if (spells(word.slice(start, start + term.length), term)) return true;
    return false;
}
// One letter added, dropped, changed or swapped: "andrey", "andre", "andrie".
function oneOff(a: string, b: string): boolean {
    if (a === b || Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    if (a.length !== b.length) return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
    return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
}

export type Term = { key: string; words: string };

// What the teacher typed, as the filter reads it, or null without two letters to block or over 60 characters.
export function blockable(words: string): Term | null {
    const key = wordsIn(readings(words).at(-1)!).join(' ');
    const shown = words.trim().replace(/\s+/g, ' ');
    return key.replace(/ /g, '').length >= 2 && shown.length <= 60 ? { key, words: shown } : null;
}

// Endings that make the same word: "losers", "idiots", "freed", "hater", "running" (a held letter is fine).
const ENDINGS = ['s', 'es', 'ed', 'er', 'ers', 'ing', 'y', 'ly'];
const AFTER_E = ['d', 'r', 'rs'];

// The first blocked term a message says, or null. Capitals, accents, signs for letters, letters held longer,
// letters spaced or dotted apart, a word split in two and the usual endings never hide one. `accepted` says
// whether the English check takes a word: with it (on the teacher's laptop), a term is also found inside a longer
// word (#freeandrei) or one letter off (andrey), but never in a real word or a classmate's name ("closer" is no
// "loser", Andreu is no Andrei); without it, those could be.
export function blockedIn(text: string, terms: readonly Term[], accepted?: (word: string) => boolean): Term | null {
    if (!terms.length) return null;
    const read = readings(text);
    const sequences = read.map(wordsIn);
    // Single words to look inside: each word, each one written with signs or dots inside, and letters spelt out.
    const singles = accepted ? [...new Set(read.flatMap(reading => [...wordsIn(reading),
        ...reading.split(/\s+/).map(chunk => chunk.replace(/[^\p{L}]/gu, '')).filter(Boolean), ...joinSpelt(wordsIn(reading))]))] : [];
    return terms.find(term => {
        const parts = term.key.split(' ');
        const whole = parts.join(''), shape = runsOf(whole), bare = collapse(whole);
        // Endings go on a last word of three letters or more: "free andreis", but "free as" is not "free a".
        const endings = parts.at(-1)!.length < 3 ? [] : [...ENDINGS, ...(whole.endsWith('e') ? AFTER_E : [])];
        const stem = (word: string) => endings.length > 0 && [word, word.replace(/(\p{L})\1+$/u, '$1')].some(form =>
            endings.some(ending => form.length > ending.length && form.endsWith(ending) && spells(runsOf(form.slice(0, -ending.length)), shape))
            || (whole.endsWith('y') && /ie[sd]$/.test(form) && spells(runsOf(`${form.slice(0, -3)}y`), shape)));
        const fits = (word: string) => spells(runsOf(word), shape) || stem(word);
        // Words side by side read as one while they still spell the start of the term: "an drei", "a n d r e i",
        // and "free a" written "freea".
        const side = sequences.some(words => words.some((_, start) => {
            let joined = '';
            for (const word of words.slice(start)) {
                joined += word;
                const sofar = collapse(joined);
                if (!(sofar.startsWith(bare) || bare.startsWith(sofar)) || sofar.length > bare.length + 3) return false;
                if (fits(joined)) return true;
            }
            return false;
        }));
        if (side || !accepted) return side;
        return singles.some(word => ((bare.length >= 4 && holds(runsOf(word), shape))
            || (parts.length === 1 && bare.length >= 5 && collapse(word).length >= 4 && oneOff(collapse(word), bare))) && !accepted(word));
    }) ?? null;
}

// Everyday words: never offered for blocking on their own, however many students write them.
const EVERYDAY = new Set(`a about after again all also am an and any are as at back be because been but by can come could did do does
    dont down for from get go going good got guys had has have he hello help her here hey hi him his how i if im in into is it its just
    know let lets like look me more my no not now of oh ok okay on one or our out please right said say see she so some sorry than thank
    thanks that the their them then there these they this to too u up us want was we well were what when where which who why will with
    yeah yes you your lol haha omg wow cool everyone everybody bye`.split(/\s+/).map(collapse));

// The words of a text as the repeat finder reads them: signs and spaced letters as above.
const countedWords = (text: string): string[] => joinSpelt(wordsIn(readings(text)[0]));
// The task's own words (its story, its warm-up), as the repeat finder compares them.
export const taskWordSet = (texts: readonly string[]): Set<string> => new Set(texts.flatMap(text => countedWords(text).map(collapse)));

export type Repeat = { key: string; words: string; students: string[]; examples: string[] };

// What many students are all writing to the whole plaza: the same word, or the same words together, from at
// least `least` of them. Everyday words, the task's own (`task`, from taskWordSet) and what `skip` says (keys the
// teacher let through) are never offered. The most widespread first, and never two that share a word: "free
// andrei" rather than "free" and "andrei" as well.
export function repeated(said: readonly { studentKey: string; text: string }[], least: number,
    task: ReadonlySet<string>, skip: (key: string) => boolean): Repeat[] {
    const found = new Map<string, { words: string; keyWords: string[]; size: number; students: Set<string>; examples: string[] }>();
    for (const { studentKey, text } of said) {
        const words = countedWords(text);
        const parts = words.map(collapse);
        const telling = parts.map(part => part.length >= 3 && !EVERYDAY.has(part) && !task.has(part));
        for (let size = 1; size <= 3; size++) for (let start = 0; start + size <= words.length; start++) {
            if (!telling.slice(start, start + size).some(Boolean)) continue;
            const key = parts.slice(start, start + size).join(' ');
            const shown = words.slice(start, start + size).join(' ');
            const entry = found.get(key) ?? { words: shown, keyWords: parts.slice(start, start + size).filter((_, i) => telling[start + i]), size, students: new Set(), examples: [] };
            found.set(key, entry);
            if (shown.length < entry.words.length) entry.words = shown; // "free andrei", not "freee andreiii"
            entry.students.add(studentKey);
            if (entry.examples.length < 3 && !entry.examples.includes(text.trim())) entry.examples.push(text.trim());
        }
    }
    // A phrase let through covers its words too: "free andrei" left alone is not offered again as "andrei".
    const taken = new Set<string>();
    return [...found].filter(([, entry]) => entry.students.size >= least)
        .sort(([, a], [, b]) => b.students.size - a.students.size || b.size - a.size)
        .filter(([key, entry]) => {
            if (entry.keyWords.some(word => taken.has(word))) return false;
            entry.keyWords.forEach(word => taken.add(word));
            return !skip(key);
        })
        .slice(0, 3).map(([key, entry]) => ({ key, words: entry.words, students: [...entry.students], examples: entry.examples }));
}

// What the teacher page shows: the lesson's blocked words with what each one stopped, the last lesson's to block
// again, and what the plaza is repeating.
export type BlockedStatus = {
    words: { key: string; words: string; removed: number; stopped: number; by: { studentKey: string; name: string; count: number }[] }[];
    before: string[];
    repeats: { key: string; words: string; students: { studentKey: string; name: string }[]; examples: string[] }[];
};
