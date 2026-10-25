import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getTheme, themes } from '../../shared/themeCatalog';
import { COMMONS_LAYOUT } from '../../shared/commons';
import { sheetTransparencyProblem } from '../../shared/artSheet';
import { ArtPiece } from '../components/ThemePicture';
import { downloadArtTemplate, loadPicture } from '../themeFiles';
import { FOOT, formatTheme, makeWorld, parseTheme, validateTheme } from '../../shared/theme';
import type { Rect, Theme, WalkBehind } from '../../shared/theme';
import { feetBlocked, walkReport } from '../../shared/walk';
import './Studio.css';

type Tool = 'select' | 'block' | 'bellipse' | 'bpoly' | 'zone' | 'ellipse' | 'poly' | 'spawn';
type Selection = { kind: 'block' | 'shape' | 'behind' | 'zone'; index: number } | { kind: 'spawn' } | null;
type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { type: 'move'; from: [number, number]; start: Theme }
  | { type: 'corner'; corner: Corner; start: Theme }
  | { type: 'vertex'; vertex: number; start: Theme }
  | { type: 'draw'; from: [number, number] };

const TOOLS: [Tool, string, string][] = [
  ['select', 'Select', 'Click a shape to select it, drag to move it, drag a handle to resize'],
  ['block', 'Block', 'Draw a rectangle nobody can walk through'],
  ['bellipse', 'Block (oval)', 'Draw an oval nobody can walk through, such as a fountain'],
  ['bpoly', 'Block (shape)', 'Click the corners of a place nobody can walk through, such as a curved edge; double-click to finish'],
  ['ellipse', 'Walk-behind (oval)', 'Draw an oval over something tall, such as a tree crown'],
  ['poly', 'Walk-behind (shape)', 'Click the corners of something tall; double-click to finish'],
  ['zone', 'Zone', 'Draw a named place for the story'],
  ['spawn', 'Start', 'Click where students start'],
];

const blank = (): Theme => ({
  id: 'new-theme', name: 'New theme', image: '/assets/maps/new-theme.webp', art: 1000, world: 2048,
  spawn: { x: 500, y: 500 }, blocked: [], walkBehind: [], zones: [],
});

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const round = (value: number) => Math.round(value);

// The box a walk-behind shape sits in, for its ground line and handles
function bounds(piece: WalkBehind): Rect {
  if (piece.shape === 'ellipse') return piece.rect;
  const xs = piece.points.map(point => point[0]);
  const ys = piece.points.map(point => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

function resized(rect: Rect, corner: Corner, x: number, y: number): Rect {
  const [rx, ry, rw, rh] = rect;
  const left = corner === 'nw' || corner === 'sw' ? x : rx;
  const top = corner === 'nw' || corner === 'ne' ? y : ry;
  const right = corner === 'ne' || corner === 'se' ? x : rx + rw;
  const bottom = corner === 'sw' || corner === 'se' ? y : ry + rh;
  return [Math.min(left, right), Math.min(top, bottom), Math.max(1, Math.abs(right - left)), Math.max(1, Math.abs(bottom - top))];
}

const polygon = (points: readonly (readonly [number, number])[]) => points.map(point => point.join(',')).join(' ');

export default function Studio() {
  const [params] = useSearchParams();
  const initial = getTheme(params.get('theme') ?? 'commons-garden');
  const [theme, setTheme] = useState<Theme>(() => clone(initial));
  const [imageUrl, setImageUrl] = useState(initial.image);
  const [sheetUrl, setSheetUrl] = useState<string | undefined>();
  const [direction, setDirection] = useState('A welcoming autumn village with amber leaves and warm windows.');
  const [exporting, setExporting] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [picked, setSelection] = useState<Selection>(null);
  const [zoom, setZoom] = useState(0.6);
  const [past, setPast] = useState<Theme[]>([]);
  const [future, setFuture] = useState<Theme[]>([]);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [polyDraft, setPolyDraft] = useState<[number, number][]>([]);
  const [layers, setLayers] = useState({ blocks: true, behind: true, zones: true });
  const [report, setReport] = useState<ReturnType<typeof walkReport> | null>(null);
  const [overlay, setOverlay] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(false);
  const [avatar, setAvatar] = useState<[number, number]>([0, 0]);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const keys = useRef(new Set<string>());

  useEffect(() => () => { if (imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl); }, [imageUrl]);
  useEffect(() => () => { if (sheetUrl?.startsWith('blob:')) URL.revokeObjectURL(sheetUrl); }, [sheetUrl]);

  const world = useMemo(() => makeWorld(theme), [theme]);
  // What is picked, unless undo or a new file has taken it away
  const selection: Selection = !picked || picked.kind === 'spawn' ? picked
    : picked.index < (picked.kind === 'block' ? theme.blocked.length : picked.kind === 'zone' ? theme.zones.length : picked.kind === 'shape' ? (theme.blockedShapes?.length ?? 0) : theme.walkBehind.length) ? picked : null;
  const problems = useMemo(() => validateTheme(theme), [theme]);

  // ---------- history ----------
  const record = useCallback((before: Theme) => { setPast(list => [...list.slice(-99), before]); setFuture([]); }, []);
  const change = useCallback((next: Theme) => { record(theme); setTheme(next); setReport(null); setOverlay(''); }, [record, theme]);
  const undo = () => { const before = past.at(-1); if (!before) return; setFuture(list => [theme, ...list]); setPast(past.slice(0, -1)); setTheme(before); setReport(null); setOverlay(''); };
  const redo = () => { const after = future[0]; if (!after) return; setPast(list => [...list, theme]); setFuture(future.slice(1)); setTheme(after); setReport(null); setOverlay(''); };

  const pointAt = (event: { clientX: number; clientY: number }): [number, number] => {
    const element = svg.current;
    if (!element) return [0, 0];
    const box = element.getBoundingClientRect();
    return [Math.max(0, Math.min(theme.art, round((event.clientX - box.left) / zoom))), Math.max(0, Math.min(theme.art, round((event.clientY - box.top) / zoom)))];
  };

  // ---------- editing ----------
  const remove = useCallback(() => {
    if (!selection || selection.kind === 'spawn') return;
    const next = clone(theme);
    const list: unknown[] = selection.kind === 'block' ? next.blocked : selection.kind === 'behind' ? next.walkBehind : selection.kind === 'shape' ? (next.blockedShapes ??= []) : next.zones;
    list.splice(selection.index, 1);
    setSelection(null);
    change(next);
  }, [selection, theme, change]);

  const nudge = useCallback((dx: number, dy: number) => {
    if (!selection) return;
    const next = clone(theme);
    if (selection.kind === 'spawn') { next.spawn = { x: next.spawn.x + dx, y: next.spawn.y + dy }; }
    else if (selection.kind === 'behind') {
      const piece = next.walkBehind[selection.index];
      if (piece.shape === 'ellipse') piece.rect = [piece.rect[0] + dx, piece.rect[1] + dy, piece.rect[2], piece.rect[3]];
      else piece.points = piece.points.map(([x, y]) => [x + dx, y + dy]);
      piece.sortY += dy;
    } else if (selection.kind === 'shape') {
      const piece = (next.blockedShapes ??= [])[selection.index];
      if (piece.shape === 'ellipse') piece.rect = [piece.rect[0] + dx, piece.rect[1] + dy, piece.rect[2], piece.rect[3]];
      else piece.points = piece.points.map(([x, y]) => [x + dx, y + dy]);
    } else {
      const list = selection.kind === 'block' ? next.blocked : next.zones.map(zone => zone.rect);
      const rect = list[selection.index];
      const moved: Rect = [rect[0] + dx, rect[1] + dy, rect[2], rect[3]];
      if (selection.kind === 'block') next.blocked[selection.index] = moved; else next.zones[selection.index].rect = moved;
    }
    change(next);
  }, [selection, theme, change]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement?.tagName ?? ''));
      if (preview) {
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(event.key.toLowerCase())) {
          event.preventDefault();
          if (event.type === 'keydown') keys.current.add(event.key.toLowerCase()); else keys.current.delete(event.key.toLowerCase());
        }
        return;
      }
      if (event.type !== 'keydown' || typing) return;
      const step = event.shiftKey ? 10 : 1;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); }
      else if (event.key === 'Escape') { setPolyDraft([]); setDraft(null); setSelection(null); drag.current = null; }
      else if (event.key === 'Enter') finishPolygon();
      else if (event.key === 'ArrowLeft') { event.preventDefault(); nudge(-step, 0); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); nudge(step, 0); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); nudge(0, -step); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); nudge(0, step); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); };
  });

  // Walking around: the real foot box, at the game's speed
  useEffect(() => {
    if (!preview) return;
    let frame = 0;
    let last = performance.now();
    const speed = 200 / world.scale; // art pixels a second
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const held = keys.current;
      const dx = ((held.has('arrowright') || held.has('d') ? 1 : 0) - (held.has('arrowleft') || held.has('a') ? 1 : 0)) * speed * dt;
      const dy = ((held.has('arrowdown') || held.has('s') ? 1 : 0) - (held.has('arrowup') || held.has('w') ? 1 : 0)) * speed * dt;
      if (dx || dy) {
        setAvatar(([x, y]) => {
          const nx = Math.max(0, Math.min(theme.art, x + dx));
          const ny = Math.max(0, Math.min(theme.art, y + dy));
          const tryX = feetBlocked(theme, nx, y) ? x : nx;
          const tryY = feetBlocked(theme, tryX, ny) ? y : ny;
          return [tryX, tryY];
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [preview, theme, world.scale]);

  const startPreview = () => { keys.current.clear(); setAvatar([theme.spawn.x, theme.spawn.y]); setSelection(null); setPreview(true); };

  const finishPolygon = () => {
    if (polyDraft.length < 3) { setPolyDraft([]); return; }
    const sortY = Math.max(...polyDraft.map(point => point[1]));
    const next = clone(theme);
    if (tool === 'bpoly') {
      const shapes = (next.blockedShapes ??= []);
      shapes.push({ shape: 'poly', points: polyDraft });
      setSelection({ kind: 'shape', index: shapes.length - 1 });
    } else {
      next.walkBehind.push({ shape: 'poly', points: polyDraft, sortY });
      setSelection({ kind: 'behind', index: next.walkBehind.length - 1 });
    }
    setPolyDraft([]);
    setTool('select');
    change(next);
  };

  // ---------- pointer handling on the picture ----------
  const onBackgroundDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (preview) return;
    const at = pointAt(event);
    if (tool === 'select') { setSelection(null); return; }
    if (tool === 'spawn') { const next = clone(theme); next.spawn = { x: at[0], y: at[1] }; setSelection({ kind: 'spawn' }); change(next); return; }
    if (tool === 'poly' || tool === 'bpoly') { setPolyDraft(points => [...points, at]); return; }
    (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
    drag.current = { type: 'draw', from: at };
    setDraft([at[0], at[1], 0, 0]);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current) return;
    const at = pointAt(event);
    if (current.type === 'draw') {
      setDraft([Math.min(current.from[0], at[0]), Math.min(current.from[1], at[1]), Math.abs(at[0] - current.from[0]), Math.abs(at[1] - current.from[1])]);
      return;
    }
    if (!selection || selection.kind === 'spawn' && current.type !== 'move') return;
    const next = clone(current.start);
    if (current.type === 'move') {
      const dx = at[0] - current.from[0];
      const dy = at[1] - current.from[1];
      if (selection?.kind === 'spawn') next.spawn = { x: current.start.spawn.x + dx, y: current.start.spawn.y + dy };
      else if (selection?.kind === 'block') { const r = current.start.blocked[selection.index]; next.blocked[selection.index] = [r[0] + dx, r[1] + dy, r[2], r[3]]; }
      else if (selection?.kind === 'zone') { const r = current.start.zones[selection.index].rect; next.zones[selection.index].rect = [r[0] + dx, r[1] + dy, r[2], r[3]]; }
      else if (selection?.kind === 'shape') {
        const piece = next.blockedShapes?.[selection.index];
        const original = current.start.blockedShapes?.[selection.index];
        if (piece && original && piece.shape === 'ellipse' && original.shape === 'ellipse') piece.rect = [original.rect[0] + dx, original.rect[1] + dy, original.rect[2], original.rect[3]];
        else if (piece && original && piece.shape === 'poly' && original.shape === 'poly') piece.points = original.points.map(([x, y]) => [x + dx, y + dy]);
      }
      else if (selection?.kind === 'behind') {
        const piece = next.walkBehind[selection.index];
        const original = current.start.walkBehind[selection.index];
        if (piece.shape === 'ellipse' && original.shape === 'ellipse') piece.rect = [original.rect[0] + dx, original.rect[1] + dy, original.rect[2], original.rect[3]];
        else if (piece.shape === 'poly' && original.shape === 'poly') piece.points = original.points.map(([x, y]) => [x + dx, y + dy]);
        piece.sortY = original.sortY + dy;
      }
    } else if (current.type === 'corner' && selection) {
      if (selection.kind === 'block') next.blocked[selection.index] = resized(current.start.blocked[selection.index], current.corner, at[0], at[1]);
      else if (selection.kind === 'zone') next.zones[selection.index].rect = resized(current.start.zones[selection.index].rect, current.corner, at[0], at[1]);
      else if (selection.kind === 'shape') { const piece = next.blockedShapes?.[selection.index]; if (piece && piece.shape === 'ellipse') piece.rect = resized((current.start.blockedShapes?.[selection.index] as { rect: Rect }).rect, current.corner, at[0], at[1]); }
      else if (selection.kind === 'behind') { const piece = next.walkBehind[selection.index]; if (piece.shape === 'ellipse') piece.rect = resized((current.start.walkBehind[selection.index] as { rect: Rect }).rect, current.corner, at[0], at[1]); }
    } else if (current.type === 'vertex' && (selection?.kind === 'behind' || selection?.kind === 'shape')) {
      const piece = selection.kind === 'shape' ? next.blockedShapes?.[selection.index] : next.walkBehind[selection.index];
      if (piece && piece.shape === 'poly') piece.points = piece.points.map((point, index) => (index === current.vertex ? [at[0], at[1]] : point));
    }
    setTheme(next);
  };

  const onPointerUp = () => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (current.type === 'draw') {
      const shape = draft;
      setDraft(null);
      if (!shape || shape[2] < 4 || shape[3] < 4) return;
      const next = clone(theme);
      if (tool === 'block') { next.blocked.push(shape); setSelection({ kind: 'block', index: next.blocked.length - 1 }); }
      else if (tool === 'zone') {
        let n = next.zones.length + 1;
        while (next.zones.some(zone => zone.id === `zone-${n}`)) n++;
        next.zones.push({ id: `zone-${n}`, rect: shape });
        setSelection({ kind: 'zone', index: next.zones.length - 1 });
      } else if (tool === 'bellipse') {
        const shapes = (next.blockedShapes ??= []);
        shapes.push({ shape: 'ellipse', rect: shape });
        setSelection({ kind: 'shape', index: shapes.length - 1 });
      } else if (tool === 'ellipse') {
        next.walkBehind.push({ shape: 'ellipse', rect: shape, sortY: round(shape[1] + shape[3]) });
        setSelection({ kind: 'behind', index: next.walkBehind.length - 1 });
      }
      setTool('select');
      change(next);
    } else {
      // A move or resize: remember how it was before, so it can be undone
      record(current.start);
      setReport(null);
      setOverlay('');
    }
  };

  const grab = (event: ReactPointerEvent, kind: 'block' | 'shape' | 'behind' | 'zone' | 'spawn', index = 0) => {
    if (preview || tool !== 'select') return;
    event.stopPropagation();
    svg.current?.setPointerCapture(event.pointerId);
    setSelection(kind === 'spawn' ? { kind } : { kind, index });
    drag.current = { type: 'move', from: pointAt(event), start: clone(theme) };
  };
  const grabCorner = (event: ReactPointerEvent, corner: Corner) => {
    event.stopPropagation();
    svg.current?.setPointerCapture(event.pointerId);
    drag.current = { type: 'corner', corner, start: clone(theme) };
  };
  const grabVertex = (event: ReactPointerEvent, vertex: number) => {
    event.stopPropagation();
    svg.current?.setPointerCapture(event.pointerId);
    drag.current = { type: 'vertex', vertex, start: clone(theme) };
  };

  // ---------- files ----------
  const download = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([formatTheme(theme)], { type: 'application/json' }));
    link.download = `${theme.id}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setMessage(`Saved ${theme.id}.json to your downloads. Put it in shared/themes/ and the picture in public/assets/maps/.`);
  };
  const openTheme = async (file: File | undefined) => {
    if (!file) return;
    try {
      const loaded = parseTheme(JSON.parse(await file.text()));
      setTheme(loaded); setPast([]); setFuture([]); setSelection(null); setReport(null); setOverlay(''); setPreview(false); keys.current.clear();
      setImageUrl(loaded.image); setSheetUrl(undefined);
      setMessage(`Opened ${loaded.name}. If its picture does not show, use "Open picture".`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'That file is not a theme file.'); }
  };
  const openPicture = async (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const probe = await loadPicture(url);
      if (probe.naturalWidth !== probe.naturalHeight) throw new Error('Use a square background. The current picture and geometry have been kept.');
      setImageUrl(url);
      setMessage(`Opened ${probe.naturalWidth} × ${probe.naturalHeight}. The map coordinates stay at ${theme.art} × ${theme.art}, so every shape stays in place.`);
    } catch (cause) { URL.revokeObjectURL(url); setMessage(cause instanceof Error ? cause.message : 'Could not open that picture.'); }
  };
  const openSheet = async (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await loadPicture(url);
      if (img.naturalWidth !== img.naturalHeight || img.naturalWidth < 512) throw new Error('Use a square art sheet at least 512 pixels across, with four equal slots.');
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0, 64, 64);
      const pixels = ctx.getImageData(0, 0, 64, 64).data;
      const problem = sheetTransparencyProblem(pixels, 64, 64);
      if (problem) throw new Error(problem);
      if (Object.hasOwn(themes, theme.id)) newTreatment();
      setSheetUrl(url); setMessage('Art sheet opened. All collisions stay in place. Walk behind both trees to check their shape and trunk position.');
    } catch (cause) { URL.revokeObjectURL(url); setMessage(cause instanceof Error ? cause.message : 'Could not open that art sheet.'); }
  };
  const newTreatment = () => {
    const id = 'commons-custom';
    change({ ...clone(theme), id, name: 'My Commons', layers: theme.layers?.map(layer => ({ ...layer, image: `/assets/maps/${id}.png` })) });
    // Keep the current art visible until a replacement sheet is chosen.
    if (!sheetUrl) setSheetUrl(theme.layers?.[0]?.image);
    setMessage('Name your new treatment and choose an unused id. Open its AI art sheet, walk around it, then download the theme file.');
  };
  const loadRegistered = (id: string) => {
    const chosen = themes[id];
    if (!chosen) return;
    setTheme(clone(chosen)); setImageUrl(chosen.image); setSheetUrl(undefined); setPast([]); setFuture([]); setSelection(null); setReport(null); setOverlay(''); setMessage(''); setPreview(false); keys.current.clear();
  };

  // ---------- the walking check ----------
  const check = () => {
    const result = walkReport(theme);
    setReport(result);
    const { cells, blocked, steps } = result.map;
    const canvas = document.createElement('canvas');
    canvas.width = cells; canvas.height = cells;
    const context = canvas.getContext('2d');
    if (context) {
      const image = context.createImageData(cells, cells);
      for (let i = 0; i < blocked.length; i++) {
        if (blocked[i]) continue;
        const reached = steps[i] > 0;
        image.data.set(reached ? [46, 204, 113, 70] : [255, 140, 0, 150], i * 4);
      }
      context.putImageData(image, 0, 0);
      setOverlay(canvas.toDataURL());
    }
  };

  // ---------- drawing ----------
  const edited = (kind: 'block' | 'shape' | 'behind' | 'zone', index: number) => selection && selection.kind === kind && selection.index === index;
  const handles = (rect: Rect) => (['nw', 'ne', 'sw', 'se'] as Corner[]).map(corner => {
    const x = corner === 'nw' || corner === 'sw' ? rect[0] : rect[0] + rect[2];
    const y = corner === 'nw' || corner === 'ne' ? rect[1] : rect[1] + rect[3];
    return <rect key={corner} className="handle" x={x - 5 / zoom} y={y - 5 / zoom} width={10 / zoom} height={10 / zoom}
      onPointerDown={event => grabCorner(event, corner)} />;
  });

  // What is picked, as a box to put corner handles on, or as a shape with corners of its own
  const pickedPiece = selection?.kind === 'behind' ? theme.walkBehind[selection.index] : selection?.kind === 'shape' ? theme.blockedShapes?.[selection.index] : undefined;
  const pickedRect: Rect | null = !selection || selection.kind === 'spawn' ? null
    : selection.kind === 'block' ? theme.blocked[selection.index] ?? null
    : selection.kind === 'zone' ? theme.zones[selection.index]?.rect ?? null
    : pickedPiece?.shape === 'ellipse' ? pickedPiece.rect : null;
  const pickedPolygon = pickedPiece?.shape === 'poly' ? pickedPiece.points : null;

  const setField = (patch: Partial<Theme>) => change({ ...theme, ...patch });
  const footW = (FOOT.left + FOOT.right) / world.scale;
  const footH = (FOOT.up + FOOT.down) / world.scale;

  return <main className="studio">
    <section className="studio-stage">
      <div className="studio-scroll">
        <svg ref={svg} className={`studio-canvas tool-${preview ? 'preview' : tool}`} width={theme.art * zoom} height={theme.art * zoom}
          viewBox={`0 0 ${theme.art} ${theme.art}`} onPointerDown={onBackgroundDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onDoubleClick={() => { if (tool === 'poly' || tool === 'bpoly') finishPolygon(); }}>
          <defs>
            {theme.walkBehind.map((piece, index) => <clipPath key={index} id={`behind-${index}`}>
              {piece.shape === 'ellipse'
                ? <ellipse cx={piece.rect[0] + piece.rect[2] / 2} cy={piece.rect[1] + piece.rect[3] / 2} rx={piece.rect[2] / 2} ry={piece.rect[3] / 2} />
                : <polygon points={polygon(piece.points)} />}
            </clipPath>)}
          </defs>
          <image href={imageUrl} width={theme.art} height={theme.art} />
          {(theme.layers ?? []).filter(layer => !preview || layer.sortY === undefined || avatar[1] >= layer.sortY).map((layer, index) => <ArtPiece key={`art-${index}`} layer={layer} image={sheetUrl} />)}
          {overlay && !preview && <image href={overlay} width={theme.art} height={theme.art} style={{ imageRendering: 'pixelated' }} pointerEvents="none" />}

          {layers.blocks && !preview && theme.blocked.map((rect, index) => <rect key={index} className={`block${edited('block', index) ? ' picked' : ''}`}
            x={rect[0]} y={rect[1]} width={rect[2]} height={rect[3]} onPointerDown={event => grab(event, 'block', index)} />)}
          {layers.blocks && !preview && (theme.blockedShapes ?? []).map((piece, index) => piece.shape === 'ellipse'
            ? <ellipse key={`shape-${index}`} className={`block${edited('shape', index) ? ' picked' : ''}`} cx={piece.rect[0] + piece.rect[2] / 2} cy={piece.rect[1] + piece.rect[3] / 2}
                rx={piece.rect[2] / 2} ry={piece.rect[3] / 2} onPointerDown={event => grab(event, 'shape', index)} />
            : <polygon key={`shape-${index}`} className={`block${edited('shape', index) ? ' picked' : ''}`} points={polygon(piece.points)} onPointerDown={event => grab(event, 'shape', index)} />)}
          {layers.zones && !preview && theme.zones.map((zone, index) => <g key={zone.id + index}>
            <rect className={`zone${edited('zone', index) ? ' picked' : ''}`} x={zone.rect[0]} y={zone.rect[1]} width={zone.rect[2]} height={zone.rect[3]}
              onPointerDown={event => grab(event, 'zone', index)} />
            <text className="zone-label" x={zone.rect[0] + 4} y={zone.rect[1] + 14 / zoom} fontSize={13 / zoom} pointerEvents="none">{zone.id}</text>
          </g>)}
          {layers.behind && !preview && theme.walkBehind.map((piece, index) => {
            const box = bounds(piece);
            return <g key={index}>
              {piece.shape === 'ellipse'
                ? <ellipse className={`behind${edited('behind', index) ? ' picked' : ''}`} cx={piece.rect[0] + piece.rect[2] / 2} cy={piece.rect[1] + piece.rect[3] / 2}
                    rx={piece.rect[2] / 2} ry={piece.rect[3] / 2} onPointerDown={event => grab(event, 'behind', index)} />
                : <polygon className={`behind${edited('behind', index) ? ' picked' : ''}`} points={polygon(piece.points)} onPointerDown={event => grab(event, 'behind', index)} />}
              <line className="ground" x1={box[0] - 6} x2={box[0] + box[2] + 6} y1={piece.sortY} y2={piece.sortY} pointerEvents="none" />
            </g>;
          })}
          {layers.behind && !preview && (theme.layers ?? []).filter(piece => piece.sortY !== undefined).map((piece, index) => <g key={`art-guide-${index}`} pointerEvents="none">
            <rect className="behind" x={piece.rect[0]} y={piece.rect[1]} width={piece.rect[2]} height={piece.rect[3]} />
            <line className="ground" x1={piece.rect[0]} x2={piece.rect[0] + piece.rect[2]} y1={piece.sortY} y2={piece.sortY} />
          </g>)}

          {!preview && <g onPointerDown={event => grab(event, 'spawn')}>
            <circle className={`spawn${selection?.kind === 'spawn' ? ' picked' : ''}`} cx={theme.spawn.x} cy={theme.spawn.y} r={9 / zoom} />
            <text x={theme.spawn.x + 12 / zoom} y={theme.spawn.y + 4 / zoom} fontSize={12 / zoom} className="zone-label" pointerEvents="none">start</text>
          </g>}

          {draft && <rect className="draft" x={draft[0]} y={draft[1]} width={draft[2]} height={draft[3]} />}
          {polyDraft.length > 0 && <polyline className="draft" points={polygon(polyDraft)} fill="none" />}
          {polyDraft.map(([x, y], index) => <circle key={index} className="vertex" cx={x} cy={y} r={4 / zoom} />)}

          {!preview && pickedRect && handles(pickedRect)}
          {!preview && pickedPolygon && pickedPolygon.map(([x, y], index) =>
            <circle key={index} className="vertex" cx={x} cy={y} r={5 / zoom} onPointerDown={event => grabVertex(event, index)} />)}

          {preview && <>
            <g>
              <rect x={avatar[0] - footW / 2} y={avatar[1] - FOOT.up / world.scale} width={footW} height={footH} className="feet" />
              <circle cx={avatar[0]} cy={avatar[1] - 82 / world.scale} r={13 / world.scale} className="head" />
              <rect x={avatar[0] - 12 / world.scale} y={avatar[1] - 65 / world.scale} width={24 / world.scale} height={65 / world.scale} rx={4 / world.scale} className="body" />
            </g>
            {theme.walkBehind.map((piece, index) => avatar[1] < piece.sortY
              ? <image key={index} href={imageUrl} width={theme.art} height={theme.art} clipPath={`url(#behind-${index})`} pointerEvents="none" /> : null)}
            {(theme.layers ?? []).filter(layer => layer.sortY !== undefined && avatar[1] < layer.sortY).map((layer, index) => <ArtPiece key={`foreground-${index}`} layer={layer} image={sheetUrl} />)}
          </>}
        </svg>
      </div>
    </section>

    <aside className="studio-panel">
      <header>
        <h1>Theme studio</h1>
        <Link to="/teacher">Teacher controls</Link>
      </header>

      <section className="studio-template">
        <span className="studio-eyebrow">SEASON WORKSHOP</span>
        <label className="studio-field">Choose a map
          <select aria-label="Choose a map" value={Object.hasOwn(themes, theme.id) ? theme.id : ''} onChange={event => loadRegistered(event.target.value)}>
            {!Object.hasOwn(themes, theme.id) && <option value="">{theme.name} · draft</option>}
            {Object.values(themes).map(item => <option key={item.id} value={item.id}>{item.name}{item.id === 'plaza' ? ' · Season 1' : ''}</option>)}
          </select>
        </label>
        <p>{theme.blocked.length + (theme.blockedShapes?.length ?? 0)} collision pieces · {theme.walkBehind.length + (theme.layers ?? []).filter(p => p.sortY !== undefined).length} walk-behind pieces · {theme.zones.length} places</p>
        {theme.layout === COMMONS_LAYOUT && <>
          <p className="studio-hint">Hotel, café, shop and tree: four art slots, one layout. Both seasonal maps use exactly the same paths.</p>
          <div className="studio-row"><button onClick={newTreatment}>New treatment</button>
            <label className="file">Open AI art sheet<input type="file" accept="image/png,image/webp" onChange={event => void openSheet(event.target.files?.[0])} /></label></div>
        </>}
        <label className="studio-field">Describe the next season
          <textarea aria-label="Art direction" value={direction} onChange={event => setDirection(event.target.value)} rows={3} maxLength={2000} />
        </label>
        <button className="primary" disabled={exporting || problems.errors.length > 0} onClick={async () => {
          setExporting(true);
          try { await downloadArtTemplate(theme, direction, imageUrl, sheetUrl); setMessage('Downloaded the AI template kit. Give instructions.md and the reference and guide PNGs to your art AI.'); }
          catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not export the template.'); }
          finally { setExporting(false); }
        }}>{exporting ? 'Making the kit…' : 'Download AI Template'}</button>
        <p className="studio-hint">A ZIP with the prompt, map guide, art-slot guide, current reference and theme file.</p>
        {!preview && <div className="studio-row"><button onClick={startPreview}>Walk around it</button><button onClick={check}>Check paths</button></div>}
        {message && <p className="studio-message" role="status">{message}</p>}
      </section>

      <div className="studio-row">
        <button onClick={undo} disabled={!past.length}>Undo</button>
        <button onClick={redo} disabled={!future.length}>Redo</button>
        <label className="studio-zoom">Zoom <input type="range" min="0.3" max="1.6" step="0.05" value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label>
      </div>

      {!preview ? <>
        <h2>Draw</h2>
        <div className="studio-tools">
          {TOOLS.map(([id, label, help]) => <button key={id} className={tool === id ? 'on' : ''} title={help}
            onClick={() => { setTool(id); setPolyDraft([]); setDraft(null); }}>{label}</button>)}
        </div>
        <p className="studio-hint">{TOOLS.find(([id]) => id === tool)?.[2]}. Delete removes the selected shape; the arrow keys nudge it (hold Shift for 10 pixels).</p>
        <div className="studio-row">
          {(['blocks', 'behind', 'zones'] as const).map(layer => <label key={layer}>
            <input type="checkbox" checked={layers[layer]} onChange={event => setLayers({ ...layers, [layer]: event.target.checked })} />
            {layer === 'blocks' ? 'Blocks' : layer === 'behind' ? 'Walk-behind' : 'Zones'}</label>)}
        </div>

        <h2>Selected</h2>
        {selection?.kind === 'spawn' && <p>The start position: x {theme.spawn.x}, y {theme.spawn.y}.</p>}
        {selection?.kind === 'zone' && <label className="studio-field">Zone name
          <input value={theme.zones[selection.index].id} onChange={event => { const next = clone(theme); next.zones[selection.index].id = event.target.value.trim(); change(next); }} /></label>}
        {selection?.kind === 'behind' && <label className="studio-field">Ground line (where it meets the floor)
          <input type="number" value={theme.walkBehind[selection.index].sortY} onChange={event => { const next = clone(theme); next.walkBehind[selection.index].sortY = Number(event.target.value); change(next); }} /></label>}
        {selection?.kind === 'block' && <p>Block: {theme.blocked[selection.index].join(', ')}</p>}
        {selection?.kind === 'shape' && <p>A block shaped like {theme.blockedShapes?.[selection.index]?.shape === 'ellipse' ? 'an oval' : 'a free shape'}.</p>}
        {!selection && <p className="studio-hint">Nothing selected.</p>}
        {selection && selection.kind !== 'spawn' && <button onClick={remove}>Delete it</button>}

        <h2>Check</h2>
        <button className="primary" onClick={check}>Check where students can walk</button>
        {report && <div className="studio-report">
          {report.problems.length === 0 ? <p className="ok">Every place can be reached. Green is ground students can reach.</p>
            : <ul>{report.problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
          {report.cutOff > 0 && <p className="studio-hint">Orange is open ground that is cut off from the start.</p>}
        </div>}
        {problems.errors.length > 0 && <ul className="studio-errors">{problems.errors.map(error => <li key={error}>{error}</li>)}</ul>}
        {problems.warnings.length > 0 && <ul className="studio-warnings">{problems.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
      </> : <>
        <h2>Walking</h2>
        <p>Use WASD or the arrow keys. You are blocked by the same walls as in the game, and hidden behind the walk-behind areas.</p>
        <button className="primary" onClick={() => setPreview(false)}>Back to drawing</button>
      </>}

      <h2>Theme</h2>
      <div className="studio-row">
        <button onClick={() => { setTheme(blank()); setImageUrl(''); setSheetUrl(undefined); setPast([]); setFuture([]); setSelection(null); setReport(null); setOverlay(''); setPreview(false); keys.current.clear(); }}>New theme</button>
        <label className="file">Open a theme file<input type="file" accept="application/json,.json" onChange={event => void openTheme(event.target.files?.[0])} /></label>
        <label className="file">Open a picture<input type="file" accept="image/*" onChange={event => void openPicture(event.target.files?.[0])} /></label>
      </div>
      <label className="studio-field">Name <input value={theme.name} onChange={event => setField({ name: event.target.value })} /></label>
      <label className="studio-field">Id (lower case, no spaces) <input value={theme.id} onChange={event => setField({ id: event.target.value })} /></label>
      <label className="studio-field">Picture address in the game <input value={theme.image} onChange={event => setField({ image: event.target.value })} /></label>
      <p className="studio-hint">The picture is {theme.art} pixels across and the game world {theme.world}.</p>
      <div className="studio-row">
        <button className="primary" onClick={download} disabled={problems.errors.length > 0}>Download the theme file</button>
        <button onClick={() => { void navigator.clipboard?.writeText(formatTheme(theme)); setMessage('The theme is copied.'); }}>Copy it</button>
      </div>
      {theme.layout === COMMONS_LAYOUT && <p className="studio-hint">Install a new treatment: <code>npm run theme -- "theme.json" --sheet "art.png"</code>. Restart to offer it for new games.</p>}
    </aside>
  </main>;
}
