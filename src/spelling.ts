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

const WORD = /\p{L}+(?:['’]\p{L}+)*/gu;

export type Checker = (text: string, names?: string[]) => Misspelling[];

export type Dictionary = { aff: string; dic: string };

// aff and dic are a Hunspell dictionary, as in the dictionary-en package: American
// English, the one dialect the class uses, so every suggestion is American. `alsoAccept`
// is another dictionary (British) whose words are fine when typed but never suggested.
export function createChecker(aff: string, dic: string, alsoAccept?: Dictionary): Checker {
  const speller = NSpell(aff, dic);
  const other = alsoAccept && NSpell(alsoAccept.aff, alsoAccept.dic);
  const correct = (word: string) => speller.correct(word) || !!other?.correct(word);
  return (text, names = []) => {
    const known = new Set(names.flatMap(name => name.toLowerCase().split(/[^\p{L}]+/u)).filter(Boolean));
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
      // Learners type "cafe" and "café" alike: accents do not make a word foreign.
      const plain = lower.normalize('NFD').replace(/\p{M}/gu, '');
      if (plain !== lower && correct(plain)) continue;
      found.set(lower, { word: raw, suggestions: lower.length > 1 ? speller.suggest(lower).slice(0, 3) : [] });
    }
    return [...found.values()];
  };
}
