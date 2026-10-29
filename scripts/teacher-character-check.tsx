import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/teacher' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
vm.runInNewContext(fs.readFileSync('public/cup/avatar-parts.js', 'utf8'), { window: dom.window });

let profile = { studentKey: 'sam', name: 'Sam', avatar: { head: 2, skin: 1, hairColor: 2, hair: 3, eyes: 1, mouth: 2, glasses: 0, shirt: 4, hat: 0, voice: 'en-AU-NatashaNeural' } };
globalThis.fetch = async (url, init) => {
  assert.equal((init?.headers as Record<string, string> | undefined)?.['x-teacher-session'], 'teacher-session');
  const query = new URL(String(url), 'http://localhost');
  if (query.pathname === '/api/teacher/conversations') return Response.json({ studentKey: 'sam', lines: [], names: {} });
  assert.equal(query.pathname, '/api/teacher/student');
  assert.equal(query.searchParams.get('gameId'), 'game-a');
  assert.equal(query.searchParams.get('studentKey'), 'sam');
  return Response.json(profile);
};

const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { default: StudentDrawer } = await import('../src/components/StudentDrawer');
const root = createRoot(document.getElementById('root')!);
const actions: { path: string; body: any }[] = [];
let rejectSave = true;
let finishSave: (() => void) | null = null;
const action = async (path: string, body: any, onError?: (cause: unknown) => void) => {
  actions.push({ path, body });
  if (rejectSave) { onError?.(new Error('Another student in this game already has that name.')); return false; }
  await new Promise<void>(resolve => { finishSave = resolve; });
  profile = { ...profile, name: body.name, avatar: body.avatar };
  return true;
};
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label);
const press = async (element: HTMLElement | undefined | null) => act(async () => { assert.ok(element); element.focus(); element.click(); });
const waitForEditor = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 160)); });
const displayName = () => document.querySelector<HTMLInputElement>('input[aria-label="Student display name"]')!;
const type = async (value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(displayName(), value);
  displayName().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
});

try {
  await act(async () => root.render(<StudentDrawer token="teacher-session" gameId="game-a" student={{ studentKey: 'sam', name: 'Sam' }}
    online={false} muted={false} soundOff={false} allSoundOff={false} who={(_key, name) => name}
    action={action} failed={cause => { throw cause; }} onClose={() => {}} onOpen={() => {}} />));
  await press(button('Edit name & character'));
  await waitForEditor();
  assert.equal(displayName().value, 'Sam', 'an offline student starts with their saved name and appearance');
  assert.ok(document.querySelector('.avatar-preview svg'), 'the real catalog renders in the teacher editor');
  assert.equal(button('Hear this voice'), undefined, 'teacher editing never uses another student session for voice preview');
  await press(document.querySelector('[aria-label="Next Outfit"]'));
  await press(document.querySelector('[aria-label="Next Hats"]'));
  await type('Captain Owl');
  assert.equal(actions.length, 0, 'preview edits do not save automatically');
  await press(button('Save changes'));
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /already has that name/);
  assert.equal(displayName().value, 'Captain Owl', 'failed saves retain the edits for correction');
  assert.deepEqual(actions[0], { path: 'student', body: { gameId: 'game-a', studentKey: 'sam', name: 'Captain Owl', avatar: { ...profile.avatar, shirt: 5, hat: 1 } } });
  rejectSave = false;
  await press(button('Save changes'));
  assert.ok(button('Saving…')?.matches(':disabled'));
  assert.ok(displayName().closest('fieldset')?.disabled);
  assert.ok(button('Cancel')?.matches(':disabled'), 'the dialog cannot close halfway through saving');
  await act(async () => { assert.ok(finishSave); finishSave(); });
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, button('Edit name & character'), 'focus returns to the teacher action');

  await press(button('Edit name & character'));
  await waitForEditor();
  assert.equal(displayName().value, 'Captain Owl');
  await press(document.querySelector('[aria-label="Next Hair Style"]'));
  await press(button('Cancel'));
  assert.equal(actions.length, 2, 'cancel discards changes without writing');
  console.log('PASS: teacher edits an offline student using the real wardrobe, saves name/outfit/hat/voice, retains failed edits, disables pending saves and cancels safely.');
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
process.exit(0);
