import type { AvatarConfig } from './utils/AvatarRenderer';
import type { QuestView } from '../shared/campaign';
import type { WarmupView } from '../shared/warmup';

export type PlazaPlayer = AvatarConfig & { id: string; name: string; x: number; y: number };
// A hint on one chat message, from the server. Never a refusal.
export type GrammarHint = { ok: true } | { ok: false; corrected: string; why: string };
export type PlazaStatus = { state: 'connecting' | 'online' | 'reconnecting' | 'stopped'; message?: string };
export type PlazaEvent =
  | { t: 'roster' } // everyone was replaced: first join, or back after a dropped connection
  | { t: 'join'; player: PlazaPlayer }
  | { t: 'leave'; id: string }
  | { t: 'move'; id: string; x: number; y: number }
  | { t: 'emote'; id: string; emote: string }
  | { t: 'chat'; id?: string; sender: string; text: string; ts: number; whisper?: boolean; to?: string; marks?: [number, number][] }
  | { t: 'retract'; id: string } // the teacher took a posted message down
  | { t: 'notice'; level: 'info' | 'warning'; text: string; cid?: string } // cid: the chat message this answers
  | { t: 'result'; cid: string }
  | { t: 'snap'; x: number; y: number }                                    // the server put you back: your last move was not possible
  | { t: 'warmup'; warmup: WarmupView | null }                               // your part of the warm-up, or null when it is over
  | { t: 'warmup-answered'; correct: boolean; wait: boolean }
  | { t: 'vision'; radius: number }                                        // how far you see, in map pixels; 0 is everyone
  | { t: 'alias'; name: string; kept: boolean }                            // your made-up name, and whether you have kept it
  | { t: 'rename'; id: string; name: string }                              // a namesake arrived: this player's shown name changed
  | { t: 'quest'; quest: QuestView | null }                                  // this student's view of the campaign
  | { t: 'answered'; objective: string; correct: boolean; wait: boolean };                                          // that message was posted at once

// As in PinPlay's live-socket.js: a connection can die without closing (a laptop
// lid, Wi-Fi roaming), and only a missing pong shows it. The room answers
// 'ping' without waking up.
const PING_EVERY_MS = 10000;
const PONG_WITHIN_MS = 5000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
const CLOSE_REPLACED = 4009;
const CLOSE_CLASS_CLOSED = 4002;
const HINT_WAIT_MS = 4000; // a slow hint is dropped: the message is sent as it is

// A refusal that retrying cannot fix, such as a wrong PIN or a closed class.
class Refused extends Error {}

// One student's connection to the plaza. It keeps the roster, so a scene that
// starts late can draw everyone, and rejoins by itself after a drop.
export class PlazaConnection {
  players = new Map<string, PlazaPlayer>();
  selfId = '';
  vision = 0; // how far this student sees, from the server; 0 shows everyone
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

  // A null avatar keeps the one saved on the server.
  constructor(pin: string, token: string, avatar: AvatarConfig | null) {
    this.pin = pin;
    this.token = token;
    this.avatar = avatar;
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
    this.ws.send(JSON.stringify(message));
    return true;
  }

  // Asks whether a message has a clear grammar mistake. Resolves to "fine" when
  // anything is slow, offline or unsure, so it can never stop a message.
  check(text: string): Promise<GrammarHint> {
    return new Promise(resolve => {
      const id = crypto.randomUUID();
      let timer = 0;
      const finish = (hint: GrammarHint) => {
        window.clearTimeout(timer);
        if (this.hints.delete(id)) resolve(hint);
      };
      timer = window.setTimeout(() => finish({ ok: true }), HINT_WAIT_MS);
      this.hints.set(id, finish);
      if (!this.send({ t: 'check', id, text })) finish({ ok: true });
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
      this.selfId = message.id;
      this.players = new Map((message.players as PlazaPlayer[]).map(player => [player.id, player]));
      this.fails = 0;
      this.setStatus({ state: 'online' });
      this.emit({ t: 'roster' });
      return;
    }
    if (message.t === 'checked') {
      this.hints.get(message.id)?.(message.ok ? { ok: true } : { ok: false, corrected: String(message.corrected), why: String(message.why) });
      return;
    }
    if (message.t === 'join') this.players.set(message.player.id, message.player);
    if (message.t === 'vision') this.vision = message.radius;
    if (message.t === 'rename') { const player = this.players.get(message.id); if (player) player.name = message.name; }
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
