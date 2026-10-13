// Where an avatar can walk on a theme, found by walking: from the start position, step by step, with the avatar's real
// feet. Used by the studio to show closed-off places, and by the tests. Plain functions, no imports but the theme.
import { FOOT, makeWorld, type Theme } from './theme.ts';

const CELL = 4; // world pixels per step

export type Reachability = {
    cells: number;                 // cells across the world
    cell: number;                  // world pixels per cell
    blocked: Uint8Array;           // 1 where the avatar's feet cannot be
    steps: Uint16Array;            // steps from the start to each cell it can reach, or 0
    reachable: (artX: number, artY: number) => boolean;
    stepsAt: (artX: number, artY: number) => number; // steps from the start to a place, or 0 when it cannot be reached
    walkable: (artX: number, artY: number) => boolean;
};

// Everything the feet can reach from `from` (art pixels), which is the theme's start position by default.
export function reachability(theme: Theme, from: { x: number; y: number } = theme.spawn): Reachability {
    const world = makeWorld(theme);
    const cells = Math.ceil(theme.world / CELL);
    const blocked = new Uint8Array(cells * cells);
    for (const [x, y, w, h] of world.worldRects) {
        const x0 = Math.max(0, Math.floor((x - FOOT.right) / CELL)), x1 = Math.min(cells - 1, Math.ceil((x + w + FOOT.left) / CELL));
        const y0 = Math.max(0, Math.floor((y - FOOT.down) / CELL)), y1 = Math.min(cells - 1, Math.ceil((y + h + FOOT.up) / CELL));
        for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) blocked[cy * cells + cx] = 1;
    }
    // The edge of the world stops the avatar at its centre.
    for (let i = 0; i < cells; i++) for (const edge of [0, cells - 1]) { blocked[edge * cells + i] = 1; blocked[i * cells + edge] = 1; }

    const index = (artX: number, artY: number) => Math.round(artX * world.scale / CELL) + cells * Math.round(artY * world.scale / CELL);
    const steps = new Uint16Array(cells * cells);
    const start = index(from.x, from.y);
    if (start >= 0 && start < cells * cells && !blocked[start]) {
        const queue = [start];
        steps[start] = 1;
        for (let head = 0; head < queue.length; head++) {
            const here = queue[head];
            const x = here % cells;
            for (const next of [here - 1, here + 1, here - cells, here + cells]) {
                if (next < 0 || next >= cells * cells || steps[next] || blocked[next]) continue;
                if ((next === here - 1 && x === 0) || (next === here + 1 && x === cells - 1)) continue;
                steps[next] = steps[here] + 1;
                queue.push(next);
            }
        }
    }
    return {
        cells, cell: CELL, blocked, steps,
        reachable: (artX, artY) => { const i = index(artX, artY); return i >= 0 && i < steps.length && steps[i] > 0; },
        stepsAt: (artX, artY) => { const i = index(artX, artY); return i >= 0 && i < steps.length ? steps[i] : 0; },
        walkable: (artX, artY) => { const i = index(artX, artY); return i >= 0 && i < blocked.length && !blocked[i]; },
    };
}

// What the studio tells the person drawing: places that cannot be reached, and ground that is open but cut off.
export function walkReport(theme: Theme): { problems: string[]; cutOff: number; reached: number; map: Reachability } {
    const map = reachability(theme);
    const problems: string[] = [];
    if (!map.reachable(theme.spawn.x, theme.spawn.y)) problems.push('Nobody can walk anywhere from the start position.');
    // How much of each zone can be walked on, sampled across the zone
    for (const zone of theme.zones) {
        let open = 0;
        let reached = 0;
        const [x, y, w, h] = zone.rect;
        for (let sy = y; sy < y + h; sy += 6) for (let sx = x; sx < x + w; sx += 6) {
            if (map.walkable(sx, sy)) open++;
            if (map.reachable(sx, sy)) reached++;
        }
        if (open === 0) problems.push(`Zone "${zone.id}" has nowhere to stand: it is all blocked.`);
        else if (reached === 0) problems.push(`Zone "${zone.id}" cannot be reached: every way in is blocked.`);
        else if (reached < open * 0.5) problems.push(`Zone "${zone.id}" is only partly reachable (${Math.round(100 * reached / open)}%).`);
    }
    let walkable = 0;
    let reachedCells = 0;
    for (let i = 0; i < map.blocked.length; i++) {
        if (!map.blocked[i]) { walkable++; if (map.steps[i]) reachedCells++; }
    }
    const cutOff = walkable - reachedCells;
    if (cutOff > walkable * 0.02) problems.push(`About ${Math.round(100 * cutOff / walkable)}% of the open ground is cut off from the start position.`);
    return { problems, cutOff, reached: reachedCells, map };
}

// Whether the avatar's feet would be in a wall at this spot (art pixels), for walking around in the studio.
export function feetBlocked(theme: Theme, artX: number, artY: number): boolean {
    const { worldRects, scale } = makeWorld(theme);
    const x = artX * scale;
    const y = artY * scale;
    return worldRects.some(([rx, ry, rw, rh]) => x - FOOT.left < rx + rw && x + FOOT.right > rx && y - FOOT.up < ry + rh && y + FOOT.down > ry);
}
