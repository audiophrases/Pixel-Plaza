// Exercise the teacher workflow through rendered controls. Backend behavior has separate runtime tests.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { castanyada } from '../shared/campaign';
import { missionEnvelope, missionJson } from '../shared/missionSchema';
import type { MissionDraft } from '../shared/missionTypes';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/mission-studio' });
const g = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
Object.assign(g, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
dom.window.confirm = () => true;
let saved: MissionDraft = { campaign: structuredClone(castanyada), version: 1, publishedRevision: 'builtin', updated: 0 };
const writes: { op: string; body: Record<string, unknown> }[] = [];
const summary = () => ({ id: saved.campaign.id, title: saved.campaign.title, version: saved.version, publishedRevision: saved.publishedRevision, updated: 0 });
g.fetch = async (url, init) => {
    const route = String(url); const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (route === '/api/teacher/login') return Response.json({ token: 'teacher-test' });
    assert.equal((init?.headers as Record<string, string> | undefined)?.['x-teacher-session'], 'teacher-test');
    if (route.endsWith('/list')) return Response.json({ library: [summary()] });
    if (route.includes('/get?')) return Response.json({ draft: saved });
    if (route.endsWith('/save')) { writes.push({ op: 'save', body }); assert.equal(body.version, saved.version); saved = { ...saved, campaign: body.envelope.campaign, version: saved.version + 1 }; }
    else if (route.endsWith('/publish')) { writes.push({ op: 'publish', body }); assert.equal(body.version, saved.version); saved = { ...saved, version: saved.version + 1, publishedRevision: 'new-revision' }; }
    else throw new Error(`Unexpected request ${route}`);
    return Response.json({ draft: saved, library: [summary()] });
};

const { createRoot } = await import('react-dom/client'); const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom'); const { default: MissionStudio } = await import('../src/pages/MissionStudio');
const root = createRoot(document.getElementById('root')!);
const button = (label: string) => {
    const found = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label);
    assert.ok(found, `Button exists: ${label}`); return found;
};
const field = (label: string) => {
    const found = [...document.querySelectorAll('label')].find(l => l.querySelector('span')?.textContent === label)?.querySelector('input,textarea,select');
    assert.ok(found, `Field exists: ${label}`); return found as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
};
const edit = async (label: string, value: string) => {
    const input = field(label);
    const proto = input.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : input.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value); input.dispatchEvent(new dom.window.Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
};
const click = async (label: string) => { await act(async () => { button(label).click(); }); };

await act(async () => { root.render(<MemoryRouter><MissionStudio /></MemoryRouter>); });
assert.ok(document.body.textContent?.includes('Teacher sign-in'));
assert.equal(document.body.textContent?.includes('Where is the blue box?'), false, 'editor hidden before sign-in');
await edit('Teacher password', 'test');
await act(async () => { document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
await act(async () => { document.querySelector<HTMLButtonElement>('.mission-library nav button')!.click(); });
assert.equal(field('Campaign title').value, castanyada.title);
assert.ok(document.querySelector('table'), 'clue timing table rendered');
assert.equal(button('Publish for new games').disabled, false);
await edit('Campaign title', 'Teacher edited adventure');
assert.ok(document.body.textContent?.includes('Unsaved changes'));
await click('Save draft');
assert.equal(saved.campaign.title, 'Teacher edited adventure');
assert.equal(writes[0].op, 'save');
await click('Publish for new games');
assert.equal(writes[1].op, 'publish');
await edit('Your mission brief', 'Add a hotel interview for fast finishers');
await click('Build prompt');
assert.ok(field('Prompt to give your AI').value.includes('ONLY the new objectives'));

const incoming = structuredClone(castanyada); incoming.chapters = [incoming.chapters[0]];
incoming.chapters[0].objectives = [{ id: 'hotel-interview', text: 'Interview a witness and write three sentences.', accept: [], kind: 'report', optional: true, after: 'where' }];
incoming.chapters[0].discoveries = []; incoming.chapters[0].reveals = [];
await edit('Paste campaign JSON', missionJson(incoming));
await click('Preview pasted JSON');
assert.ok(document.body.textContent?.includes('Extend The Missing Chestnuts'));
assert.equal(writes.length, 2, 'preview does not write server content');
await click('Apply to draft');
assert.ok(document.body.textContent?.includes('Interview a witness and write three sentences.'));
await click('Save draft');
assert.ok(saved.campaign.chapters[0].objectives.find(o => o.id === 'hotel-interview'));
assert.equal(saved.campaign.chapters.length, 3);

await edit('Paste campaign JSON', JSON.stringify({ ...missionEnvelope(incoming), schemaVersion: 42 }));
await click('Preview pasted JSON');
assert.equal(button('Apply to draft').disabled, true, 'malformed import cannot be applied');
await click('Cancel import');
await edit('Campaign title', '');
assert.equal(button('Publish for new games').disabled, true, 'incomplete draft cannot publish');
await click('Save draft');
assert.equal(saved.campaign.title, '', 'incomplete draft remains saveable');
await act(async () => { root.unmount(); });
dom.window.close();
console.log('Mission Studio UI: sign-in, editor, clue table, save/publish, AI prompt, reviewed chapter extension and invalid-input guards pass.');
process.exit(0);
