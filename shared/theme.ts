// A theme: one picture of the plaza and everything about how it is walked on. Plain data and plain functions, so
// the game, the server, the studio and the tests all read the same thing. The data lives in shared/themes/<id>.json.
//
// Everything is measured on the picture, in its own pixels ("art pixels"); `world` is how many pixels wide the
// game's world is, so art pixels are scaled by world / art when the game runs.

export type Rect = readonly [x: number, y: number, w: number, h: number];
export type Point = readonly [x: number, y: number];

// Something tall that a player can walk behind: its picture is drawn again on top of players standing north of
// `sortY` (the line where it meets the ground), so a tree crown or a lamp post hides them. The shape is cut out of the
// artwork: an ellipse inside `rect`, or a polygon.
export type WalkBehind =
    | { shape: 'ellipse'; rect: Rect; sortY: number }
    | { shape: 'poly'; points: readonly Point[]; sortY: number };

export type Zone = { id: string; rect: Rect; name?: string };

// A transparent piece of an art sheet. Source coordinates are fractions of its
// image, so 1024px and 2048px versions fit the same layout. sortY makes a piece
// hide avatars north of its base, using its real alpha instead of a traced mask.
export type ArtLayer = { image: string; source: Rect; rect: Rect; sortY?: number };

// A place nobody can walk that is not a rectangle: an oval inside `rect`, or a polygon. The game turns it into thin
// strips (see shapeRects), so walls, the server's check and the walking test all keep working with rectangles.
export type BlockShape =
    | { shape: 'ellipse'; rect: Rect }
    | { shape: 'poly'; points: readonly Point[] };

export type Theme = {
    id: string;
    name: string;
    image: string;          // where the picture is served from, such as /assets/maps/plaza.webp
    art: number;            // width and height of the picture, in pixels (it is square)
    world: number;          // width and height of the game's world, in pixels
    spawn: { x: number; y: number };
    blocked: Rect[];        // where nobody can walk
    blockedShapes?: BlockShape[]; // where nobody can walk, as ovals and free shapes
    walkBehind: WalkBehind[];
    zones: Zone[];          // named places, for the story
    layout?: string;       // stable layout version shared by seasonal treatments
    layers?: ArtLayer[];
    scenery?: { setting: string; ground: string; objects: string[] };
};

// The avatar's feet: what bumps into walls, in world pixels (FIGURE_BODY in src/game/AvatarFigure.ts).
export const FOOT = { left: 13, right: 13, up: 4, down: 10 };

// The avatar walks at 200 pixels a second (283 on a diagonal). A move is believed up to this speed, with room for
// a slow connection to deliver several steps at once.
export const MAX_SPEED = 450;
const MOVE_SLACK = 30; // pixels
const MOVE_TIME_CAP_MS = 2000;

const inside = (x: number, y: number, [rx, ry, rw, rh]: Rect) => x >= rx && x < rx + rw && y >= ry && y < ry + rh;

// A shape as the thin horizontal strips it is made of, each `step` art pixels tall, with neighbouring strips of the
// same width joined, so a block of any shape can be treated as rectangles.
export function shapeRects(piece: BlockShape, step = 3): Rect[] {
    const spansAt = (y: number): [number, number][] => {
        if (piece.shape === 'ellipse') {
            const [rx, ry, rw, rh] = piece.rect;
            const dy = (y - (ry + rh / 2)) / (rh / 2);
            if (Math.abs(dy) >= 1) return [];
            const half = (rw / 2) * Math.sqrt(1 - dy * dy);
            return [[rx + rw / 2 - half, rx + rw / 2 + half]];
        }
        const crossings: number[] = [];
        const points = piece.points;
        for (let i = 0; i < points.length; i++) {
            const [x1, y1] = points[i];
            const [x2, y2] = points[(i + 1) % points.length];
            if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) crossings.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
        }
        crossings.sort((a, b) => a - b);
        const spans: [number, number][] = [];
        for (let i = 0; i + 1 < crossings.length; i += 2) spans.push([crossings[i], crossings[i + 1]]);
        return spans;
    };
    const box = piece.shape === 'ellipse' ? piece.rect : (() => {
        const xs = piece.points.map(point => point[0]);
        const ys = piece.points.map(point => point[1]);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] as const;
    })();
    const rects: Rect[] = [];
    let open: { left: number; right: number; top: number; bottom: number }[] = [];
    for (let top = box[1]; top < box[1] + box[3]; top += step) {
        const bottom = Math.min(top + step, box[1] + box[3]);
        const spans = spansAt((top + bottom) / 2).filter(([left, right]) => right - left > 0.5);
        const continued: typeof open = [];
        for (const [left, right] of spans) {
            const same = open.find(item => Math.abs(item.left - left) < 0.75 && Math.abs(item.right - right) < 0.75);
            if (same) { same.bottom = bottom; continued.push(same); } else continued.push({ left, right, top, bottom });
        }
        for (const item of open) if (!continued.includes(item)) rects.push([item.left, item.top, item.right - item.left, item.bottom - item.top]);
        open = continued;
    }
    for (const item of open) rects.push([item.left, item.top, item.right - item.left, item.bottom - item.top]);
    return rects;
}

// A theme ready to use in the game: its rectangles in world pixels, and the checks the server and the page make.
export function makeWorld(theme: Theme) {
    const scale = theme.world / theme.art;
    const toWorld = ([x, y, w, h]: Rect): Rect => [x * scale, y * scale, w * scale, h * scale];
    const worldRects: Rect[] = [...theme.blocked, ...(theme.blockedShapes ?? []).flatMap(piece => shapeRects(piece))].map(toWorld);
    const worldZones = theme.zones.map(zone => ({ id: zone.id, rect: toWorld(zone.rect) }));
    const SPAWN = { x: Math.round(theme.spawn.x * scale), y: Math.round(theme.spawn.y * scale) };

    // True when a world position is in a place nobody can walk.
    const isBlocked = (x: number, y: number) => worldRects.some(rect => inside(x, y, rect));

    // The named place (zone id) a world position is in, or null.
    const zoneAt = (x: number, y: number): string | null => worldZones.find(zone => inside(x, y, zone.rect))?.id ?? null;

    // Whether a student could really have walked from one place to another in `elapsedMs`: the end is not in a wall,
    // it is not further than they can walk, and no wall lies on the straight line between.
    function legalMove(fromX: number, fromY: number, toX: number, toY: number, elapsedMs: number): boolean {
        if (isBlocked(toX, toY)) return false;
        const distance = Math.hypot(toX - fromX, toY - fromY);
        const time = Math.min(Math.max(elapsedMs, 50), MOVE_TIME_CAP_MS) / 1000;
        if (distance > MAX_SPEED * time + MOVE_SLACK) return false;
        const steps = Math.ceil(distance / 6);
        for (let step = 1; step < steps; step++) {
            if (isBlocked(fromX + (toX - fromX) * step / steps, fromY + (toY - fromY) * step / steps)) return false;
        }
        return true;
    }

    return { scale, worldRects, worldZones, SPAWN, isBlocked, zoneAt, legalMove };
}

// What is wrong with a theme, in words for the person editing it. `errors` would break the game; `warnings` are
// worth a look.
export function validateTheme(theme: Theme): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!/^[a-z0-9-]+$/.test(theme.id)) errors.push('The id should be lower-case letters, numbers and dashes, such as "castle".');
    if (!theme.name.trim()) errors.push('The theme needs a name.');
    if (!theme.image.trim()) errors.push('The theme needs a picture address.');
    if (!Number.isFinite(theme.art) || !Number.isFinite(theme.world) || !(theme.art > 0) || !(theme.world > 0) || theme.art > 8192 || theme.world > 4096) errors.push('Use a picture size between 1 and 8192 and a world size between 1 and 4096.');
    const within = (x: number, y: number) => x >= 0 && y >= 0 && x <= theme.art && y <= theme.art;
    if (!within(theme.spawn.x, theme.spawn.y)) errors.push('The start position is outside the picture.');
    theme.blocked.forEach(([x, y, w, h], index) => {
        if (!(w > 0 && h > 0)) errors.push(`Block ${index + 1} has no size.`);
        else if (x + w < 0 || y + h < 0 || x > theme.art || y > theme.art) warnings.push(`Block ${index + 1} is outside the picture.`);
    });
    (theme.blockedShapes ?? []).forEach((piece, index) => {
        const label = `Block shape ${index + 1}`;
        if (piece.shape === 'poly' && piece.points.length < 3) errors.push(`${label} needs at least three corners.`);
        if (piece.shape === 'ellipse' && !(piece.rect[2] > 0 && piece.rect[3] > 0)) errors.push(`${label} has no size.`);
    });
    theme.walkBehind.forEach((piece, index) => {
        const label = `Walk-behind area ${index + 1}`;
        if (piece.shape === 'poly' && piece.points.length < 3) errors.push(`${label} needs at least three corners.`);
        if (piece.shape === 'ellipse' && !(piece.rect[2] > 0 && piece.rect[3] > 0)) errors.push(`${label} has no size.`);
        if (!(piece.sortY >= 0 && piece.sortY <= theme.art)) errors.push(`${label} has its ground line outside the picture.`);
    });
    const seen = new Set<string>();
    if (theme.scenery && (typeof theme.scenery.setting !== 'string' || !theme.scenery.setting.trim() || theme.scenery.setting.length > 200
        || typeof theme.scenery.ground !== 'string' || theme.scenery.ground.length > 4000 || !Array.isArray(theme.scenery.objects)
        || theme.scenery.objects.length !== 6 || theme.scenery.objects.some(s => typeof s !== 'string' || !s.trim() || s.length > 500))) errors.push('Scenery needs a setting, ground description and six object descriptions.');
    for (const [index, layer] of (theme.layers ?? []).entries()) {
        const [x, y, w, h] = layer.source;
        if (!layer.image.trim() || ![...layer.source, ...layer.rect].every(Number.isFinite)
            || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1 || layer.rect[2] <= 0 || layer.rect[3] <= 0
            || layer.sortY !== undefined && (!Number.isFinite(layer.sortY) || layer.sortY < 0 || layer.sortY > theme.art)) {
            errors.push(`Art piece ${index + 1} needs a picture, a valid crop and a ground line inside the map.`);
        }
    }
    for (const zone of theme.zones) {
        if (!zone.id.trim()) errors.push('A zone has no name.');
        if (zone.name !== undefined && (typeof zone.name !== 'string' || !zone.name.trim() || zone.name.length > 120)) errors.push('Place labels must be between 1 and 120 characters.');
        else if (seen.has(zone.id)) errors.push(`Two zones are called "${zone.id}".`);
        seen.add(zone.id);
        if (!(zone.rect[2] > 0 && zone.rect[3] > 0)) errors.push(`Zone "${zone.id}" has no size.`);
    }
    if (errors.length === 0) {
        const world = makeWorld(theme);
        if (world.isBlocked(world.SPAWN.x, world.SPAWN.y)) errors.push('The start position is inside a block, so nobody could start there.');
    }
    return { errors, warnings };
}

// Files are untrusted input. Check structure before either validation or rendering
// can touch nested shapes; also bound the reachability grid and shape count.
export function parseTheme(value: unknown): Theme {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('That file is not a theme object.');
    const t = value as Theme;
    const rect = (v: unknown): v is Rect => Array.isArray(v) && v.length === 4 && v.every(n => typeof n === 'number' && Number.isFinite(n));
    const point = (v: unknown): v is Point => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n));
    const list = (v: unknown): v is unknown[] => Array.isArray(v) && v.length <= 2000;
    const shape = (v: unknown): v is BlockShape => {
        if (!v || typeof v !== 'object') return false;
        const p = v as BlockShape;
        return p.shape === 'ellipse' ? rect(p.rect) : p.shape === 'poly' && list(p.points) && p.points.length >= 3 && p.points.every(point);
    };
    if (![t.id, t.name, t.image].every(v => typeof v === 'string')
        || typeof t.art !== 'number' || typeof t.world !== 'number'
        || !t.spawn || !Number.isFinite(t.spawn.x) || !Number.isFinite(t.spawn.y)
        || !list(t.blocked) || !t.blocked.every(rect)
        || t.blockedShapes !== undefined && (!list(t.blockedShapes) || !t.blockedShapes.every(shape))
        || !list(t.walkBehind) || !t.walkBehind.every(p => shape(p) && Number.isFinite((p as WalkBehind).sortY))
        || !list(t.zones) || !t.zones.every(z => z && typeof z.id === 'string' && rect(z.rect))
        || t.layout !== undefined && typeof t.layout !== 'string'
        || t.scenery !== undefined && (!t.scenery || typeof t.scenery !== 'object')
        || t.layers !== undefined && (!list(t.layers) || !t.layers.every(p => p && typeof p.image === 'string' && rect(p.rect) && rect(p.source)))) {
        throw new Error('That theme has missing or malformed shapes, places or art pieces.');
    }
    const { errors } = validateTheme(t);
    if (errors.length) throw new Error(errors.join(' '));
    return t;
}

// The theme as a file: compact, one shape to a line, always in the same order, so two versions can be compared.
export function formatTheme(theme: Theme): string {
    const line = (value: unknown) => JSON.stringify(value).replace(/,/g, ', ');
    const lines = (items: unknown[]) => items.length ? `[\n${items.map(item => `  ${line(item)}`).join(',\n')}\n ]` : '[]';
    return [
        '{',
        ` "id": ${line(theme.id)},`,
        ` "name": ${line(theme.name)},`,
        ` "image": ${line(theme.image)},`,
        ` "art": ${theme.art},`,
        ` "world": ${theme.world},`,
        ...(theme.layout ? [` "layout": ${line(theme.layout)},`] : []),
        ...(theme.scenery ? [` "scenery": ${line(theme.scenery)},`] : []),
        ...(theme.layers?.length ? [` "layers": ${lines(theme.layers)},`] : []),
        ` "spawn": ${line(theme.spawn)},`,
        ` "blocked": ${lines(theme.blocked.map(rect => [...rect]))},`,
        ...(theme.blockedShapes?.length ? [` "blockedShapes": ${lines(theme.blockedShapes)},`] : []),
        ` "walkBehind": ${lines(theme.walkBehind)},`,
        ` "zones": ${lines(theme.zones)}`,
        '}',
        '',
    ].join('\n');
}
