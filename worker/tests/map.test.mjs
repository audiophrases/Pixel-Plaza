// Can a student's feet actually walk between the places the story sends them? Walks the real wall
// data with the player's real foot box, so a wall that closes off a path or a gate fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCALE, SPAWN, isBlocked, legalMove, plazaMap } from '../../shared/plazaMap.ts';
import { reachability } from '../../shared/walk.ts';

const CELL = 4;

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
    const map = reachability(plazaMap);
    const stuck = Object.entries(places).filter(([, spot]) => isBlocked(spot[0] * SCALE, spot[1] * SCALE) || !map.reachable(spot[0], spot[1])).map(([name]) => name);
    assert.deepEqual(stuck, []);
});

test('the bridge is crossed by its deck, not by going around the pond', () => {
    const [westX, westY] = places['bridge, west end'];
    const map = reachability(plazaMap, { x: westX, y: westY });
    assert.ok(map.reachable(...places['bridge deck']), 'the deck can be entered from the west');
    const across = map.stepsAt(...places['bridge, east end']);
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
