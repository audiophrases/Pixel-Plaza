import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fixture from '../worker/tests/fixtures/side-quests.json';

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/quest-library' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
let quests = structuredClone(fixture.quests);
const story = quests.filter(q => q.chapter !== null), generic = quests.filter(q => q.chapter === null);
let trash: typeof quests = [];
const versions = Object.fromEntries(quests.map(q => [q.id, 1]));
const game = { id: 'test', name: 'Test' };
let failDelete = false, deletions = 0;
let lastSelection: { id: string; version: number }[] = [];
const listing = () => ({ quests, trash, versions, chapters: fixture.chapters });
globalThis.fetch = async (url, init) => {
    const route = new URL(String(url), 'http://localhost').pathname;
    assert.equal((init?.headers as Record<string, string>)?.['x-teacher-session'], 'teacher-token');
    if (route.endsWith('activity-history')) return Response.json({ game, games: [game], quests: {}, warmups: {}, tasks: {}, recent: [] });
    if (route.endsWith('side-quests/board')) return Response.json({ target: { game, open: true, version: 0, mission: null, quests: [] } });
    if (route.endsWith('side-quests/list')) return Response.json(listing());
    if (route.endsWith('side-quests/delete-many')) {
        assert.equal(init?.method, 'POST');
        lastSelection = JSON.parse(String(init?.body)).quests;
        if (failDelete) return Response.json({ error: 'A selected quest changed somewhere else. No quests were moved.' }, { status: 409 });
        for (const item of lastSelection) assert.equal(item.version, versions[item.id]);
        const ids = new Set(lastSelection.map(q => q.id));
        trash.push(...quests.filter(q => ids.has(q.id)));
        quests = quests.filter(q => !ids.has(q.id));
        for (const id of ids) versions[id]++;
        deletions++;
        return Response.json(listing());
    }
    if (route.endsWith('side-quests/restore')) {
        const { id, version } = JSON.parse(String(init?.body));
        assert.equal(version, versions[id]);
        quests.push(trash.find(q => q.id === id)!); trash = trash.filter(q => q.id !== id); versions[id]++;
        return Response.json(listing());
    }
    throw new Error(`Unexpected request: ${route}`);
};
const { storeTeacherSession } = await import('../src/teacherSession'); storeTeacherSession('teacher-token');
const { createRoot } = await import('react-dom/client'); const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const { default: QuestLibrary } = await import('../src/pages/QuestLibrary');
const root = createRoot(document.getElementById('root')!);
const button = (label: string, scope: ParentNode = document) => {
    const found = [...scope.querySelectorAll('button')].find(b => b.textContent === label);
    assert.ok(found, `Button: ${label}`); return found;
};
const click = async (label: string, scope: ParentNode = document) => act(async () => {
    const found = button(label, scope); assert.equal(found.disabled, false, `Enabled: ${label}`); found.click();
});
const cards = () => [...document.querySelectorAll('.ql-results .ql-card')];
const confirm = () => document.querySelector('.ql-delete-confirm');
await act(async () => root.render(<MemoryRouter><QuestLibrary /></MemoryRouter>));
assert.equal(cards().length, 40);
assert.equal(button('Delete selected (0)').disabled, true);

await click('Story quests');
assert.ok(story.length > 40);
await click('Select', cards()[0]);
assert.equal(button('Delete selected (1)').disabled, false, 'story quests can be selected without a running campaign');
assert.equal(button('Review and add to the game').disabled, true, 'story eligibility still applies to release');
await click(`Select all ${story.length} results`);
assert.equal(document.querySelectorAll('.ql-chosen li').length, story.length, 'selects all results beyond Show more and the ten-quest limit');
await click(`Delete selected (${story.length})`);
assert.equal(confirm()?.querySelectorAll('li').length, story.length);
assert.equal(deletions, 0, 'opening confirmation does not delete anything');
await click('Keep quests'); assert.equal(confirm(), null); assert.equal(deletions, 0);

await click('Generic quests');
assert.match(document.querySelector('.ql-bulk')!.textContent!, new RegExp(`${story.length} outside the current filters`));
await click(`Select all ${generic.length} results`);
assert.equal(document.querySelectorAll('.ql-chosen li').length, generic.length, 'select all replaces selection instead of keeping hidden quests');
await click('Clear selection');
for (let i = 0; i < 10; i++) await click('Select', cards()[i]);
assert.equal(button('Review and add to the game').disabled, false, 'ten eligible quests can be reviewed');
await click('Select', cards()[10]);
assert.equal(button('Review and add to the game').disabled, true, 'eleven can be selected for deletion, but cannot be released');

await click('Story quests'); await click(`Select all ${story.length} results`);
await click(`Delete selected (${story.length})`);
await click('Generic quests');
failDelete = true;
await click(`Move ${story.length} quests to Trash`);
assert.match(document.querySelector('.mission-error')!.textContent!, /No quests were moved/);
assert.ok(confirm(), 'failed deletion keeps the confirmation and selection');
assert.equal(quests.length, fixture.quests.length);
assert.equal(document.querySelectorAll('.ql-chosen li').length, story.length);
failDelete = false;
await click(`Move ${story.length} quests to Trash`);
assert.equal(deletions, 1);
assert.deepEqual(lastSelection.map(q => q.id), story.map(q => q.id), 'changing filters after confirmation does not change which quests are deleted');
assert.deepEqual(quests, generic, 'all generic quests survive');
assert.equal(confirm(), null); assert.equal(button('Delete selected (0)').disabled, true);
assert.match(document.querySelector('.mission-notice')!.textContent!, new RegExp(`${story.length} quests moved to Trash`));

await click(`Trash (${story.length})`);
assert.equal(document.querySelectorAll('.mission-trash-row').length, story.length);
await click('Restore quest', document.querySelector('.mission-trash-row')!);
assert.equal(trash.length, story.length - 1);
await click('Back to the library'); await click('Story quests');
assert.equal(cards().length, 1, 'a bulk-deleted quest can be restored normally');
await act(async () => root.unmount()); dom.window.close();
console.log('Side quest selection: whole-filter deletion, confirmation/cancel, failures, restore and release limits pass.');
process.exit(0);
