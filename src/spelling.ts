import NSpell from 'nspell';

// Checks that every word in a message is English, with a way to fix each one.
// A dictionary cannot tell a typo from another language, so both are stopped:
// "recieve" and "gracias" are told apart only by how good the suggestions are.

export type Misspelling = { word: string; suggestions: string[] };

// Said out loud and typed everywhere, but not in a dictionary.
const CHAT_WORDS = new Set(['lol', 'omg', 'ok', 'okay', 'hi', 'hey', 'yeah', 'yep', 'nope', 'wow', 'hmm', 'hm', 'uh', 'um',
  'oh', 'aw', 'yay', 'bye', 'plaza', 'pixel', 'emoji']);
const LAUGH = /^(ha|he)+h?$/i;

// Text-speak is not English either, but it has an obvious fix.
const TEXT_SPEAK: Record<string, string> = {
  u: 'you', r: 'are', ur: 'your', y: 'why', pls: 'please', plz: 'please', thx: 'thanks', thnx: 'thanks', ty: 'thank you',
  im: "I'm", dont: "don't", cant: "can't", wont: "won't", didnt: "didn't", doesnt: "doesn't", isnt: "isn't", ive: "I've",
  idk: "I don't know", bc: 'because', cuz: 'because', gonna: 'going to', wanna: 'want to', gotta: 'have to'
};

// The class's own languages (Spanish and Catalan): the English word is the suggestion, rather than a look-alike
// such as "six" for "si". The word is still stopped.
const HOME_WORDS: Record<string, string> = {
  si: 'yes', 'sí': 'yes', hola: 'hello', adios: 'bye', 'adiós': 'bye', adeu: 'bye', 'adéu': 'bye', gracias: 'thank you',
  'gràcies': 'thank you', gracies: 'thank you', merci: 'thank you', vale: 'OK', valeee: 'OK', bueno: 'well', bé: 'well', bien: 'good',
  pero: 'but', 'però': 'but', que: 'what', 'qué': 'what', 'què': 'what', como: 'how', 'cómo': 'how', com: 'how', donde: 'where',
  'dónde': 'where', quien: 'who', 'quién': 'who', qui: 'who', porque: 'because', 'perquè': 'because', perque: 'because',
  mira: 'look', tio: 'dude', 'tío': 'dude', tia: 'girl', 'tía': 'girl', jaja: 'haha', jajaja: 'haha', perdon: 'sorry', 'perdón': 'sorry',
  'perdó': 'sorry', amiga: 'friend', amic: 'friend', nada: 'nothing', res: 'nothing', mucho: 'a lot', molt: 'very', tambien: 'too',
  'también': 'too', 'també': 'too', aqui: 'here', 'aquí': 'here', alli: 'there', 'allí': 'there', alla: 'there',
};

const WORD = /\p{L}+(?:['’]\p{L}+)*/gu;

export type Checker = (text: string, names?: string[]) => Misspelling[];

export type Dictionary = { aff: string; dic: string };

// Letters stretched for feeling, as in "helloooo", "nooo" or "yesss": the word with each run of a repeated
// letter as one letter or two. "siiii" becomes "si" and "sii", which are still not English.
function unstretched(word: string): string[] {
  const runs = word.match(/(.)\1*/gu) ?? [];
  if (!runs.some(run => run.length > 1)) return [];
  let words = [''];
  for (const run of runs) {
    words = words.flatMap(start => run.length > 1 ? [start + run[0], start + run[0] + run[0]] : [start + run]);
    if (words.length > 64) return [];
  }
  return words.filter(short => short !== word);
}

// How many letters must change to turn one word into the other.
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

// aff and dic are a Hunspell dictionary, as in the dictionary-en package: American
// English, the one dialect the class uses, so every suggestion is American. `alsoAccept`
// is another dictionary (British) whose words are fine when typed but never suggested.
export function createChecker(aff: string, dic: string, alsoAccept?: Dictionary): Checker {
  const speller = NSpell(aff, dic);
  const other = alsoAccept && NSpell(alsoAccept.aff, alsoAccept.dic);
  const correct = (word: string) => speller.correct(word) || !!other?.correct(word);
  return (text, names = []) => {
    const known = new Set(names.flatMap(name => name.toLowerCase().split(/[^\p{L}]+/u)).filter(Boolean));
    // Name words as written ("Lamine", not "lamine"), to suggest for a misspelt name.
    const nameWords = new Map<string, string>();
    for (const part of names.flatMap(name => name.split(/[^\p{L}]+/u)).filter(part => part.length > 3)) {
      const key = part.toLowerCase();
      if (!nameWords.has(key) || /^\p{Lu}/u.test(part)) nameWords.set(key, part);
    }
    const found = new Map<string, Misspelling>();
    for (const [raw] of text.matchAll(WORD)) {
      const word = raw.replace(/’/g, "'");
      const lower = word.toLowerCase();
      if (found.has(lower) || CHAT_WORDS.has(lower) || LAUGH.test(lower) || known.has(lower)) continue;
      if (lower === 'a' || lower === 'i') continue;
      if (TEXT_SPEAK[lower]) { found.set(lower, { word: raw, suggestions: [TEXT_SPEAK[lower]] }); continue; }
      if (lower.length > 1 && correct(word)) continue;
      // Hunspell is case-sensitive: a word that is only fine in lower case, in capitals.
      if (lower.length > 1 && correct(lower)) continue;
      // "i'm", "i'll", "i've", "i'd": the dictionary only has them with a capital I.
      if (/^i'\p{L}/u.test(lower) && correct('I' + lower.slice(1))) continue;
      if (unstretched(lower).some(short => CHAT_WORDS.has(short) || LAUGH.test(short) || known.has(short) || (short.length > 1 && correct(short)))) continue;
      // Learners type "cafe" and "café" alike: accents do not make a word foreign.
      const plain = lower.normalize('NFD').replace(/\p{M}/gu, '');
      if (plain !== lower && (correct(plain) || known.has(plain))) continue;
      const home = HOME_WORDS[lower] ?? HOME_WORDS[plain] ?? unstretched(lower).map(short => HOME_WORDS[short]).find(Boolean);
      // A name typed nearly right ("lamaine" for Lamine) is offered the name first.
      const name = lower.length > 3 ? [...nameWords].map(([key, written]) => ({ written, distance: editDistance(plain, key.normalize('NFD').replace(/\p{M}/gu, '')) }))
        .filter(item => item.distance <= 2).sort((a, b) => a.distance - b.distance)[0]?.written : undefined;
      const words = lower.length > 1 ? speller.suggest(lower) : [];
      found.set(lower, { word: raw, suggestions: home ? [home] : [...new Set(name ? [name, ...words] : words)].slice(0, 3) });
    }
    return [...found.values()];
  };
}
