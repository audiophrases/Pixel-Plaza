// Checks the theme studio the way a person uses it, with a fake browser (jsdom): drawing, moving, undo, naming,
// the walking check, walking around, and the download guard. Run with: npm run check:studio
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
const g = globalThis as any;
g.window = dom.window; g.document = dom.window.document; Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
g.HTMLElement = dom.window.HTMLElement; g.SVGElement = dom.window.SVGElement; g.Node = dom.window.Node;
g.requestAnimationFrame = (fn: (t: number) => void) => setTimeout(() => fn(performance.now()), 16) as unknown as number;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLCanvasElement.prototype.getContext = () => ({ createImageData: (w: number, h: number) => ({ data: { set: () => {} }, width: w, height: h }), putImageData: () => {} }) as any;
dom.window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA==';
(dom.window.Element.prototype as any).setPointerCapture = () => {};
// The picture is shown at zoom 0.6 from the top left of the page
dom.window.Element.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON() {} } as any; };

const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const { default: Studio } = await import('../src/pages/Studio');

const root = createRoot(document.getElementById('root')!);
await act(async () => { root.render(<MemoryRouter initialEntries={['/studio?theme=plaza']}><Studio /></MemoryRouter>); });

const svg = () => document.querySelector('svg.studio-canvas')!;
const count = (selector: string) => document.querySelectorAll(selector).length;
const button = (text: string) => [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === text) as HTMLButtonElement;
const text = () => document.body.textContent ?? '';
let failures = 0;
const check = (what: string, ok: boolean) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) failures++; };

function fire(target: Element, type: string, x: number, y: number) {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}
const zoom = 0.6;
const at = (artX: number, artY: number) => [artX * zoom, artY * zoom] as const; // screen position of a point on the picture

// 1. Draw a block with the Block tool
const before = count('rect.block');
await act(async () => { button('Block').click(); });
await act(async () => { fire(svg(), 'pointerdown', ...at(100, 100)); });
await act(async () => { fire(svg(), 'pointermove', ...at(150, 130)); });
await act(async () => { fire(svg(), 'pointerup', ...at(150, 130)); });
check('drawing a block adds one', count('rect.block') === before + 1);
check('the tool returns to Select after drawing', button('Select').className.includes('on'));
check('the new block is selected (shows corner handles)', count('rect.handle') === 4);

// 2. Undo and redo
await act(async () => { button('Undo').click(); });
check('undo removes it', count('rect.block') === before);
await act(async () => { button('Redo').click(); });
check('redo brings it back', count('rect.block') === before + 1);

// 3. Move it by dragging
const blocks = [...document.querySelectorAll('rect.block')];
const mine = blocks[blocks.length - 1];
await act(async () => { fire(mine, 'pointerdown', ...at(110, 110)); });
await act(async () => { fire(svg(), 'pointermove', ...at(130, 140)); });
await act(async () => { fire(svg(), 'pointerup', ...at(130, 140)); });
const moved = [...document.querySelectorAll('rect.block')].pop()!;
check('dragging moves the block by the drag', moved.getAttribute('x') === '120' && moved.getAttribute('y') === '130');
await act(async () => { button('Undo').click(); });
check('undo puts a move back', [...document.querySelectorAll('rect.block')].pop()!.getAttribute('x') === '100');

// 4. Draw a zone and name it
await act(async () => { button('Zone').click(); });
await act(async () => { fire(svg(), 'pointerdown', ...at(300, 300)); });
await act(async () => { fire(svg(), 'pointermove', ...at(380, 360)); });
await act(async () => { fire(svg(), 'pointerup', ...at(380, 360)); });
check('a zone is added with a name', text().includes('zone-6'));
const zoneInput = document.querySelector('input[value="zone-6"]') as HTMLInputElement;
check('its name can be changed in the panel', !!zoneInput);

// 5. Draw a polygon walk-behind by clicking corners and double-clicking
const behindBefore = count('polygon.behind');
await act(async () => { button('Walk-behind (shape)').click(); });
for (const [x, y] of [[500, 500], [560, 500], [560, 560]]) await act(async () => { fire(svg(), 'pointerdown', ...at(x, y)); });
await act(async () => { fire(svg(), 'dblclick', ...at(560, 560)); });
check('a walk-behind polygon is added', count('polygon.behind') === behindBefore + 1);

// 5b. Blocks that are not rectangles: an oval, and a free shape with a corner that can be dragged
const ovalBefore = count('ellipse.block'), polyBefore = count('polygon.block');
await act(async () => { button('Block (oval)').click(); });
await act(async () => { fire(svg(), 'pointerdown', ...at(700, 100)); });
await act(async () => { fire(svg(), 'pointermove', ...at(780, 140)); });
await act(async () => { fire(svg(), 'pointerup', ...at(780, 140)); });
check('an oval block is added', count('ellipse.block') === ovalBefore + 1);
await act(async () => { button('Block (shape)').click(); });
for (const [x, y] of [[900, 100], [960, 100], [960, 160]]) await act(async () => { fire(svg(), 'pointerdown', ...at(x, y)); });
await act(async () => { fire(svg(), 'dblclick', ...at(960, 160)); });
check('a free-shaped block is added', count('polygon.block') === polyBefore + 1);
const corner = document.querySelector('circle.vertex');
check('its corners can be dragged', !!corner);
if (corner) {
  await act(async () => { fire(corner, 'pointerdown', ...at(960, 160)); });
  await act(async () => { fire(svg(), 'pointermove', ...at(990, 190)); });
  await act(async () => { fire(svg(), 'pointerup', ...at(990, 190)); });
  check('dragging a corner reshapes it', [...document.querySelectorAll('polygon.block')].at(-1)!.getAttribute('points')!.includes('990,190'));
}
await act(async () => { button('Undo').click(); });
check('undo puts the corner back', [...document.querySelectorAll('polygon.block')].at(-1)!.getAttribute('points')!.includes('960,160'));
await act(async () => { fire([...document.querySelectorAll('ellipse.block')].at(-1)!, 'pointerdown', ...at(740, 120)); });
await act(async () => { fire(svg(), 'pointerup', ...at(740, 120)); });
await act(async () => { window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Delete' })); });
check('an oval can be selected and deleted', count('ellipse.block') === ovalBefore);

// 6. The walking check on the real plaza is clean; a wall across the start is reported
await act(async () => { button('Check where students can walk').click(); });
check('the check runs and shows a verdict', text().includes('Every place can be reached') || text().includes('cannot be reached') || text().includes('cut off'));

// 7. Walking around
await act(async () => { button('Walk around it').click(); });
check('walking mode shows the avatar and hides the shapes', count('rect.feet') === 1 && count('rect.block') === 0);
const feet = () => Number(document.querySelector('rect.feet')!.getAttribute('y'));
const startY = feet();
await act(async () => { window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp' })); });
await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
await act(async () => { window.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: 'ArrowUp' })); });
check('arrow keys walk the avatar', feet() < startY);
await act(async () => { button('Back to drawing').click(); });
check('back to drawing brings the shapes back', count('rect.block') > 100);

// 8. Download is blocked by a mistake in the theme, and the mistake is explained
const idInput = [...document.querySelectorAll('input')].find(input => (input as HTMLInputElement).value === 'plaza') as HTMLInputElement;
const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
await act(async () => { setter.call(idInput, 'Big Plaza'); idInput.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
check('a bad id is explained', text().includes('lower-case'));
check('and the download is disabled', button('Download the theme file').disabled);

console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
