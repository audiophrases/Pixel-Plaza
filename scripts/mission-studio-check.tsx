// Exercise the teacher workflow through rendered controls. Backend behavior has separate runtime tests.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { castanyada } from '../shared/campaign';
import type { QuestView } from '../shared/campaign';
import { missionEnvelope, missionJson } from '../shared/missionSchema';
import type { MissionDraft } from '../shared/missionTypes';
import type { LiveMissionTarget } from '../shared/missionTypes';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/mission-studio' });
const g = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
Object.assign(g, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
dom.window.confirm = () => true;
let saved: MissionDraft = { campaign: structuredClone(castanyada), version: 1, publishedRevision: 'builtin', updated: 0 };
const writes: { op: string; body: Record<string, unknown> }[] = [];
const summary = () => ({ id: saved.campaign.id, title: saved.campaign.title, version: saved.version, publishedRevision: saved.publishedRevision, updated: 0 });
let liveTarget: LiveMissionTarget = { game: { id: 'live-game', name: 'Class 3A' }, campaign: { id: castanyada.id, title: castanyada.title, revision: 'builtin' }, chapter: { id: castanyada.chapters[0].id, title: castanyada.chapters[0].title, index: 0 }, version: 0, epoch: 'session-1', open: true, ended: false, objectiveIds: castanyada.chapters.flatMap(c => c.objectives.map(o => o.id)), additions: [] };
let liveReleased = 0; let livePreview = false;
g.fetch = async (url, init) => {
    const route = String(url); const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (route === '/api/teacher/login') return Response.json({ token: 'teacher-test' });
    assert.equal((init?.headers as Record<string, string> | undefined)?.['x-teacher-session'], 'teacher-test');
    if (route.endsWith('/list')) return Response.json({ library: [summary()] });
    if (route.endsWith('/live')) return Response.json({ target: liveTarget });
    if (route.endsWith('/live-cancel')) return Response.json({ target: liveTarget });
    if (route.endsWith('/live-preview')) {
        livePreview = true;
        assert.equal(body.sourceVersion, saved.version); assert.equal(body.targetEpoch, liveTarget.epoch);
        const definition = saved.campaign.chapters[0].objectives.find(o => o.id === body.objectiveIds[0])!;
        return Response.json({ target: liveTarget, preview: { id: 'preview-1', game: liveTarget.game, chapter: liveTarget.chapter, expires: Date.now() + 600000, quests: [{ id: definition.id, text: definition.text, activity: definition.activity, audience: 'All roles', eligibleNow: 2, definition }] } });
    }
    if (route.endsWith('/live-release')) {
        assert.ok(livePreview); assert.equal(body.previewId, 'preview-1'); liveReleased++;
        const definition = saved.campaign.chapters[0].objectives.find(o => o.id === 'hotel-interview')!;
        liveTarget = { ...liveTarget, version: liveTarget.version + 1, objectiveIds: [...liveTarget.objectiveIds, definition.id], additions: [{ id: definition.id, text: definition.text, withdrawn: false, started: false }] };
        return Response.json({ target: liveTarget, released: [definition.id] });
    }
    if (route.endsWith('/live-withdraw')) {
        liveTarget = { ...liveTarget, version: liveTarget.version + 1, additions: liveTarget.additions.map(a => ({ ...a, withdrawn: true })) };
        return Response.json({ target: liveTarget, withdrawn: body.objectiveId });
    }
    if (route.includes('/live-inspect?')) {
        return Response.json({ target: liveTarget, inspection: { id: 'hotel-interview', definition: saved.campaign.chapters[0].objectives.find(o => o.id === 'hotel-interview'), sourceId: saved.campaign.id, sourceVersion: saved.version, created: Date.now(), withdrawn: false } });
    }
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
    const found = [...scope.querySelectorAll('label')].find(l => l.querySelector('span')?.textContent === label)?.querySelector('input,textarea,select')
        ?? [...scope.querySelectorAll('input,textarea,select')].find(input => input.getAttribute('aria-label') === label || input.closest('label')?.firstChild?.textContent?.trim() === label);
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
const differentRoleToggle = [...socialEditor.querySelectorAll('label')].find(l => l.textContent?.includes('Assign a partner with a different role'))!.querySelector<HTMLInputElement>('input')!;
await act(async () => { differentRoleToggle.click(); });
await click('Save draft');
const authored = saved.campaign.chapters[0].objectives.find(o => o.id === 'hotel-interview')!;
assert.equal(authored.activity, 'exchange'); assert.equal(authored.board?.afterMain, true); assert.equal(authored.board?.teacherReleased, true);
assert.equal(authored.board?.differentRole, true);
assert.deepEqual(authored.requires, { mode: 'all', objectives: ['where', 'when'] });
const livePanel = [...document.querySelectorAll('section')].find(s => s.querySelector('h2')?.textContent === 'Add quests to a running game')!;
const choice = [...livePanel.querySelectorAll('label')].find(l => l.textContent?.includes(authored.text))!.querySelector<HTMLInputElement>('input')!;
await act(async () => { choice.click(); });
assert.equal(liveReleased, 0);
await click('Review live release'); assert.equal(liveReleased, 0, 'review does not alter the game');
assert.ok(document.body.textContent?.includes('2 students can accept now'));
await edit('Campaign title', 'Changed after review');
assert.equal([...document.querySelectorAll('button')].some(b => b.textContent === 'Release reviewed quests'), false, 'unsaved edits invalidate the preview');
await click('Save draft'); await click('Review live release');
await click('Release reviewed quests'); assert.equal(liveReleased, 1);
assert.ok(document.body.textContent?.includes('Student progress is preserved'));
await click('Inspect released definition');
assert.ok(document.body.textContent?.includes('Saved from castanyada, draft version'));
await click('Withdraw unstarted quest');
assert.ok(liveTarget.additions[0].withdrawn);

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
const turns: Record<string, unknown>[] = [];
const quest: QuestView = { campaign: { id: 'test', title: 'Test' }, status: 'active', chapter: { index: 0, of: 1, title: 'Investigation', intro: 'Find evidence.', ending: null },
    role: { id: 'baker', name: 'Baker', card: 'Ask a witness.' }, clues: [], secret: null, thieves: null, objectives: [], team: { done: 0, total: 0 }, recap: null, finale: null,
    board: [{ id: 'interview', text: 'Interview the witness.', kind: 'report', activity: 'interview', state: 'waiting', reason: 'Finish your main mystery first.', partner: null }] };
const renderJournal = async () => { await act(async () => { journalRoot.render(<Journal quest={structuredClone(quest)} feedback={null} onTurn={turn => turns.push(turn)} onAnswer={(_id, text) => reports.push(text)} onAccept={(id, change) => accepted.push(change ? `${id}-replace` : id)} />); }); };
await renderJournal();
assert.equal(button('Accept quest').disabled, true);
quest.board![0].state = 'available'; quest.board![0].reason = null;
await renderJournal(); await click('Accept quest'); assert.deepEqual(accepted, ['interview']);
quest.board![0].state = 'active'; quest.board![0].partner = { name: 'Sam', online: false };
await renderJournal(); await click('Find another partner'); assert.equal(accepted.at(-1), 'interview-replace');
const answerInput = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your report"]')!;
assert.equal(answerInput.maxLength, 1000);
const reportText = 'Sam saw a box at the hotel and explained the delivery record. I checked my own note and asked a follow-up question about the time.\nWe compared two possible plans and agreed to keep the exits clear, use battery lights and put the welcome table beside the hotel desk.';
assert.ok(reportText.length > 200);
await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(answerInput, reportText); answerInput.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
await act(async () => { document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
assert.deepEqual(reports, [reportText]);
quest.status = 'campaign_complete'; await renderJournal();
assert.ok(!document.querySelector('form'), 'closed campaigns do not offer report submission');
quest.status = 'active';
quest.clues = [{ id: 'role-baker', from: 'job', text: 'No blue box came to the cafe.' }];
quest.board![0].conversation = { required: 1, completed: 0, witnesses: [{ id: 'sam-socket', name: 'Sam' }] };
quest.board![0].partner!.online = true;
await renderJournal();
await edit('Your report', 'My partner saw a delivery at the hotel.');
assert.equal(button('Send report').disabled, true, 'a report waits for verified participation');
await edit('Your question about this mystery', 'What did you see at the hotel?');
await click('Send for teacher approval');
assert.deepEqual(turns.at(-1), { t: 'interview-ask', objective: 'interview', witness: 'sam-socket', clue: 'role-baker', text: 'What did you see at the hotel?' });
quest.board![0].conversation!.completed = 1;
await renderJournal(); assert.equal(button('Send report').disabled, false, 'an approved exchange unlocks the report');
quest.interviews = [{ id: 'incoming-1', objective: 'interview', task: 'Investigate the hotel delivery.', incoming: true, name: 'Chris', question: 'What did you see?', questionStatus: 'approved', answer: null, answerStatus: null, evidence: null, shared: 'The driver left a parcel at the hotel.' }];
await renderJournal();
assert.ok(document.body.textContent?.includes('The driver left a parcel at the hotel.'));
await edit('Your reply: explain what your evidence tells you', 'No blue box came to the cafe.');
await click('Send for teacher approval');
assert.deepEqual(turns.at(-1), { t: 'interview-reply', id: 'incoming-1', clue: 'role-baker', text: 'No blue box came to the cafe.' });
quest.interviews[0].answerStatus = 'pending'; await renderJournal();
assert.ok(!document.querySelector('textarea[maxlength="200"]'), 'a pending reply cannot be resubmitted');
await act(async () => { journalRoot.unmount(); });
dom.window.close();
console.log('Mission Studio UI: authoring, imports, reviewed live release, inspection, withdrawal and student quest board controls pass.');
process.exit(0);
