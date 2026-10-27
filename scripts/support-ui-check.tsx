// Exercise the teacher's message history: audit pagination, opening a student, and changes of class/student.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { MessageAttempt, TeacherSupport as Support } from '../shared/support';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/teacher' });
const g = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
Object.assign(g, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });

const students = [{ studentKey: 'ada', name: 'Ada' }, { studentKey: 'sam', name: 'Sam' }];
const support: Support = { alerts: [], students, ai: { used: 1, students: 2 } };
const records: MessageAttempt[] = Array.from({ length: 610 }, (_, index) => ({
  id: `audit-${index}`, studentKey: index % 2 ? 'sam' : 'ada', sender: index % 2 ? 'Sam' : 'Ada',
  text: index === 0 ? 'Original blocked idea' : `Submitted idea ${index}`,
  finalText: index === 0 ? 'I saw the thief in the plaza.' : null,
  timestamp: 1000 - index, source: index === 1 ? 'teacher' : 'chat', status: index === 0 ? 'language-blocked' : index === 1 ? 'delivered' : index === 2 ? 'hint-offered' : 'approved',
  reason: index === 0 ? 'Try writing in English.' : null, target: index === 1 ? 'sam' : null, objective: null,
  chatId: null, correction: index === 0 ? 'Try using the past tense.' : null
}));
const requests: URL[] = [];
const opened: string[] = [];
let deferred: { resolve: (response: Response) => void; signal: AbortSignal } | null = null;
let deferNextSam = false;
g.fetch = async (url, init) => {
  assert.equal((init?.headers as Record<string, string>)['x-teacher-session'], 'teacher-session');
  const query = new URL(String(url), 'http://localhost'); requests.push(query);
  assert.equal(query.pathname, '/api/teacher/attempts');
  assert.ok(query.searchParams.has('gameId'), 'history requests bind the selected game');
  if (deferNextSam && query.searchParams.get('studentKey') === 'sam') {
    deferNextSam = false;
    return new Promise<Response>(resolve => { deferred = { resolve, signal: init!.signal! }; });
  }
  if (query.searchParams.get('gameId') === 'second-game') return Response.json({ attempts: [{ ...records[0], id: 'new-class', text: 'Second class only', finalText: null }], next: null });
  const filtered = records.filter(record => !query.searchParams.get('studentKey') || query.searchParams.get('studentKey') === record.studentKey);
  const cursor = Number(query.searchParams.get('cursor') ?? 0);
  return Response.json({ attempts: filtered.slice(cursor, cursor + 50), next: cursor + 50 < filtered.length ? String(cursor + 50) : null });
};
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { default: TeacherSupport } = await import('../src/components/TeacherSupport');
const root = createRoot(document.getElementById('root')!);
const render = async (gameId = 'first-game') => {
  await act(async () => {
    root.render(<TeacherSupport key={gameId} gameId={gameId} token="teacher-session" support={support} students={students}
      who={(_key, name) => `${name} (real name)`}
      failed={cause => { throw cause; }} onStudent={studentKey => opened.push(studentKey)} />);
  });
};
const button = (text: string) => {
  const found = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === text);
  assert.ok(found, `Button exists: ${text}`); return found;
};
const click = async (text: string) => { await act(async () => { button(text).click(); }); };
const edit = async (id: string, value: string) => {
  const field = document.getElementById(id) as HTMLSelectElement;
  assert.ok(field, `Field exists: ${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
};

await render();
assert.ok(document.querySelector('.teacher-ai-count')?.textContent?.includes('1 / 2'));
assert.ok(document.body.textContent?.includes('Original blocked idea'));
assert.ok(document.body.textContent?.includes('Revised submission: I saw the thief in the plaza.'));
assert.ok(document.querySelector('.teacher-attempt-teacher > div')?.textContent?.startsWith('Teacher → Sam (real name)'), 'private teacher replies show the named student recipient instead of the stored student key');
assert.ok(document.body.textContent?.includes('Stopped by language check'));
assert.ok(document.body.textContent?.includes('Language hint offered'));
assert.equal(document.body.textContent?.includes('language-blocked'), false, 'status codes are explained in ordinary language');
assert.equal(document.querySelector('form'), null, 'help requests and private messages are answered in Needs you and the student drawer, not here');
assert.equal(document.querySelectorAll('.teacher-attempt').length, 50);
while ([...document.querySelectorAll('button')].some(item => item.textContent === 'Load older messages')) await click('Load older messages');
assert.equal(document.querySelectorAll('.teacher-attempt').length, 610, 'all older submissions remain available beyond 500 records');
assert.ok(document.body.textContent?.includes('Submitted idea 609'));
await click('Open this student');
assert.deepEqual(opened, ['ada'], 'a submission opens its student beside the class');
await edit('teacher-history-student', 'ada');
assert.equal(document.querySelectorAll('.teacher-attempt').length, 50, 'switching student discards the previous all-student history');
deferNextSam = true;
await edit('teacher-history-student', 'sam');
assert.ok(deferred);
await edit('teacher-history-student', 'ada');
assert.ok(deferred!.signal.aborted, 'the previous student request is aborted');
await act(async () => { deferred!.resolve(Response.json({ attempts: [{ ...records[0], id: 'stale-student', text: 'Stale student leak' }], next: null })); });
assert.equal(document.body.textContent?.includes('Stale student leak'), false);
await render('second-game');
assert.equal((document.getElementById('teacher-history-student') as HTMLSelectElement).value, '', 'another class starts with every student');
assert.ok(document.body.textContent?.includes('Second class only'));
assert.equal(document.body.textContent?.includes('Submitted idea 609'), false);
assert.equal(requests.at(-1)!.searchParams.get('gameId'), 'second-game');
await act(async () => { root.unmount(); });
dom.window.close();
console.log('Teacher message history: original/revised attempts, opening a student, full pagination and student/game isolation pass.');
process.exit(0);
