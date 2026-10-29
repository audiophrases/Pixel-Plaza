import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { BoardView, ReportSubmission } from '../shared/campaign';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: Journal } = await import('../src/components/Journal');
const root = createRoot(document.getElementById('root')!);
const sent: [string, string][] = [], undone: [string, number][] = [];
const text = 'We choose the library because it is quiet.';
const render = async (report: ReportSubmission, done = false) => {
    const board: BoardView = { board: [{ id: 'writing', text: 'Choose a place and give two reasons.', kind: 'report', activity: null,
        state: done ? 'done' : 'active', reason: null, partner: null, report, sideQuest: true,
        group: { members: ['Alex', 'Sam'], size: 2, state: done ? 'done' : 'playing', startAt: null } }],
        sideQuests: { state: 'active', waiting: 0, reason: null } };
    await act(async () => root.render(<Journal quest={null} board={board} feedback={null}
        onAnswer={(id, answer) => sent.push([id, answer])} onUndoReport={(id, version) => undone.push([id, version])} />));
};
const clickUndo = async () => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Undo submission');
    assert.ok(button); await act(async () => button.click());
};
await render({ text, version: 1, submitted: true, check: { status: 'checking', feedback: 'Checking your answer…' } });
assert.match(document.body.textContent!, /Checking your answer/);
assert.equal(document.querySelector('form'), null, 'checking writing appears once and cannot be resubmitted');
assert.equal(document.querySelectorAll('.journal-submitted-report').length, 1);
await clickUndo(); assert.deepEqual(undone.pop(), ['writing', 1]);
await render({ text, version: 1, submitted: false, check: { status: 'checking', feedback: 'Checking your answer…' } });
assert.equal(document.querySelector('textarea')!.value, text, 'undo preserves writing');

await render({ text, version: 2, submitted: false, check: { status: 'revise', feedback: 'Add a second reason for your choice.' } });
assert.match(document.body.textContent!, /Add a second reason/);
assert.ok(document.querySelector('textarea'));
await act(async () => document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
assert.deepEqual(sent.pop(), ['writing', text]);
await render({ text, version: 3, submitted: true, check: { status: 'uncertain', feedback: 'Your teacher can check this evidence.' } });
assert.match(document.body.textContent!, /Your teacher can check/);
assert.equal(document.querySelector('.journal-wrong'), null, 'uncertainty is not shown as an incorrect answer');
assert.equal(document.querySelector('form'), null);
await clickUndo(); assert.deepEqual(undone.pop(), ['writing', 3]);

const teamText = 'We chose the library because it is quiet and has enough space.';
await render({ text: teamText, version: 4, submitted: true, check: { status: 'pass', feedback: 'Use “we were” when talking about the past.' } }, true);
assert.match(document.body.textContent!, /Quest complete/);
assert.match(document.body.textContent!, /Use “we were”/);
assert.equal(document.querySelector('.journal-submitted-report')!.textContent, teamText, 'all teammates receive the saved writing');
assert.equal(document.querySelector('textarea'), null);
await clickUndo(); assert.deepEqual(undone.pop(), ['writing', 4]);
await act(async () => root.unmount()); dom.window.close();
console.log('Report feedback UI: checking, revision, shared writing, undo, uncertainty and completion passed.');
process.exit(0);
