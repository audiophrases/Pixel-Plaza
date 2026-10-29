import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { defaultWarmup, type SavedWarmup } from '../shared/warmupConfig';
import type { WarmupKind } from '../shared/warmupKinds';
import type { ActivityHistoryView } from '../shared/activityHistory';
import { pairTaskId } from '../shared/activityHistory';
import fixture from '../worker/tests/fixtures/side-quests.json';

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/quest-library' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
dom.window.confirm = () => true;
const games = [{ id: 'a', name: 'Class A' }, { id: 'b', name: 'Class B' }];
const stats = { plays: 2, lastPlayed: 1000, recovered: false };
const histories: Record<string, ActivityHistoryView> = {
    current: { game: games[0], games, quests: { 'sq-used': stats, 'sq-old': { ...stats, plays: 1, recovered: true } },
        warmups: { identity: stats }, tasks: { identity: { messi: stats, ronaldo: { ...stats, recovered: true } } },
        recent: [{ type: 'quest', id: 'sq-used', title: 'Played quest', playedAt: 1000, recovered: false }] },
    b: { game: games[1], games, quests: { 'sq-fresh': stats }, warmups: {}, tasks: {}, recent: [] },
};
histories.a = histories.current;
const base = fixture.quests.find(q => q.chapter === null)!;
const quests = [['sq-used', 'Played quest'], ['sq-fresh', 'Fresh quest'], ['sq-old', 'Recovered quest']].map(([id, title]) => ({ ...base, id, title }));
const saved = Object.fromEntries(['identity', 'facts', 'pairs'].map(kind => [kind, { definition: defaultWarmup(kind as WarmupKind), version: 0 }])) as Record<WarmupKind, SavedWarmup>;
if (saved.identity.definition.kind === 'identity') saved.identity.definition.identities = saved.identity.definition.identities.slice(0, 3);
if (saved.pairs.definition.kind === 'pairs') histories.current.tasks.pairs = { [pairTaskId(saved.pairs.definition.pairs[0])]: stats };
let failHistory = false, slowA = false, lateA: ((response: Response) => void) | undefined;
globalThis.fetch = async (url, init) => {
    const request = new URL(String(url), 'http://localhost');
    assert.equal((init?.headers as Record<string, string> | undefined)?.['x-teacher-session'], 'teacher-token');
    if (request.pathname.endsWith('activity-history')) {
        if (failHistory) return Response.json({ error: 'History is offline.' }, { status: 503 });
        const scope = request.searchParams.get('gameId') ?? 'current';
        if (slowA && scope === 'a') return new Promise<Response>(resolve => { lateA = resolve; });
        return Response.json(histories[scope]);
    }
    if (request.pathname.endsWith('side-quests/board')) return Response.json({ target: { game: games[0], open: true, version: 0, mission: null, quests: [] } });
    if (request.pathname.endsWith('side-quests/list')) return Response.json({ quests, trash: [], versions: {}, chapters: [] });
    assert.ok(request.pathname.endsWith('warmup-editor'), request.pathname);
    const kind = request.searchParams.get('kind') as WarmupKind;
    if (init?.method === 'POST') saved[kind] = { definition: JSON.parse(String(init.body)).definition, version: saved[kind].version + 1 };
    return Response.json(saved[kind]);
};
const { storeTeacherSession } = await import('../src/teacherSession'); storeTeacherSession('teacher-token');
const { createRoot } = await import('react-dom/client'); const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const { default: QuestLibrary } = await import('../src/pages/QuestLibrary');
const { default: WarmupStudio } = await import('../src/pages/WarmupStudio');
let root = createRoot(document.getElementById('root')!);
const select = async (label: string, value: string) => act(async () => {
    const input = document.querySelector(`select[aria-label="${label}"]`)!;
    assert.ok(input, label);
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
});
const click = async (label: string) => act(async () => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent === label); assert.ok(button, label); button.click();
});
const cards = () => [...document.querySelectorAll('.ql-results .ql-card')];
await act(async () => root.render(<MemoryRouter><QuestLibrary /></MemoryRouter>));
assert.equal(cards().length, 3);
assert.match(cards()[0].textContent!, /2 plays/); assert.match(cards()[1].textContent!, /Never played/);
assert.match(cards()[2].textContent!, /1\+ plays/);
await select('Played history filter', 'never'); assert.equal(cards().length, 1); assert.match(cards()[0].textContent!, /Fresh quest/);
const levelChip = [...document.querySelectorAll('[aria-label="Level"] button')].find(button => button.textContent?.startsWith(base.level));
assert.equal(levelChip?.querySelector('small')?.textContent, '1', 'facet counts include the play-history filter');
await click('Pick 5 at random from these');
assert.match(document.querySelector('.ql-chosen')!.textContent!, /Fresh quest/);
assert.ok(!document.querySelector('.ql-chosen')!.textContent!.includes('Played quest'));
await select('History for game/class', 'b');
assert.equal(cards().length, 2); assert.ok(cards().every(card => !card.textContent!.includes('Fresh quest')));
assert.match(document.querySelector('.ql-target')!.textContent!, /Class A/, 'history browsing does not change the release target');
slowA = true;
await select('History for game/class', 'a'); assert.equal(cards().length, 0, 'loading history never treats unknown counts as zero');
await select('History for game/class', 'b'); assert.equal(cards().length, 2);
await act(async () => lateA!(Response.json(histories.a)));
assert.equal(cards().length, 2, 'a stale response cannot replace the chosen class history');
failHistory = true; await click('Refresh history');
assert.equal(cards().length, 0); assert.match(document.body.textContent!, /History is offline/);
failHistory = false; await click('Refresh history'); assert.equal(cards().length, 2);
await act(async () => root.unmount());

root = createRoot(document.getElementById('root')!);
await act(async () => root.render(<MemoryRouter initialEntries={['/warmup-studio?kind=identity']}><WarmupStudio /></MemoryRouter>));
assert.equal(document.querySelectorAll('.warmup-editor-row').length, 3);
await select('Played history filter', 'never');
assert.equal(document.querySelectorAll('.warmup-editor-row').length, 1);
const row = document.querySelector('.warmup-editor-row')!;
assert.match(row.textContent!, /Identity 3/); assert.match(row.textContent!, /Never played/);
await act(async () => {
    const input = row.querySelector('input')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'New name');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
});
await click('Save warm-up');
assert.equal(saved.identity.definition.kind, 'identity');
if (saved.identity.definition.kind === 'identity') {
    assert.equal(saved.identity.definition.identities.length, 3, 'history filtering never deletes hidden entries');
    assert.equal(saved.identity.definition.identities[0].name, 'Messi');
    assert.equal(saved.identity.definition.identities[2].name, 'New name', 'filtered editing keeps original row indices');
}
await select('Played history filter', 'played'); assert.equal(document.querySelectorAll('.warmup-editor-row').length, 2);
await select('History for game/class', 'b'); assert.equal(document.querySelectorAll('.warmup-editor-row').length, 0);
assert.match(document.body.textContent!, /0 of 3 tasks/);
await select('History for game/class', 'current');
await select('Warm-up type', 'pairs');
assert.equal(document.querySelectorAll('.warmup-editor-row').length, 1);
const pairInput = document.querySelector('.warmup-editor-row input') as HTMLInputElement;
await act(async () => {
    pairInput.focus();
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(pairInput, 'New word');
    pairInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
});
assert.equal(document.activeElement, pairInput, 'editing a played word pair does not hide the focused row');
const totalPairs = saved.pairs.definition.kind === 'pairs' ? saved.pairs.definition.pairs.length : 0;
await click('Add pair');
assert.equal(document.querySelectorAll('.warmup-editor-row').length, totalPairs + 1, 'adding a task reveals it even under the played filter');
await act(async () => root.unmount()); dom.window.close();
console.log('Activity history UI: badges, quest selection/facets, class scope, stale/offline data and filtered warm-up editing pass.');
process.exit(0);
