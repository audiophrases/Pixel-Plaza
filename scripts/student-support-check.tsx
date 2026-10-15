import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

// Run the real game UI and connection, replacing only the canvas, dictionary,
// and network. This checks student interactions without starting workerd.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/game' });
const global = globalThis as any;
Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
localStorage.setItem('pixelplaza.student.v1', JSON.stringify({ studentToken: 'test-credential', expiresAt: Date.now() + 60000,
  student: { studentKey: 'student-a', displayName: 'Alex', className: '4B' } }));
global.fetch = async () => ({ ok: true, json: async () => ({ ticket: 'join-ticket' }) });

const sockets: Socket[] = [];
let testAIHelp = false;
let aiUsed = false;
const aiSupport = () => ({ session: 'lesson-one', available: !aiUsed, used: aiUsed, pending: false,
  tip: aiUsed ? 'Use “want to” before a base verb. Try: “I want to ___.”' : null, resultId: aiUsed ? 'ai-result' : null });
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
  drop() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
  send(raw: string) {
    const message = JSON.parse(raw);
    this.sent.push(message);
    if (message.t === 'attempt' || message.t === 'attempt-outcome') queueMicrotask(() => this.receive({ t: 'attempt-recorded', id: message.id, kind: message.t }));
    if (message.t === 'check') queueMicrotask(() => this.receive({ t: 'checked', id: message.id, ok: false,
      corrected: 'He walks home.', why: 'Use walks with he.' }));
    if (message.t === 'chat') queueMicrotask(() => this.receive({ t: 'result', cid: message.cid }));
    if (message.t === 'help-request') queueMicrotask(() => {
      if (testAIHelp && message.route !== 'teacher' && !aiUsed) {
        aiUsed = true;
        this.receive({ t: 'support', support: { request: null, messages: [], ai: aiSupport() } });
      } else this.receive({ t: 'support', support: { request: { id: 'request-a', topic: message.topic, status: 'open' },
        messages: [], ...(testAIHelp ? { ai: aiSupport() } : {}) } });
    });
  }
}
global.WebSocket = Socket;

const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const { default: Game } = await import('../src/pages/Game');
const root = createRoot(document.getElementById('root')!);
const button = (text: string) => [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === text) as HTMLButtonElement;
const input = () => document.querySelector('.chat-input') as HTMLInputElement;
async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = field instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}
async function select(field: HTMLSelectElement, value: string) {
  await act(async () => { field.value = value; field.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
}
async function click(label: string) { await act(async () => { assert.ok(button(label), `button ${label} exists`); button(label).click(); }); }
async function submit(form: HTMLFormElement) { await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))); }

try {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[{ pathname: '/game', state: { roomCode: '123456', avatarConfig: null } }]}><Game /></MemoryRouter>);
  });
  const socket = sockets[0];
  await act(async () => { socket.open(); socket.receive({ t: 'welcome', id: 'socket-a', gameId: 'game-a', players: [{ id: 'socket-a', name: 'Alex', x: 100, y: 100 }] }); });

  testAIHelp = true;
  await act(async () => socket.receive({ t: 'support', support: { request: null, messages: [], ai: aiSupport() } }));
  await type(input(), 'I want tell');
  await click('I need help');
  assert.equal((document.querySelector('.student-help-panel textarea') as HTMLTextAreaElement).value, 'I want tell', 'help starts with a copy of the unfinished chat draft');
  assert.equal(button('Ask my teacher directly'), undefined);
  await click('Get help');
  assert.ok(document.querySelector('.student-ai-tip')?.textContent?.includes('want to'));
  assert.equal(input().value, 'I want tell', 'AI help never rewrites or clears the composer');
  assert.ok(!socket.sent.some(event => event.t === 'chat'), 'AI help never posts a message');
  assert.ok(button('Get help'), 'after AI use, further help goes to the teacher');
  await click('Get help');
  assert.equal(socket.sent.at(-1).route, 'auto');
  assert.equal(input().value, 'I want tell');
  testAIHelp = false;
  await act(async () => socket.receive({ t: 'support', support: { request: null, messages: [] } }));
  socket.sent = [];

  await type(input(), 'No entenc');
  assert.equal(socket.sent.length, 0, 'typing an unsent draft never creates a teacher log');
  await click('Send');
  assert.deepEqual(socket.sent.map(event => event.t), ['attempt', 'attempt-outcome'], 'a blocked Send is logged before the language outcome');
  assert.equal(socket.sent[0].text, 'No entenc');
  assert.equal(socket.sent[1].status, 'language-blocked');
  const firstId = socket.sent[0].id;
  await click('Send');
  assert.notEqual(socket.sent[2].id, firstId, 'retrying the same draft creates a distinct attempt');
  assert.ok(button('I need help'), 'the help button stays available beside a blocked draft');

  await click('I need help');
  await select(document.querySelector('.student-help-panel select') as HTMLSelectElement, 'instructions');
  await type(document.querySelector('.student-help-panel textarea') as HTMLTextAreaElement, 'No entenc què he de fer.');
  await click('Get help');
  const help = socket.sent.at(-1);
  assert.equal(help.t, 'help-request');
  assert.equal(help.topic, 'instructions');
  assert.equal(help.text, 'No entenc què he de fer.', 'a help note can use the student’s own language');
  assert.equal(socket.sent.at(-2).source, 'help');
  assert.equal(socket.sent.at(-2).objective, 'instructions');
  assert.equal(help.attemptId, socket.sent.at(-2).id);
  assert.ok(document.body.textContent?.includes('Help requested'));

  const support = { request: { id: 'request-a', topic: 'instructions', status: 'acknowledged' }, messages: [{ id: 'reply-a', text: 'Tell me your idea and we can write it together.', timestamp: 100 }] };
  await act(async () => { socket.receive({ t: 'support', support }); socket.receive({ t: 'support', support }); });
  assert.equal(document.querySelectorAll('.teacher-msg').length, 1, 'replayed teacher messages appear once by persisted id');
  assert.ok(document.body.textContent?.includes('Teacher (private)'));
  assert.ok(document.body.textContent?.includes('Teacher is helping'));
  await click('I need help');
  await type(document.querySelector('.student-help-panel textarea') as HTMLTextAreaElement, 'Another idea I need help with');
  await act(async () => socket.receive({ t: 'support', support }));
  assert.equal((document.querySelector('.student-help-panel textarea') as HTMLTextAreaElement).value, 'Another idea I need help with', 'incoming status updates do not discard an unsent help note');
  await click('Close');
  await click('Reply to teacher');
  assert.equal((document.querySelector('.chat-target') as HTMLSelectElement).value, 'teacher');
  await type(input(), 'No entenc');
  const start = socket.sent.length;
  await click('Send');
  assert.deepEqual(socket.sent.slice(start).map(event => event.t), ['attempt', 'chat'], 'private teacher replies bypass language filters while preserving the original attempt');
  assert.equal(socket.sent.at(-1).to, 'teacher');
  assert.equal(socket.sent.at(-1).attemptId, socket.sent.at(-2).id);

  await select(document.querySelector('.chat-target') as HTMLSelectElement, '');
  await type(input(), 'He walk home');
  await click('Send');
  const hintedAttempt = socket.sent.findLast(event => event.t === 'attempt');
  assert.equal(socket.sent.at(-1).attemptId, hintedAttempt.id, 'the grammar check keeps the original attempt id');
  await click('OK');
  assert.equal(socket.sent.at(-1).attemptId, hintedAttempt.id);
  assert.equal(socket.sent.at(-1).was, 'He walk home');
  assert.equal(socket.sent.at(-1).text, 'He walks home.');
  await type(input(), 'He walk home');
  await click('Send');
  const keptAttempt = socket.sent.findLast(event => event.t === 'attempt');
  await click('Ignore');
  assert.equal(socket.sent.at(-1).attemptId, keptAttempt.id);
  assert.equal(socket.sent.at(-1).text, 'He walk home');
  assert.equal(socket.sent.at(-1).better, 'He walks home.');
  await act(async () => socket.receive({ t: 'support', support: { ...support, request: { ...support.request, status: 'resolved' } } }));
  assert.ok(document.body.textContent?.includes('Help completed'));
  assert.equal(document.querySelectorAll('.teacher-msg').length, 1);
  assert.ok(!Object.keys(localStorage).some(key => key.startsWith('pixelplaza.pending-attempts')), 'acknowledged audit records leave no pending message text in browser storage');

  const quest = { campaign: { id: 'test-mystery', title: 'A mystery' }, status: 'active',
    chapter: { index: 0, of: 1, title: 'Find the box', intro: 'Ask classmates about the box.', ending: null },
    role: { id: 'baker', name: 'Baker', card: 'You baked this morning.' }, clues: [{ id: 'clue-baker', text: 'I saw a box near the pond.', from: 'job' }],
    secret: null, thieves: null, objectives: [{ id: 'where', text: 'Where is the box?', kind: 'text', done: false, optional: false },
      { id: 'interview', text: 'Ask a witness.', kind: 'report', done: false, optional: false, conversation: { required: 1, completed: 0, witnesses: [{ id: 'socket-b', name: 'Sam' }] } }],
    interviews: [{ id: 'incoming-1', objective: 'interview', task: 'Help Chris investigate.', incoming: true, name: 'Chris', question: 'What did you see?', questionStatus: 'approved', answer: null, answerStatus: null, evidence: null, shared: null }],
    team: { done: 0, total: 1 }, recap: null, finale: null };
  await act(async () => {
    socket.receive({ t: 'join', player: { id: 'socket-b', name: 'Sam', x: 100, y: 100 } });
    socket.receive({ t: 'join', player: { id: 'socket-c', name: 'Chris', x: 100, y: 100 } });
    socket.receive({ t: 'quest', quest });
    socket.receive({ t: 'warmup', warmup: { kind: 'facts', fact: 'I like oranges.', task: 'Find someone who likes oranges.', step: 0, of: 1, team: { done: 0, total: 1 } } });
  });
  const theirName = document.querySelector('input[aria-label="Their name"]') as HTMLInputElement;
  await type(theirName, 'Sam');
  await submit(theirName.closest('form')!);
  assert.equal(socket.sent.at(-1).t, 'warmup-answer');
  assert.equal(socket.sent.at(-2).source, 'warmup');
  assert.equal(socket.sent.at(-1).attemptId, socket.sent.at(-2).id);

  const answer = document.querySelector('input[aria-label="Your answer"]') as HTMLInputElement;
  await type(answer, 'Near the pond');
  await submit(answer.closest('form')!);
  assert.equal(socket.sent.at(-1).t, 'answer');
  assert.equal(socket.sent.at(-2).source, 'answer');
  assert.equal(socket.sent.at(-2).objective, 'where');
  assert.equal(socket.sent.at(-1).attemptId, socket.sent.at(-2).id);

  const evidenceField = (label: string) => [...document.querySelectorAll('label')].find(item => item.textContent?.includes(label))!.querySelector('textarea')!;
  const question = evidenceField('Your question about this mystery');
  await type(question, 'Did you see the box?');
  await submit(question.closest('form')!);
  assert.equal(socket.sent.at(-1).t, 'interview-ask');
  assert.equal(socket.sent.at(-2).source, 'interview');
  assert.equal(socket.sent.at(-2).to, 'socket-b');
  assert.equal(socket.sent.at(-2).objective, 'interview');
  assert.equal(socket.sent.at(-1).attemptId, socket.sent.at(-2).id);
  const reply = evidenceField('Your reply: explain what your evidence tells you');
  await type(reply, 'I saw it by the pond.');
  await submit(reply.closest('form')!);
  assert.equal(socket.sent.at(-1).t, 'interview-reply');
  assert.equal(socket.sent.at(-2).to, 'socket-c');
  assert.equal(socket.sent.at(-2).objective, 'interview');
  assert.equal(socket.sent.at(-1).attemptId, socket.sent.at(-2).id);

  await act(async () => socket.drop());
  await type(answer, 'Offline journal conclusion');
  const beforeOffline = socket.sent.length;
  await submit(answer.closest('form')!);
  assert.equal(socket.sent.length, beforeOffline, 'an offline submission is not delivered to its game recipient');
  const stored = () => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('pixelplaza.pending-attempts'))!)!);
  assert.equal(stored()[0].source, 'answer');
  assert.equal(stored()[0].objective, 'where');
  assert.equal(stored()[0].text, 'Offline journal conclusion');
  assert.equal(stored()[1].status, 'not-sent');
  await click('I need help');
  await select(document.querySelector('.student-help-panel select') as HTMLSelectElement, 'classmate-message');
  await type(document.querySelector('.student-help-panel textarea') as HTMLTextAreaElement, '');
  await click('Get help');
  assert.equal(stored()[2].source, 'help');
  assert.equal(stored()[2].objective, 'classmate-message');
  assert.equal(stored()[2].text, "I need help understanding a classmate's message.");
  assert.equal(stored()[3].status, 'not-sent');
  assert.ok(document.querySelector('.student-help-panel'), 'an offline help request keeps its form open for a manual retry');
  console.log('Student support UI checks pass: one AI hint, direct teacher help, preserved composer, no automatic messages, prefilter audit, private help and offline persistence.');
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
process.exit(0);
