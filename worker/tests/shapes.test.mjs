// Blocks that are not rectangles: ovals and free shapes become thin strips the game and the server can use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTheme, makeWorld, shapeRects, validateTheme } from '../../shared/theme.ts';
import { reachability, walkReport } from '../../shared/walk.ts';

const area = rects => rects.reduce((sum, [, , w, h]) => sum + w * h, 0);
const field = (overrides = {}) => ({
    id: 'field', name: 'Field', image: '/assets/maps/field.webp', art: 200, world: 400,
    spawn: { x: 100, y: 20 }, blocked: [], walkBehind: [], zones: [{ id: 'gate', rect: [80, 150, 40, 40] }], ...overrides,
});

test('an oval is made of strips that add up to its area', () => {
    const rects = shapeRects({ shape: 'ellipse', rect: [10, 10, 100, 60] });
    const truth = Math.PI * 50 * 30;
    assert.ok(Math.abs(area(rects) - truth) / truth < 0.05, `${area(rects)} against ${truth}`);
    assert.ok(rects.every(([x, y, w, h]) => x >= 10 && y >= 10 - 0.01 && x + w <= 110.01 && y + h <= 70.01), 'inside its box');
    assert.ok(rects.length > 5);
});

test('a free shape is made of strips that follow its outline', () => {
    const triangle = shapeRects({ shape: 'poly', points: [[0, 0], [60, 0], [0, 60]] });
    assert.ok(Math.abs(area(triangle) - 1800) / 1800 < 0.06, String(area(triangle)));
    // An L-shape leaves its corner empty.
    const ell = shapeRects({ shape: 'poly', points: [[0, 0], [20, 0], [20, 40], [60, 40], [60, 60], [0, 60]] });
    const covers = (x, y) => ell.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh);
    assert.equal(covers(10, 10), true);
    assert.equal(covers(40, 50), true);
    assert.equal(covers(40, 10), false, 'the empty corner');
    // A rectangle drawn as a shape joins into one block, not a stack of strips.
    assert.equal(shapeRects({ shape: 'poly', points: [[5, 5], [45, 5], [45, 35], [5, 35]] }).length, 1);
    assert.deepEqual(shapeRects({ shape: 'poly', points: [[1, 1], [9, 9]] }), []);
});

test('shapes block avatars in the world, with the same checks as rectangles', () => {
    const world = makeWorld(field({ blockedShapes: [{ shape: 'ellipse', rect: [60, 80, 80, 40] }] }));
    assert.equal(world.isBlocked(200, 200), true, 'the middle of the oval');
    assert.equal(world.isBlocked(100, 200), false, 'beside it');
    assert.equal(world.isBlocked(124, 164), false, 'the corner of its box, outside the oval');
    assert.equal(world.legalMove(200, 100, 200, 300, 2000), false, 'not through it');
});

test('students walk round an oval, and a shape that closes the field off is reported', () => {
    assert.deepEqual(walkReport(field({ blockedShapes: [{ shape: 'ellipse', rect: [60, 80, 80, 40] }] })).problems, []);
    const wall = [[0, 85], [200, 85], [200, 115], [0, 115]];
    const closed = walkReport(field({ blockedShapes: [{ shape: 'poly', points: wall }] }));
    assert.ok(closed.problems.some(problem => /cannot be reached/.test(problem)), closed.problems.join(' | '));
    assert.equal(reachability(field({ blockedShapes: [{ shape: 'ellipse', rect: [60, 80, 80, 40] }] })).reachable(100, 100), false);
});

test('shapes are checked and written like everything else', () => {
    assert.match(validateTheme(field({ blockedShapes: [{ shape: 'poly', points: [[1, 1], [5, 5]] }] })).errors.join(' '), /Block shape 1 needs at least three corners/);
    assert.match(validateTheme(field({ blockedShapes: [{ shape: 'ellipse', rect: [5, 5, 0, 9] }] })).errors.join(' '), /Block shape 1 has no size/);
    const theme = field({ blockedShapes: [{ shape: 'ellipse', rect: [60, 80, 80, 40] }] });
    assert.deepEqual(JSON.parse(formatTheme(theme)).blockedShapes, theme.blockedShapes);
    assert.equal('blockedShapes' in JSON.parse(formatTheme(field())), false, 'a theme without shapes is written as before');
});
