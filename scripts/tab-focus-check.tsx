import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// Exercise the real React pages and connection. The canvas, dictionary and network are replaced;
// visibility and focus events are simulated because JSDOM has no operating-system window.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/game' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
let hidden = false, focused = true;
Object.defineProperties(document, { hidden: { get: () => hidden }, visibilityState: { get: () => hidden ? 'hidden' : 'visible' } });
document.hasFocus = () => focused;

const theme = { id: 'plaza', name: 'Pixel Plaza', image: '/assets/maps/plaza.webp', world: 2048, zones: [] };
const sockets: Socket[] = [];
class Socket {
    static OPEN = 1;
    readyState = 0;
    sent: { t: string; inTab?: boolean; count?: number }[] = [];
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: (event: { code: number }) => void;
    constructor() { sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
    send(raw: string) { if (raw !== 'ping') this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; }
    drop() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
    welcome(count = 0, gameId = 'game-a') {
        this.open(); this.receive({ t: 'welcome', id: 'me', gameId, theme, tabSwitches: count,
            players: [{ id: 'me', name: 'Alex', x: 100, y: 100 }] });
    }
    get reports() { return this.sent.filter(message => message.t === 'tab-focus'); }
}
Object.assign(globalThis, { WebSocket: Socket });
const { act, StrictMode } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { default: Game } = await import('../src/pages/Game');
const { default: Teacher } = await import('../src/pages/Teacher');

function reset() {
    hidden = false; focused = true; sockets.length = 0;
    sessionStorage.clear(); localStorage.clear();
    localStorage.setItem('pixelplaza.student.v1', JSON.stringify({ studentToken: 'test-token', expiresAt: Date.now() + 60000,
        student: { studentKey: 'student-a', displayName: 'Alex', className: '4B' } }));
    globalThis.fetch = async () => Response.json({ ticket: 'join-ticket' });
}
async function mountGame() {
    const root = createRoot(document.getElementById('root')!);
    try {
        await act(async () => root.render(<StrictMode><MemoryRouter initialEntries={[{ pathname: '/game', state: { roomCode: '123456', avatarConfig: null } }]}><Game /></MemoryRouter></StrictMode>));
    } catch (cause) { await act(async () => root.unmount()); throw cause; }
    return { root, socket: sockets.at(-1)! };
}
async function leave() {
    await act(async () => {
        focused = false; window.dispatchEvent(new dom.window.Event('blur'));
        hidden = true; document.dispatchEvent(new dom.window.Event('visibilitychange'));
        await new Promise(resolve => setTimeout(resolve, 5));
    });
}
async function returnToGame() {
    await act(async () => {
        hidden = false; document.dispatchEvent(new dom.window.Event('visibilitychange'));
        focused = true; window.dispatchEvent(new dom.window.Event('focus'));
    });
}

test('tab focus regressions', async t => {
await t.test('blur plus visibilitychange count one leave and returning restores focus', async () => {
    reset(); const { root, socket } = await mountGame();
    try {
        await act(async () => socket.welcome()); socket.sent = [];
        await leave();
        assert.deepEqual(socket.reports, [{ t: 'tab-focus', inTab: false, count: 1 }], 'StrictMode must not replay network writes inside state updaters');
        assert.match(document.querySelector('.badge-tab-warning')!.textContent!, /Left tab 1x/);
        assert.ok(document.querySelector('.tab-focus-overlay'));
        await returnToGame();
        assert.deepEqual(socket.reports.at(-1), { t: 'tab-focus', inTab: true, count: 1 });
        assert.equal(document.querySelector('.tab-focus-overlay'), null);
        await act(async () => { focused = false; window.dispatchEvent(new dom.window.Event('blur')); focused = true; window.dispatchEvent(new dom.window.Event('focus')); await new Promise(resolve => setTimeout(resolve, 5)); });
        assert.equal(socket.reports.length, 2, 'transient blur must not count a leave');
    } finally { await act(async () => root.unmount()); }
});

await t.test('joining while hidden restores the teacher status when focus returns', async () => {
    reset(); hidden = true; focused = false;
    const { root, socket } = await mountGame();
    try {
        await act(async () => socket.welcome());
        assert.equal(socket.reports.at(-1)?.inTab, false);
        await returnToGame();
        assert.equal(socket.reports.at(-1)?.inTab, true, 'a background join must not leave the student permanently away');
        assert.equal(document.querySelector('.tab-focus-overlay'), null);
    } finally { await act(async () => root.unmount()); }
});

await t.test('switching applications and fast focus cycles keep the final state and total', async () => {
    reset(); const { root, socket } = await mountGame();
    try {
        await act(async () => socket.welcome()); socket.sent = [];
        await act(async () => {
            focused = false; window.dispatchEvent(new dom.window.Event('blur'));
            await new Promise(resolve => setTimeout(resolve, 5));
        });
        assert.deepEqual(socket.reports, [{ t: 'tab-focus', inTab: false, count: 1 }], 'an application switch is detected while the page remains visible');
        await returnToGame(); socket.sent = [];
        await act(async () => {
            for (let i = 0; i < 3; i++) {
                hidden = true; focused = false; document.dispatchEvent(new dom.window.Event('visibilitychange'));
                hidden = false; focused = true; window.dispatchEvent(new dom.window.Event('focus'));
            }
        });
        assert.deepEqual(socket.reports.map(message => [message.inTab, message.count]), [[false, 2], [true, 2], [false, 3], [true, 3], [false, 4], [true, 4]]);
        assert.equal(document.querySelector('.tab-focus-overlay'), null);
    } finally { await act(async () => root.unmount()); }
});

await t.test('welcome count is synchronized before the online report and offline leaves survive reconnect/reload', async () => {
    reset(); let mounted = await mountGame();
    try {
        await act(async () => mounted.socket.welcome(5));
        assert.equal(mounted.socket.reports.at(-1)?.count, 5, 'online must use the server count synchronously');
        await act(async () => mounted.socket.drop());
        await leave(); await returnToGame();
        await act(async () => { window.dispatchEvent(new dom.window.Event('online')); });
        const reconnected = sockets.at(-1)!;
        await act(async () => reconnected.welcome(5));
        assert.equal(reconnected.reports.at(-1)?.count, 6);
        await act(async () => mounted.root.unmount());
        mounted = await mountGame();
        await act(async () => mounted.socket.welcome(5));
        assert.equal(mounted.socket.reports.at(-1)?.count, 6, 'unsent local history survives reload');
    } finally { await act(async () => mounted.root.unmount()); }
});

await t.test('a reused class PIN cannot carry tab counts into another game', async () => {
    reset(); let mounted = await mountGame();
    try {
        await act(async () => mounted.socket.welcome(4));
        await act(async () => mounted.root.unmount());
        mounted = await mountGame();
        await act(async () => mounted.socket.welcome(0, 'game-b'));
        assert.equal(mounted.socket.reports.at(-1)?.count, 0);
        assert.equal(document.querySelector('.badge-tab-warning'), null);
    } finally { await act(async () => mounted.root.unmount()); }
});

await t.test('queued blur detection is cancelled when the game unmounts', async () => {
    reset(); const { root, socket } = await mountGame();
    await act(async () => socket.welcome());
    socket.sent = [];
    const saved = Object.entries(sessionStorage);
    await act(async () => {
        focused = false; window.dispatchEvent(new dom.window.Event('blur'));
        root.unmount();
        await new Promise(resolve => setTimeout(resolve, 5));
    });
    assert.equal(socket.reports.length, 0);
    assert.deepEqual(Object.entries(sessionStorage), saved, 'unmounted blur must not persist a phantom leave');
});

await t.test('page unload does not count a tab switch and a restored page resumes tracking', async () => {
    reset(); const { root, socket } = await mountGame();
    try {
        await act(async () => socket.welcome()); socket.sent = [];
        const saved = Object.entries(sessionStorage);
        await act(async () => {
            window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide'));
            hidden = true; focused = false;
            document.dispatchEvent(new dom.window.Event('visibilitychange'));
            window.dispatchEvent(new dom.window.Event('blur'));
            await new Promise(resolve => setTimeout(resolve, 5));
        });
        assert.deepEqual(socket.reports, [], 'reload/unload visibility events are not departures to another tab');
        assert.deepEqual(Object.entries(sessionStorage), saved);
        await act(async () => {
            hidden = false; focused = true;
            window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted: true }));
        });
        await leave();
        assert.deepEqual(socket.reports.at(-1), { t: 'tab-focus', inTab: false, count: 1 });
    } finally { await act(async () => root.unmount()); }
});

await t.test('the teacher page passes live tab state to the student drawer', async () => {
    reset(); sessionStorage.setItem('pixel-plaza-teacher-session', 'teacher-token');
    const online = { studentKey: 'student-a', name: 'Alex', x: 100, y: 100, zone: null, inTab: false, tabSwitches: 3, tabAwayAt: 1000 };
    let connected = true;
    globalThis.fetch = async url => {
        const route = String(url);
        if (route.includes('/themes')) return Response.json({ themes: [theme], trash: [] });
        if (route.includes('/conversations')) return Response.json({ studentKey: 'student-a', names: {}, lines: [] });
        assert.ok(route.endsWith('/status'), route);
        return Response.json({ open: true, game: { id: 'game-a', name: 'Class A', vision: 450, randomNames: false }, pin: '123456',
            games: [], campaigns: [], campaign: null, warmup: null, entries: [], muted: [], online: connected ? [online] : [], realNames: {},
            support: { alerts: [], students: [online] }, sound: { off: [], now: Date.now(), plays: [] } });
    };
    const root = createRoot(document.getElementById('root')!);
    try {
        await act(async () => root.render(<MemoryRouter><Teacher /></MemoryRouter>));
        assert.ok(document.querySelector('.live-tile-tab-away-badge'));
        await act(async () => (document.querySelector('.live-tile') as HTMLButtonElement).click());
        assert.match(document.querySelector('.drawer-top')!.textContent!, /Left tab right now/);
        assert.match(document.querySelector('.drawer-top')!.textContent!, /Left tab 3×/);
        connected = false;
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 2100)); });
        assert.match(document.querySelector('.drawer-top')!.textContent!, /not in the plaza/);
        assert.match(document.querySelector('.drawer-top')!.textContent!, /Left tab 3×/, 'offline history stays visible in the drawer');
        assert.equal(document.querySelector('.drawer-tab-away'), null, 'disconnection is distinct from leaving a tab');
    } finally { await act(async () => root.unmount()); }
});

dom.window.close();
});
