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
let result: StudentChoicePage | null = null, active = false, online = true;
const render = () => act(async () => root.render(<StudentQuestBrowser result={result} active={active} refreshKey="1"
  onBrowse={query => { requests.push(query); return online; }} onPick={id => { picks.push(id); return online; }} />));
const wait = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 230)); });
const button = (label: string) => {
  const found = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
  assert.ok(found, `Button: ${label}`); return found;
};
const click = (label: string) => act(async () => button(label).click());
const response = (title = 'Build a story') => ({ requestId: requests.at(-1)!.requestId, enabled: true, total: 25, page: requests.at(-1)!.page, pages: 3,
  items: [{ id: 'story', title, text: 'Chat with your partner. Take turns adding one sentence.', category: 'Talk', format: 'pair' as const, level: 'A2' as const,
    minutes: 5, state: 'available' as const, reason: null, joining: ['Sam'] }] });
await render(); await wait();
assert.equal(requests.length, 1);
assert.match(requests[0].requestId, /^[a-f0-9-]{36}$/, 'the school-network browser can request challenges without randomUUID');
await act(async () => { assert.ok(loadingTimeout); loadingTimeout(); });
assert.match(document.body.textContent!, /Could not load challenges/);
result = response(); await render();
assert.doesNotMatch(document.body.textContent!, /Could not load challenges/, 'a late successful response replaces its loading warning');
assert.match(document.body.textContent!, /Waiting: Sam/);
online = false; await click('Join them');
assert.match(document.body.textContent!, /Reconnecting/, 'a failed selection is still reported when the catalog has loaded');
online = true; picks.length = 0;
await click('Join them'); assert.deepEqual(picks, ['story']);
await click('Next');
assert.equal(document.querySelector('.student-choice-card'), null, 'stale cards disappear while another page loads');
await wait(); assert.equal(requests.at(-1)!.page, 1);
const stale = result;
result = response('Second page'); await render();
assert.match(document.body.textContent!, /Second page/);
await act(async () => { const select = document.querySelector('select')!; select.value = 'group'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
await wait(); assert.equal(requests.at(-1)!.format, 'group'); assert.equal(requests.at(-1)!.page, 0);
result = stale; await render();
assert.equal(document.querySelector('.student-choice-card'), null, 'a delayed response cannot replace a newer search');
result = { ...response(), items: [], total: 0, pages: 0 }; await render();
assert.match(document.body.textContent!, /No matches/);
active = true; await render();
assert.equal(document.querySelector('.student-choice-filters'), null, 'picking a quest folds the browser away');
await act(async () => document.querySelector<HTMLButtonElement>('.student-choice-toggle')!.click()); await wait();
result = response(); await render();
assert.equal(button('Join them').disabled, true, 'one challenge at a time');
active = false; online = false; await render(); await click('Refresh'); await wait();
assert.match(document.body.textContent!, /Reconnecting/);
online = true; await click('Refresh'); await wait(); result = response(); await render();
assert.doesNotMatch(document.body.textContent!, /Reconnecting/);

const timers: number[] = [], originalTimeout = window.setTimeout;
window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => { timers.push(ms ?? 0); return originalTimeout.call(window, handler, ms, ...args); }) as typeof window.setTimeout;
const board: BoardView = { board: [], studentChoice: true, sideQuests: { state: 'empty', reason: 'Your teacher can add side quests.', waiting: 0 } };
Object.defineProperty(window, 'innerHeight', { value: 600 });
await act(async () => root.render(<Journal quest={null} board={board} feedback={null} onAnswer={() => {}} onBrowse={() => true} onPick={() => true} />));
assert.ok(document.querySelector('.student-choice-search'), 'the library opens even with no quest board on a short screen');
assert.doesNotMatch(document.body.textContent!, /teacher can add|in a minute/);
assert.ok(!timers.includes(60000), 'student browsing never schedules automatic selection');
assert.match(activityAnnouncements(null, null, new Set(), board)[0].sections[0].text, /Chat with your classmates/);
await act(async () => root.render(<Journal quest={null} board={{ ...board, studentChoice: false }} feedback={null} onAnswer={() => {}} />));
assert.equal(document.querySelector('.student-choice'), null, 'turning the mode off removes browsing');
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
console.log('Student Choice UI: pages, filters, stale replies, joining, active quests, reconnects, empty boards, no automatic selection and teacher toggle/retry pass.');
process.exit(0);
