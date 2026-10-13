// The same English-only check the chat box runs, as a backstop on the teacher's
// laptop: a student who tampers with the page still cannot send other languages.
// It is loaded only when needed, because the dictionary is large.
import { createChecker, type Checker, type Misspelling } from '../src/spelling.ts';
import aff from '../node_modules/dictionary-en/index.aff';
import dic from '../node_modules/dictionary-en/index.dic';
import gbAff from '../node_modules/dictionary-en-gb/index.aff';
import gbDic from '../node_modules/dictionary-en-gb/index.dic';

let checker: Checker | null = null;

export function notEnglish(text: string, names: string[]): Misspelling[] {
    checker ??= createChecker(aff, dic, { aff: gbAff, dic: gbDic });
    return checker(text, names);
}
