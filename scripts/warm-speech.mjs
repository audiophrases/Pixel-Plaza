// A plain HTTP request wakes Render without synthesizing or sending student text.
// Runs independently of classroom startup; an offline bridge must not stop class.
import fs from 'node:fs';
import path from 'node:path';

try {
    const vars = path.join(import.meta.dirname, '..', '.dev.vars');
    if (fs.existsSync(vars)) process.loadEnvFile(vars);
    // Keep the fallback in sync with worker/speech.ts.
    const url = new URL(process.env.EDGE_TTS_URL || 'https://pinplay-tts-bridge-27sk.onrender.com/tts');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
        process.exitCode = 1;
    } else {
        // Even a 404 at the root wakes the service; no bridge secret is needed.
        const response = await fetch(new URL('/', url), {
            redirect: 'manual', signal: AbortSignal.timeout(120_000),
        });
        await response.body?.cancel();
    }
} catch {
    // Startup continues normally if Render or the network is unavailable.
}
