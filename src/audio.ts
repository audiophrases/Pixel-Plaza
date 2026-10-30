// One optional audio queue per player. Text and game progress never wait for sound.
export type SoundState = {
  muted: boolean;
  locked: boolean; // the teacher turned this student's sound off; only the teacher turns it back on
  messageId: string | null;
  needsInteraction: boolean;
  error: string;
};

type SoundJob = { kind: 'speech'; id: string } | { kind: 'goal'; path: string };
export type SoundDependencies = {
  speech: (id: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  effect: (path: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  play: (bytes: ArrayBuffer, signal: AbortSignal, volume: number) => Promise<void>;
};

const muteKey = (studentKey: string) => `pixelplaza.sound-muted.v1:${studentKey}`;
export function soundIsMuted(studentKey: string): boolean {
  try { return localStorage.getItem(muteKey(studentKey)) === 'true'; }
  catch { return false; } // sound starts ON, including when storage is unavailable
}

let context: AudioContext | null = null;
const unlocked = new Set<() => void>();
class NeedsInteraction extends Error {}

function soundContext(): AudioContext {
  if (context) return context;
  const browser = window as Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Audio = browser.AudioContext ?? browser.webkitAudioContext;
  if (!Audio) throw new Error('Sound is unavailable in this browser. You can keep playing.');
  context = new Audio();
  return context;
}

// Called synchronously by join/save and pointer/key gestures, before any fetch.
export function unlockSound(): void {
  try {
    const audio = soundContext();
    void audio.resume().then(() => {
      if (audio.state === 'running') for (const listener of unlocked) listener();
    }).catch(() => { /* the player can use Enable sound if the browser blocks it */ });
  } catch { /* audio is optional */ }
}

async function playBytes(bytes: ArrayBuffer, signal: AbortSignal, volume: number): Promise<void> {
  if (signal.aborted) return;
  const audio = soundContext();
  if (audio.state !== 'running') throw new NeedsInteraction();
  const buffer = await audio.decodeAudioData(bytes.slice(0)).catch(() => {
    throw new Error('This sound could not be played. You can keep reading.');
  });
  if (signal.aborted) return;
  await new Promise<void>((resolve, reject) => {
    const source = audio.createBufferSource();
    const gain = audio.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain).connect(audio.destination);
    let timer: ReturnType<typeof setTimeout>;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      source.onended = null;
      source.disconnect(); gain.disconnect();
      resolve();
    };
    const stop = () => { try { source.stop(); } catch { /* already ended */ } finish(); };
    signal.addEventListener('abort', stop, { once: true });
    source.onended = finish;
    timer = setTimeout(stop, Math.min(120_000, buffer.duration * 1000 + 2000));
    try { source.start(); }
    catch (cause) { stop(); reject(cause); }
  });
}

async function fetchAudio(path: string, signal: AbortSignal, token?: string, body?: object): Promise<ArrayBuffer> {
  const timeout = AbortSignal.timeout(55_000); // the shared Render service may be waking up
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.any([signal, timeout]), cache: 'no-store',
    headers: token ? { 'Content-Type': 'application/json', 'x-student-token': token } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => { throw new Error('Sound is temporarily unavailable. You can keep playing.'); });
  if (response.status === 403) throw new Error('Your teacher turned your sound off.');
  if (!response.ok) throw new Error('Could not play this message. You can try Listen again.');
  if (!(response.headers.get('Content-Type') ?? '').startsWith('audio/')) throw new Error('Speech is temporarily unavailable. You can keep reading.');
  // Do not let a faulty upstream put an unbounded recording into the browser.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Sound is temporarily unavailable.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('This sound could not be played.'); }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result.buffer;
}

export class GameAudio {
  private state: SoundState;
  private listeners = new Set<(state: SoundState) => void>();
  private queue: SoundJob[] = [];
  private seen = new Set<string>();
  private controller: AbortController | null = null;
  private thunderController: AbortController | null = null;
  private busy = false;
  private disposed = false;
  private generation = 0;
  private clip = 0;
  private dependencies: SoundDependencies;
  private studentKey: string;
  private resume = () => {
    if (this.disposed || this.silent || !this.state.needsInteraction) return;
    this.update({ needsInteraction: false });
    void this.drain();
  };

  constructor(token: string, studentKey: string, dependencies?: SoundDependencies) {
    this.studentKey = studentKey;
    this.state = { muted: soundIsMuted(studentKey), locked: false, messageId: null, needsInteraction: false, error: '' };
    this.dependencies = dependencies ?? {
      speech: (id, signal) => fetchAudio('/api/plaza/speech', signal, token, { id }),
      effect: (path, signal) => fetchAudio(path, signal),
      play: playBytes,
    };
    unlocked.add(this.resume);
  }

  get snapshot(): SoundState { return { ...this.state }; }
  private get silent(): boolean { return this.state.muted || this.state.locked; }
  subscribe(listener: (state: SoundState) => void): () => void {
    this.listeners.add(listener); listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  }

  private update(next: Partial<SoundState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  setMuted(muted: boolean): void {
    try { localStorage.setItem(muteKey(this.studentKey), String(muted)); } catch { /* storage disabled */ }
    this.stop();
    this.update({ muted, needsInteraction: false });
    if (!muted) unlockSound();
  }

  // The teacher's switch: it stops what is playing and outranks the student's own button.
  setLocked(locked: boolean): void {
    if (locked === this.state.locked) return;
    if (locked) this.stop();
    this.update({ locked, needsInteraction: false });
  }

  // Even muted/history messages count as seen: unmuting or reconnecting must not
  // cause a backlog of old chat to start speaking.
  receive(id: string, history = false): void {
    if (!id || this.seen.has(id) || this.disposed) return;
    this.seen.add(id);
    if (!history && !this.silent) this.enqueue({ kind: 'speech', id });
  }

  replay(id: string): void {
    if (this.disposed || this.silent) return;
    unlockSound();
    this.stop();
    this.enqueue({ kind: 'speech', id });
  }

  goal(): void {
    if (this.disposed || this.silent) return;
    this.clip = this.clip % 4 + 1;
    this.enqueue({ kind: 'goal', path: `/sounds/pinplay/correct-${this.clip}.mp3` });
  }

  // A soft two-note chime for a private message, made here and played alongside whatever is speaking: the message is
  // still read aloud in its turn. Silent until the browser has allowed sound.
  ping(): void {
    if (this.disposed || this.silent) return;
    try {
      const audio = soundContext();
      if (audio.state !== 'running') return;
      [880, 1320].forEach((frequency, i) => {
        const start = audio.currentTime + i * 0.12;
        const tone = audio.createOscillator(); const gain = audio.createGain();
        tone.type = 'sine'; tone.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
        tone.connect(gain).connect(audio.destination);
        tone.start(start); tone.stop(start + 0.3);
      });
    } catch { /* no sound here: the card still shows */ }
  }

  // Thunder starts alongside the bolt, even while a chat message is speaking.
  thunder(): void {
    if (this.disposed || this.silent) return;
    this.thunderController?.abort();
    const controller = new AbortController();
    this.thunderController = controller;
    void (async () => {
      try {
        const bytes = await this.dependencies.effect('/sounds/thunder.mp3', controller.signal);
        if (!controller.signal.aborted) await this.dependencies.play(bytes, controller.signal, 0.5);
      } catch (cause) {
        if (!controller.signal.aborted) {
          if (cause instanceof NeedsInteraction) this.update({ needsInteraction: true });
          else this.update({ error: 'Thunder sound is temporarily unavailable.' });
        }
      } finally {
        if (this.thunderController === controller) this.thunderController = null;
      }
    })();
  }

  retract(id: string): void {
    this.queue = this.queue.filter(job => job.kind !== 'speech' || job.id !== id);
    if (this.state.messageId === id) {
      this.generation += 1;
      this.controller?.abort();
      this.update({ messageId: null });
    }
  }

  stop(): void {
    this.thunderController?.abort();
    this.thunderController = null;
    this.generation += 1;
    this.queue = [];
    this.controller?.abort();
    this.update({ messageId: null, error: '' });
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    unlocked.delete(this.resume);
    this.listeners.clear();
  }

  private enqueue(job: SoundJob): void {
    this.queue.push(job);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.busy || this.disposed || this.silent || this.state.needsInteraction) return;
    this.busy = true;
    try {
      while (this.queue.length && !this.disposed && !this.silent && !this.state.needsInteraction) {
        const job = this.queue.shift()!;
        const generation = this.generation;
        const controller = new AbortController();
        this.controller = controller;
        this.update({ messageId: job.kind === 'speech' ? job.id : null, error: '' });
        try {
          const bytes = await (job.kind === 'speech'
            ? this.dependencies.speech(job.id, controller.signal)
            : this.dependencies.effect(job.path, controller.signal));
          if (!controller.signal.aborted && generation === this.generation) {
            await this.dependencies.play(bytes, controller.signal, job.kind === 'goal' ? 0.5 : 1);
          }
        } catch (cause) {
          if (!controller.signal.aborted && generation === this.generation) {
            if (cause instanceof NeedsInteraction) {
              this.queue.unshift(job);
              this.update({ needsInteraction: true });
            } else this.update({ error: cause instanceof Error ? cause.message : 'Sound is temporarily unavailable. You can keep playing.' });
          }
        } finally {
          this.controller = null;
          this.update({ messageId: null });
        }
      }
    } finally { this.busy = false; }
  }
}

let preview: AbortController | null = null;
export function stopVoicePreview(): void { preview?.abort(); preview = null; }

export async function previewCharacterVoice(voice: string, token: string, studentKey?: string): Promise<void> {
  stopVoicePreview();
  if (studentKey && soundIsMuted(studentKey)) throw new Error('Sound is muted. Turn sound on in the Plaza to preview your voice.');
  unlockSound();
  const controller = new AbortController();
  preview = controller;
  try {
    const bytes = await fetchAudio('/api/plaza/voice-preview', controller.signal, token, { voice });
    if (!controller.signal.aborted) await playBytes(bytes, controller.signal, 1);
  } catch (cause) {
    if (!controller.signal.aborted) {
      if (cause instanceof NeedsInteraction) throw new Error('Click Hear this voice again to enable sound.');
      throw cause;
    }
  } finally { if (preview === controller) preview = null; }
}
