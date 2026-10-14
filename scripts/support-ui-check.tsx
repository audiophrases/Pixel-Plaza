// Exercise teacher assistance, audit pagination and changes of class/student in rendered controls.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { HelpAlert, MessageAttempt, TeacherSupport as Support } from '../shared/support';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/teacher' });
const g = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
Object.assign(g, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });

const students = [{ studentKey: 'ada', name: 'Ada' }, { studentKey: 'sam', name: 'Sam' }];
const alert: HelpAlert = {
  id: 'help-ada', studentKey: 'ada', name: 'Ada', topic: 'writing', kind: 'suggested', status: 'open',
  note: 'Repeated language checks', timestamp: 100, updated: 100,
  evidence: [{ reason: 'Try writing in English.', text: 'Original blocked idea', timestamp: 90 }]
};
const support: Support = { alerts: [alert], students };
const records: MessageAttempt[] = Array.from({ length: 610 }, (_, index) => ({
  id: `audit-${index}`, studentKey: index % 2 ? 'sam' : 'ada', sender: index % 2 ? 'Sam' : 'Ada',
  text: index === 0 ? 'Original blocked idea' : `Submitted idea ${index}`,
  finalText: index === 0 ? 'I saw the thief in the plaza.' : null,
  timestamp: 1000 - index, source: 'chat', status: index === 0 ? 'blocked' : 'approved',
  reason: index === 0 ? 'Try writing in English.' : null, target: null, objective: null,
  chatId: null, correction: index === 0 ? 'Try using the past tense.' : null
}));
const requests: URL[] = [];
const actions: { path: string; body: Record<string, unknown> }[] = [];
let success = true;
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
      action={async (path, body) => { actions.push({ path, body: body as Record<string, unknown> }); return success; }}
      failed={cause => { throw cause; }} />);
  });
};
const button = (text: string) => {
  const found = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === text);
  assert.ok(found, `Button exists: ${text}`); return found;
};
const click = async (text: string) => { await act(async () => { button(text).click(); }); };
const edit = async (id: string, value: string) => {
  const field = document.getElementById(id) as HTMLSelectElement | HTMLTextAreaElement;
  assert.ok(field, `Field exists: ${id}`);
  const prototype = field.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLTextAreaElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new dom.window.Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};
const submit = async () => { await act(async () => { document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); }); };

await render();
assert.ok(document.body.textContent?.includes('Suggested check-in'));
assert.ok(document.body.textContent?.includes('Original blocked idea'));
assert.ok(document.body.textContent?.includes('Revised submission: I saw the thief in the plaza.'));
assert.equal(document.querySelectorAll('.teacher-attempt').length, 50);
while ([...document.querySelectorAll('button')].some(item => item.textContent === 'Load older messages')) await click('Load older messages');
assert.equal(document.querySelectorAll('.teacher-attempt').length, 610, 'all older submissions remain available beyond 500 records');
assert.ok(document.body.textContent?.includes('Submitted idea 609'));
await click('View messages & help');
assert.equal((document.getElementById('teacher-help-recipient') as HTMLSelectElement).value, 'ada');
assert.equal((document.getElementById('teacher-history-student') as HTMLSelectElement).value, 'ada');
assert.equal(document.querySelectorAll('.teacher-attempt').length, 50, 'switching student discards the previous all-student history');
await click('I’m helping');
assert.deepEqual(actions.at(-1), { path: 'help-status', body: { id: 'help-ada', status: 'acknowledged', gameId: 'first-game' } });
await click('Help completed / helped in person');
assert.equal(actions.at(-1)!.body.status, 'resolved');

await edit('teacher-help-recipient', 'sam');
await edit('teacher-help-message', 'Tell me what you want to say.');
success = false;
await submit();
assert.equal((document.getElementById('teacher-help-message') as HTMLTextAreaElement).value, 'Tell me what you want to say.', 'a failed private send preserves the draft');
success = true;
await submit();
assert.deepEqual(actions.at(-1), { path: 'help-message', body: { studentKey: 'sam', text: 'Tell me what you want to say.', gameId: 'first-game' } });
assert.equal((document.getElementById('teacher-help-message') as HTMLTextAreaElement).value, '');
assert.ok(document.body.textContent?.includes('Private message sent.'));

await edit('teacher-history-student', 'ada');
deferNextSam = true;
await edit('teacher-history-student', 'sam');
assert.ok(deferred);
await edit('teacher-history-student', 'ada');
assert.ok(deferred!.signal.aborted, 'the previous student request is aborted');
await act(async () => { deferred!.resolve(Response.json({ attempts: [{ ...records[0], id: 'stale-student', text: 'Stale student leak' }], next: null })); });
assert.equal(document.body.textContent?.includes('Stale student leak'), false);
await edit('teacher-help-message', 'First class draft');
await render('second-game');
assert.equal((document.getElementById('teacher-help-recipient') as HTMLSelectElement).value, '');
assert.equal((document.getElementById('teacher-help-message') as HTMLTextAreaElement).value, '');
assert.ok(document.body.textContent?.includes('Second class only'));
assert.equal(document.body.textContent?.includes('Submitted idea 609'), false);
assert.equal(requests.at(-1)!.searchParams.get('gameId'), 'second-game');
await act(async () => { root.unmount(); });
dom.window.close();
console.log('Teacher support UI: alerts, private help, preserved failed drafts, original/revised attempts, full pagination and student/game isolation pass.');
process.exit(0);
