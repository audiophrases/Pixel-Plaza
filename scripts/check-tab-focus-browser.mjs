// Start npm run dev, then npm run check:tab-focus:browser (optional origin argument).
// Real Chrome tab activation drives browser focus events; the class socket is an isolated fixture.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.join(import.meta.dirname, '..');
const origin = process.argv[2] ?? 'http://127.0.0.1:5173';
const chrome = process.env.CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
if (!chrome) throw new Error('Set CHROME_PATH to Chrome/Chromium.');
const qa = path.join(root, '.wrangler', `tab-focus-browser-${Date.now()}`);
fs.mkdirSync(qa, { recursive: true });
const theme = JSON.parse(fs.readFileSync(path.join(root, 'shared', 'themes', 'plaza.json'), 'utf8'));
const child = spawn(chrome, ['--headless=new', '--no-first-run', '--disable-default-apps', '--remote-debugging-port=0',
    `--user-data-dir=${path.join(qa, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
    let port;
    for (let i = 0; i < 100; i++) {
        try { port = fs.readFileSync(path.join(qa, 'profile', 'DevToolsActivePort'), 'utf8').split('\n')[0]; if (Number(port) > 0) break; } catch { /* starting */ }
        await pause(100);
    }
    if (!(Number(port) > 0)) throw new Error('Chrome did not start.');
    const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let sequence = 0; const pending = new Map(), errors = [];
    ws.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.id) {
            const call = pending.get(message.id); if (!call) return;
            pending.delete(message.id); clearTimeout(call.timer);
            if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result);
        } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
        pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
    };
    const waitFor = async expression => {
        for (let i = 0; i < 100; i++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(100); }
        throw new Error(`Page did not become ready: ${expression}\n${JSON.stringify(await evaluate('({reports:window.__reports,hidden:document.hidden,focused:document.hasFocus(),badge:document.querySelector(".badge-tab-warning")?.textContent})'))}\n${errors.join('\n')}`);
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
        history.replaceState({usr:{roomCode:'123456',avatarConfig:null},key:'tab-qa'},'');
        localStorage.setItem('pixelplaza.student.v1',JSON.stringify({studentToken:'fixture',expiresAt:Date.now()+600000,student:{studentKey:'qa',displayName:'Alex',className:'4B'}}));
        localStorage.setItem('pixelplaza.sound-muted.v1:qa','true');
        const original=fetch.bind(window);
        window.fetch=(url,init)=>String(url).includes('/api/plaza/join')?Promise.resolve(Response.json({ticket:'fixture'})):original(url,init);
        window.__reports=[];
        window.WebSocket=class {
            static OPEN=1; readyState=0;
            constructor(){setTimeout(()=>{if(this.readyState===3)return;this.readyState=1;this.onopen?.();this.onmessage?.({data:JSON.stringify({t:'welcome',id:'a',gameId:'tab-fixture',theme:${JSON.stringify(theme)},tabSwitches:0,players:[{id:'a',name:'Alex',x:1500,y:1500}]})})},30)}
            send(raw){if(raw==='ping'){this.onmessage?.({data:'pong'});return}const message=JSON.parse(raw);if(message.t==='tab-focus')window.__reports.push(message)}
            close(){this.readyState=3}
        };` });
    await send('Page.bringToFront');
    await send('Page.navigate', { url: `${origin}/game` });
    await waitFor(`document.querySelector('canvas') && window.__reports.some(m=>m.inTab)`);
    assert.deepEqual(await evaluate('window.__reports.at(-1)'), { t: 'tab-focus', inTab: true, count: 0 });
    await evaluate('window.__reports=[]');
    const other = await send('Target.createTarget', { url: 'about:blank' });
    for (let count = 1; count <= 3; count++) {
        await send('Target.activateTarget', { targetId: other.targetId });
        await waitFor(`document.hidden && window.__reports.at(-1)?.inTab===false && window.__reports.at(-1)?.count===${count}`);
        await send('Page.bringToFront');
        await waitFor(`!document.hidden && document.hasFocus() && window.__reports.at(-1)?.inTab===true && !document.querySelector('.tab-focus-overlay')`);
        assert.deepEqual(await evaluate('window.__reports.slice(-2)'), [{ t: 'tab-focus', inTab: false, count }, { t: 'tab-focus', inTab: true, count }]);
    }
    assert.equal(await evaluate(`document.querySelector('.badge-tab-warning').textContent.trim()`), '⚠️ Left tab 3x');
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(qa, 'returned-to-game.png'), Buffer.from(data, 'base64'));
    await send('Page.reload');
    await waitFor(`window.__reports.some(m=>m.inTab && m.count===3)`);
    assert.deepEqual(errors, [], 'no uncaught browser exceptions');
    console.log(`PASS: Chrome switched tabs three times, counted each departure once, restored focus and retained the total after reload. Screenshot: ${path.join(qa, 'returned-to-game.png')}`);
} finally {
    ws?.close();
    if (child.exitCode === null) {
        if (process.platform === 'win32') await new Promise(resolve => spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).once('exit', resolve));
        else child.kill('SIGTERM');
    }
}
