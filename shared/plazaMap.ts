// The map the plaza is played on. Plain data, no imports, so the browser and
// the worker (and the tests, under `node --test`) all read the same file.
//
// Rectangles are measured on the artwork in its own pixels, [x, y, width, height],
// so they can be checked against the picture. `worldRects` scales them to the
// 2048-wide world the game runs in. To add a new theme, copy this file, swap the
// image, and redraw the rectangles; press F2 in the game to see them drawn over the art.

export type Rect = readonly [x: number, y: number, w: number, h: number];

const ART = 1254; // width and height of public/assets/maps/plaza.webp
export const MAP_SIZE = 2048;
const SCALE = MAP_SIZE / ART;

export const plazaMap = {
    id: 'plaza',
    image: '/assets/maps/plaza.webp',
    spawn: { x: 372, y: 555 }, // paved gap north of the fountain, in art pixels

    // Where players cannot walk, as small blocks hugging each object's base: the
    // trunk of a tree, not its crown, since a head can pass in front of a wall.
    // Streets, the square's paving, the park paths and the gates stay open.
    blocked: [
        // edge: tree line, fence, left forest
        [0,0,1254,40], [0,0,60,1254], [1210,0,44,1254], [0,1120,1254,134],
        // --- hotel
        [0,0,147,330], [0,330,130,110], [147,0,350,318], [135,318,82,40], [207,285,56,60], [332,285,32,60], [370,285,66,50],
        [468,285,30,45], [370,335,115,47], [122,360,123,55], [351,360,154,55], [401,405,68,28], [489,213,31,163], [495,0,85,205],
        // --- cafe
        [565,0,250,300], [548,194,34,60], [554,300,32,38], [600,285,60,28], [730,285,40,28], [771,285,30,35], [826,335,28,22],
        [586,318,80,36], [721,318,52,36], [799,320,35,25], [562,357,112,58], [733,357,118,58], [815,0,40,300], [855,0,70,190], [855,190,50,175],
        // --- shop
        [909,0,220,310], [937,300,102,52], [1088,290,34,52], [908,320,32,60], [925,357,25,52], [950,358,98,66], [1090,360,115,75], [1125,0,129,360],
        // --- square: fountain
        [325,605,80,60], [310,610,110,55], [300,660,125,20], [275,680,180,20], [255,700,217,90], [275,790,180,25], [305,815,115,45],
        [217,645,55,50], [455,645,55,50], [220,705,40,80], [470,705,40,80], [212,830,50,60], [465,830,52,60], [247,790,60,45], [415,790,60,45],
        // --- square: corners
        [150,500,95,115], [130,610,42,36], [102,655,45,50], [232,500,75,65],
        [452,500,65,65], [500,500,65,105], [548,612,36,34], [578,605,85,105], [640,790,45,40],
        [100,855,35,130], [118,890,100,55], [152,925,100,80], [135,985,60,45], [210,978,100,70], [425,978,110,70], [530,985,30,50],
        [610,845,45,130], [555,965,100,60], [490,925,100,75], [515,892,65,60], [580,890,34,32], [660,1075,40,40],
        // --- park
        [672,505,125,42], [747,505,48,145], [747,600,95,50], [810,490,28,55], [675,550,70,20], [838,492,80,70], [962,585,55,50], [1060,505,70,90],
        [1128,630,24,22], [1105,700,25,35], [1125,715,28,70], [838,655,25,80], [807,685,40,50], [995,695,22,80], [895,688,78,50],
        [1012,705,48,42], [980,745,26,28], [1052,735,58,50], [712,668,70,128], [702,740,35,45], [825,765,45,35], [800,780,42,40],
        [850,775,48,45], [775,805,115,60], [720,795,50,40], [882,875,26,22], [955,815,26,70], [900,818,16,65], [980,810,118,60],
        [1115,845,30,25], [950,872,70,32], [1055,870,90,55], [1100,915,50,55], [1120,960,30,40],
        [917,905,70,38], [985,925,45,50], [1030,950,35,50], [1030,895,40,40], [1065,915,45,40], [1100,950,18,40],
        [810,985,250,120], [1010,1015,80,115], [722,1000,85,80], [795,945,100,60], [765,975,40,40], [715,1080,110,50], [685,1080,25,50],
        [712,930,48,45], [680,1045,30,22], [650,1085,45,30], [640,538,25,22], [640,505,35,45],
    ] as Rect[],

    // Named places, for missions and hints later.
    zones: [
        { id: 'hotel', rect: [120, 330, 390, 110] },
        { id: 'cafe', rect: [565, 330, 265, 110] },
        { id: 'shop', rect: [910, 330, 215, 110] },
        { id: 'square', rect: [100, 480, 560, 580] },
        { id: 'park', rect: [670, 480, 540, 660] },
    ] as { id: string; rect: Rect }[],
};

const toWorld = ([x, y, w, h]: Rect): Rect => [x * SCALE, y * SCALE, w * SCALE, h * SCALE];
const inside = (x: number, y: number, [rx, ry, rw, rh]: Rect) => x >= rx && x < rx + rw && y >= ry && y < ry + rh;

export const worldRects: Rect[] = plazaMap.blocked.map(toWorld);
export const worldZones = plazaMap.zones.map(zone => ({ id: zone.id, rect: toWorld(zone.rect) }));
export const SPAWN = { x: Math.round(plazaMap.spawn.x * SCALE), y: Math.round(plazaMap.spawn.y * SCALE) };

// True when a world position is in a place nobody can walk.
export const isBlocked = (x: number, y: number) => worldRects.some(rect => inside(x, y, rect));
