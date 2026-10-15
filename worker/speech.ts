// Reuse PinPlay's Render Edge TTS bridge directly. Its public quiz-cache proxy
// is deliberately bypassed for student/private chat.
export const DEFAULT_EDGE_TTS_URL = 'https://pinplay-tts-bridge-27sk.onrender.com/tts';
export const VOICE_SAMPLE = 'Hello! This is my voice in Pixel Plaza.';
type SpeechEnv = { EDGE_TTS_URL?: string; EDGE_TTS_SECRET?: string };
export type SpokenMessage = { text: string; voice: string };

export async function synthesize(env: SpeechEnv, message: SpokenMessage, signal: AbortSignal): Promise<Response | null> {
    try {
        const url = new URL(env.EDGE_TTS_URL || DEFAULT_EDGE_TTS_URL);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
        const response = await fetch(url, {
            method: 'POST', redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(50_000)]),
            headers: { 'Content-Type': 'application/json', ...(env.EDGE_TTS_SECRET ? { Authorization: `Bearer ${env.EDGE_TTS_SECRET}` } : {}) },
            body: JSON.stringify({ ...message, rate: '+0%' }),
        });
        const length = Number(response.headers.get('Content-Length') || 0);
        if (!response.ok || !response.body || !(response.headers.get('Content-Type') || '').startsWith('audio/') || length > 4 * 1024 * 1024) {
            await response.body?.cancel();
            return null;
        }
        let size = 0;
        const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                size += chunk.byteLength;
                if (size > 4 * 1024 * 1024) controller.error(new Error('Audio response exceeds the limit.'));
                else controller.enqueue(chunk);
            },
        }));
        return new Response(stream, { headers: {
            'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        } });
    } catch { return null; } // upstream errors must never log chat text or bridge credentials
}
