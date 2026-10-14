// Exercise the teacher workflow through rendered controls. Backend behavior has separate runtime tests.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { castanyada } from '../shared/campaign';
import type { QuestView } from '../shared/campaign';
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
const field = (label: string, scope: ParentNode = document) => {
    const found = [...scope.querySelectorAll('label')].find(l => l.querySelector('span')?.textContent === label)?.querySelector('input,textarea,select');
    assert.ok(found, `Field exists: ${label}`); return found as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
};
const edit = async (label: string, value: string, scope: ParentNode = document) => {
    const input = field(label, scope);
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

const socialEditor = [...document.querySelectorAll('fieldset')].find(f => f.querySelector('small')?.textContent === 'ID: hotel-interview')!;
assert.ok(socialEditor);
await edit('Answer mode', 'exchange', socialEditor);
await edit('Unlock rule', 'all', socialEditor);
const timePrerequisite = [...socialEditor.querySelectorAll('label')].find(l => l.textContent?.includes('What time did the box get to the park?'))!.querySelector<HTMLInputElement>('input')!;
await act(async () => { timePrerequisite.click(); });
const releaseToggle = [...socialEditor.querySelectorAll('label')].find(l => l.textContent?.includes('Hide until the teacher releases it'))!.querySelector<HTMLInputElement>('input')!;
await act(async () => { releaseToggle.click(); });
await click('Save draft');
const authored = saved.campaign.chapters[0].objectives.find(o => o.id === 'hotel-interview')!;
assert.equal(authored.activity, 'exchange'); assert.equal(authored.board?.afterMain, true); assert.equal(authored.board?.teacherReleased, true);
assert.deepEqual(authored.requires, { mode: 'all', objectives: ['where', 'when'] });

await edit('Paste campaign JSON', JSON.stringify({ ...missionEnvelope(incoming), schemaVersion: 42 }));
await click('Preview pasted JSON');
assert.equal(button('Apply to draft').disabled, true, 'malformed import cannot be applied');
await click('Cancel import');
await edit('Campaign title', '');
assert.equal(button('Publish for new games').disabled, true, 'incomplete draft cannot publish');
await click('Save draft');
assert.equal(saved.campaign.title, '', 'incomplete draft remains saveable');
await act(async () => { root.unmount(); });

const { default: Journal } = await import('../src/components/Journal');
const journalRoot = createRoot(document.getElementById('root')!);
const accepted: string[] = []; const reports: string[] = [];
const quest: QuestView = { campaign: { id: 'test', title: 'Test' }, status: 'active', chapter: { index: 0, of: 1, title: 'Investigation', intro: 'Find evidence.', ending: null },
    role: { id: 'baker', name: 'Baker', card: 'Ask a witness.' }, clues: [], secret: null, thieves: null, objectives: [], team: { done: 0, total: 0 }, recap: null, finale: null,
    board: [{ id: 'interview', text: 'Interview the witness.', kind: 'report', activity: 'interview', state: 'waiting', reason: 'Finish your main mystery first.', partner: null }] };
const renderJournal = async () => { await act(async () => { journalRoot.render(<Journal quest={structuredClone(quest)} feedback={null} onAnswer={(_id, text) => reports.push(text)} onAccept={(id, change) => accepted.push(change ? `${id}-replace` : id)} />); }); };
await renderJournal();
assert.equal(button('Accept quest').disabled, true);
quest.board![0].state = 'available'; quest.board![0].reason = null;
await renderJournal(); await click('Accept quest'); assert.deepEqual(accepted, ['interview']);
quest.board![0].state = 'active'; quest.board![0].partner = { name: 'Sam', online: false };
await renderJournal(); await click('Find another partner'); assert.equal(accepted.at(-1), 'interview-replace');
const answerInput = document.querySelector<HTMLInputElement>('input[aria-label="Your answer"]')!;
await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(answerInput, 'Sam saw a box at the hotel.'); answerInput.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
await act(async () => { document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
assert.deepEqual(reports, ['Sam saw a box at the hotel.']);
quest.status = 'campaign_complete'; await renderJournal();
assert.ok(!document.querySelector('form'), 'closed campaigns do not offer report submission');
await act(async () => { journalRoot.unmount(); });
dom.window.close();
console.log('Mission Studio UI: authoring, all/any links, social quest settings, imports and student quest board controls pass.');
process.exit(0);
