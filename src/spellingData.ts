import type { Checker } from './spelling';

// American English suggests; British spellings are accepted too. Each dictionary is
// about 550 KB, so it is fetched when the Plaza opens, not
// with the sign-in page, and built once.
let checker: Promise<Checker> | null = null;

export function loadChecker(): Promise<Checker> {
  checker ??= Promise.all([
    import('english-dictionary/index.aff?raw'),
    import('english-dictionary/index.dic?raw'),
    import('english-dictionary-gb/index.aff?raw'),
    import('english-dictionary-gb/index.dic?raw'),
    import('./spelling')
  ]).then(([aff, dic, gbAff, gbDic, { createChecker }]) =>
    createChecker(aff.default, dic.default, { aff: gbAff.default, dic: gbDic.default }))
    .catch(error => { checker = null; throw error; }); // try again next time
  return checker;
}
