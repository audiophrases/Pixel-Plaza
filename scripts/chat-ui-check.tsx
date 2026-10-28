import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

// The chat as a student meets it: conversations as faces, replies that find the student, "is writing",
// and what became of each message they sent. The real page and connection, with the canvas, dictionary
// and network replaced.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/game' });
const global = globalThis as any;
Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
// Native focus trapping/backdrop behavior is covered separately in Chrome.
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
localStorage.setItem('pixelplaza.student.v1', JSON.stringify({ studentToken: 'test-credential', expiresAt: Date.now() + 60000,
  student: { studentKey: 'student-a', displayName: 'Alex', className: '4B' } }));
global.fetch = async () => ({ ok: true, json: async () => ({ ticket: 'join-ticket' }) });

// What the server says back to a chat message: by default it posts at once, reaching one classmate.
const NAMES: Record<string, string> = { b: 'Sam', c: 'Chris' };
let last = 0; // the fake server's clock: real time, never the same twice
const stamp = () => (last = Math.max(Date.now(), last + 1));
let serial = 0;
const posted = (message: any, from: Socket) => {
  const id = `own${serial++}`;
  from.receive({ t: 'chat', id, sender: 'Alex', text: message.text, ts: stamp(), heard: 1,
    ...(message.to === 'everyone' ? { all: true } : message.to ? { whisper: true, to: NAMES[message.to] } : {}) });
  from.receive({ t: 'result', cid: message.cid, id });
};
let answer: (message: any, socket: Socket) => void = posted;
const sockets: Socket[] = [];
class Socket {
  static OPEN = 1;
  readyState = 0;
  sent: any[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  constructor() { sockets.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
  close() { this.readyState = 3; }
  send(raw: string) {
    const message = JSON.parse(raw);
    this.sent.push(message);
    if (message.t === 'attempt' || message.t === 'attempt-outcome') queueMicrotask(() => this.receive({ t: 'attempt-recorded', id: message.id, kind: message.t }));
    if (message.t === 'check') queueMicrotask(() => this.receive({ t: 'checked', id: message.id, ok: true }));
    if (message.t === 'chat') queueMicrotask(() => answer(message, this));
  }
}
global.WebSocket = Socket;

const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const { default: Game } = await import('../src/pages/Game');
const root = createRoot(document.getElementById('root')!);
const input = () => document.querySelector('.chat-input') as HTMLInputElement;
const head = () => document.querySelector('.chat-head')?.textContent ?? '';
const pane = () => document.querySelector('.chat-messages')?.textContent ?? '';
const tab = (name: string) => document.querySelector(`.chat-rail [role="tab"][aria-label^="${name}"]`) as HTMLButtonElement | null;
const selected = () => document.querySelector('.chat-rail [aria-selected="true"]')?.getAttribute('aria-label');
const bubbles = () => [...document.querySelectorAll('.chat-messages .chat-message:not(.system-msg)')];
const ticks = () => bubbles().at(-1)?.querySelector('.chat-ticks')?.textContent;
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}
async function send(value: string) {
  await type(value);
  await act(async () => input().closest('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  await act(async () => { for (let tick = 0; tick < 3; tick++) await new Promise(resolve => setTimeout(resolve, 0)); });
}
const frame = () => act(async () => { await new Promise(resolve => dom.window.requestAnimationFrame(() => resolve(null))); });
const press = (element: Element | null) => act(async () => { assert.ok(element, 'the control exists'); (element as HTMLElement).click(); });
const chat = (sender: string, text: string, extra: object = {}) => ({ t: 'chat', id: `m${serial++}`, sender, text, ts: stamp(), ...extra });

try {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[{ pathname: '/game', state: { roomCode: '123456', avatarConfig: null } }]}><Game /></MemoryRouter>);
  });
  const socket = sockets[0];
  await act(async () => { socket.open(); socket.receive({ t: 'welcome', id: 'a', gameId: 'game-a', players: [{ id: 'a', name: 'Alex', x: 1000, y: 1000 }] }); });

  // The chat starts with the people nearby, and says plainly when there is nobody to hear.
  assert.equal(selected(), 'Nearby');
  assert.match(head(), /Nobody near you/);
  assert.equal(input().placeholder, 'Nobody near you…');
  await act(async () => {
    socket.receive({ t: 'join', player: { id: 'b', name: 'Sam', x: 1100, y: 1000 } });
    socket.receive({ t: 'join', player: { id: 'c', name: 'Chris', x: 3000, y: 3000 } });
  });
  assert.doesNotMatch(head(), /Nobody/);
  assert.equal(document.querySelector('.chat-head-people')?.getAttribute('title'), 'Sam', 'the faces of who would hear, and only them');
  assert.equal(input().placeholder, 'Talk to people near you…');

  // Someone starting to write privately shows up in the list at once, writing.
  assert.equal(tab('Sam'), null);
  await act(async () => socket.receive({ t: 'typing', id: 'b', scope: 'private' }));
  assert.ok(tab('Sam')?.querySelector('.chat-conv-writing'), 'a classmate writing to you appears before their message');
  // A private message for a student who is not writing opens by itself, so the reply goes back to the right person.
  await act(async () => socket.receive(chat('Sam', 'Hi Alex, where are you?', { whisper: true, to: 'Alex' })));
  assert.equal(selected(), 'Sam');
  assert.match(head(), /Sam.*only you two/);
  assert.match(pane(), /where are you/);
  await send('I am at the cafe');
  assert.deepEqual([socket.sent.at(-1).t, socket.sent.at(-1).to], ['chat', 'b'], 'the reply goes to Sam');
  assert.deepEqual(socket.sent.find(message => message.t === 'typing'), { t: 'typing', to: 'b' }, 'Sam was told Alex was writing back, without the words');
  assert.equal(ticks(), '✓✓');

  // While that conversation is going, another one is announced instead, and waits with its count.
  await act(async () => socket.receive(chat('Chris', 'Do you have the key?', { whisper: true, to: 'Alex' })));
  assert.equal(selected(), 'Sam', 'nobody is pulled out of a conversation');
  assert.match(document.querySelector('.chat-peek')?.textContent ?? '', /Chris: Do you have the key\?/);
  assert.equal(tab('Chris')?.getAttribute('aria-label'), 'Chris, 1 new');
  const rail = [...document.querySelectorAll('.chat-rail [role="tab"]')].map(item => item.getAttribute('aria-label'));
  assert.deepEqual(rail, ['Nearby', 'Everyone', 'Teacher', 'Chris, 1 new', 'Sam'], 'fixed places first, then the newest private chat');
  await press(document.querySelector('.chat-peek'));
  await frame();
  assert.equal(selected(), 'Chris');
  assert.equal(document.activeElement, input(), 'opened to answer: the box has the keys');
  assert.equal(document.querySelector('.chat-peek'), null);

  // "Is writing": dots on the face in the list, and in the conversation itself; the message replaces them.
  await act(async () => socket.receive({ t: 'typing', id: 'b', scope: 'private' }));
  assert.ok(tab('Sam')?.querySelector('.chat-conv-writing'), 'the list shows who is writing to you');
  assert.equal(document.querySelector('.chat-typing'), null, 'not in a conversation they are not writing in');
  await press(tab('Sam'));
  assert.ok(document.querySelector('.chat-typing'));
  await act(async () => socket.receive(chat('Sam', 'Wait for me!', { whisper: true, to: 'Alex' })));
  assert.equal(document.querySelector('.chat-typing'), null);

  // Everyone: the whole plaza, and the sender sees how many got it.
  await press(tab('Everyone'));
  assert.match(head(), /Everyone.*2 classmates/);
  answer = (message, from) => { from.receive({ t: 'chat', id: 'all-1', sender: 'Alex', text: message.text, ts: stamp(), all: true, heard: 2 }); from.receive({ t: 'result', cid: message.cid, id: 'all-1' }); };
  await send('Hello everyone!');
  answer = posted;
  assert.equal(socket.sent.at(-1).to, 'everyone');
  assert.equal(input().value, '', 'sent: the box is empty again');
  assert.ok(bubbles().at(-1)?.classList.contains('mine'));
  assert.equal(ticks(), '✓✓2');

  // In a group, a name opens a private chat with its owner.
  await act(async () => socket.receive(chat('Chris', 'Hi! Who has the map?', { all: true })));
  await press(document.querySelector('.chat-messages button.chat-sender'));
  assert.equal(selected(), 'Chris');

  // Waiting for the teacher: the message stays in its conversation with a clock, then shows what the teacher decided.
  await press(tab('Nearby'));
  answer = (message, from) => from.receive({ t: 'notice', level: 'info', text: 'Sent to your teacher for approval.', cid: message.cid, id: 'w1' });
  await send('Is the cellar open?');
  assert.equal(input().value, '');
  assert.ok(bubbles().at(-1)?.classList.contains('waiting'));
  assert.equal(ticks(), '🕓');
  assert.doesNotMatch(pane(), /Sent to your teacher/, 'the clock says it: no sentence to read');
  await act(async () => {
    socket.receive({ t: 'chat', id: 'w1', sender: 'Alex', text: 'Is the cellar open?', ts: stamp(), heard: 1 });
    socket.receive({ t: 'notice', level: 'info', text: 'Your message was approved.', id: 'w1' });
  });
  assert.equal(bubbles().filter(item => item.textContent?.includes('cellar')).length, 1, 'the waiting message becomes the posted one');
  assert.equal(ticks(), '✓✓1');
  assert.doesNotMatch(pane(), /approved/);
  answer = (message, from) => from.receive({ t: 'notice', level: 'info', text: 'Sent to your teacher for approval.', cid: message.cid, id: 'w2' });
  await send('A message the teacher refuses');
  await act(async () => socket.receive({ t: 'notice', level: 'info', text: 'Your message was not posted.', id: 'w2' }));
  assert.ok(bubbles().at(-1)?.classList.contains('declined'));
  assert.equal(ticks(), '✕');
  assert.doesNotMatch(pane(), /not posted/);
  // Nobody near enough: one tick.
  answer = (message, from) => { from.receive({ t: 'chat', id: 'n1', sender: 'Alex', text: message.text, ts: stamp(), heard: 0 }); from.receive({ t: 'result', cid: message.cid, id: 'n1' }); };
  await send('Hello?');
  assert.equal(ticks(), '✓');
  answer = posted;

  // What a reload brings back is not new; what comes while another chat is open is.
  await act(async () => socket.receive(chat('Chris', 'An old hello', { whisper: true, to: 'Alex', history: true })));
  assert.equal(tab('Chris')?.getAttribute('aria-label'), 'Chris');
  await act(async () => socket.receive(chat('Sam', 'Look at the fountain', { all: true })));
  assert.equal(tab('Everyone')?.getAttribute('aria-label'), 'Everyone, 1 new');
  assert.equal(document.querySelector('.chat-peek'), null, 'the busy group chats only count');

  // Folded away, the newest message still shows on the handle.
  await press(document.querySelector('.chat-handle button'));
  assert.match(document.querySelector('.chat-handle')?.textContent ?? '', /1 new · Sam: Look at the fountain/);
  await press(document.querySelector('.chat-handle button'));

  // A namesake arrives: the private chat with Sam follows Sam's new name.
  await act(async () => socket.receive({ t: 'rename', id: 'b', name: 'Sam B.' }));
  assert.ok(tab('Sam B.'), 'the chat follows the new name');
  const labels = [...document.querySelectorAll('.chat-rail [role="tab"]')].map(item => item.getAttribute('aria-label') ?? '');
  assert.ok(!labels.some(label => label === 'Sam' || label.startsWith('Sam,')), 'no chat is left behind under the old name');
  await press(tab('Sam B.'));
  assert.match(pane(), /Wait for me!/);

  // A classmate who left keeps their chat, greyed, and a message to them is held back with the reason.
  await act(async () => socket.receive({ t: 'leave', id: 'b' }));
  assert.ok(tab('Sam B.')?.classList.contains('chat-conv-away'));
  const before = socket.sent.length;
  await send('Are you there?');
  assert.equal(socket.sent.length, before, 'nothing is sent to someone who is not here');
  assert.match(document.querySelector('.composer-error')?.textContent ?? '', /not in the Plaza now/);
  // Activity announcements use the real websocket events and wait until the student keeps their name.
  const quest = { runId: 'game-a:story1', campaign: { id: 'mystery', title: 'Mystery' }, status: 'active',
    chapter: { index: 0, of: 2, title: 'The missing chestnuts', intro: 'Talk to the villagers.', ending: null },
    role: { id: 'baker', name: 'Baker', card: 'You work in the bakery.' }, clues: [], secret: null, thieves: null,
    objectives: [{ id: 'bag', text: 'Where is the bag?', kind: 'text', done: false, optional: false }],
    team: { done: 0, total: 3 }, recap: null, finale: null };
  const warmup = { runId: 'game-a:round1', kind: 'facts', title: 'Find someone who…', instructions: 'Talk to classmates.',
    fact: 'You have a cat.', task: 'Find someone who has a dog.', step: 0, of: 2, team: { done: 0, total: 4 } };
  const dialog = () => document.querySelector('dialog[open]');
  const ok = () => press(document.querySelector('.activity-announcement-ok'));
  await act(async () => {
    socket.receive({ t: 'alias', name: 'Robin', kept: false });
    socket.receive({ t: 'quest', quest }); socket.receive({ t: 'warmup', warmup });
  });
  assert.equal(dialog(), null, 'choosing your name comes first');
  await act(async () => socket.receive({ t: 'alias', name: 'Robin', kept: true }));
  assert.match(dialog()?.textContent ?? '', /WARM-UP STARTING/);
  assert.equal(document.activeElement?.id, 'activity-announcement-title');
  await act(async () => {
    const cancel = new dom.window.Event('cancel', { cancelable: true });
    dialog()!.dispatchEvent(cancel); assert.equal(cancel.defaultPrevented, true, 'Escape cannot acknowledge instructions');
    document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  assert.notEqual(document.activeElement, input(), 'Enter does not send focus into chat');
  const beforeOK = socket.sent.length;
  await ok(); assert.match(dialog()?.textContent ?? '', /The missing chestnuts/);
  await ok(); assert.equal(dialog(), null); assert.equal(socket.sent.length, beforeOK, 'OK only acknowledges instructions');
  await act(async () => { socket.receive({ t: 'quest', quest }); socket.receive({ t: 'warmup', warmup }); });
  assert.equal(dialog(), null, 'progress refreshes are quiet');
  await press(document.querySelector('.activity-instructions-button'));
  assert.match(dialog()?.textContent ?? '', /Your current instructions/); await ok();
  await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: '/game', state: { roomCode: '123456', avatarConfig: null } }]}><Game key="reload" /></MemoryRouter>));
  const back = sockets.at(-1)!;
  await act(async () => {
    back.open(); back.receive({ t: 'welcome', id: 'a', gameId: 'game-a', players: [{ id: 'a', name: 'Alex', x: 1000, y: 1000 }] });
    back.receive({ t: 'quest', quest }); back.receive({ t: 'warmup', warmup });
  });
  assert.equal(dialog(), null, 'acknowledged instructions survive a page reload');
  await act(async () => back.receive({ t: 'warmup', warmup: { ...warmup, runId: 'game-a:round2' } }));
  assert.match(dialog()?.textContent ?? '', /WARM-UP STARTING/, 'restarting the same warm-up announces it again');
  await act(async () => back.receive({ t: 'warmup', warmup: null }));
  assert.equal(dialog(), null, 'ending an activity closes its stale instructions');
  await act(async () => back.receive({ t: 'quest', quest: { ...quest, chapter: { ...quest.chapter, index: 1, title: 'The cellar' } } }));
  assert.match(dialog()?.textContent ?? '', /The cellar/); await ok();
  await act(async () => back.receive({ t: 'welcome', id: 'a', gameId: 'game-b', players: [{ id: 'a', name: 'Alex', x: 1000, y: 1000 }] }));
  assert.equal(dialog(), null, 'switching games drops the old activity');
  await act(async () => back.receive({ t: 'quest', quest }));
  assert.match(dialog()?.textContent ?? '', /The missing chestnuts/, 'another game has its own acknowledgement scope');
  console.log('Chat and announcement UI checks pass: chat behavior, name selection first, OK-only acknowledgement, sequential dialogs, review, reloads, restarted activities, chapter changes and game isolation.');
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
process.exit(0);
