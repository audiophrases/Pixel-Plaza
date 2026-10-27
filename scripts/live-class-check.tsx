import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

// The teacher's live view: Needs you, most urgent first (harm, a student asking, messages waiting oldest first, a
// student who may be stuck), one line each with its quickest answer and the rest a click away; and the class as
// faces that put whoever needs the teacher first.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/teacher' });
const global = globalThis as any;
Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

const { createRoot } = await import('react-dom/client');
const { act, useState } = await import('react');
const { default: LiveClass } = await import('../src/components/LiveClass');
const { correctionText } = await import('../shared/diff');
const root = createRoot(document.getElementById('root')!);
const actions: { path: string; body: any }[] = [];
const now = Date.now();
const entry = (id: string, studentKey: string, sender: string, text: string, status: string, ago: number, extra = {}) =>
  ({ id, studentKey, sender, target: null, flag: null, note: null, text, timestamp: now - ago, status, ...extra });
const help = { id: 'help-ana', studentKey: 'ana', name: 'Ana', topic: 'writing' as const, kind: 'requested' as const, status: 'open' as const,
  note: 'No entiendo qué tengo que hacer.', timestamp: now - 300_000, updated: now - 300_000, evidence: [] };
// Ben's answer was refused twice: nothing the game could correct, so it waits for the teacher's fix.
const stuck = { id: 'help-ben', studentKey: 'ben', name: 'Ben', topic: 'writing' as const, kind: 'suggested' as const, status: 'open' as const,
  note: 'Repeated incorrect answers', timestamp: now - 60_000, updated: now - 60_000,
  evidence: [{ reason: 'Answer not accepted: What is in the basket?', text: 'There is chesnuts in the basket', timestamp: now - 70_000, count: 2 }] };
const incident = { id: 'harm-cleo', studentKey: 'cleo', name: 'Cleo', harm: 'threat' as const, texts: ['I will find you after school'], count: 2, firstTs: now - 200_000, lastTs: now - 100_000 };
let props: any = {
  gameId: 'game-a', alerts: [help, stuck], incidents: [incident], muted: ['cleo'], open: true,
  // Ana's device read Ben's message twice, a moment ago, and Cleo once; Ben's read Cleo's ten minutes ago. Cleo's sound is off.
  sound: { off: ['cleo'], now, plays: [
    { at: now - 3_000, studentKey: 'ana', id: 'c5', senderKey: 'ben', text: 'I love you!!' },
    { at: now - 5_000, studentKey: 'ana', id: 'c5', senderKey: 'ben', text: 'I love you!!' },
    { at: now - 20_000, studentKey: 'cleo', id: 'c5', senderKey: 'ben', text: 'I love you!!' },
    { at: now - 600_000, studentKey: 'ben', id: 'c4', senderKey: 'cleo', text: 'The basket is in the cellar.' },
  ] },
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
let selected: string | null = null; // the student open in the drawer
function Harness() {
  const [chosen, setChosen] = useState<string | null>(null);
  selected = chosen;
  return <LiveClass {...props} selected={chosen} onSelect={setChosen} />;
}
const render = () => act(async () => { root.render(<Harness />); });
const items = () => [...document.querySelectorAll('.live-todo > li')];
const press = (element: Element | null | undefined) => act(async () => { assert.ok(element, 'the control exists'); (element as HTMLElement).click(); });
const open = (item: Element) => press(item.querySelector('.live-row'));
async function type(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}
const submit = (form: Element | null) => act(async () => { assert.ok(form, 'the form exists'); form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });

try {
  await render();
  // Most urgent first: Cleo's threat, Ana asking (5 minutes), the messages waiting oldest first, then Ben stuck.
  assert.deepEqual(items().map(item => item.querySelector('.live-person strong')?.textContent), ['Cleo', 'Ana', 'Cleo', 'Ben', 'Ben']);
  assert.match(items()[0].textContent!, /🚨 threat ×2.*I will find you after school/);
  assert.match(items()[1].textContent!, /asks for help.*No entiendo.*5m/);
  assert.match(items()[2].textContent!, /→ 🔒 Ben.*Psst, Ben/);
  assert.match(items()[3].textContent!, /→ 📢 everyone.*Hello everyone!/);
  assert.match(items()[4].textContent!, /💡 stuck 2×.*There is chesnuts in the basket/);
  assert.equal(document.querySelector('.live-count')?.textContent, '5');
  assert.ok(items()[2].classList.contains('live-first'), 'the oldest message waiting is the one A and R answer');
  assert.equal(document.querySelectorAll('.live-details').length, 0, 'one line each until opened');

  // One click answers a line where it is.
  await press(items()[2].querySelector('[aria-label="Approve"]'));
  assert.deepEqual(actions.at(-1), { path: 'review', body: { id: 'c1', approve: true } });
  await press(items()[3].querySelector('[aria-label="Reject"]'));
  assert.deepEqual(actions.at(-1), { path: 'review', body: { id: 'c2', approve: false } });
  await press([...document.querySelectorAll('button')].find(button => button.textContent?.startsWith('✓ Approve all')));
  assert.deepEqual(actions.at(-1), { path: 'approve-all', body: {} });
  await press(items()[0].querySelector('button[title="Let them chat again"]'));
  assert.deepEqual(actions.at(-1), { path: 'mute', body: { studentKey: 'cleo', muted: false } }, 'Cleo is muted already: the button lets her chat again');
  await press(items()[0].querySelector('[aria-label="Seen"]'));
  assert.deepEqual(actions.at(-1), { path: 'incident', body: { id: 'harm-cleo' } });
  await press(items()[1].querySelector('button[title^="You are helping"]'));
  assert.deepEqual(actions.at(-1), { path: 'help-status', body: { id: 'help-ana', status: 'acknowledged', gameId: 'game-a' } });
  assert.equal(document.querySelectorAll('.live-details').length, 0, 'answering a line does not open it');

  // An incident opens to everything that was tried, and a private message.
  await open(items()[0]);
  assert.match(items()[0].querySelector('.live-details')!.textContent!, /I will find you after school/);
  assert.ok(items()[0].querySelector('.live-details form'), 'a private message to the student');
  // Opening another line closes the first: one open at a time.
  await open(items()[1]);
  assert.equal(items()[0].querySelector('.live-details'), null);

  // Answering a help request in place sends it privately, and counts as helping.
  await type(items()[1].querySelector('.live-details input')!, 'Tell me your idea in Catalan.');
  await submit(items()[1].querySelector('.live-details form'));
  assert.deepEqual(actions.slice(-2), [
    { path: 'help-message', body: { studentKey: 'ana', text: 'Tell me your idea in Catalan.', gameId: 'game-a' } },
    { path: 'help-status', body: { id: 'help-ana', status: 'acknowledged', gameId: 'game-a' } },
  ]);
  assert.equal(items()[1].querySelector<HTMLInputElement>('.live-details input')!.value, '', 'sent: the box empties');
  await press(items()[1].querySelector('[aria-label="Done"]'));
  assert.deepEqual(actions.at(-1), { path: 'help-status', body: { id: 'help-ana', status: 'resolved', gameId: 'game-a' } });
  await open(items()[1]);
  assert.equal(items()[1].querySelector('.live-details'), null, 'a second click folds it again');

  // A student stuck: what they tried, why it failed, and a fix the student gets highlighted. Fixing every attempt
  // the game could not correct finishes the check-in.
  await open(items()[4]);
  assert.match(items()[4].querySelector('.live-evidence')!.textContent!, /There is chesnuts in the basket.*×2.*wrong answer to: What is in the basket\?/);
  await press(items()[4].querySelector('.live-fix'));
  const fixer = items()[4].querySelector<HTMLInputElement>('.live-fixer input')!;
  assert.equal(fixer.value, 'There is chesnuts in the basket', 'the fix starts from what they wrote');
  await type(fixer, 'There are chestnuts in the basket');
  assert.ok(items()[4].querySelector('.live-fix-preview')!.textContent!.includes('chestnuts'), 'a preview of what the student will see');
  await submit(items()[4].querySelector('.live-fixer'));
  assert.deepEqual(actions.slice(-2), [
    { path: 'help-message', body: { studentKey: 'ben', text: correctionText('There is chesnuts in the basket', 'There are chestnuts in the basket'), gameId: 'game-a' } },
    { path: 'help-status', body: { id: 'help-ben', status: 'resolved', gameId: 'game-a' } },
  ]);
  assert.match(items()[4].textContent!, /✓ fix sent/);

  // The class as faces, whoever needs the teacher first: Cleo (harm), Ben (stuck, and a message waiting), Ana (asking).
  const tiles = () => [...document.querySelectorAll('.live-tile')];
  const tile = (name: string) => tiles().find(item => item.querySelector('.live-tile-name')?.textContent === name)!;
  assert.deepEqual(tiles().map(item => item.querySelector('.live-tile-name')?.textContent), ['Cleo', 'Ben', 'Ana']);
  assert.equal(tile('Cleo').querySelector('.live-tile-flag')?.textContent, '🚨');
  assert.equal(tile('Ben').querySelector('.live-tile-flag')?.textContent, '💡');
  assert.equal(tile('Ana').querySelector('.live-tile-flag')?.textContent, '🙋');
  assert.ok(tile('Ana').classList.contains('live-tile-help'));
  assert.equal(tile('Ben').querySelector('.live-tile-count')?.textContent, '1');
  assert.ok(tile('Cleo').querySelector('.live-tile-muted'));

  // A face or a name opens that student beside the class; the same face closes it.
  await press(tile('Ben'));
  assert.equal(selected, 'ben');
  assert.equal(tile('Ben').getAttribute('aria-pressed'), 'true');
  await press(tile('Ben'));
  assert.equal(selected, null);
  await press(items()[3].querySelector('.live-person'));
  assert.equal(selected, 'ben', 'a name in Needs you opens that student');
  assert.equal(items()[3].querySelector('.live-details'), null);

  // Heard something in the room: the faces say whose device is reading aloud now, and whose sound is off.
  assert.ok(tile('Ana').querySelector('.live-tile-playing'), "Ana's device is reading aloud");
  assert.equal(tile('Cleo').querySelector('.live-tile-sound')?.textContent, '🔇');
  assert.equal(tile('Ben').querySelector('.live-tile-sound'), null);
  const heard = () => [...document.querySelectorAll('.live-heard > li')];
  // A device as the teacher reads it, after its face: name, how often, and its sound.
  const devices = (line: Element) => [...line.querySelectorAll('.live-heard-device')].map(device => [...device.childNodes].slice(1).map(node => node.textContent).join(''));
  assert.equal(heard().length, 1, 'with nothing typed, only what played in the last minutes');
  assert.match(heard()[0].textContent!, /I love you!!.*Ben/);
  assert.deepEqual(devices(heard()[0]), ['Ana×2🔈', 'Cleo🔇']);
  const search = document.querySelector('.live-heard-search') as HTMLInputElement;
  await type(search, 'basket in the CELLAR');
  assert.equal(heard().length, 1);
  assert.match(heard()[0].textContent!, /The basket is in the cellar\..*Cleo.*10m/);
  assert.deepEqual(devices(heard()[0]), ['Ben🔈']);
  await type(search, 'i love you');
  await press(heard()[0].querySelector('.live-heard-device'));
  assert.deepEqual(actions.at(-1), { path: 'sound', body: { studentKey: 'ana', off: true } }, 'one click silences the device it played on');
  await press(heard()[0].querySelectorAll('.live-heard-device')[1]);
  assert.deepEqual(actions.at(-1), { path: 'sound', body: { studentKey: 'cleo', off: false } });
  await press(heard()[0].querySelector('.live-person'));
  assert.equal(selected, 'ben', 'the writer opens like any other student');
  await type(search, 'nothing like this');
  assert.equal(heard().length, 0);
  assert.match(document.querySelector('.live-heard-none')!.textContent!, /Nothing like that/);
  await type(search, '');

  // Every device's sound, off and back, keeping the ones turned off one by one.
  const soundToggle = () => document.querySelector<HTMLButtonElement>('.live-sound-control button')!;
  assert.equal(soundToggle().textContent, '🔇 Mute all student sound');
  await press(soundToggle());
  assert.deepEqual(actions.at(-1), { path: 'sound-all', body: { off: true } });
  props = { ...props, sound: { ...props.sound, allOff: true } }; await render();
  assert.equal(soundToggle().textContent, '🔊 Restore student sound');
  assert.equal(soundToggle().getAttribute('aria-pressed'), 'true');
  assert.ok(document.body.textContent?.includes('All student sound is off until you restore it'));
  assert.ok(tiles().every(item => item.querySelector('.live-tile-sound')?.textContent === '🔇'));
  assert.ok([...document.querySelectorAll<HTMLButtonElement>('.live-heard-device')].every(device => device.disabled), 'one device at a time waits for the class sound');
  await press(soundToggle());
  assert.deepEqual(actions.at(-1), { path: 'sound-all', body: { off: false } });
  props = { ...props, sound: { ...props.sound, allOff: false } }; await render();
  assert.equal(tile('Cleo').querySelector('.live-tile-sound')?.textContent, '🔇', 'restoring the class preserves individual sound locks');

  // Nothing needs the teacher.
  props = { ...props, entries: [], alerts: [], incidents: [] };
  await render();
  assert.equal(document.querySelector('.live-clear')?.textContent, '✓ All caught up');
  props = { ...props, open: false };
  await render();
  assert.equal(document.querySelector('.live-clear')?.textContent, 'The class is closed.');
  console.log('Live class UI checks pass: Needs you in order of urgency, one line each with its quickest answer, one open at a time, replies that count as helping, a fix that finishes a check-in, faces in order of need that open a student, a phrase heard in the room traced to the devices that played it, and the class sound switch.');
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
process.exit(0);
