import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
const root = path.join(import.meta.dirname, '..');
const out = path.join(root, '.wrangler', 'activity-history-check.mjs');
fs.mkdirSync(path.dirname(out), { recursive: true });
await build({ entryPoints: [path.join(root, 'scripts', 'activity-history-check.tsx')], outfile: out, bundle: true, platform: 'node', format: 'esm',
    loader: { '.css': 'empty' }, jsx: 'automatic', external: ['jsdom'], logLevel: 'error',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
process.exit(spawnSync(process.execPath, [out], { stdio: 'inherit', cwd: root }).status ?? 1);
