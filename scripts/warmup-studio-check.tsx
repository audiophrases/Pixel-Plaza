import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { defaultWarmup, validateWarmup, type SavedWarmup } from '../shared/warmupConfig';
import type { WarmupKind } from '../shared/warmupKinds';
import identityFile from '../worker/tests/fixtures/who-am-i-110.json';

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/warmup-studio' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
dom.window.confirm = () => true;
dom.window.HTMLAnchorElement.prototype.click = () => {};
let exported = 0;
URL.createObjectURL = () => { exported++; return 'blob:test'; }; URL.revokeObjectURL = () => {};
const saved = Object.fromEntries(['identity', 'facts', 'pairs'].map(kind => [kind, { definition: defaultWarmup(kind as WarmupKind), version: 0 }])) as Record<WarmupKind, SavedWarmup>;
let conflict = false, writes = 0;
globalThis.fetch = async (url, init) => {
    assert.ok(init);
    assert.equal((init.headers as Record<string, string>)['x-teacher-session'], 'teacher-token');
    if (String(url).startsWith('/api/teacher/activity-history')) return Response.json({ game: null, games: [], quests: {}, warmups: {}, tasks: {}, recent: [] });
    const kind = new URL(String(url), 'http://localhost').searchParams.get('kind') as WarmupKind;
    if (init?.method === 'POST') {
        if (conflict) return Response.json({ error: 'Changed in another tab.' }, { status: 409 });
        const body = JSON.parse(String(init.body)); assert.equal(body.version, saved[kind].version);
        const checked = validateWarmup(body.definition); assert.deepEqual(checked.errors, []); writes++;
        saved[kind] = { definition: checked.definition!, version: saved[kind].version + 1 };
    }
    return Response.json(saved[kind]);
};
const { storeTeacherSession } = await import('../src/teacherSession'); storeTeacherSession('teacher-token');
const { createRoot } = await import('react-dom/client'); const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom'); const { default: WarmupStudio } = await import('../src/pages/WarmupStudio');
const root = createRoot(document.getElementById('root')!);
await act(async () => { root.render(<MemoryRouter initialEntries={['/warmup-studio?kind=identity']}><WarmupStudio /></MemoryRouter>); });
const button = (label: string) => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === label); assert.ok(b, label); return b; };
const field = (label: string) => { const f = [...document.querySelectorAll('label')].find(l => l.querySelector('span')?.textContent === label)?.querySelector('input,textarea,select'); assert.ok(f, label); return f as HTMLInputElement; };
const edit = async (label: string, value: string) => act(async () => {
    const f = field(label), proto = f.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : f.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(f, value);
    f.dispatchEvent(new dom.window.Event(f.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
});
const click = (label: string) => act(async () => { button(label).click(); });
const envelope = (definition: unknown) => JSON.stringify({ format: 'pixel-plaza-warmup', schemaVersion: 1, definition });
const upload = (text: string, size = new TextEncoder().encode(text).length, failRead = false) => act(async () => {
    const input = document.querySelector('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [{ name: 'warmup.json', size, text: async () => {
        if (failRead) throw new Error('Could not read the file.'); return text;
    } }], configurable: true });
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
});
const backup = () => document.querySelector('section[aria-label="Backup and restore"]')!;
assert.equal(field('Title').value, 'Who am I?'); assert.equal(button('Save warm-up').disabled, true);
await edit('Title', 'Scientists'); await edit('Identity 1', 'Ada Lovelace');
await edit('Aliases 1 (comma separated)', 'Ada,');
assert.equal(field('Aliases 1 (comma separated)').value, 'Ada,', 'comma can be typed without being lost');
await edit('Aliases 1 (comma separated)', 'Ada, Countess of Lovelace');
await edit('Student instructions', 'Ask yes or no questions about scientists.'); await edit('Language level', 'B1');
await click('Save warm-up'); assert.equal(saved.identity.definition.title, 'Scientists');
assert.equal(saved.identity.definition.kind, 'identity');
if (saved.identity.definition.kind === 'identity') assert.ok(saved.identity.definition.identities[0].accept.includes('Countess of Lovelace'));
await edit('Title', 'Unsaved science'); conflict = true; await click('Save warm-up');
assert.ok(document.body.textContent?.includes('Changed in another tab.')); assert.equal(field('Title').value, 'Unsaved science');
await click('Export JSON'); assert.equal(exported, 1);
conflict = false; await click('Reload saved version'); assert.equal(field('Title').value, 'Scientists');
await edit('Warm-up type', 'facts');
await edit('Your fact 1', 'You have a parrot.'); await edit('Find someone who… 1', 'has a parrot');
await edit('Facts to find per student (up to)', '1'); await click('Save warm-up');
assert.equal(saved.facts.definition.kind, 'facts');
if (saved.facts.definition.kind === 'facts') { assert.equal(saved.facts.definition.facts[0].mine, 'You have a parrot.'); assert.equal(saved.facts.definition.rounds, 1); }
await edit('Warm-up type', 'pairs');
await edit('Matching word 1', field('First word 1').value); assert.equal(button('Save warm-up').disabled, true);
assert.ok(document.body.textContent?.includes('Each word must belong to exactly one pair'));
await edit('Matching word 1', 'vinegar'); await click('Save warm-up');
assert.equal(saved.pairs.definition.kind, 'pairs');
if (saved.pairs.definition.kind === 'pairs') assert.equal(saved.pairs.definition.pairs[0][1], 'vinegar');
const imported = defaultWarmup('pairs'); imported.title = 'Imported pairs';
await upload(envelope(imported));
assert.equal(field('Title').value, 'Find your pair', 'selecting a file only previews changes');
assert.ok(document.activeElement?.textContent?.includes('Import preview'));
await click('Apply import');
assert.equal(field('Title').value, 'Imported pairs'); assert.equal(saved.pairs.definition.title, 'Find your pair', 'import remains a draft until saved');
await click('Save warm-up'); assert.equal(saved.pairs.definition.title, 'Imported pairs');
await click('Use built-in content'); assert.equal(field('Title').value, 'Find your pair'); assert.equal(button('Save warm-up').disabled, false);
assert.equal(saved.pairs.definition.title, 'Imported pairs', 'restore needs an explicit save');
assert.equal(writes, 4);

await edit('Warm-up type', 'identity'); await click('Use built-in content');
await edit('Title', 'Keep this title');
await upload(JSON.stringify(identityFile));
assert.ok(backup().textContent?.includes('110 imported entries'));
assert.equal(field('Title').value, 'Keep this title');
await edit('Import action', 'append');
assert.ok(backup().textContent?.includes('Add 77 new identities; skip 33 duplicates; 110 identities in total'));
await click('Apply import');
assert.equal(field('Title').value, 'Keep this title');
assert.ok(document.body.textContent?.includes('Secret identities (110)'));
assert.ok(backup().contains(document.activeElement), 'success feedback receives focus beside the upload control');
assert.ok(document.activeElement?.textContent?.includes('Added 77 identities'));
assert.equal(writes, 4, 'applying an import does not save');
await click('Save warm-up'); await click('Reload saved version');
assert.equal(saved.identity.definition.kind, 'identity');
if (saved.identity.definition.kind === 'identity') assert.equal(saved.identity.definition.identities.length, 110);
assert.ok(document.body.textContent?.includes('Secret identities (110)'));

await upload(JSON.stringify(identityFile)); await edit('Import action', 'append');
assert.ok(backup().textContent?.includes('Add 0 new identities; skip 110 duplicates'));
await click('Cancel import'); assert.ok(!backup().textContent?.includes('Import preview'));

const largeCollection = { ...identityFile.definition, identities: Array.from({ length: 201 }, (_, i) => ({ id: `person-${i}`, name: `Person ${i.toString(36).split('').join(' ')}`, accept: [] })) };
for (const [text, size, failRead] of [
    ['{', undefined, false], ['{}', undefined, false], [envelope(defaultWarmup('facts')), undefined, false],
    [envelope({ ...identityFile.definition, identities: [] }), undefined, false], [JSON.stringify(identityFile), 64_001, false], [JSON.stringify(identityFile), undefined, true],
] as [string, number | undefined, boolean][]) {
    await upload(text, size, failRead);
    const alert = backup().querySelector('[role="alert"]'); assert.ok(alert);
    assert.equal(document.activeElement, alert, 'each import failure focuses the error beside Import JSON');
    assert.equal(field('Title').value, 'Keep this title');
    assert.ok(document.body.textContent?.includes('Secret identities (110)'));
    assert.ok(!backup().textContent?.includes('Import preview'), 'failed files cannot leave an old import ready to apply');
}

const conflictFile = structuredClone(identityFile);
conflictFile.definition.identities[0] = { id: 'messi', name: 'Someone Else', accept: [] };
conflictFile.definition.identities = conflictFile.definition.identities.slice(0, 2);
await upload(JSON.stringify(conflictFile)); await edit('Import action', 'append');
assert.ok(backup().querySelector('[role="alert"]')?.textContent?.includes('same ID as'));
assert.equal(button('Apply import').disabled, true); assert.equal(field('Title').value, 'Keep this title');
await click('Cancel import');

await upload(JSON.stringify(identityFile)); await click('Apply import');
assert.equal(field('Title').value, 'Who am I?', 'replace uses the imported metadata');
assert.ok(document.activeElement?.textContent?.includes('Imported 110 entries'));
await click('Save warm-up'); await click('Reload saved version');
assert.equal(field('Title').value, 'Who am I?'); assert.ok(document.body.textContent?.includes('Secret identities (110)'));

await upload(envelope(largeCollection)); await click('Apply import');
await click('Save warm-up'); await click('Reload saved version');
assert.ok(document.body.textContent?.includes('Secret identities (201)'), 'collections above 200 can be imported and saved');
assert.equal(button('Add identity').disabled, false, 'manual additions have no count ceiling');
await click('Add identity'); await edit('Identity 202', 'Extra Person');
await click('Save warm-up'); await click('Reload saved version');
assert.ok(document.body.textContent?.includes('Secret identities (202)'));
await upload(JSON.stringify(identityFile)); await edit('Title', 'Edit after preview');
assert.ok(!backup().textContent?.includes('Import preview'), 'editing a draft cancels a stale import preview');
assert.equal(writes, 8);
await act(async () => root.unmount()); dom.window.close();
console.log('Warm-up editor UI: 110-identity replace/append, duplicates, limits, focused errors, save/reload, all three modes and conflicts pass.');
process.exit(0);
