// Build and start `npx vite preview --port 5188`, then run this script.
// Real student page, canvas and native modal; only the server is a fixture.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.join(import.meta.dirname, '..');
const origin = process.argv[2] ?? 'http://127.0.0.1:5188';
const chrome = process.env.CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
if (!chrome) throw new Error('Set CHROME_PATH to Chrome/Chromium.');
const qa = path.join(root, '.wrangler', `announcements-browser-${Date.now()}`);
fs.mkdirSync(qa, { recursive: true });
const child = spawn(chrome, ['--headless=new', '--no-first-run', '--disable-default-apps', '--disable-background-timer-throttling', '--remote-debugging-port=0', `--user-data-dir=${path.join(qa, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
    let port;
    for (let i = 0; i < 100; i++) {
        try { port = fs.readFileSync(path.join(qa, 'profile', 'DevToolsActivePort'), 'utf8').split('\n')[0]; if (Number(port) > 0) break; } catch { /* Chrome is starting. */ }
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
            const p = pending.get(message.id); if (!p) return;
            pending.delete(message.id); clearTimeout(p.timer);
            if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result);
        } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
        pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
    };
    const waitFor = async expression => {
        for (let i = 0; i < 100; i++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(100); }
        throw new Error(`Page did not become ready: ${expression}\n${JSON.stringify(errors)}\n${await evaluate('document.body.innerText.slice(0,800)')}`);
    };
    const key = async (key, code, windowsVirtualKeyCode) => {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(key === 'Enter' ? { text: '\r' } : {}) });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    };
    const clickAt = async (x, y) => {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };
    const ok = async () => { await evaluate(`document.querySelector('.activity-announcement-ok').click()`); await pause(80); };
    const screenshot = async name => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(qa, `${name}.png`), Buffer.from(data, 'base64')); };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
        history.replaceState({usr:{roomCode:'123456',avatarConfig:null},key:'qa'},'');
        localStorage.setItem('pixelplaza.student.v1',JSON.stringify({studentToken:'fixture',expiresAt:Date.now()+600000,student:{studentKey:'qa',displayName:'Alex',className:'4B'}}));
        localStorage.setItem('pixelplaza.sound-muted.v1:qa','true');
        Element.prototype.requestFullscreen=async()=>{};
        const original=fetch.bind(window);
        window.fetch=(url,init)=>String(url).includes('/api/plaza/join')?Promise.resolve(Response.json({ticket:'fixture'})):original(url,init);
        window.__sent=[];
        window.__quest={runId:'lesson:run1',campaign:{id:'mystery',title:'The missing chestnuts'},status:'active',
            chapter:{index:0,of:3,title:'The missing chestnuts',intro:'The festival chestnuts have disappeared. Explore the plaza and talk to your classmates to discover what happened.',ending:null},
            role:{id:'baker',name:'Baker',card:'You work in the bakery. Ask the villagers what they saw this morning.'},
            clues:[{id:'own',from:'job',text:'You saw someone carrying a blue bag near the fountain.'}],secret:null,thieves:null,
            objectives:[{id:'bag',text:'What colour was the bag?',kind:'text',done:false,optional:false}],team:{done:0,total:3},recap:null,finale:null};
        window.__warmup={runId:'lesson:round1',kind:'facts',title:'Find someone who…',instructions:'Talk to your classmates. Ask questions in English to find the person described in your task. Type their name in the Warm-up panel.',fact:'You have a cat.',task:'Find someone who has a dog.',step:0,of:2,team:{done:0,total:4}};
        window.WebSocket=class {
            static OPEN=1; readyState=0;
            constructor(){window.__socket=this;setTimeout(()=>{this.readyState=1;this.onopen?.();this.receive({t:'welcome',id:'a',gameId:'lesson',players:[{id:'a',name:'Alex',x:1500,y:1500}]});this.receive({t:'quest',quest:window.__quest});},30)}
            receive(value){this.onmessage?.({data:JSON.stringify(value)})}
            send(raw){if(raw==='ping'){this.onmessage?.({data:'pong'});return}window.__sent.push(JSON.parse(raw))}
            close(){this.readyState=3}
        };` });
    await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${origin}/game` });
    await waitFor(`document.querySelector('dialog:modal') && document.querySelector('canvas')`);
    assert.equal(await evaluate(`document.activeElement.id`), 'activity-announcement-title');
    await screenshot('desktop-chapter');
    await evaluate(`window.__modalEvents=[];for(const name of ['cancel','close'])document.querySelector('dialog').addEventListener(name,e=>setTimeout(()=>window.__modalEvents.push({name,prevented:e.defaultPrevented}),0))`);
    await key('Escape', 'Escape', 27);
    assert.equal(await evaluate(`!!document.querySelector('dialog:modal')`), true, 'Escape does not dismiss: '+JSON.stringify(await evaluate(`window.__modalEvents`)));
    await clickAt(5, 5);
    assert.equal(await evaluate(`!!document.querySelector('dialog:modal')`), true, 'outside click does not dismiss');
    for (let i = 0; i < 4; i++) {
        await key('Tab', 'Tab', 9);
        assert.equal(await evaluate(`document.activeElement===document.body || !!document.activeElement.closest('dialog')`), true, 'keyboard cannot reach game controls');
    }
    await pause(900); await evaluate('window.__sent=[]');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
    await pause(400);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
    assert.equal(await evaluate(`window.__sent.filter(m=>m.t==='move').length`), 0, 'reading instructions holds the avatar still');
    await evaluate(`document.querySelector('.activity-announcement-ok').focus()`); await key('Enter', 'Enter', 13);
    await waitFor(`!document.querySelector('dialog[open]')`);
    await clickAt(700, 450); await evaluate('window.__sent=[]');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
    await pause(400);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
    assert.ok(await evaluate(`window.__sent.some(m=>m.t==='move')`), 'walking resumes after OK');
    await evaluate(`window.__socket.receive({t:'warmup',warmup:window.__warmup})`);
    await waitFor(`document.querySelector('dialog:modal')?.textContent.includes('WARM-UP STARTING')`);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 650, deviceScaleFactor: 1, mobile: true });
    await screenshot('mobile-warmup');
    const fits = () => evaluate(`(()=>{const d=document.querySelector('dialog').getBoundingClientRect(), b=document.querySelector('.activity-announcement-ok').getBoundingClientRect();return d.left>=0&&d.right<=innerWidth&&d.top>=0&&d.bottom<=innerHeight&&b.bottom<=innerHeight&&b.top>=0})()`);
    assert.ok(await fits(), 'mobile dialog and OK fit on screen');
    await ok();
    // The quest board comes in its own message, with or without a campaign.
    await evaluate(`window.__socket.receive({t:'board',board:[{id:'side',text:'Interview a classmate about their favourite festival food. Write what you learned.',kind:'report',activity:'interview',state:'available',reason:null,partner:null}],sideQuests:{state:'empty',reason:null,waiting:0}})`);
    await waitFor(`document.querySelector('dialog:modal')?.textContent.includes('OPTIONAL SIDE QUESTS')`);
    await screenshot('mobile-side-quest');
    await ok();
    assert.equal(await evaluate(`window.__sent.some(m=>m.t==='quest-accept')`), false, 'OK does not accept a side quest');
    await evaluate(`window.__quest.chapter={...window.__quest.chapter,index:1,title:'The cellar',intro:'Look for clues in the cellar. '.repeat(140)};window.__socket.receive({t:'quest',quest:window.__quest})`);
    await waitFor(`document.querySelector('dialog:modal')?.textContent.includes('The cellar')`);
    assert.ok(await fits(), 'long instructions keep OK visible');
    assert.ok(await evaluate(`(()=>{const b=document.querySelector('.activity-announcement-body');return b.scrollHeight>b.clientHeight})()`), 'long instructions scroll inside the dialog');
    await screenshot('mobile-long-instructions');
    assert.deepEqual(errors, [], 'no browser errors');
    console.log(`Announcement browser checks passed: native modal, keyboard, Escape, backdrop, avatar movement, mobile sizing and long instructions. Screenshots: ${qa}`);
} finally { ws?.close(); child.kill(); }
