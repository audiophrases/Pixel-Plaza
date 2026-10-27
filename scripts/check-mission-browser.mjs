// Start npm run dev, then npm run check:missions:browser. Uses an isolated teacher API fixture.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { castanyada, castanyadaComplete } from '../worker/tests/fixtures/season-1.mjs';

const root = path.join(import.meta.dirname, '..');
const origin = process.argv[2] ?? 'http://127.0.0.1:5173';
const chrome = process.env.CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
if (!chrome) throw new Error('Set CHROME_PATH to Chrome/Chromium.');
const qa = path.join(root, '.wrangler', `mission-browser-${Date.now()}`);
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
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
        pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
    };
    const waitFor = async expression => {
        for (let i = 0; i < 100; i++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(100); }
        throw new Error(`Page did not become ready: ${expression}`);
    };
    const settle = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const click = async label => { await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.checkVisibility()&&b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Unavailable button: '+${JSON.stringify(label)});b.click()})()`); await settle(); };
    const stage = async label => { await evaluate(`[...document.querySelectorAll('.mission-workflow button')].find(b=>b.querySelector('strong').textContent===${JSON.stringify(label)}).click()`); await waitFor(`document.querySelector('.mission-workflow button[aria-current] strong')?.textContent===${JSON.stringify(label)}`); };
    const edit = async (label, value) => { await evaluate(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.checkVisibility()&&l.querySelector('span')?.textContent===${JSON.stringify(label)});const el=l?.querySelector('input,textarea,select');if(!el||!el.checkVisibility())throw Error('Unavailable field: '+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`); await settle(); };
    const screenshot = async name => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(qa, `${name}.png`), Buffer.from(data, 'base64')); };
    const noOverflow = async () => {
        assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'page fits the viewport');
        const clipped = await evaluate(`[...document.querySelectorAll('main,.mission-library,.mission-savebar,.mission-workflow,.mission-map-canvas,.mission-builder,.mission-role-grid,.mission-preview')].filter(el=>el.checkVisibility()).filter(el=>el.getBoundingClientRect().right>innerWidth+1||el.getBoundingClientRect().left < -1).map(el=>el.className)`);
        assert.deepEqual(clipped, [], 'visible workspace panels fit even when body overflow is hidden');
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
        sessionStorage.setItem('pixel-plaza-teacher-session','browser-test');
        const fixtures=${JSON.stringify([castanyada, castanyadaComplete])};
        const drafts=fixtures.map(campaign=>({campaign,version:1,publishedRevision:'builtin',updated:0}));
        const library=()=>drafts.map(d=>({id:d.campaign.id,title:d.campaign.title,version:d.version,publishedRevision:d.publishedRevision,updated:0}));
        window.__missionWrites=[];
        const original=window.fetch.bind(window);
        window.fetch=async(url,init)=>{
            const route=String(url);if(!route.startsWith('/api/teacher/missions/'))return original(url,init);
            if(init.headers['x-teacher-session']!=='browser-test')throw Error('Missing teacher session');
            const body=init.body?JSON.parse(init.body):{};
            if(route.endsWith('/list'))return Response.json({library:library()});
            if(route.endsWith('/live'))return Response.json({target:null});
            if(route.includes('/get?'))return Response.json({draft:drafts.find(d=>d.campaign.id===new URL(route,location.origin).searchParams.get('id'))});
            if(route.endsWith('/create')){const campaign=structuredClone(drafts.find(d=>d.campaign.id===body.source)?.campaign??fixtures[0]);campaign.id=body.id;const draft={campaign,version:1,publishedRevision:null,updated:0};drafts.push(draft);return Response.json({draft,library:library()})}
            const draft=drafts.find(d=>d.campaign.id===body.id);if(!draft||draft.version!==body.version)throw Error('Stale write');
            if(route.endsWith('/save'))draft.campaign=body.envelope.campaign;
            else if(route.endsWith('/publish'))draft.publishedRevision='published-test';
            else throw Error('Unexpected request: '+route);
            window.__missionWrites.push(body);draft.version++;return Response.json({draft,library:library()});
        };` });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${origin}/mission-studio` });
    await waitFor(`document.querySelector('.mission-welcome-library button')`);
    await edit('Your missions', castanyadaComplete.id);
    await waitFor(`document.querySelector('.mission-story-map')`);
    await noOverflow(); await screenshot('desktop-story-map');
    await evaluate(`document.querySelector('.mission-map-canvas').scrollIntoView({block:'start'})`); await settle(); await screenshot('desktop-story-detail');
    await evaluate(`document.querySelectorAll('.mission-chapter-strip button')[1].click()`); await settle();
    assert.equal(await evaluate(`document.querySelector('.mission-map-heading h2').textContent`), castanyadaComplete.chapters[1].title);
    await evaluate(`document.querySelector('.mission-chapter-strip button').click()`); await settle();
    await evaluate(`document.querySelector('.mission-story-task-open').click()`); await settle();
    await waitFor(`document.querySelectorAll('.mission-step-list li').length > 0`);
    await noOverflow();
    assert.equal(await evaluate(`document.querySelectorAll('.mission-step-panel textarea').length < 15`), true);
    assert.equal(await evaluate(`[...document.querySelectorAll('button')].filter(b=>b.checkVisibility()&&b.textContent.includes('Publish for new games')).length`), 0, 'publication is in review');
    await screenshot('desktop');
    await click('+ Add step');
    await evaluate(`[...document.querySelectorAll('.mission-type-card')].find(b=>b.querySelector('strong').textContent==='Short answer').click()`);
    await edit('What should students do?', 'What colour is the festival box?');
    await edit('Accepted answers (one per line)', 'blue');
    await click('Copy step'); await click('↑ Move up');
    assert.equal(await evaluate(`document.querySelector('.mission-step-panel textarea').value`), 'What colour is the festival box?');
    await click('Remove step'); await click('Yes, remove step'); await click('Undo');
    await click('Save draft');
    await stage('Preview & publish');
    await evaluate(`document.querySelector('.mission-preview').scrollIntoView({block:'start'})`); await settle(); await noOverflow(); await screenshot('desktop-preview');
    await evaluate(`document.querySelector('[aria-label="Complete preview step 1"]').click()`); await settle();
    assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Undo preview step 1"]'))`), true);
    assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Publish for new games').disabled`), false);
    await click('Publish for new games');
    await stage('Build steps');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await stage('Story map'); await evaluate('window.scrollTo(0,0)'); await noOverflow(); await screenshot('phone-story-map');
    await evaluate(`document.querySelector('[aria-label="Dismiss message"]')?.click()`); await settle();
    await evaluate(`document.querySelectorAll('.mission-role-filters button')[1].click()`); await settle();
    assert.equal(await evaluate(`document.querySelectorAll('.mission-clue-card').length`), 1);
    await evaluate(`document.querySelector('.mission-map-canvas').scrollIntoView({block:'start'})`); await settle(); await noOverflow(); await screenshot('phone-story-detail');
    await stage('Mission setup'); await evaluate(`document.querySelector('.mission-role-grid').scrollIntoView({block:'start'})`); await settle(); await noOverflow(); await screenshot('phone-roles');
    await stage('Preview & publish'); await evaluate(`document.querySelector('.mission-preview').scrollIntoView({block:'start'})`); await settle(); await noOverflow(); await screenshot('phone-preview');
    for (const width of [320, 768]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
        for (const name of ['Story map', 'Mission setup', 'Build steps', 'Preview & publish']) { await stage(name); await noOverflow(); }
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await stage('Build steps');
    await evaluate('window.scrollTo(0,0)'); await noOverflow(); await screenshot('phone-overview');
    await evaluate(`document.querySelector('.mission-step-list button').click()`);
    await waitFor(`document.activeElement?.classList.contains('mission-step-panel')`);
    await pause(400); await noOverflow(); await screenshot('phone-step');
    assert.ok(await evaluate(`document.querySelector('.mission-step-panel').getBoundingClientRect().top < 150`), 'choosing a step brings its editor into view on a phone');
    await click('+ Add step'); await pause(400); await screenshot('phone-types'); await noOverflow();
    await click('Cancel');
    await click('+ New mission'); await edit('New mission name', 'Our classroom mystery'); await click('Create mission');
    await waitFor(`document.querySelector('.mission-workflow button[aria-current] strong').textContent==='Mission setup'`);
    assert.equal(await evaluate(`[...document.querySelectorAll('label')].find(l=>l.querySelector('span')?.textContent==='Mission title').querySelector('input').value`), 'Our classroom mystery');
    await noOverflow();
    assert.deepEqual(errors, [], 'no uncaught browser exceptions');
    console.log('PASS: real Chrome desktop and phone editing, ordering, removal/undo, saving, publishing and named creation.');
    console.log(`Screenshots: ${qa}`);
    await send('Browser.close');
} finally {
    ws?.close();
    if (child.exitCode === null) child.kill();
}
