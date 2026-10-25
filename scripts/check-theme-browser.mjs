// Real Chrome check for SVG sprites, imports, ZIP export and walking previews.
// Start npm run dev, then: node scripts/check-theme-browser.mjs [origin]
// CHROME_PATH can point to Chrome/Chromium on other operating systems.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.join(import.meta.dirname, '..');
const origin = process.argv[2] ?? 'http://127.0.0.1:5173';
const chrome = process.env.CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
if (!chrome) throw new Error('Set CHROME_PATH to Chrome/Chromium to run this browser check.');
const qa = path.join(root, '.wrangler', `theme-browser-${Date.now()}`);
const downloads = path.join(qa, 'downloads'); fs.mkdirSync(downloads, { recursive: true });
const previews = path.join(root, 'art', 'previews'); fs.mkdirSync(previews, { recursive: true });
const child = spawn(chrome, ['--headless=new', '--no-first-run', '--disable-default-apps', '--disable-background-timer-throttling',
    '--remote-debugging-port=0', `--user-data-dir=${qa}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
    const portFile = path.join(qa, 'DevToolsActivePort');
    let port;
    for (let i = 0; i < 100; i++) {
        // Chrome may briefly hold this file open while writing it on Windows.
        try { port = fs.readFileSync(portFile, 'utf8').split('\n')[0]; if (Number(port) > 0) break; } catch { /* starting */ }
        await pause(100);
    }
    if (!(Number(port) > 0)) throw new Error('Chrome did not start.');
    const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let sequence = 0; const pending = new Map(), errors = [], frames = [], missingArt = [];
    ws.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.id) {
            const p = pending.get(message.id); if (!p) return; pending.delete(message.id); clearTimeout(p.timer);
            if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result);
        } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
        else if (message.method === 'Network.webSocketFrameReceived') {
            try { frames.push(JSON.parse(message.params.response.payloadData)); } catch { /* pong */ }
        } else if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/assets/maps/') && message.params.response.status >= 400) missingArt.push(message.params.response.url);
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
    const click = label => evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})?.click()`);
    const upload = async (selector, file) => {
        const { root: doc } = await send('DOM.getDocument');
        const { nodeId } = await send('DOM.querySelector', { nodeId: doc.nodeId, selector });
        assert.ok(nodeId, `file input ${selector}`);
        await send('DOM.setFileInputFiles', { nodeId, files: [file] });
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    for (const theme of ['commons-garden', 'commons-autumn']) {
        await send('Page.navigate', { url: `${origin}/studio?theme=${theme}` });
        await waitFor(`document.querySelector('svg.studio-canvas') && document.body.textContent.includes('10 collision pieces')`);
        await evaluate(`Promise.all([...document.querySelectorAll('svg image')].map(el=>new Promise((resolve,reject)=>{const i=new Image();i.onload=resolve;i.onerror=reject;i.src=el.getAttribute('href')})))`);
        assert.equal(await evaluate(`document.querySelectorAll('svg.studio-canvas > svg').length`), 5);
        await click('Check where students can walk');
        await waitFor(`document.body.textContent.includes('Every place can be reached')`);
        await click('Walk around it');
        await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown'})); new Promise(r=>setTimeout(()=>{window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowDown'}));r()},350))`);
        assert.ok(await evaluate(`Number(document.querySelector('rect.feet').getAttribute('y')) > 490`), 'preview avatar walks at the real speed');
        const { data } = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(previews, `${theme}-studio.png`), Buffer.from(data, 'base64'));
        await click('Back to drawing');
    }
    await click('Download AI Template');
    await waitFor(`document.body.textContent.includes('Downloaded the AI template kit')`);
    for (let i = 0; !fs.readdirSync(downloads).some(p => p.endsWith('.zip')); i++) { if (i > 100) throw new Error('ZIP not downloaded.'); await pause(100); }
    const zip = path.join(downloads, fs.readdirSync(downloads).find(p => p.endsWith('.zip')));
    // An independent reader verifies CRCs and all files, including PNG output.
    const result = spawnSync('python', ['-c', 'import zipfile,sys,json,pathlib; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert {"instructions.md","layout.png","reference.png","art-sheet-guide.png"} <= set(z.namelist()); t=json.loads(z.read("commons-autumn.json")); assert t["art"]==1024; assert z.read("reference.png")[:8]==b"\\x89PNG\\r\\n\\x1a\\n"; pathlib.Path(sys.argv[2]).write_bytes(z.read("reference.png")); print("ZIP CRCs, guides, geometry and PNG reference verified")', zip, path.join(previews, 'commons-autumn-reference.png')], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || 'Python 3 is needed to validate the ZIP.');
    console.log(result.stdout.trim());
    const fixture = await evaluate(`(()=>{const c=document.createElement('canvas');c.width=2048;c.height=2048;const x=c.getContext('2d');x.fillStyle='#548b6b';for(let y=0;y<2;y++)for(let i=0;i<2;i++)x.fillRect(i*1024+180,y*1024+100,664,880);return c.toDataURL().split(',')[1]})()`);
    const sheet = path.join(qa, '2048-sheet.png'); fs.writeFileSync(sheet, Buffer.from(fixture, 'base64'));
    await click('New treatment');
    const opaque = await evaluate(`(()=>{const c=document.createElement('canvas');c.width=512;c.height=512;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,512,512);return c.toDataURL().split(',')[1]})()`);
    const opaquePath = path.join(qa, 'opaque.png'); fs.writeFileSync(opaquePath, Buffer.from(opaque, 'base64'));
    await upload('input[accept="image/png,image/webp"]', opaquePath);
    await waitFor(`document.body.textContent.includes('Each slot needs one visible object')`);
    await upload('input[accept="image/png,image/webp"]', sheet);
    await waitFor(`document.body.textContent.includes('Art sheet opened')`);
    assert.equal(await evaluate(`document.querySelector('svg.studio-canvas').getAttribute('viewBox')`), '0 0 1024 1024');
    await click('Download the theme file');
    for (let i = 0; !fs.existsSync(path.join(downloads, 'commons-custom.json')); i++) { if (i > 100) throw new Error('Theme not downloaded.'); await pause(100); }
    const custom = JSON.parse(fs.readFileSync(path.join(downloads, 'commons-custom.json')));
    assert.equal(custom.art, 1024); assert.equal(custom.layers.length, 5); assert.equal(custom.blocked.length + custom.blockedShapes.length, 10);
    const wide = await evaluate(`(()=>{const c=document.createElement('canvas');c.width=128;c.height=64;return c.toDataURL().split(',')[1]})()`);
    const invalid = path.join(qa, 'wide.png'); fs.writeFileSync(invalid, Buffer.from(wide, 'base64'));
    const before = await evaluate(`document.querySelector('svg.studio-canvas > image').getAttribute('href')`);
    await upload('input[accept="image/*"]', invalid);
    await waitFor(`document.body.textContent.includes('Use a square background')`);
    assert.equal(await evaluate(`document.querySelector('svg.studio-canvas > image').getAttribute('href')`), before);
    await upload('input[accept="image/*"]', sheet);
    await waitFor(`document.body.textContent.includes('map coordinates stay at 1024')`);
    assert.equal(await evaluate(`document.querySelector('svg.studio-canvas').getAttribute('viewBox')`), '0 0 1024 1024');
    // Full scenery changes the ground, every prop and the place names together.
    await send('Page.navigate', { url: `${origin}/studio` });
    await waitFor(`document.querySelector('input[aria-label="Setting"]')?.value==='Summer beach'`);
    await evaluate(`Promise.all([...document.querySelectorAll('svg image')].map(el=>new Promise((resolve,reject)=>{const i=new Image();i.onload=resolve;i.onerror=reject;i.src=el.getAttribute('href')})))`);
    assert.equal(await evaluate(`document.querySelectorAll('svg.studio-canvas > svg').length`), 6);
    assert.ok(await evaluate(`document.querySelector('svg.studio-canvas > image').getAttribute('href').includes('scene-beach-ground.png')`));
    await click('Check paths'); await waitFor(`document.body.textContent.includes('Every place can be reached')`);
    await click('Walk around it');
    const beachShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(previews, 'scene-beach-studio.png'), Buffer.from(beachShot.data, 'base64'));
    await click('Back to drawing');
    await click('Download AI Template'); await waitFor(`document.body.textContent.includes('Downloaded the AI template kit')`);
    const beachZip = path.join(downloads, 'scene-beach-ai-template.zip');
    for (let i = 0; !fs.existsSync(beachZip); i++) { if (i > 100) throw new Error('Beach kit not downloaded.'); await pause(100); }
    const sceneryResult = spawnSync('python', ['-c', 'import zipfile,sys,json,struct; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert {"ground-prompt.md","scenery-prompt.md","story-context.md"} <= set(z.namelist()); t=json.loads(z.read("scene-beach.json")); assert len(t["layers"])==6; assert "park: Palm cove" in z.read("story-context.md").decode(); assert struct.unpack(">II",z.read("art-sheet-guide.png")[16:24])==(1536,1024); print("Full scenery ZIP: prompts, labels, geometry and rectangular PNG guide verified")', beachZip], { encoding: 'utf8', windowsHide: true });
    assert.equal(sceneryResult.status, 0, sceneryResult.stderr); console.log(sceneryResult.stdout.trim());
    fs.copyFileSync(beachZip, path.join(root, 'art/templates/scene-beach-ai-template.zip'));
    for (const [preset, setting, ground, object, place] of [['snow', 'Snowy plaza', 'Snow-covered', 'Snow-covered chalet', 'Winter garden'], ['deck', 'Cruise-ship deck', 'wooden cruise-ship deck', 'Passenger cabin', 'Sun deck']]) {
        await evaluate(`(()=>{const s=document.querySelector('select[aria-label="Scenery preset"]');s.value=${JSON.stringify(preset)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
        await click('New scenery');
        await waitFor(`document.querySelector('input[aria-label="Setting"]')?.value===${JSON.stringify(setting)}`);
        assert.ok(await evaluate(`document.querySelector('textarea[aria-label="Ground prompt"]').value.includes(${JSON.stringify(ground)})`));
        assert.equal(await evaluate(`document.querySelector('input[aria-label="Scenery object 1"]').value`), object);
        assert.equal(await evaluate(`document.querySelector('input[aria-label="Place 5"]').value`), place);
    }
    await evaluate(`(()=>{const i=document.querySelector('input[aria-label="Place 5"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Observation deck');i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    assert.ok(await evaluate(`document.querySelector('svg.studio-canvas').textContent.includes('Observation deck')`), 'visible map labels follow place edits');
    // Identify the two file controls by their labels rather than assuming DOM order.
    await evaluate(`for(const l of document.querySelectorAll('label.file')){if(l.textContent==='Open AI ground')l.querySelector('input').id='qa-ground';if(l.textContent==='Open AI art sheet')l.querySelector('input').id='qa-sheet'}`);
    const groundBefore = await evaluate(`document.querySelector('svg.studio-canvas > image').getAttribute('href')`);
    await upload('#qa-ground', invalid); await waitFor(`document.body.textContent.includes('Use a square background')`);
    assert.equal(await evaluate(`document.querySelector('svg.studio-canvas > image').getAttribute('href')`), groundBefore);
    await upload('#qa-ground', path.join(root, 'public/assets/maps/scene-beach-ground.png'));
    await waitFor(`document.body.textContent.includes('map coordinates stay at 1024')`);
    await upload('#qa-sheet', opaquePath); await waitFor(`document.body.textContent.includes('Each slot needs one visible object')`);
    await upload('#qa-sheet', path.join(root, 'public/assets/maps/scene-beach.png'));
    await waitFor(`document.body.textContent.includes('Six scenery objects opened')`);
    await click('Download the theme file');
    const sceneryJson = path.join(downloads, 'scene-deck-custom.json');
    for (let i = 0; !fs.existsSync(sceneryJson); i++) { if (i > 100) throw new Error('Scenery JSON not downloaded.'); await pause(100); }
    const editedScenery = JSON.parse(fs.readFileSync(sceneryJson));
    assert.equal(editedScenery.layers.length, 6); assert.equal(editedScenery.zones[4].name, 'Observation deck');
    assert.equal(editedScenery.scenery.setting, 'Cruise-ship deck');
    assert.deepEqual(editedScenery.blocked, custom.blocked); assert.deepEqual(editedScenery.blockedShapes, custom.blockedShapes);
    console.log('Full scenery: preset briefs, editable labels, square ground and rectangular transparent sheet imports passed.');
    if (process.argv.includes('--tester')) {
        assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'tester mutations require a local server');
        const request = async (route, body, token) => {
            const response = await fetch(`${origin}/api/teacher/${route}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { 'x-teacher-session': token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
            const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
        };
        const { token } = await request('login', { password: 'tester' });
        await send('Network.enable');
        for (const themeId of ['commons-garden', 'commons-autumn', 'scene-beach']) {
            const game = await request('game', { name: `${themeId === 'commons-garden' ? 'Garden' : 'Autumn'} preview`, themeId, randomNames: false, vision: 0 }, token);
            frames.length = 0;
            await send('Page.navigate', { url: `${origin}/?tester=Ana&pin=${game.pin}` });
            await waitFor(`document.querySelector('canvas') && document.body.textContent.includes('Ana')`);
            await pause(1500);
            assert.equal(frames.find(f => f.t === 'welcome')?.themeId, themeId, 'the renderer receives the saved map id');
            const before = (await request('status', null, token)).online.find(s => s.name === 'Ana');
            assert.ok(before, 'the student joined the actual Worker');
            await evaluate(`document.activeElement?.blur()`);
            await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
            await pause(500);
            await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
            await pause(250);
            const after = (await request('status', null, token)).online.find(s => s.name === 'Ana');
            assert.ok(after.x > before.x + 50, 'real Phaser keyboard movement reaches the server');
            // North and south of the left tree exercise the alpha-based foreground.
            for (const [name, y] of [['behind', 1440], ['front', 1640]]) {
                await request('magic', { power: 'teleport', studentKey: before.studentKey, x: 448, y }, token);
                await pause(450);
                const { data } = await send('Page.captureScreenshot', { format: 'png' });
                fs.writeFileSync(path.join(previews, `${themeId}-game-${name}.png`), Buffer.from(data, 'base64'));
            }
            console.log(`${themeId}: real game, server movement and tree foreground rendered. Test player: ${origin}/?tester=Ana&pin=${game.pin}`);
        }
        assert.deepEqual(missingArt, [], 'all game art loads successfully');
        await send('Page.navigate', { url: `${origin}/teacher?autologin=tester` });
        await waitFor(`document.querySelector('select[aria-label="Map for a new game"]')`);
        await evaluate(`document.querySelector('select[aria-label="Map for a new game"]').closest('details').querySelector('summary').click()`);
        await evaluate(`(()=>{const s=document.querySelector('select[aria-label="Map for a new game"]');s.value='plaza';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
        await waitFor(`document.querySelector('.teacher-map-choice > svg')?.getAttribute('aria-label')==='Pixel Plaza'`);
        await evaluate(`(()=>{const s=document.querySelector('select[aria-label="Map for a new game"]');s.value='commons-garden';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
        await waitFor(`document.querySelector('.teacher-map-choice > svg')?.getAttribute('aria-label')==='Garden Commons'`);
        console.log('Teacher map picker previews both original and layered maps.');
        await send('Page.navigate', { url: `${origin}/mission-studio?theme=scene-beach` });
        await waitFor(`document.querySelector('nav[aria-label="Campaign library"] button')`);
        await evaluate(`document.querySelector('nav[aria-label="Campaign library"] button').click()`);
        await waitFor(`document.querySelector('select[aria-label="Story scenery"]')`);
        assert.equal(await evaluate(`document.querySelector('select[aria-label="Story scenery"]').value`), 'scene-beach');
        await evaluate(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.querySelector('span')?.textContent==='Task');const s=l.querySelector('select');s.value='create';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
        await evaluate(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.querySelector('span')?.textContent==='Your mission brief');const t=l.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'A missing invitation at the surf shack');t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
        await click('Build prompt');
        await waitFor(`[...document.querySelectorAll('textarea')].some(t=>t.readOnly&&t.value.includes('park: Palm cove'))`);
        assert.ok(await evaluate(`[...document.querySelectorAll('select option')].some(o=>o.value==='hotel'&&o.textContent==='Bungalow')`), 'discovery editor shows scenery names while preserving IDs');
        console.log('Mission Studio builds a beach-specific prompt and shows matching discovery labels.');
    }
    assert.deepEqual(errors, [], 'no uncaught browser exceptions');
    console.log('PASS: seasonal and complete scenery maps, walking previews, PNG/SVG rendering, ZIP prompts, 2K/six-cell imports, geometry preservation and non-square rejection.');
    console.log(`Screenshots: ${previews}`);
    await send('Browser.close');
} finally {
    ws?.close();
    if (child.exitCode === null) child.kill();
}
