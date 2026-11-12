import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { StudentChoicePage, StudentChoiceQuery } from '../shared/studentChoice';
import type { BoardView } from '../shared/campaign';

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
const { createRoot } = await import('react-dom/client'); const { act } = await import('react');
const { default: StudentQuestBrowser } = await import('../src/components/StudentQuestBrowser');
const { default: Journal } = await import('../src/components/Journal');
const { activityAnnouncements } = await import('../src/components/announcementQueue');
const root = createRoot(document.getElementById('root')!);
// Students joining the teacher's laptop over HTTP do not have randomUUID.
const uuidDescriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
const browserTimeout = window.setTimeout;
let loadingTimeout: (() => void) | undefined;
window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
  if (ms === 8000 && typeof handler === 'function') loadingTimeout = () => handler(...args);
  return browserTimeout.call(window, handler, ms, ...args);
}) as typeof window.setTimeout;
const requests: (StudentChoiceQuery & { requestId: string })[] = [], picks: string[] = [];
let result: StudentChoicePage | null = null, active = false, online = true, refreshKey = '1';
let notice: { text: string; at: number } | null = null;
const render = () => act(async () => root.render(<StudentQuestBrowser result={result} active={active} refreshKey={refreshKey} notice={notice}
  onBrowse={query => { requests.push(query); return online; }} onPick={id => { picks.push(id); return online; }} />));
const wait = (ms = 230) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
const picker = () => document.querySelector('dialog.challenge-picker');
const isOpen = () => !!picker()?.hasAttribute('open');
const button = (label: string) => {
  const found = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
  assert.ok(found, `Button: ${label}`); return found;
};
const click = (label: string) => act(async () => button(label).click());
const response = (title = 'Build a story', joining = ['Sam']) => ({ requestId: requests.at(-1)!.requestId, enabled: true, total: 25, page: requests.at(-1)!.page, pages: 3,
  items: [{ id: 'story', title, text: 'Chat with your partner. Take turns adding one sentence.', category: 'Talk', format: 'pair' as const, level: 'A2' as const,
    minutes: 5, state: 'available' as const, reason: null, joining }] });
await render();
assert.equal(isOpen(), false, 'the window waits a moment before opening by itself');
await wait(450); await wait();
assert.equal(isOpen(), true, 'a free student gets the challenge window by itself');
assert.equal(requests.length, 1);
assert.match(requests[0].requestId, /^[a-f0-9-]{36}$/, 'the school-network browser can request challenges without randomUUID');
await act(async () => { assert.ok(loadingTimeout); loadingTimeout(); });
assert.match(document.body.textContent!, /Could not load challenges/);
result = response(); await render();
assert.doesNotMatch(document.body.textContent!, /Could not load challenges/, 'a late successful response replaces its loading warning');
assert.match(document.body.textContent!, /Classmates waiting for you/, 'classmates waiting come first, in their own group');
assert.match(document.body.textContent!, /Waiting: Sam/);

// Board changes refresh the list without blanking it, at most once a second.
refreshKey = '2'; await render(); refreshKey = '3'; await render(); refreshKey = '4'; await render();
assert.ok(document.querySelector('.challenge-card'), 'the list stays while it refreshes');
assert.equal(document.querySelector('.challenge-picker-stale'), null, 'a refresh of the same search is not dimmed');
assert.doesNotMatch(document.body.textContent!, /Loading/);
await wait(); assert.equal(requests.length, 1, 'board changes do not refresh at once');
await wait(900); assert.equal(requests.length, 2, 'several board changes make one refresh');
assert.ok(document.querySelector('.challenge-card'), 'still showing the list while the refresh is on its way');
result = response('Build a story', ['Sam', 'Ana']); await render();
assert.match(document.body.textContent!, /Waiting: Sam, Ana/, 'the refreshed list replaces the old one in place');

online = false; await click('Join Sam, Ana');
assert.match(document.body.textContent!, /Reconnecting/, 'a failed selection is still reported when the catalog has loaded');
online = true; picks.length = 0;
await click('Join Sam, Ana'); assert.deepEqual(picks, ['story']);
assert.equal(button('Joining…').disabled, true, 'one click: the button waits for the answer');
notice = { text: 'That challenge is no longer available. Refresh the list.', at: Date.now() + 1 }; await render();
assert.match(document.querySelector('.challenge-picker-footer')!.textContent!, /no longer available/, 'a refused pick is shown in the window');
assert.equal(button('Join Sam, Ana').disabled, false);

await click('Next');
assert.ok(document.querySelector('.challenge-picker-stale .challenge-card'), 'while another page loads, the old one stays dimmed');
assert.equal(button('Join Sam, Ana').disabled, true, 'a dimmed card cannot be chosen');
await wait(); assert.equal(requests.at(-1)!.page, 1);
const stale = result;
result = response('Second page'); await render();
assert.match(document.body.textContent!, /Second page/);
assert.equal(document.querySelector('.challenge-picker-stale'), null);
await act(async () => { const select = document.querySelector('select')!; select.value = 'group'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
await wait(); assert.equal(requests.at(-1)!.format, 'group'); assert.equal(requests.at(-1)!.page, 0);
result = stale; await render();
assert.match(document.body.textContent!, /Second page/, 'a delayed response cannot replace a newer search');
assert.ok(document.querySelector('.challenge-picker-stale'));
result = { ...response(), items: [], total: 0, pages: 0 }; await render();
assert.match(document.body.textContent!, /No matches/);
result = response(); await render();
active = true; await render();
assert.equal(isOpen(), false, 'choosing a challenge closes the window');
assert.equal(document.querySelector('.student-choice-open')!.textContent!.trim(), '🎯 Browse challenges');
await act(async () => document.querySelector<HTMLButtonElement>('.student-choice-open')!.click()); await wait();
assert.equal(isOpen(), true);
result = response(); await render();
assert.equal(button('Join Sam').disabled, true, 'one challenge at a time');
assert.match(document.body.textContent!, /Finish it, or leave it/);
await click('✕ Close'); assert.equal(isOpen(), false);
await wait(1200); const quiet = requests.length; refreshKey = '5'; await render(); await wait(1200);
assert.equal(requests.length, quiet, 'a shut window asks for nothing');
active = false; await render(); await wait(450); await wait();
assert.equal(isOpen(), true, 'free again: the window opens again');
online = false; await click('Refresh');
assert.match(document.body.textContent!, /Reconnecting/);
online = true; await click('Refresh'); result = response(); await render();
assert.doesNotMatch(document.body.textContent!, /Reconnecting/);
await act(async () => root.render(<></>));

const timers: number[] = [], originalTimeout = window.setTimeout;
window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => { timers.push(ms ?? 0); return originalTimeout.call(window, handler, ms, ...args); }) as typeof window.setTimeout;
const board: BoardView = { board: [], studentChoice: true, sideQuests: { state: 'empty', reason: 'Your teacher can add side quests.', waiting: 0 } };
Object.defineProperty(window, 'innerHeight', { value: 600 });
await act(async () => root.render(<Journal quest={null} board={board} feedback={null} onAnswer={() => {}} onBrowse={() => true} onPick={() => true} choicePaused />));
await wait(900);
assert.ok(document.querySelector('.student-choice-open'), 'the Journal shows the way to the challenges, even on a short screen');
assert.equal(isOpen(), false, 'the window waits while the student chooses a name or reconnects');
await act(async () => root.render(<Journal quest={null} board={board} feedback={null} onAnswer={() => {}} onBrowse={() => true} onPick={() => true} />));
await wait(450); await wait();
assert.ok(isOpen() && document.querySelector('.challenge-picker-tools input[type="search"]'), 'then it opens with search and filters');
assert.doesNotMatch(document.body.textContent!, /teacher can add|in a minute/);
assert.ok(!timers.includes(60000), 'student browsing never schedules automatic selection');
assert.equal(activityAnnouncements(null, null, new Set(), board).length, 0, 'no announcement before the window: the window explains the steps');
assert.equal(activityAnnouncements(null, null, new Set(), { ...board, sideQuests: { state: 'choose', reason: null, waiting: 1 } }).length, 0, 'nor the old side quest prompt');
await act(async () => root.render(<Journal quest={null} board={{ ...board, studentChoice: false }} feedback={null} onAnswer={() => {}} />));
assert.equal(document.querySelector('.student-choice'), null, 'turning the mode off removes browsing');
assert.equal(picker(), null, 'and its window');
const currentTask: BoardView['board'][number] = { id: 'current', text: 'Current task', kind: 'report', activity: null, state: 'active', reason: null, partner: null, sideQuest: true };
await act(async () => root.render(<Journal quest={null} board={{ ...board, board: [currentTask,
  { ...currentTask, id: 'done', text: 'Finished task', state: 'done', report: { text: 'My saved report', version: 1, submitted: true } },
  { ...currentTask, id: 'ended', text: 'Old task', ended: true }] }} feedback={null} onAnswer={() => {}} onUndoReport={() => {}} />));
const history = document.querySelector<HTMLDetailsElement>('.journal-history')!;
assert.ok(history);
assert.equal(history.open, false, 'history starts collapsed');
assert.match(history.textContent!, /Finished task/);
assert.match(history.textContent!, /My saved report/);
assert.match(history.textContent!, /Undo submission/);
assert.match(history.textContent!, /Old task/);
assert.equal(history.querySelector('form'), null, 'ended tasks cannot be answered');
assert.match(document.querySelector('.journal-board')!.textContent!, /Current task/);
assert.doesNotMatch(document.querySelector('.journal-board')!.textContent!, /Finished task|Old task/);
if (uuidDescriptor) Object.defineProperty(crypto, 'randomUUID', uuidDescriptor);
else delete (crypto as Partial<Crypto>).randomUUID;

Object.assign(globalThis, { localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const { storeTeacherSession } = await import('../src/teacherSession'); storeTeacherSession('teacher-choice');
const { MemoryRouter } = await import('react-router-dom');
const { default: Teacher } = await import('../src/pages/Teacher');
let status = { open: true, game: { id: 'choice-game', name: '4B', randomNames: false, vision: 0 }, pin: '123456',
  games: [], entries: [], online: [], realNames: {}, muted: [], moderation: false, campaign: null, campaigns: [], warmup: null,
  support: { alerts: [], students: [] }, sideQuests: { studentChoice: false, free: [], doing: [], busy: 0, quests: 0, groups: [], open: [], reports: [] } };
const changes: object[] = [];
let complete: ((response: Response) => void) | null = null;
globalThis.fetch = async (url, init) => {
  assert.equal((init?.headers as Record<string, string> | undefined)?.['x-teacher-session'], 'teacher-choice');
  if (String(url).endsWith('/status')) return Response.json(status);
  assert.ok(String(url).endsWith('/student-choice'));
  changes.push(JSON.parse(String(init?.body)));
  return new Promise(resolve => { complete = resolve; });
};
await act(async () => root.render(<MemoryRouter><Teacher /></MemoryRouter>));
await act(async () => document.querySelector<HTMLButtonElement>('#tab-side')!.click());
const toggle = () => document.querySelector<HTMLInputElement>('.teacher-student-choice input')!;
assert.equal(toggle().checked, false);
await act(async () => toggle().click());
assert.deepEqual(changes, [{ gameId: 'choice-game', enabled: true }]);
assert.equal(toggle().disabled, true, 'a pending switch cannot be clicked twice');
await act(async () => complete!(Response.json({ error: 'Please retry.' }, { status: 503 })));
assert.equal(toggle().checked, false, 'failed updates keep the saved mode');
assert.equal(toggle().disabled, false);
await act(async () => toggle().click());
status = { ...status, sideQuests: { ...status.sideQuests, studentChoice: true } };
await act(async () => complete!(Response.json(status)));
assert.equal(toggle().checked, true);
assert.doesNotMatch(document.body.textContent!, /No side quests in this game yet/);
await act(async () => root.unmount()); dom.window.close();
console.log('Student Choice UI: the challenge window opens by itself (not while paused), keeps its list through throttled refreshes, dims stale pages, joins with one click, shows refused picks, closes on joining, and the teacher toggle/retry pass.');
process.exit(0);
