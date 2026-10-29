// Exercise the teacher workflow through rendered controls. Backend behavior has separate runtime tests.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { castanyada } from '../worker/tests/fixtures/season-1.mjs';
import type { AnswerFeedback, BoardView, QuestView } from '../shared/campaign';
import type { WarmupView } from '../shared/warmup';
import { missionEnvelope, missionId, missionJson, validateMission } from '../shared/missionSchema';
import type { MissionDraft } from '../shared/missionTypes';
import type { LiveMissionTarget } from '../shared/missionTypes';
import { missionOverview } from '../shared/missionOverview';
import { themes } from '../shared/themeCatalog';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/mission-studio' });
const g = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
Object.assign(g, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
dom.window.confirm = () => true;
let saved: MissionDraft = { campaign: structuredClone(castanyada), version: 1, publishedRevision: 'builtin', updated: 0 };
const writes: { op: string; body: Record<string, unknown> }[] = [];
const summary = () => ({ id: saved.campaign.id, title: saved.campaign.title, version: saved.version, publishedRevision: saved.publishedRevision, updated: 0, overview: missionOverview(saved.campaign) });
let liveTarget: LiveMissionTarget = { game: { id: 'live-game', name: 'Class 3A' }, campaign: { id: castanyada.id, title: castanyada.title, revision: 'builtin' }, chapter: { id: castanyada.chapters[0].id, title: castanyada.chapters[0].title, index: 0 }, version: 0, epoch: 'session-1', open: true, ended: false, objectiveIds: castanyada.chapters.flatMap(c => c.objectives.map(o => o.id)), additions: [] };
let liveReleased = 0; let livePreview = false;
let failSave = false;
g.fetch = async (url, init) => {
    const route = String(url); const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (route === '/api/teacher/login') return Response.json({ token: 'teacher-test' });
    // The maps on the server, as any page reads them: here, the starter maps.
    if (route === '/api/themes') return Response.json({ themes: Object.values(themes), trash: [], default: 'plaza', version: '1.plaza' });
    assert.equal((init?.headers as Record<string, string> | undefined)?.['x-teacher-session'], 'teacher-test');
    if (route.endsWith('/list')) return Response.json({ library: saved.deleted ? [] : [summary()], trash: saved.deleted ? [summary()] : [] });
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
    if (route.endsWith('/create')) {
        assert.ok(missionId(body.id), 'creation assigns a valid internal ID');
        saved = { campaign: { ...structuredClone(castanyada), id: body.id, title: 'New campaign' }, version: 1, publishedRevision: null, updated: 0 };
        return Response.json({ draft: saved, library: [summary()] });
    }
    if (route.endsWith('/save')) {
        if (failSave) return Response.json({ error: 'Could not save. Please try again.' }, { status: 500 });
        assert.deepEqual(validateMission(body.envelope, 'draft').errors, [], 'editor changes remain valid draft data');
        writes.push({ op: 'save', body }); assert.equal(body.version, saved.version); saved = { ...saved, campaign: body.envelope.campaign, version: saved.version + 1 };
    }
    else if (route.endsWith('/publish')) { writes.push({ op: 'publish', body }); assert.equal(body.version, saved.version); saved = { ...saved, version: saved.version + 1, publishedRevision: 'new-revision' }; }
    else if (route.endsWith('/delete') || route.endsWith('/restore')) { assert.equal(body.version, saved.version); saved = { ...saved, version: saved.version + 1, deleted: route.endsWith('/delete') }; writes.push({ op: saved.deleted ? 'delete' : 'restore', body }); }
    else throw new Error(`Unexpected request ${route}`);
    return Response.json({ draft: saved, library: saved.deleted ? [] : [summary()], trash: saved.deleted ? [summary()] : [] });
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
const workflow = async (label: string) => {
    const found = [...document.querySelectorAll<HTMLButtonElement>('.mission-workflow button')].find(b => b.querySelector('strong')?.textContent === label);
    assert.ok(found, `Workflow stage exists: ${label}`);
    await act(async () => { found.click(); });
};
const selectStep = async (text: string) => {
    const found = [...document.querySelectorAll<HTMLButtonElement>('.mission-step-list button')].find(b => b.querySelector('strong')?.textContent === text);
    assert.ok(found, `Step exists: ${text}`);
    await act(async () => { found.click(); });
};

await act(async () => { root.render(<MemoryRouter><MissionStudio /></MemoryRouter>); });
assert.ok(document.body.textContent?.includes('Teacher sign-in'));
assert.equal(document.body.textContent?.includes('Where is the blue box?'), false, 'editor hidden before sign-in');
await edit('Teacher password', 'test');
await act(async () => { document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
await edit('Your missions', castanyada.id);
assert.ok(document.querySelector('.mission-play-guide')?.textContent?.includes('section inside the student’s Journal'), 'the Studio explains where the board actually is');
assert.ok(document.querySelector('.mission-board-empty'), 'a chapter with no board quests has an explicit empty preview');
assert.ok(document.querySelector('.mission-story-map'), 'missions open on the visual story map');
assert.equal(document.querySelectorAll('.mission-chapter-strip button').length, castanyada.chapters.length);
assert.equal(document.querySelectorAll('.mission-story-task').length, castanyada.chapters[0].objectives.length, 'the map includes main and optional tasks');
const secondRole = castanyada.roles[1];
await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('.mission-role-filters button')].find(b => b.textContent?.endsWith(secondRole.name))!.click(); });
assert.equal(document.querySelectorAll('.mission-clue-card').length, 1, 'follow one role without hiding the story');
assert.ok(document.querySelector('.mission-clue-card')?.textContent?.includes(castanyada.chapters[0].roleClues?.[secondRole.id] ?? secondRole.clue));
assert.equal(document.querySelectorAll('.mission-story-task').length, castanyada.chapters[0].objectives.length);
await act(async () => { document.querySelectorAll<HTMLButtonElement>('.mission-story-task-open')[1].click(); });
assert.equal(field('What should students do?').value, castanyada.chapters[0].objectives[1].text, 'a map task opens the corresponding editor');
await act(async () => { document.querySelector<HTMLButtonElement>('.mission-step-panel .mission-connection-link button')!.click(); });
assert.equal(field('What should students do?').value, castanyada.chapters[0].objectives[0].text, 'a dependency link opens its actual prerequisite');
await click('+ Add step');
await workflow('Story map');
await act(async () => { document.querySelector<HTMLButtonElement>('.mission-story-task-open')!.click(); });
assert.equal(field('What should students do?').value, castanyada.chapters[0].objectives[0].text, 'map navigation closes a pending type picker, even for the same task');
await workflow('Story map'); await click('Edit this chapter');
assert.ok(document.querySelector<HTMLDetailsElement>('.mission-chapter-card > details')!.open, 'chapter shortcut unfolds story settings');
assert.equal(document.activeElement, field('Chapter title'));
assert.equal([...document.querySelectorAll('.mission-step-panel label > span')].filter(el => el.textContent === 'What should students do?').length, 1, 'only one step is edited at a time');
assert.equal(field('What should students do?').value, castanyada.chapters[0].objectives[0].text);
assert.equal(field('Your mission brief').closest('[hidden]')?.hasAttribute('hidden'), true, 'AI tools are outside the main editing flow');
assert.equal(document.querySelector('.mission-editor')?.textContent?.includes('ID:'), false, 'teachers do not need technical identifiers');
await workflow('Mission setup');
assert.equal(field('Mission title').value, castanyada.title);
await edit('Mission title', 'Teacher edited adventure');
assert.ok(document.body.textContent?.includes('Unsaved changes'));
await click('Save draft');
assert.equal(saved.campaign.title, 'Teacher edited adventure');
assert.equal(writes[0].op, 'save');
await workflow('Preview & publish');
assert.ok(document.querySelector('.mission-clue-timeline'), 'clue timing is shown as a role timeline');
const previewFirst = document.querySelector<HTMLButtonElement>('[aria-label="Complete preview step 1"]')!;
assert.ok(previewFirst);
assert.equal(document.querySelector('[aria-label="Complete preview step 2"]'), null, 'dependent preview tasks start locked');
await act(async () => { previewFirst.click(); });
assert.ok(document.querySelector('[aria-label="Complete preview step 2"]'), 'completing a task unlocks the next one');
await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Complete preview step 2"]')!.click(); });
await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Undo preview step 1"]')!.click(); });
assert.equal(document.querySelector('[aria-label="Undo preview step 2"]'), null, 'undo clears dependent completions');
assert.equal(document.querySelector('[aria-label="Complete preview step 2"]'), null, 'undo locks the dependent task again');
assert.equal(writes.length, 1, 'exploring the map and preview never writes a draft');
assert.equal(button('Publish for new games').disabled, false);
await click('Publish for new games');
assert.equal(writes[1].op, 'publish');
await workflow('Build steps');
await click('Remove step');
assert.ok(document.body.textContent?.includes('linked steps will no longer wait'), 'removal explains changed unlock rules');
assert.equal(document.querySelectorAll('.mission-step-list li').length, 7, 'removal waits for confirmation');
await click('Keep step');
await click('Remove step'); await click('Yes, remove step');
await selectStep('What time did the box get to the park?');
assert.equal(field('When does this step open?').value, 'start', 'removal cleans dependent links');
await click('Undo');
await selectStep('What time did the box get to the park?');
assert.equal(field('Complete this step first').value, 'where', 'undo restores the step and its links');
await click('+ Add step');
const chooseType = async (name: string) => {
    const found = [...document.querySelectorAll<HTMLButtonElement>('.mission-type-card')].find(b => b.querySelector('strong')?.textContent === name);
    assert.ok(found); await act(async () => { found.click(); });
};
await chooseType('Short answer');
await edit('What should students do?', 'Inspect the hotel desk.');
await edit('Accepted answers (one per line)', 'hotel\nfront desk');
await edit('Accepted answers (one per line)', 'hotel\nfront desk\n');
await act(async () => { field('Accepted answers (one per line)').dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })); });
assert.equal(field('Accepted answers (one per line)').value, 'hotel\nfront desk', 'trailing blank lines do not become invalid answers');
assert.equal(field('Complete this step first').value, 'keys', 'new main steps follow the last main step');
await click('Copy step');
assert.equal(document.querySelectorAll('.mission-step-list li').length, 9);
assert.equal(field('Accepted answers (one per line)').value, 'hotel\nfront desk', 'copy keeps the answers');
await click('↑ Move up');
assert.equal(field('What should students do?').value, 'Inspect the hotel desk.', 'moving keeps the selected step');
assert.equal(field('Complete this step first').value, 'keys', 'moving keeps explicit unlock rules');
await click('Remove step'); await click('Yes, remove step');
await click('Undo'); assert.equal(document.querySelectorAll('.mission-step-list li').length, 9);
await click('Remove step'); await click('Yes, remove step');
await selectStep('Inspect the hotel desk.'); await click('Remove step'); await click('Yes, remove step');
assert.equal(document.querySelectorAll('.mission-step-list li').length, 7);
await click('+ Add chapter');
await edit('Chapter title', 'A new lesson');
await chooseType('Written response'); await edit('What should students do?', 'Explain your conclusion in two sentences.');
await click('← Move chapter earlier');
assert.equal(field('Chapter title').value, 'A new lesson', 'chapter selection follows reorder');
await click('Remove chapter'); await click('Yes, remove chapter');
await click('Undo');
assert.equal(field('Chapter title').value, 'A new lesson', 'undo restores chapter and selection');
await click('Remove chapter'); await click('Yes, remove chapter');
await edit('Chapter to edit', '2');
await click('← Move chapter earlier');
const carryToggle = [...document.querySelectorAll('label')].find(el => el.textContent?.includes('Keep the previous chapter’s thief'))!.querySelector<HTMLInputElement>('input')!;
assert.equal(carryToggle.disabled, false, 'reordering a thief chapter still allows fixing its carry rule');
await click('Move chapter later →');
await edit('Chapter to edit', '0');
await workflow('Mission setup');
await click('+ Add role');
const newRole = [...document.querySelectorAll('details.mission-role')].at(-1)!;
await edit('Role name', 'Detective', newRole);
assert.ok(newRole.hasAttribute('open'), 'new role stays open while typing its name');
await act(async () => { newRole.querySelector<HTMLButtonElement>('button')!.click(); });
await click('Yes, remove role'); await click('Undo');
assert.equal(document.querySelectorAll('details.mission-role').length, 6);
await act(async () => { [...document.querySelectorAll('details.mission-role')].at(-1)!.querySelector<HTMLButtonElement>('button')!.click(); });
await click('Yes, remove role');
assert.equal(document.querySelectorAll('details.mission-role').length, 5);
assert.equal(writes.length, 2, 'reversible editing does not write until the teacher saves');
await click('AI help & files');
await edit('Your mission brief', 'Add a hotel interview for fast finishers');
await click('Build prompt');
assert.ok(field('Prompt to give your AI').value.includes('ONLY the new objectives'));
await edit('Chapter for AI & imports', '1');
assert.equal([...document.querySelectorAll('label > span')].some(el => el.textContent === 'Prompt to give your AI'), false, 'changing chapters clears an outdated prompt');
await edit('Chapter for AI & imports', '0');

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

await selectStep('Interview a witness and write three sentences.');
const socialEditor = document.querySelector('.mission-step-panel')!;
assert.ok(socialEditor);
await edit('Step type', 'exchange', socialEditor);
await edit('When does this step open?', 'all', socialEditor);
const timePrerequisite = [...socialEditor.querySelectorAll('label')].find(l => l.textContent?.includes('What time did the box get to the park?'))!.querySelector<HTMLInputElement>('input')!;
await act(async () => { timePrerequisite.click(); });
const releaseToggle = [...socialEditor.querySelectorAll('label')].find(l => l.textContent?.includes('Hide until I release it'))!.querySelector<HTMLInputElement>('input')!;
await act(async () => { releaseToggle.click(); });
const differentRoleToggle = [...socialEditor.querySelectorAll('label')].find(l => l.textContent?.includes('Assign a partner with a different role'))!.querySelector<HTMLInputElement>('input')!;
await act(async () => { differentRoleToggle.click(); });
await click('Save draft');
const authored = saved.campaign.chapters[0].objectives.find(o => o.id === 'hotel-interview')!;
assert.equal(authored.activity, 'exchange'); assert.equal(authored.board?.afterMain, true); assert.equal(authored.board?.teacherReleased, true);
assert.equal(authored.board?.differentRole, true);
assert.deepEqual(authored.requires, { mode: 'all', objectives: ['where', 'when'] });
await click('Add to a running game');
const livePanel = [...document.querySelectorAll('section')].find(s => s.querySelector('h2')?.textContent === 'Add quests to a running game')!;
const choice = [...livePanel.querySelectorAll('label')].find(l => l.textContent?.includes(authored.text))!.querySelector<HTMLInputElement>('input')!;
await act(async () => { choice.click(); });
assert.equal(liveReleased, 0);
await click('Review live release'); assert.equal(liveReleased, 0, 'review does not alter the game');
assert.ok(document.body.textContent?.includes('2 students can accept now'));
await workflow('Mission setup');
await edit('Mission title', 'Changed after review');
await click('Add to a running game');
assert.equal([...document.querySelectorAll('button')].some(b => b.textContent === 'Release reviewed quests'), false, 'unsaved edits invalidate the preview');
await click('Save draft'); await click('Review live release');
await click('Release reviewed quests'); assert.equal(liveReleased, 1);
assert.ok(document.body.textContent?.includes('Student progress is preserved'));
await click('Inspect released definition');
assert.ok(document.body.textContent?.includes('Saved from castanyada, draft version'));
await click('Withdraw unstarted quest');
assert.ok(liveTarget.additions[0].withdrawn);

await click('AI help & files');
await edit('Paste campaign JSON', JSON.stringify({ ...missionEnvelope(incoming), schemaVersion: 42 }));
await click('Preview pasted JSON');
assert.equal(button('Apply to draft').disabled, true, 'malformed import cannot be applied');
await click('Cancel import');
await workflow('Mission setup');
await edit('Mission title', '');
await workflow('Preview & publish');
assert.equal(button('Publish for new games').disabled, true, 'incomplete draft cannot publish');
await click('Go to fix');
assert.equal(document.activeElement, field('Mission title'), 'validation takes the teacher to the actual field');
await click('Save draft');
assert.equal(saved.campaign.title, '', 'incomplete draft remains saveable');
await workflow('Mission setup');
await edit('Mission title', 'Retry this draft'); failSave = true;
await click('Save draft');
assert.equal(field('Mission title').value, 'Retry this draft', 'failed save keeps local work');
assert.ok(document.body.textContent?.includes('Could not save. Please try again.'));
assert.ok(document.body.textContent?.includes('Unsaved changes'));
failSave = false; await click('Save draft');
await click('+ New mission'); await edit('New mission name', '¿Dónde están las luces?');
await click('Create mission');
assert.equal(field('Mission title').value, '¿Dónde están las luces?');
assert.equal(saved.campaign.title, '¿Dónde están las luces?', 'creation saves the friendly name');
assert.equal(document.querySelector('.mission-workflow button[aria-current] strong')?.textContent, 'Mission setup');
await workflow('Build steps'); await click('+ Add chapter');
const chapterSettings = document.querySelector<HTMLDetailsElement>('.mission-chapter-card > details')!;
await act(async () => { chapterSettings.open = false; });
await workflow('Preview & publish');
const openingIssue = [...document.querySelectorAll('.mission-issue-list li')].find(el => el.querySelector('strong')?.textContent?.includes('Opening story'))!;
await act(async () => { openingIssue.querySelector<HTMLButtonElement>('button')!.click(); });
assert.ok(document.querySelector<HTMLDetailsElement>('.mission-chapter-card > details')!.open, 'Go to fix unfolds chapter settings');
assert.equal(document.activeElement, field('Opening story · what do students see first?'));
await click('Delete mission');
assert.ok(document.querySelector('.mission-delete-confirm')?.textContent?.includes('Unsaved edits will be discarded'));
const writesBeforeDeletion = writes.length;
await click('Keep mission'); assert.equal(writes.length, writesBeforeDeletion, 'canceling deletion never writes');
await click('Delete mission'); await click('Move to Trash');
assert.equal(saved.deleted, true); assert.equal(document.querySelectorAll('.mission-library-tile').length, 0);
assert.ok(document.querySelector('.mission-trash-row'), 'deleted missions can be restored');
await click('Restore mission'); assert.equal(saved.deleted, false);
assert.equal(document.querySelectorAll('.mission-library-tile').length, 1);
await act(async () => { root.unmount(); });

// A branching story must preview its real rules, including optional clue rewards.
const { MissionPreview } = await import('../src/components/MissionEditor');
const previewRoot = createRoot(document.getElementById('root')!);
const branchingChapter = { ...castanyada.chapters[0], thieves: undefined, objectives: [
    { id: 'a', text: 'First lead', accept: ['a'] },
    { id: 'b', text: 'Second lead', accept: ['b'] },
    { id: 'either', text: 'Follow either lead', accept: ['c'], requires: { mode: 'any' as const, objectives: ['a', 'b'] } },
    { id: 'both', text: 'Compare both leads', accept: ['d'], requires: { mode: 'all' as const, objectives: ['a', 'b'] } },
    { id: 'board', text: 'Optional discovery', accept: ['e'], optional: true, board: { afterMain: true, minPlayers: 2 }, rewards: { [castanyada.roles[0].id]: 'The optional discovery clue.' } },
] };
await act(async () => { previewRoot.render(<MissionPreview campaign={castanyada} chapter={branchingChapter} />); });
const previewAction = (action: 'Complete' | 'Undo', step: number) => document.querySelector<HTMLButtonElement>(`[aria-label="${action} preview step ${step}"]`);
await act(async () => { previewAction('Complete', 1)!.click(); });
assert.ok(previewAction('Complete', 3), 'any prerequisite opens after one lead');
assert.equal(previewAction('Complete', 4), null, 'all prerequisites wait for both leads');
assert.equal(previewAction('Complete', 5)!.disabled, true, 'board quests respect the main-story gate');
for (const step of [2, 3, 4, 5]) await act(async () => { previewAction('Complete', step)!.click(); });
assert.ok(document.querySelector('.mission-preview-clues')!.textContent!.includes('The optional discovery clue.'), 'completing a board quest earns its private clue');
await act(async () => { previewAction('Undo', 1)!.click(); });
assert.ok(previewAction('Undo', 3), 'an any-rule completion remains when its other prerequisite is complete');
assert.equal(previewAction('Undo', 4), null, 'an all-rule completion is undone when a required lead is undone');
assert.equal(previewAction('Complete', 5)!.disabled, true, 'undoing the main story locks a dependent board quest');
assert.ok(!document.querySelector('.mission-preview-clues')!.textContent!.includes('The optional discovery clue.'), 'undo removes the board reward too');
await click('Reset preview');
assert.equal(previewAction('Undo', 2), null);
await act(async () => { previewRoot.unmount(); });

const { default: Journal } = await import('../src/components/Journal');
const journalRoot = createRoot(document.getElementById('root')!);
const accepted: string[] = []; const reports: string[] = [];
const undone: [string, number][] = [];
const turns: Record<string, unknown>[] = [];
const quest: QuestView = { campaign: { id: 'test', title: 'Test' }, status: 'active', chapter: { index: 0, of: 1, title: 'Investigation', intro: 'Find evidence.', ending: null },
    role: { id: 'baker', name: 'Baker', card: 'Ask a witness.' }, clues: [], secret: null, thieves: null, objectives: [], team: { done: 0, total: 0 }, recap: null, finale: null };
// The quest board comes on its own, as the server sends it: here, the mission's partner quest.
const board: BoardView = { board: [{ id: 'interview', text: 'Interview the witness.', kind: 'report', activity: 'interview', state: 'waiting', reason: 'Finish your main mystery first.', partner: null }],
    sideQuests: { state: 'empty', reason: 'Your teacher will add side quests soon.', waiting: 0 } };
const renderJournal = async (feedback: AnswerFeedback | null = null) => { await act(async () => { journalRoot.render(<Journal quest={structuredClone(quest)} board={structuredClone(board)} feedback={feedback} onTurn={turn => turns.push(turn)} onAnswer={(_id, text) => reports.push(text)} onUndoReport={(id, version) => undone.push([id, version])} onAccept={(id, change) => accepted.push(change ? `${id}-replace` : id)} />); }); };
await renderJournal();
assert.equal(button('Accept quest').disabled, true);
board.board[0].state = 'available'; board.board[0].reason = null;
await renderJournal(); await click('Accept quest'); assert.deepEqual(accepted, ['interview']);
board.board[0].state = 'active'; board.board[0].partner = { name: 'Sam', online: false };
await renderJournal(); await click('Find another partner'); assert.equal(accepted.at(-1), 'interview-replace');
const answerInput = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your report"]')!;
assert.equal(answerInput.maxLength, 1000);
const reportText = 'Sam saw a box at the hotel and explained the delivery record. I checked my own note and asked a follow-up question about the time.\nWe compared two possible plans and agreed to keep the exits clear, use battery lights and put the welcome table beside the hotel desk.';
assert.ok(reportText.length > 200);
await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(answerInput, reportText); answerInput.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
await act(async () => { document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
assert.deepEqual(reports, [reportText]);
quest.status = 'campaign_complete'; board.board[0].ended = true; await renderJournal();
assert.ok(!document.querySelector('form'), 'closed campaigns do not offer report submission');
quest.status = 'active'; delete board.board[0].ended;
quest.clues = [{ id: 'role-baker', from: 'job', text: 'No blue box came to the cafe.' }];
board.board[0].conversation = { required: 1, completed: 0, witnesses: [{ id: 'sam-socket', name: 'Sam' }] };
board.board[0].partner!.online = true;
await renderJournal();
await edit('Your report', 'My partner saw a delivery at the hotel.');
assert.equal(button('Send report').disabled, true, 'a report waits for verified participation');
await edit('Your question about this mystery', 'What did you see at the hotel?');
await click('Send');
assert.deepEqual(turns.at(-1), { t: 'interview-ask', objective: 'interview', witness: 'sam-socket', clue: 'role-baker', text: 'What did you see at the hotel?' });
board.board[0].conversation!.completed = 1;
await renderJournal(); assert.equal(button('Send report').disabled, false, 'an approved exchange unlocks the report');
quest.interviews = [{ id: 'incoming-1', objective: 'interview', task: 'Investigate the hotel delivery.', incoming: true, name: 'Chris', question: 'What did you see?', questionStatus: 'approved', answer: null, answerStatus: null, evidence: null, shared: 'The driver left a parcel at the hotel.' }];
await renderJournal();
assert.ok(document.body.textContent?.includes('The driver left a parcel at the hotel.'));
await edit('Your reply: explain what your evidence tells you', 'No blue box came to the cafe.');
await click('Send');
assert.deepEqual(turns.at(-1), { t: 'interview-reply', id: 'incoming-1', clue: 'role-baker', text: 'No blue box came to the cafe.' });
quest.interviews[0].answerStatus = 'pending'; await renderJournal();
assert.ok(!document.querySelector('textarea[maxlength="200"]'), 'a pending reply cannot be resubmitted');
board.board = []; quest.interviews = [];
quest.objectives = [{ id: 'place', text: 'Where is the box?', kind: 'text', optional: false, done: false }];
await renderJournal(); await edit('Your answer', 'hotel'); await click('Answer');
await renderJournal({ objective: 'place', correct: false, wait: false });
assert.equal(field('Your answer').value, 'hotel', 'a rejected answer remains available to edit');
assert.match(document.querySelector('.journal-wrong')!.textContent!, /answer was not accepted/);
assert.ok(!document.body.textContent?.includes('Not yet'));
assert.ok(!document.body.textContent?.includes('Ask your classmates'));
assert.equal(field('Your answer').getAttribute('aria-describedby'), document.querySelector('.journal-wrong')!.id);
await edit('Your answer', 'park'); assert.ok(!document.querySelector('.journal-wrong'), 'editing dismisses feedback about the previous answer');
await click('Answer'); await renderJournal({ objective: 'place', correct: false, wait: true, message: 'Please wait a few seconds before trying again.' });
assert.match(document.querySelector('.journal-wrong')!.textContent!, /wait a few seconds/);
assert.equal(field('Your answer').value, 'park', 'cooldowns also preserve the answer');
quest.objectives[0].done = true;
await renderJournal({ objective: 'place', correct: true, wait: false });
assert.ok(!document.querySelector('form')); assert.ok(document.body.textContent?.includes('Correct.'));

quest.objectives = [{ id: 'planner', text: 'Who is the planner?', kind: 'name', optional: false, done: false }];
await renderJournal(); await edit('Your answer', 'Baker'); await click('Answer');
const ownRoleMessage = 'You have this role, and no other student with it is online. Type the role name (Festival planner) to continue.';
await renderJournal({ objective: 'planner', correct: false, wait: false, message: ownRoleMessage });
assert.equal(document.querySelector('.journal-wrong')!.textContent, ownRoleMessage, 'show the server explanation for this student and question');
assert.equal(field('Your answer').value, 'Baker');
await renderJournal({ objective: 'planner', correct: false, wait: false });
assert.match(document.querySelector('.journal-wrong')!.textContent!, /name shown above their avatar/);

quest.objectives = [{ id: 'written', text: 'Explain your evidence.', kind: 'report', optional: false, done: false }];
await renderJournal(); await edit('Your report', 'Maybe'); await click('Send report');
await renderJournal({ objective: 'written', correct: false, wait: false });
assert.match(document.querySelector('.journal-wrong')!.textContent!, /at least 5 words/);
assert.equal(field('Your report').value, 'Maybe');
await renderJournal({ objective: 'written', correct: false, wait: true, message: 'Exchange evidence with 2 witnesses before submitting this conclusion.' });
assert.match(document.querySelector('.journal-wrong')!.textContent!, /2 witnesses/);
assert.ok(!document.querySelector('.journal-wrong')!.textContent!.includes('wait'), 'missing participation is not described as a timing problem');
const savedWriting = 'We checked the evidence and agreed on a safer plan.';
await edit('Your report', savedWriting); await click('Send report');
quest.objectives[0].done = true; quest.objectives[0].report = { text: savedWriting, version: 10, submitted: true };
await renderJournal(); await click('Undo submission');
assert.deepEqual(undone.at(-1), ['written', 10], 'individual writing sends the exact submission version to undo');
quest.objectives[0].done = false; quest.objectives[0].report.submitted = false;
await renderJournal();
assert.equal(field('Your report').value, savedWriting, 'undo preserves the individual report for further writing');
assert.equal(document.querySelector('.journal-wrong'), null, 'old answer feedback does not follow a reopened report');

// A teammate sees a report submitted by somebody else, then gets the shared writing back on undo.
quest.objectives = [];
board.board = [{ id: 'team-writing', text: 'Agree on a plan together.', kind: 'report', activity: null, state: 'active', reason: null, partner: null,
    sideQuest: true, group: { members: ['Alex', 'Sam'], size: 2, state: 'playing', startAt: null } }];
await renderJournal(); assert.equal(field('Your report').value, '');
board.board[0].state = 'done'; board.board[0].group!.state = 'done';
board.board[0].report = { text: savedWriting, version: 20, submitted: true };
await renderJournal(); assert.match(document.querySelector('.journal-undo-note')!.textContent!, /everyone in your group/);
assert.equal(document.querySelector('.journal-submitted-report')!.textContent, savedWriting);
await click('Undo submission'); assert.deepEqual(undone.at(-1), ['team-writing', 20]);
board.board[0].state = 'active'; board.board[0].group!.state = 'playing'; board.board[0].report!.submitted = false;
await renderJournal(); assert.equal(field('Your report').value, savedWriting, 'a teammate recovers the shared text even if their own box had been empty');
await edit('Your report', 'My unfinished addition to our group report.');
await renderJournal(); assert.equal(field('Your report').value, 'My unfinished addition to our group report.', 'ordinary updates preserve ongoing edits');
await click('Send report');
const latestSharedWriting = 'Sam revised our proposal after we compared the two plans.';
board.board[0].state = 'done'; board.board[0].report = { text: latestSharedWriting, version: 21, submitted: true };
await renderJournal(); await click('Undo submission');
board.board[0].state = 'active'; board.board[0].report!.submitted = false;
await renderJournal(); assert.equal(field('Your report').value, latestSharedWriting, 'reopening uses the latest shared report rather than an older local submission');
board.board[0].state = 'done'; board.board[0].report!.submitted = true; board.board[0].ended = true;
await renderJournal(); assert.equal([...document.querySelectorAll('button')].some(item => item.textContent?.trim() === 'Undo submission'), false, 'an ended mission cannot reopen reports');
await act(async () => { journalRoot.unmount(); });

const { default: Warmup } = await import('../src/components/Warmup');
const warmupRoot = createRoot(document.getElementById('root')!);
let warmup: WarmupView = { runId: 'round-1', kind: 'identity', fact: 'You are Elsa.', task: 'Find Sam’s secret identity.', step: 0, of: 1, team: { done: 0, total: 2 } };
const renderWarmup = (feedback: { correct: boolean; wait: boolean } | null = null) => act(async () => {
    warmupRoot.render(<Warmup warmup={warmup} feedback={feedback} onAnswer={text => reports.push(text)} />);
});
await renderWarmup(); await edit('Their name', 'Batman'); await click('Answer');
await renderWarmup({ correct: false, wait: false });
assert.match(document.querySelector('.warmup-wrong')!.textContent!, /identity was not accepted/);
assert.equal(field('Their name').value, 'Batman');
assert.ok(!document.body.textContent?.includes('Not yet'));
await edit('Their name', 'Mario'); assert.ok(!document.querySelector('.warmup-wrong'));
await click('Answer'); await renderWarmup({ correct: false, wait: true });
assert.match(document.querySelector('.warmup-wrong')!.textContent!, /wait a few seconds/);
warmup = { ...warmup, runId: 'round-2' }; await renderWarmup();
assert.equal(field('Their name').value, '', 'restarting a warm-up clears the previous round’s draft');
warmup = { ...warmup, kind: 'facts', task: 'Find someone who has a cat.' }; await renderWarmup();
await edit('Their name', 'Sam'); await click('Answer'); await renderWarmup({ correct: false, wait: false });
assert.match(document.querySelector('.warmup-wrong')!.textContent!, /name shown above their avatar/);
await act(async () => { warmupRoot.unmount(); });
dom.window.close();
console.log('Mission Studio UI: authoring, quest board controls, contextual answer feedback, editable rejected answers and warm-up retries pass.');
process.exit(0);
