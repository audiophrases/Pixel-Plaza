import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio, soundIsMuted, unlockSound } from '../../src/audio.ts';
import { DEFAULT_VOICE, ENGLISH_VOICES, normalizeVoice } from '../../shared/voices.ts';
import { sanitizeAvatar } from '../rules.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const bytes = new ArrayBuffer(1);

test('character voices preserve old looks and accept only the shared English catalogue', () => {
    assert.equal(ENGLISH_VOICES.length, 34);
    assert.equal(new Set(ENGLISH_VOICES.map(voice => voice.id)).size, 34);
    assert.equal(normalizeVoice(undefined), DEFAULT_VOICE);
    assert.equal(normalizeVoice('made-up'), DEFAULT_VOICE);
    const voice = 'en-AU-NatashaNeural';
    assert.equal(sanitizeAvatar({ hair: 3, voice }).voice, voice);
    assert.equal(sanitizeAvatar({ voice: 'not-a-voice' }), null);
    assert.equal(sanitizeAvatar({ voice: 7 }), null);
    assert.equal(sanitizeAvatar({ hair: 3 }).hair, 3);
});

test('new chat speaks in order once; history is quiet and goals rotate the PinPlay clips', async () => {
    const spoken = []; const fetched = []; const effects = []; const finishes = [];
    const sound = new GameAudio('private-token', 'ordered', {
        speech: async id => { fetched.push(id); return bytes; },
        effect: async path => { effects.push(path); return bytes; },
        play: async () => { spoken.push('start'); await new Promise(resolve => finishes.push(resolve)); },
    });
    try {
        assert.equal(sound.snapshot.muted, false, 'sound starts ON');
        sound.receive('old-message', true);
        sound.receive('one'); sound.receive('one'); sound.receive('two'); sound.goal();
        await tick();
        assert.deepEqual(fetched, ['one']);
        assert.equal(sound.snapshot.messageId, 'one');
        finishes.shift()(); await tick();
        assert.deepEqual(fetched, ['one', 'two']);
        finishes.shift()(); await tick();
        assert.deepEqual(effects, ['/sounds/pinplay/correct-1.mp3']);
        finishes.shift()(); await tick();
        for (let index = 0; index < 4; index++) {
            sound.goal(); await tick(); finishes.shift()(); await tick();
        }
        assert.deepEqual(effects.map(path => path.match(/correct-(\d)/)[1]), ['1', '2', '3', '4', '1']);
        assert.equal(spoken.length, 7);
    } finally { sound.dispose(); }
});

test('muting aborts in-flight work and discards queued/muted messages; choice persists per student', async () => {
    const original = globalThis.localStorage;
    const store = new Map();
    globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
    const fetched = []; const played = []; let finish;
    let requestSignal;
    const dependencies = {
        speech: async (id, signal) => { fetched.push(id); requestSignal = signal; if (id === 'slow') await new Promise(resolve => { finish = resolve; }); return bytes; },
        effect: async () => bytes,
        play: async () => { played.push('played'); },
    };
    const sound = new GameAudio('never-stored-token', 'alice', dependencies);
    let restored;
    try {
        sound.receive('slow'); sound.receive('queued');
        sound.setMuted(true);
        assert.equal(requestSignal.aborted, true);
        sound.receive('arrived-while-muted'); sound.goal();
        finish(); await tick();
        assert.equal(played.length, 0, 'late network completion cannot play after mute');
        assert.deepEqual(fetched, ['slow']);
        restored = new GameAudio('new-private-token', 'alice', dependencies);
        assert.equal(restored.snapshot.muted, true);
        assert.equal(soundIsMuted('bob'), false, 'another student still starts with sound ON');
        assert.ok(!JSON.stringify([...store]).includes('token'));
        sound.setMuted(false);
        sound.receive('arrived-while-muted'); sound.receive('fresh');
        await tick();
        assert.deepEqual(fetched, ['slow', 'fresh'], 'unmute starts with future chat, without a backlog');
        assert.equal(played.length, 1);
    } finally { sound.dispose(); restored?.dispose(); globalThis.localStorage = original; }
});

test('retracting cancels active speech and removes queued speech; replay can retry a failed message', async () => {
    const fetched = []; const stops = []; let fail = true;
    const sound = new GameAudio('', 'retract', {
        speech: async id => { fetched.push(id); if (id === 'failed' && fail) throw new Error('Temporarily offline'); return bytes; },
        effect: async () => bytes,
        play: async (_bytes, signal) => { await new Promise(resolve => signal.addEventListener('abort', () => { stops.push('stopped'); resolve(); }, { once: true })); },
    });
    try {
        sound.receive('first'); sound.receive('withdrawn'); sound.receive('failed');
        await tick();
        sound.retract('withdrawn'); sound.retract('first'); await tick();
        assert.deepEqual(stops, ['stopped']);
        assert.deepEqual(fetched, ['first', 'failed']);
        assert.equal(sound.snapshot.error, 'Temporarily offline');
        fail = false;
        sound.replay('failed'); await tick();
        assert.deepEqual(fetched, ['first', 'failed', 'failed']);
        sound.dispose(); await tick();
        assert.equal(stops.length, 2, 'leaving the game stops playback');
    } finally { sound.dispose(); }
});

test('browser autoplay blocking keeps sound ON and resumes pending chat after an interaction', async () => {
    const previous = { window: globalThis.window, fetch: globalThis.fetch };
    const requests = []; const sources = [];
    class Context {
        state = 'suspended';
        destination = {};
        resume() { this.state = 'running'; return Promise.resolve(); }
        decodeAudioData() { return Promise.resolve({ duration: 0.01 }); }
        createGain() { return { gain: { value: 1 }, connect() { return this; }, disconnect() {} }; }
        createBufferSource() {
            const source = { onended: null, connect() { return this; }, disconnect() {},
                start() { sources.push(source); }, stop() { this.onended?.(); } };
            return source;
        }
    }
    globalThis.window = { AudioContext: Context };
    globalThis.fetch = async (path, init) => {
        requests.push({ path, body: JSON.parse(init.body), headers: init.headers });
        return new Response('mp3', { headers: { 'Content-Type': 'audio/mpeg' } });
    };
    const sound = new GameAudio('signed-student', 'browser');
    try {
        sound.receive('message-id'); await tick();
        assert.equal(sound.snapshot.muted, false);
        assert.equal(sound.snapshot.needsInteraction, true);
        assert.equal(sources.length, 0);
        unlockSound(); await tick();
        assert.equal(sound.snapshot.needsInteraction, false);
        assert.equal(sources.length, 1);
        assert.deepEqual(requests.at(-1).body, { id: 'message-id' }, 'the browser sends a message id, never arbitrary text or a forged voice');
        assert.equal(requests.at(-1).headers['x-student-token'], 'signed-student');
        sound.setMuted(true); await tick();
        assert.equal(sound.snapshot.messageId, null);
    } finally { sound.dispose(); Object.assign(globalThis, previous); }
});
