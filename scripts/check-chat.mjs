import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const root = path.join(import.meta.dirname, '..');
const outfile = path.join(root, '.wrangler', 'chat-ui-check.mjs');
fs.mkdirSync(path.dirname(outfile), { recursive: true });
await build({
    entryPoints: [path.join(root, 'scripts', 'chat-ui-check.tsx')], outfile, bundle: true, platform: 'node', format: 'esm',
    loader: { '.css': 'empty' }, jsx: 'automatic', external: ['jsdom'], logLevel: 'error',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{ name: 'student-ui-test-boundaries', setup(build) {
        build.onLoad({ filter: /[/\\]PhaserGame\.tsx$/ }, () => ({ contents: 'export default function PhaserGame() { return null; }', loader: 'tsx' }));
        build.onLoad({ filter: /[/\\]spellingData\.ts$/ }, () => ({ contents: "export async function loadChecker() { return text => text.includes('entenc') ? [{word:'entenc',suggestions:[]}] : []; }", loader: 'ts' }));
    } }],
});
process.exit(spawnSync(process.execPath, [outfile], { stdio: 'inherit', cwd: root }).status ?? 1);
