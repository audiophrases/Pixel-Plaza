import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { defaultWarmup, validateWarmup, type SavedWarmup } from '../shared/warmupConfig';
import type { WarmupKind } from '../shared/warmupKinds';

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
await act(async () => {
    const input = document.querySelector('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [{ size: 100, text: async () => JSON.stringify({ format: 'pixel-plaza-warmup', schemaVersion: 1, definition: imported }) }], configurable: true });
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
});
assert.equal(field('Title').value, 'Imported pairs'); assert.equal(saved.pairs.definition.title, 'Find your pair', 'import remains a draft until saved');
await click('Save warm-up'); assert.equal(saved.pairs.definition.title, 'Imported pairs');
await click('Use built-in content'); assert.equal(field('Title').value, 'Find your pair'); assert.equal(button('Save warm-up').disabled, false);
assert.equal(saved.pairs.definition.title, 'Imported pairs', 'restore needs an explicit save');
assert.equal(writes, 4);
await act(async () => root.unmount()); dom.window.close();
console.log('Warm-up editor UI: identities/aliases, facts/rounds, pairs, validation, conflicts, import/export, restore and save pass.');
process.exit(0);
