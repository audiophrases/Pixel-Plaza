import type { AvatarConfig } from './utils/AvatarRenderer';
import { messageId } from './utils/messageId.ts';
import type { AnswerFeedback, BoardView, QuestView } from '../shared/campaign';
import type { WarmupView } from '../shared/warmup';
import type { AttemptSource, StudentSupport } from '../shared/support';
import type { Style } from '../shared/levels';
import type { Theme } from '../shared/theme';

export type PlazaPlayer = AvatarConfig & { id: string; name: string; x: number; y: number; style?: Style; frozenUntil?: number; downUntil?: number };
// A hint on one chat message, from the server. Never a refusal.
export type GrammarHint = { ok: true } | { ok: false; corrected: string; why: string };
export type PlazaStatus = { state: 'connecting' | 'online' | 'reconnecting' | 'stopped'; message?: string };
export type PlazaEvent =
  | { t: 'magic'; id: string; power: string; frozenUntil: number; downUntil: number }
  | { t: 'rain'; until: number }
  | { t: 'roster' } // everyone was replaced: first join, or back after a dropped connection
  | { t: 'join'; player: PlazaPlayer }
  | { t: 'leave'; id: string }
  | { t: 'move'; id: string; x: number; y: number }
  | { t: 'emote'; id: string; emote: string }
  // all: for the whole plaza; heard: on the sender's own copy, how many classmates it reached
  | { t: 'chat'; id?: string; sender: string; text: string; ts: number; whisper?: boolean; to?: string; all?: boolean; heard?: number; marks?: [number, number][]; voice?: string; history?: boolean }
  | { t: 'typing'; id: string; scope: 'private' | 'nearby' | 'all' } // a classmate is writing a message that will reach you
  | { t: 'retract'; id: string } // the teacher took a posted message down
  | { t: 'notice'; level: 'info' | 'warning'; text: string; cid?: string; id?: string } // cid: the attempt this answers; id: the chat message it is about
  | { t: 'result'; cid: string; id?: string }
  | { t: 'snap'; x: number; y: number }                                    // the server put you back: your last move was not possible
  | { t: 'theme' }                                                         // the game's map changed: draw it again (it is in `theme`)
  | { t: 'warmup'; warmup: WarmupView | null; vocabulary?: string[] }         // your part of the warm-up, or null when it is over
  | { t: 'warmup-answered'; correct: boolean; wait: boolean }
  | { t: 'vision'; radius: number }                                        // how far you see, in map pixels; 0 is everyone
  | { t: 'sound'; off: boolean }                                           // the teacher turned your sound off, or back on
  | { t: 'alias'; name: string; kept: boolean }                            // your made-up name, and whether you have kept it
  | { t: 'rename'; id: string; name: string }                              // a namesake arrived: this player's shown name changed
  | { t: 'names'; names: string[]; changes: { id?: string; from: string; name: string }[] } // the teacher switched to real names
  | { t: 'quest'; quest: QuestView | null }                                  // this student's view of the campaign
  | ({ t: 'board' } & BoardView)                                           // this student's quest board, with or without a campaign
  | ({ t: 'answered' } & AnswerFeedback)
  | { t: 'support'; support: StudentSupport; history?: boolean }
  | { t: 'xp'; xp: number; gained?: number; reason?: string }            // this student's experience; gained and why when it grows
  | { t: 'style'; id: string; style: Style };                             // a player chose a name colour or a flair

// As in PinPlay's live-socket.js: a connection can die without closing (a laptop
// lid, Wi-Fi roaming), and only a missing pong shows it. The room answers
// 'ping' without waking up.
const PING_EVERY_MS = 10000;
const PONG_WITHIN_MS = 5000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
const CLOSE_REPLACED = 4009;
const CLOSE_CLASS_CLOSED = 4002;
const HINT_WAIT_MS = 4000; // a slow hint is dropped: the message is sent as it is
type ClientAttemptSource = Exclude<AttemptSource, 'teacher'>;
type PendingAttempt = ({ t: 'attempt'; id: string; text: string; source: ClientAttemptSource; to?: string; objective?: string }
  | { t: 'attempt-outcome'; id: string; status: string; reason?: string }) & { gameId?: string };

// A refusal that retrying cannot fix, such as a wrong PIN or a closed class.
class Refused extends Error {}

// One student's connection to the plaza. It keeps the roster, so a scene that
// starts late can draw everyone, and rejoins by itself after a drop.
export class PlazaConnection {
  players = new Map<string, PlazaPlayer>();
  selfId = '';
  themeId = '';
  theme: Theme | null = null; // the game's map, sent by the server with the welcome
  vision = 0; // how far this student sees, from the server; 0 shows everyone
  classNames: string[] = []; // every classmate in this game, online or not, for the English word check
  xp = 0; // this student's experience, kept for good
  status: PlazaStatus = { state: 'connecting' };
  private pin: string;
  private token: string;
  private avatar: AvatarConfig | null;
  private listeners = new Set<(event: PlazaEvent) => void>();
  private statusListeners = new Set<(status: PlazaStatus) => void>();
  private ws: WebSocket | null = null;
  private opening = false;
  private stopped = false;
  private fails = 0;
  private pingTimer = 0;
  private pongTimer = 0;
  private retryTimer = 0;
  private hints = new Map<string, (hint: GrammarHint) => void>();
  // Explicit submissions remain here and in scoped browser storage until the
  // server acknowledges them. A socket send alone does not prove receipt.
  private pendingAttempts: PendingAttempt[] = [];
  private sentAttempts = new Set<string>();
  private attemptStorageKey: string | null;
  private currentGameId = '';
  get gameId() { return this.currentGameId; }

  // A null avatar keeps the one saved on the server.
  constructor(pin: string, token: string, avatar: AvatarConfig | null, studentKey?: string) {
    this.pin = pin;
    this.token = token;
    this.avatar = avatar;
    // Use the public student identity, never the authentication credential.
    this.attemptStorageKey = studentKey ? `pixelplaza.pending-attempts.v1:${JSON.stringify([pin, studentKey])}` : null;
    this.pendingAttempts = this.readStoredAttempts();
    document.addEventListener('visibilitychange', this.wake);
    window.addEventListener('online', this.wake);
    void this.open();
  }

  subscribe(listener: (event: PlazaEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  onStatus(listener: (status: PlazaStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }

  send(message: object): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.selfId) return false;
    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch { return false; }
  }

  recordAttempt(text: string, to?: string, source: ClientAttemptSource = 'chat', objective?: string): string {
    const id = messageId();
    this.record({ t: 'attempt', id, text: text.slice(0, 1000), source, ...(to ? { to } : {}),
      ...(objective ? { objective: objective.slice(0, 200) } : {}), ...(this.currentGameId ? { gameId: this.currentGameId } : {}) });
    return id;
  }

  recordAttemptOutcome(id: string, status: string, reason?: string): void {
    this.record({ t: 'attempt-outcome', id, status, ...(reason ? { reason: reason.slice(0, 500) } : {}), ...(this.currentGameId ? { gameId: this.currentGameId } : {}) });
  }

  private record(message: PendingAttempt): void {
    this.pendingAttempts.push(message);
    this.syncStoredAttempts();
    this.flushAttempts();
  }

  private flushAttempts(): void {
    for (const message of this.pendingAttempts) {
      const key = this.attemptKey(message);
      if (this.sentAttempts.has(key)) continue;
      if (!this.send(message)) break;
      this.sentAttempts.add(key);
    }
  }

  private attemptKey(message: Pick<PendingAttempt, 't' | 'id'>): string { return `${message.t}:${message.id}`; }

  private readStoredAttempts(): PendingAttempt[] {
    if (!this.attemptStorageKey) return [];
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(this.attemptStorageKey) ?? '[]');
      if (!Array.isArray(saved)) return [];
      return saved.flatMap((value: any): PendingAttempt[] => {
        if (!value || typeof value.id !== 'string' || value.id.length > 80) return [];
        const game = typeof value.gameId === 'string' && value.gameId.length <= 128 ? { gameId: value.gameId } : {};
        if (value.t === 'attempt' && typeof value.text === 'string' && value.text.length <= 1000
          && ['chat', 'interview', 'answer', 'warmup', 'help'].includes(value.source)) {
          return [{ t: 'attempt', id: value.id, text: value.text, source: value.source,
            ...(typeof value.to === 'string' ? { to: value.to.slice(0, 100) } : {}),
            ...(typeof value.objective === 'string' ? { objective: value.objective.slice(0, 200) } : {}), ...game }];
        }
        if (value.t === 'attempt-outcome' && typeof value.status === 'string' && value.status.length <= 80) {
          return [{ t: 'attempt-outcome', id: value.id, status: value.status, ...(typeof value.reason === 'string' ? { reason: value.reason.slice(0, 500) } : {}), ...game }];
        }
        return [];
      });
    } catch { return []; } // storage unavailable: keep the in-memory queue
  }

  private syncStoredAttempts(acknowledged?: string): void {
    // Another tab for this same student may have queued a submission. Preserve
    // those records when this tab adds or acknowledges one of its own.
    const merged = new Map<string, PendingAttempt>();
    for (const message of [...this.readStoredAttempts(), ...this.pendingAttempts]) {
      const key = this.attemptKey(message);
      if (key !== acknowledged) merged.set(key, message);
    }
    this.pendingAttempts = [...merged.values()];
    if (!this.attemptStorageKey) return;
    try {
      if (this.pendingAttempts.length) window.localStorage.setItem(this.attemptStorageKey, JSON.stringify(this.pendingAttempts));
      else window.localStorage.removeItem(this.attemptStorageKey);
    } catch { /* storage disabled or full: the in-memory queue still reconnects */ }
  }

  // Asks whether a message has a clear grammar mistake. Resolves to "fine" when
  // anything is slow, offline or unsure, so it can never stop a message.
  check(text: string, attemptId?: string): Promise<GrammarHint> {
    return new Promise(resolve => {
      const id = messageId();
      let timer = 0;
      const finish = (hint: GrammarHint) => {
        window.clearTimeout(timer);
        if (this.hints.delete(id)) resolve(hint);
      };
      timer = window.setTimeout(() => finish({ ok: true }), HINT_WAIT_MS);
      this.hints.set(id, finish);
      if (!this.send({ t: 'check', id, text, ...(attemptId ? { attemptId } : {}) })) finish({ ok: true });
    });
  }

  close(): void {
    this.stopped = true;
    this.cleanup();
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
  }

  private emit(event: PlazaEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private setStatus(status: PlazaStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private cleanup(): void {
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.pongTimer);
    window.clearTimeout(this.retryTimer);
    document.removeEventListener('visibilitychange', this.wake);
    window.removeEventListener('online', this.wake);
  }

  private async join(): Promise<string> {
    const response = await fetch('/api/plaza/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-student-token': this.token },
      body: JSON.stringify({ pin: this.pin, avatar: this.avatar })
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && typeof result.ticket === 'string') {
      this.avatar = null; // saved now; rejoining keeps it
      return result.ticket;
    }
    if (response.status >= 400 && response.status < 500) throw new Refused(result.error || 'Could not join the Plaza.');
    throw new Error(result.error || 'Could not reach the Plaza.');
  }

  private async open(): Promise<void> {
    if (this.stopped || this.ws || this.opening) return;
    this.opening = true;
    let ticket: string;
    try {
      ticket = await this.join();
    } catch (error) {
      if (error instanceof Refused) this.stop(error.message);
      else this.retry();
      return;
    } finally {
      this.opening = false;
    }
    if (this.stopped) return;

    const url = new URL('/api/plaza/ws', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('ticket', ticket);
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.pingTimer = window.setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send('ping');
        window.clearTimeout(this.pongTimer);
        this.pongTimer = window.setTimeout(() => this.lost(ws, 0), PONG_WITHIN_MS);
      }, PING_EVERY_MS);
    };
    ws.onmessage = event => {
      if (ws !== this.ws) return;
      window.clearTimeout(this.pongTimer); // anything arriving proves the connection is alive
      if (event.data === 'pong') return;
      try { this.receive(JSON.parse(event.data)); } catch { /* not ours */ }
    };
    ws.onclose = event => this.lost(ws, event.code);
  }

  private receive(message: any): void {
    if (message.t === 'welcome') {
      if (!message.theme || typeof message.theme !== 'object' || typeof message.theme.image !== 'string') {
        this.stop('This map needs an updated page. Reload Pixel Plaza to join.');
        this.ws?.close();
        return;
      }
      // Back after a drop, the map may have changed meanwhile: the page draws it again.
      const changed = !!this.theme && JSON.stringify(this.theme) !== JSON.stringify(message.theme);
      this.theme = message.theme as Theme;
      this.themeId = this.theme.id;
      if (changed) this.emit({ t: 'theme' });
      this.selfId = message.id;
      this.players = new Map((message.players as PlazaPlayer[]).map(player => [player.id, player]));
      if (Array.isArray(message.names)) this.classNames = message.names.filter((name: unknown): name is string => typeof name === 'string');
      this.fails = 0;
      if (typeof message.gameId === 'string') this.currentGameId = message.gameId;
      this.syncStoredAttempts();
      if (this.currentGameId) {
        for (const pending of this.pendingAttempts) pending.gameId ??= this.currentGameId;
        this.syncStoredAttempts();
      }
      this.sentAttempts.clear();
      this.flushAttempts();
      this.setStatus({ state: 'online' });
      this.emit({ t: 'roster' });
      return;
    }
    if (message.t === 'attempt-recorded' && typeof message.id === 'string'
      && (message.kind === 'attempt' || message.kind === 'attempt-outcome')) {
      const key = `${message.kind}:${message.id}`;
      this.pendingAttempts = this.pendingAttempts.filter(pending => this.attemptKey(pending) !== key);
      this.sentAttempts.delete(key);
      this.syncStoredAttempts(key);
      this.flushAttempts();
      return;
    }
    if (message.t === 'checked') {
      this.hints.get(message.id)?.(message.ok ? { ok: true } : { ok: false, corrected: String(message.corrected), why: String(message.why) });
      return;
    }
    // The teacher published a new version of this game's map.
    if (message.t === 'theme') {
      if (!message.theme || typeof message.theme !== 'object' || typeof message.theme.image !== 'string') return;
      this.theme = message.theme as Theme;
      this.themeId = this.theme.id;
      this.emit({ t: 'theme' });
      return;
    }
    if (message.t === 'moves') {
      // Everyone who walked since the last batch, passed on as single moves.
      for (const [id, x, y] of message.moves as [string, number, number][]) this.receive({ t: 'move', id, x, y });
      return;
    }
    if (message.t === 'magic') { const player = this.players.get(message.id); if (player) { player.frozenUntil = message.frozenUntil; player.downUntil = message.downUntil; } }
    if (message.t === 'snap') { const player = this.players.get(this.selfId); if (player) { player.x = message.x; player.y = message.y; } }
    if (message.t === 'join') this.players.set(message.player.id, message.player);
    if (message.t === 'vision') this.vision = message.radius;
    if (message.t === 'xp') this.xp = message.xp;
    if (message.t === 'style') { const player = this.players.get(message.id); if (player) player.style = message.style; }
    if (message.t === 'rename') { const player = this.players.get(message.id); if (player) player.name = message.name; }
    if (message.t === 'names') {
      this.classNames = message.names;
      for (const change of message.changes) { const player = this.players.get(change.id); if (player) player.name = change.name; }
    }
    if (message.t === 'leave') this.players.delete(message.id);
    if (message.t === 'move') {
      const player = this.players.get(message.id);
      if (player) { player.x = message.x; player.y = message.y; }
    }
    this.emit(message as PlazaEvent);
  }

  private lost(ws: WebSocket, code: number): void {
    if (ws !== this.ws) return;
    this.ws = null;
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.pongTimer);
    ws.onclose = null;
    ws.onmessage = null;
    try { ws.close(); } catch { /* already closed */ }
    if (this.stopped) return;
    if (code === CLOSE_REPLACED) this.stop('Pixel Plaza is open in another window or tab.');
    else if (code === CLOSE_CLASS_CLOSED) this.stop('Your teacher closed the class. Join again with the PIN when it reopens.');
    else this.retry(); // includes 4001, an unusable ticket: the next join asks for a new one
  }

  private retry(): void {
    if (this.stopped) return;
    this.fails += 1;
    this.setStatus({ state: 'reconnecting' });
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => void this.open(), BACKOFF_MS[Math.min(this.fails, BACKOFF_MS.length) - 1]);
  }

  private stop(message: string): void {
    this.stopped = true;
    this.cleanup();
    this.setStatus({ state: 'stopped', message });
  }

  // Back from a locked screen or without network: check at once.
  private wake = (): void => {
    if (this.stopped || document.visibilityState === 'hidden') return;
    if (!this.ws) {
      window.clearTimeout(this.retryTimer);
      void this.open();
    } else if (this.ws.readyState === WebSocket.OPEN) {
      const ws = this.ws;
      ws.send('ping');
      window.clearTimeout(this.pongTimer);
      this.pongTimer = window.setTimeout(() => this.lost(ws, 0), PONG_WITHIN_MS);
    }
  };
}
