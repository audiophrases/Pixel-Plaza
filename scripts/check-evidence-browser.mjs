// Native browser checks for the real evidence viewer and upload controls.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';

const root = path.join(import.meta.dirname, '..');

const chrome = process.env.CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
if (!chrome) throw new Error('Set CHROME_PATH to Chrome/Chromium.');
const qa = path.join(root, '.wrangler', `evidence-browser-${Date.now()}`);
fs.mkdirSync(qa, { recursive: true });

const fixture = "\nimport React,{useState} from 'react';\nimport {createRoot} from 'react-dom/client';\nimport Journal from './src/components/Journal';\nimport ActivityAnnouncements from './src/components/ActivityAnnouncements';\nimport MissionEvidence from './src/components/MissionEvidence';\nimport './src/pages/MissionStudio.css';\nimport pack from './content/season-2/campaign.json';\nconst first=pack.campaign.chapters[0], role=pack.campaign.roles[0], clue=first.discoveries[0];\nconst quest={runId:'evidence-qa',campaign:{id:pack.campaign.id,title:pack.campaign.title},status:'active',\nchapter:{index:0,of:3,title:first.title,intro:first.intro,ending:null,introImage:clue.image,help:first.help},\nrole:{id:role.id,name:role.name,card:role.card},clues:[{...clue,from:clue.zone}],secret:null,thieves:null,\nobjectives:[{id:'answer',text:'Which place do the messages disagree about?',kind:'text',done:false,optional:false}],\nteam:{done:0,total:2},recap:null,finale:null};\nfunction App(){\n const [campaign,setCampaign]=useState(pack.campaign);\n window.__campaign=campaign;\n return <><ActivityAnnouncements quest={quest} warmup={null} board={null} paused={false} storageKey=\"evidence-qa\"/>\n <Journal quest={quest} board={null} feedback={null} onAnswer={()=>{}}/>\n <div className=\"mission-editor\" style={{marginTop:1000}}><MissionEvidence campaign={campaign} chapterIndex={0} onChange={setCampaign}/></div></>;\n}\ncreateRoot(document.getElementById('root')).render(<App/>);";
await build({stdin:{contents:fixture,resolveDir:root,loader:'tsx'},outfile:path.join(qa,'app.js'),bundle:true,format:'esm',jsx:'automatic',logLevel:'error'});
const server=createServer((req,res)=>{
 const file=req.url==='/app.js'?'app.js':req.url==='/app.css'?'app.css':null;
 res.setHeader('Content-Type',file?.endsWith('.js')?'application/javascript':file?'text/css':'text/html');
 res.end(file?fs.readFileSync(path.join(qa,file)):'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;

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

    await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: origin });
    await waitFor("document.querySelector('.activity-announcement[open] .evidence-thumbnail')");
    await evaluate("document.querySelector('.activity-announcement[open] .evidence-thumbnail').click()");
    await waitFor("document.querySelector('.evidence-dialog:modal')");
    assert.equal(await evaluate("document.querySelector('.evidence-dialog:modal img').naturalWidth"),900);
    await screenshot('desktop-evidence');
    await key('Escape','Escape',27);
    await waitFor("!document.querySelector('.evidence-dialog:modal')");
    assert.equal(await evaluate("!!document.querySelector('.activity-announcement:modal')"),true,'Escape closes only the evidence viewer');
    assert.equal(await evaluate("document.activeElement.classList.contains('evidence-thumbnail')"),true,'focus returns to the picture button');
    await ok();
    await waitFor("!document.querySelector('dialog:modal')");
    await evaluate("document.querySelector('input[aria-label=\"Your answer\"]').focus()");
    await send('Input.insertText',{text:'sports hall'});
    await evaluate("document.querySelector('.journal .evidence-thumbnail').click()");
    await waitFor("document.querySelector('.evidence-dialog:modal')");
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 650, deviceScaleFactor: 1, mobile: true });
    assert.ok(await evaluate("(()=>{const r=document.querySelector('.evidence-dialog:modal').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.height<=innerHeight})()"),'viewer fits a narrow screen');
    await evaluate("document.querySelector('.evidence-dialog:modal .language-help summary').click()");
    await screenshot('mobile-evidence');
    assert.ok(await evaluate("document.querySelector('.evidence-dialog:modal .language-help').open"));
    await evaluate("document.querySelector('.evidence-dialog:modal button').click()");
    await waitFor("!document.querySelector('.evidence-dialog:modal')");
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"Your answer\"]').value"),'sports hall','closing evidence preserves the answer');
    await evaluate("document.querySelector('[data-editor-section=\"evidence-pictures\"]').open=true;document.querySelector('[data-evidence-path=\"chapters.0.introImage\"]').open=true");
    await send('DOM.enable');
    const doc=await send('DOM.getDocument');
    const input=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'[data-evidence-path="chapters.0.introImage"] input[type=file]'});
    await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[path.join(root,'content/season-2/art/evidence/cctv-original.png')]});
    await waitFor("window.__campaign.chapters[0].introImage");
    assert.ok(await evaluate("window.__campaign.chapters[0].introImage.src.length<=100000"),'large uploads are reduced for portable missions');
    assert.equal(await evaluate("document.querySelector('[role=alert]')?.textContent??''"),'');
    assert.deepEqual(errors,[], 'no browser errors');
    console.log('Evidence browser checks pass: image decode, nested modal, Escape, focus return, mobile size, Catalan, answer preservation and upload compression. Screenshots: '+qa);
} finally { ws?.close(); child.kill(); await new Promise(resolve=>server.close(resolve)); }

