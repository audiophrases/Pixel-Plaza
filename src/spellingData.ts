import type { Checker } from './spelling';

// The dictionary is about 550 KB, so it is fetched when the Plaza opens, not
// with the sign-in page, and built once.
let checker: Promise<Checker> | null = null;

export function loadChecker(): Promise<Checker> {
  checker ??= Promise.all([
    import('english-dictionary/index.aff?raw'),
    import('english-dictionary/index.dic?raw'),
    import('./spelling')
  ]).then(([aff, dic, { createChecker }]) => createChecker(aff.default, dic.default))
    .catch(error => { checker = null; throw error; }); // try again next time
  return checker;
}
