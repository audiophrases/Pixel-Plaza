import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const root = path.join(import.meta.dirname, '..');
const outfile = path.join(root, '.wrangler', 'teacher-character-check.mjs');
fs.mkdirSync(path.dirname(outfile), { recursive: true });
await build({ entryPoints: [path.join(root, 'scripts', 'teacher-character-check.tsx')], outfile, bundle: true, platform: 'node', format: 'esm',
    loader: { '.css': 'empty' }, jsx: 'automatic', external: ['jsdom'], logLevel: 'error',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
process.exit(spawnSync(process.execPath, [outfile], { stdio: 'inherit', cwd: root }).status ?? 1);
