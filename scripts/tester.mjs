// Tries the plaza on this PC alone: a throwaway server with a few made-up
// students and the teacher, each in its own browser tab. No Google, no internet,
// and nothing shared with the real class or the online site.
//
//   npm run tester               (4 players)
//   npm run tester -- 6          (6 players, up to 8)
//   npm run tester -- 4 noai     (no OpenAI checks, so no cost)
//   npm run tester -- 4 random   (the game gives made-up names, as a new game does by default)
//
// The OpenAI key in .dev.vars is used, so grammar hints and moderation work as in class.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
let state = path.join(root, '.wrangler', 'tester');
const port = Number(process.env.TESTER_PORT || 8788);
const origin = `http://localhost:${port}`;
const NAMES = ['Ana', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hal'];
const args = process.argv.slice(2);
const count = Math.min(Math.max(Number(args.find(arg => /^\d+$/.test(arg))) || 4, 1), NAMES.length);
const noAi = args.includes('noai');
const randomNames = args.includes('random');
const teacherPassword = 'tester'; // only this throwaway server accepts it

// Every run starts with an empty plaza. If an earlier run still holds the folder, use a fresh one.
try { fs.rmSync(state, { recursive: true, force: true }); } catch { state += `-${Date.now()}`; }

console.log(`\n  Starting a test plaza with ${count} players${noAi ? ' (OpenAI off)' : ''}. Keep this window open; Ctrl+C stops it.\n`);
const child = spawn(process.execPath, [wrangler, 'dev', '--port', String(port), '--persist-to', state,
    '--show-interactive-dev-session=false',
    '--var', 'TESTER_MODE:1',
    '--var', `CREATE_PASSWORD_HASH:${crypto.createHash('sha256').update(teacherPassword).digest('hex')}`,
    ...(noAi ? ['--var', 'OPENAI_API_KEY:'] : []),
    '--var', 'PINPLAY_API_URL:'], {
    cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'inherit'
});
child.on('exit', code => process.exit(code ?? 0));

const post = async (url, body, headers = {}) => {
    const response = await fetch(origin + url, {
        method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `${url} answered ${response.status}`);
    return result;
};

for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch { /* still starting */ }
    if (attempt > 90) { console.error('The test server did not start.'); child.kill(); process.exit(1); }
    await new Promise(resolve => setTimeout(resolve, 1000));
}

let pin;
try {
    const { token } = await post('/api/teacher/login', { password: teacherPassword });
    ({ pin } = await post('/api/teacher/game', { name: 'Class 1', randomNames }, { 'x-teacher-session': token }));
} catch (error) {
    console.error(`Could not open the test class: ${error.message}`);
    child.kill();
    process.exit(1);
}

// One tab each; the teacher first. `start` hands the address to the default browser.
const tabs = [`${origin}/teacher?autologin=tester`, ...NAMES.slice(0, count).map(name => `${origin}/?tester=${name}&pin=${pin}`)];
for (const url of process.env.TESTER_NO_OPEN ? [] : tabs) {
    spawn('cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')], { stdio: 'ignore', windowsHide: true });
    await new Promise(resolve => setTimeout(resolve, 700));
}
console.log(`
  Test class is open. PIN ${pin}
  Teacher tab: ${origin}/teacher (signs in by itself; password "${teacherPassword}")
  Players: ${NAMES.slice(0, count).join(', ')}, one tab each. Press F2 in a game tab to see the walls.
`);
