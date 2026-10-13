// Can a student's feet actually walk between the places the story sends them? Walks the real wall
// data with the player's real foot box, so a wall that closes off a path or a gate fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_SIZE, SCALE, SPAWN, isBlocked, legalMove, worldRects } from '../../shared/plazaMap.ts';

const CELL = 4;
const N = Math.ceil(MAP_SIZE / CELL);
// The avatar's feet: FIGURE_BODY in src/game/AvatarFigure.ts (width 26, height 14, offset -13, -4).
const FOOT = { left: 13, right: 13, up: 4, down: 10 };

const blocked = new Uint8Array(N * N);
for (const [x, y, w, h] of worldRects) {
    const x0 = Math.max(0, Math.floor((x - FOOT.right) / CELL)), x1 = Math.min(N - 1, Math.ceil((x + w + FOOT.left) / CELL));
    const y0 = Math.max(0, Math.floor((y - FOOT.down) / CELL)), y1 = Math.min(N - 1, Math.ceil((y + h + FOOT.up) / CELL));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) blocked[cy * N + cx] = 1;
}
// The world's edge stops the avatar at its centre.
for (let i = 0; i < N; i++) for (const edge of [0, N - 1]) { blocked[edge * N + i] = 1; blocked[i * N + edge] = 1; }

const cell = ([ax, ay]) => Math.round(ax * SCALE / CELL) + N * Math.round(ay * SCALE / CELL);

// Steps (of CELL pixels) from `start` to each cell it can reach, or 0 for cells it cannot.
function stepsFrom(start) {
    const seen = new Uint16Array(N * N);
    const queue = [start];
    seen[start] = 1;
    for (let head = 0; head < queue.length; head++) {
        const here = queue[head];
        const x = here % N;
        for (const next of [here - 1, here + 1, here - N, here + N]) {
            if (next < 0 || next >= N * N || seen[next] || blocked[next]) continue;
            if ((next === here - 1 && x === 0) || (next === here + 1 && x === N - 1)) continue;
            seen[next] = seen[here] + 1;
            queue.push(next);
        }
    }
    return seen;
}

// Places in art pixels. Each must be somewhere a student can stand and reach from the spawn.
const places = {
    'spawn': [SPAWN.x / SCALE, SPAWN.y / SCALE],
    'hotel gate steps': [298, 385], 'hotel courtyard': [298, 340],
    'cafe gate steps': [704, 385], 'cafe patio': [693, 337],
    'shop steps': [1066, 385], 'shop forecourt': [1066, 342],
    'path between hotel and cafe, north end': [536, 230], 'path between hotel and cafe, south end': [536, 420],
    'square, south of the fountain': [370, 945], 'square, west side': [140, 760],
    'stairs from the square to the park': [685, 725],
    'park arbor floor': [930, 755], 'park, under the big tree': [1000, 665],
    'park, west lawn by the pond': [700, 925], 'bridge, west end': [960, 914],
    'bridge deck': [1040, 932], 'bridge, east end': [1095, 1000],
    'path south of the pond, west': [760, 1170], 'path south of the pond, middle': [940, 1165], 'path south of the pond, east': [1000, 1175],
    'path by the bottom fence, far west': [130, 1135], 'path by the bottom fence, west': [300, 1150], 'path by the bottom fence, curve': [650, 1172],
    'east street': [1175, 800],
};

test('every place in the story can be reached on foot from the spawn', () => {
    const seen = stepsFrom(cell(places.spawn));
    const stuck = Object.entries(places).filter(([, spot]) => isBlocked(spot[0] * SCALE, spot[1] * SCALE) || !seen[cell(spot)]).map(([name]) => name);
    assert.deepEqual(stuck, []);
});

test('the bridge is crossed by its deck, not by going around the pond', () => {
    const steps = stepsFrom(cell(places['bridge, west end']));
    assert.ok(steps[cell(places['bridge deck'])], 'the deck can be entered from the west');
    const across = steps[cell(places['bridge, east end'])];
    assert.ok(across, 'and left at the east end');
    // Over the deck it is a few hundred pixels; round the pond and back it would be well over a thousand.
    assert.ok((across - 1) * CELL < 600, `crossing takes ${(across - 1) * CELL} pixels`);
});

test('a move is believed only if it could have been walked', () => {
    const { x, y } = SPAWN;
    assert.equal(legalMove(x, y, x + 10, y, 100), true, 'a step');
    assert.equal(legalMove(x, y, x + 100, y, 1000), true, 'a second of walking');
    assert.equal(legalMove(x, y, x + 600, y, 100), false, 'too fast');
    assert.equal(legalMove(x, y, 590, 1280, 5000), false, 'into the fountain');
    // Walking straight through the fountain is refused even though both ends are open and the time is generous.
    const south = [372 * SCALE, 1000 * SCALE];
    assert.equal(isBlocked(south[0], south[1]), false);
    assert.equal(legalMove(x, y, south[0], south[1], 2000), false);
    // Time beyond a couple of seconds buys no more distance, so waiting is no way to teleport.
    assert.equal(legalMove(x, y, x + 1500, y, 60000), false);
});
