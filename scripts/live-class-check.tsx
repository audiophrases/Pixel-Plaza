import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

// The teacher's live view: one queue of what waits, oldest first, with one-click answers, and the class as faces
// that put whoever needs the teacher first.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/teacher' });
const global = globalThis as any;
Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

const { createRoot } = await import('react-dom/client');
const { act, useState } = await import('react');
const { default: LiveClass } = await import('../src/components/LiveClass');
const root = createRoot(document.getElementById('root')!);
const actions: { path: string; body: any }[] = [];
const now = Date.now();
const entry = (id: string, studentKey: string, sender: string, text: string, status: string, ago: number, extra = {}) =>
  ({ id, studentKey, sender, target: null, flag: null, note: null, text, timestamp: now - ago, status, ...extra });
const help = { id: 'help-ana', studentKey: 'ana', name: 'Ana', topic: 'writing' as const, kind: 'requested' as const, status: 'open' as const,
  note: 'No entiendo qué tengo que hacer.', timestamp: now - 300_000, updated: now - 300_000, evidence: [] };
let props: any = {
  gameId: 'game-a', alerts: [help], muted: ['cleo'], mode: 'approve', moderation: true, open: true,
  entries: [
    entry('c2', 'ben', 'Ben', 'Hello everyone!', 'pending', 30_000, { everyone: true }),
    entry('c1', 'cleo', 'Cleo', 'Psst, Ben', 'pending', 120_000, { target: 'Ben' }),
    entry('c0', 'ben', 'Ben', 'Where is the cellar?', 'approved', 600_000),
  ],
  online: [{ studentKey: 'ben', name: 'Ben', zone: 'cafe', level: 2 }, { studentKey: 'cleo', name: 'Cleo', zone: null }, { studentKey: 'ana', name: 'Ana', zone: 'park' }],
  known: [],
  who: (_key: string, name: string) => name,
  action: async (path: string, body: object) => { actions.push({ path, body }); return true; },
};
let selected: string | null = null; // the student open in the panel
function Harness() {
  const [chosen, setChosen] = useState<string | null>(null);
  selected = chosen;
  return <LiveClass {...props} selected={chosen} onSelect={setChosen} />;
}
const render = () => act(async () => { root.render(<Harness />); });
const items = () => [...document.querySelectorAll('.live-todo > li')];
const press = (element: Element | null | undefined) => act(async () => { assert.ok(element, 'the control exists'); (element as HTMLElement).click(); });
async function type(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

try {
  await render();
  // One queue, oldest first: the help request (5 minutes), then Cleo's whisper, then Ben's message for everyone.
  assert.deepEqual(items().map(item => item.querySelector('.live-person strong')?.textContent), ['Ana', 'Cleo', 'Ben']);
  assert.match(items()[0].textContent!, /asks for help.*5m.*No entiendo/);
  assert.match(items()[1].textContent!, /→ 🔒 Ben/);
  assert.match(items()[2].textContent!, /→ 📢 everyone/);
  assert.equal(document.querySelector('.live-count')?.textContent, '3');
  assert.ok(items()[1].classList.contains('live-first') === false && items()[0].classList.contains('live-help'));

  await press(items()[1].querySelector('[aria-label="Approve"]'));
  assert.deepEqual(actions.at(-1), { path: 'review', body: { id: 'c1', approve: true } });
  await press(items()[2].querySelector('[aria-label="Reject"]'));
  assert.deepEqual(actions.at(-1), { path: 'review', body: { id: 'c2', approve: false } });
  await press([...document.querySelectorAll('button')].find(button => button.textContent?.startsWith('✓ Approve all')));
  assert.deepEqual(actions.at(-1), { path: 'approve-all', body: {} });

  // Answering a help request in place sends it privately, and counts as helping.
  await type(items()[0].querySelector('input')!, 'Tell me your idea in Catalan.');
  await act(async () => items()[0].querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.deepEqual(actions.slice(-2), [
    { path: 'help-message', body: { studentKey: 'ana', text: 'Tell me your idea in Catalan.', gameId: 'game-a' } },
    { path: 'help-status', body: { id: 'help-ana', status: 'acknowledged', gameId: 'game-a' } },
  ]);
  assert.equal(items()[0].querySelector('input')!.value, '', 'sent: the box empties');
  await press(items()[0].querySelector('[aria-label="Done"]'));
  assert.deepEqual(actions.at(-1), { path: 'help-status', body: { id: 'help-ana', status: 'resolved', gameId: 'game-a' } });

  // Too much to approve: one click posts first and reviews after.
  await press([...document.querySelectorAll('.live-mode button')].find(button => button.textContent?.includes('Post, then review')));
  assert.deepEqual(actions.at(-1), { path: 'mode', body: { mode: 'review' } });

  // What already posted: a star and a take-down, one line each.
  const line = document.querySelector('.live-recent .live-line-approved')!;
  assert.match(line.textContent!, /Ben.*Where is the cellar\?/);
  await press(line.querySelector('button[title^="Give"]'));
  assert.deepEqual(actions.at(-1), { path: 'xp', body: { chatId: 'c0' } });
  await press(line.querySelector('button[title^="Take it down"]'));
  assert.deepEqual(actions.at(-1), { path: 'review', body: { id: 'c0', approve: false } });

  // The class as faces: Ana, who asked for help, first; counts of what waits; who is muted.
  const tiles = () => [...document.querySelectorAll('.live-tile')];
  assert.deepEqual(tiles().map(tile => tile.querySelector('.live-tile-name')?.textContent), ['Ana', 'Ben', 'Cleo']);
  assert.ok(tiles()[0].classList.contains('live-tile-help'));
  assert.equal(tiles()[1].querySelector('.live-tile-count')?.textContent, '1');
  assert.ok(tiles()[2].querySelector('.live-tile-muted'));

  // A face opens that student: what they wrote, a private message, and the spells.
  await press(tiles()[1]);
  assert.match(document.querySelector('.live-student')!.textContent!, /Ben.*cafe · Lv 2.*Hello everyone!/);
  await press([...document.querySelectorAll('.live-spells button')].find(button => button.textContent?.includes('Freeze')));
  assert.deepEqual(actions.at(-1), { path: 'magic', body: { power: 'freeze', studentKey: 'ben' } });
  await press([...document.querySelectorAll('.live-spells button')].find(button => button.textContent?.includes('Mute')));
  assert.deepEqual(actions.at(-1), { path: 'mute', body: { studentKey: 'ben', muted: true } });
  await press(items()[2].querySelector('.live-person'));
  assert.equal(selected, 'ben', 'a name in the queue opens that student');

  // Nothing waiting.
  props = { ...props, entries: [], alerts: [] };
  await render();
  assert.equal(document.querySelector('.live-clear')?.textContent, '✓ All caught up');
  console.log('Live class UI checks pass: one queue oldest first, approve and reject in a click, replies that count as helping, the moderation switch, stars and take-downs, faces in order of need, and a student panel with spells.');
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
process.exit(0);
