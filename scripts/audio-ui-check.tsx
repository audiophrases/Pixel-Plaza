import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Exercise actual React/connection/audio code with controllable Web Audio and
// HTTP. Keep the map canvas outside this UI test.
const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  pretendToBeVisual: true, url: 'http://localhost/game', runScripts: 'outside-only',
});
const browser = globalThis as any;
Object.assign(browser, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
localStorage.setItem('pixelplaza.student.v1', JSON.stringify({ studentToken: 'private-test-credential', expiresAt: Date.now() + 60000,
  student: { studentKey: 'student-a', displayName: 'Alex', className: '4B' } }));

const sources: { stopped: boolean; onended: (() => void) | null; stop: () => void }[] = [];
class Audio {
  state = 'suspended';
  resume() { this.state = 'running'; return Promise.resolve(); }
  decodeAudioData() { return Promise.resolve({ duration: 5 }); }
  destination = {};
  createGain() { return { gain: { value: 1 }, connect() { return this; }, disconnect() {} }; }
  createBufferSource() {
    const source = { stopped: false, onended: null as (() => void) | null,
      connect() { return this; }, disconnect() {}, start() { sources.push(source); },
      stop() { this.stopped = true; this.onended?.(); } };
    return source;
  }
}
Object.assign(dom.window, { AudioContext: Audio });
const calls: { path: string; body?: any; headers?: HeadersInit }[] = [];
browser.fetch = async (path: string, init: RequestInit = {}) => {
  calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers });
  if (path === '/api/plaza/join') return Response.json({ ticket: 'join-ticket' });
  if (path === '/api/plaza/speech' || path === '/api/plaza/voice-preview' || path.startsWith('/sounds/')) {
    return new Response('fake-mp3-bytes', { headers: { 'Content-Type': 'audio/mpeg' } });
  }
  throw new Error(`Unexpected fetch: ${path}`);
};
const sockets: Socket[] = [];
class Socket {
  static OPEN = 1;
  readyState = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  constructor() { sockets.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
  close() { this.readyState = 3; }
  send() {}
}
browser.WebSocket = Socket;

const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const { default: Game } = await import('../src/pages/Game');
const { default: AvatarEditor } = await import('../src/components/AvatarEditor');
let root = createRoot(document.getElementById('root')!);
const button = (text: string) => [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === text) as HTMLButtonElement;
const speech = () => calls.filter(call => call.path === '/api/plaza/speech');
const effects = () => calls.filter(call => call.path.startsWith('/sounds/'));
const chat = (id: string, sender = 'Sam') => ({ t: 'chat', id, sender, voice: 'en-AU-NatashaNeural', text: 'The basket is near the cellar.', ts: Date.now() });
const welcome = { t: 'welcome', id: 'self', gameId: 'game-a', players: [{ id: 'self', name: 'Alex', x: 100, y: 100 }] };
const oldSupport = { request: null, messages: [{ id: 'old-help', text: 'An earlier reply.', timestamp: 1 }] };
const renderGame = () => act(async () => {
  root.render(<MemoryRouter initialEntries={[{ pathname: '/game', state: { roomCode: '123456', avatarConfig: null } }]}><Game /></MemoryRouter>);
});
const click = async (text: string) => { assert.ok(button(text), `button ${text}`); await act(async () => button(text).click()); };
const finish = async () => { await act(async () => sources.at(-1)?.onended?.()); };

try {
  await renderGame();
  const socket = sockets[0];
  await act(async () => { socket.open(); socket.receive(welcome); socket.receive({ t: 'support', history: true, support: oldSupport }); });
  assert.equal(button('🔊 Sound on').getAttribute('aria-pressed'), 'true');
  assert.equal(speech().length, 0, 'restored teacher history is silent');
  await act(async () => document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })));
  await act(async () => socket.receive(chat('first')));
  assert.deepEqual(speech().map(call => call.body), [{ id: 'first' }]);
  assert.equal(new Headers(speech()[0].headers).get('x-student-token'), 'private-test-credential');
  assert.equal(document.querySelector('.chat-speaking .chat-text')?.textContent, chat('first').text);
  assert.equal(sources.length, 1, 'incoming chat speaks automatically, without clicking Listen');
  await act(async () => { socket.receive(chat('first')); socket.receive(chat('queued', 'Chris')); });
  assert.equal(speech().length, 1, 'only one voice plays at a time');
  assert.equal(document.querySelectorAll('.chat-message:not(.teacher-msg)').length, 2, 'duplicate delivery does not duplicate text');
  await click('🔊 Sound on');
  assert.equal(sources[0].stopped, true, 'mute stops the current utterance immediately');
  await act(async () => { socket.receive(chat('muted')); socket.receive({ t: 'answered', objective: 'one', correct: true, wait: false }); });
  assert.equal(speech().length, 1); assert.equal(effects().length, 0);
  await click('🔇 Sound off');
  assert.equal(speech().length, 1, 'unmute does not read queued or muted chat');
  await act(async () => socket.receive(chat('fresh')));
  assert.equal(speech().at(-1)?.body.id, 'fresh');
  await finish();
  await act(async () => socket.receive({ t: 'warmup-answered', correct: false, wait: false }));
  assert.equal(effects().length, 0, 'incorrect answers have no failure sound');
  await act(async () => socket.receive({ t: 'warmup-answered', correct: true, wait: false }));
  assert.equal(effects()[0].path, '/sounds/pinplay/correct-1.mp3');
  await finish();
  await act(async () => socket.receive({ t: 'answered', objective: 'one', correct: true, wait: false }));
  assert.equal(effects()[1].path, '/sounds/pinplay/correct-2.mp3', 'journal goals use the same success rotation');
  await finish();
  const played = sources.length;
  await act(async () => { socket.receive(chat('retracted')); socket.receive({ t: 'retract', id: 'retracted' }); });
  assert.equal(sources.length, played, 'retraction cancels pending synthesis before it plays');
  assert.ok(!document.querySelector('.chat-messages')?.textContent?.includes('retracted'));
  await act(async () => socket.receive({ ...chat('for-everyone', 'Chris'), all: true }));
  assert.ok(!speech().some(request => request.body.id === 'for-everyone'), "the whole plaza's chatter is not read aloud while another conversation is open");
  await act(async () => socket.receive({ t: 'support', support: { ...oldSupport,
    messages: [...oldSupport.messages, { id: 'live-help', text: 'A new private reply.', timestamp: 2 }] } }));
  assert.ok(!speech().some(request => request.body.id.startsWith('teacher:')), 'teacher help is never synthesized');
  assert.equal(document.querySelector('.teacher-msg .chat-listen'), null);
  await finish();
  // The teacher turns this device's sound off: the button locks, and nothing is read aloud until it is back on.
  await act(async () => socket.receive({ t: 'sound', off: true }));
  assert.equal(button('🔒 Sound off').disabled, true);
  const asked = speech().length;
  await act(async () => socket.receive(chat('while-off')));
  assert.equal(speech().length, asked);
  assert.ok([...document.querySelectorAll('.chat-listen')].every(listen => (listen as HTMLButtonElement).disabled), 'Listen is off too');
  await act(async () => socket.receive({ t: 'sound', off: false }));
  assert.equal(button('🔊 Sound on').disabled, false);
  assert.equal(speech().length, asked, 'no backlog when sound comes back');
  await click('🔊 Sound on');
  await act(async () => root.unmount());
  root = createRoot(document.getElementById('root')!);
  await renderGame();
  assert.ok(button('🔇 Sound off'), 'mute choice survives returning to the game');
  await act(async () => root.unmount());

  // The real avatar catalogue keeps numeric appearance controls and new voice
  // settings in the same saved character without mixing their field types.
  localStorage.removeItem('pixelplaza.sound-muted.v1:student-a');
  dom.window.eval(fs.readFileSync(new URL('../public/cup/avatar-parts.js', import.meta.url), 'utf8'));
  root = createRoot(document.getElementById('root')!);
  let saved: any;
  await act(async () => {
    root.render(<AvatarEditor initialConfig={{ hair: 3 }} onSave={value => { saved = value; }} />);
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
  const picker = document.querySelector('#character-voice') as HTMLSelectElement;
  assert.equal(picker.options.length, 34);
  await act(async () => { picker.value = 'en-IE-EmilyNeural'; picker.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  await click('Hear this voice');
  assert.equal(calls.at(-1)?.path, '/api/plaza/voice-preview');
  assert.deepEqual(calls.at(-1)?.body, { voice: 'en-IE-EmilyNeural' });
  await click('Stop preview');
  assert.equal(sources.at(-1)?.stopped, true);
  await click('Save Character');
  assert.equal(saved.voice, 'en-IE-EmilyNeural'); assert.equal(saved.hair, 3);
  console.log('Audio UI checks pass: default autoplay, queued voices, private replies, mute persistence, cancellation, goal sounds and character voice selection.');
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
process.exit(0);
