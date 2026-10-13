// The theme file and the tools the studio uses: checking a theme, writing it out, and finding where avatars can walk.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { formatTheme, makeWorld, validateTheme } from '../../shared/theme.ts';
import { feetBlocked, reachability, walkReport } from '../../shared/walk.ts';
import { themes } from '../../shared/plazaMap.ts';

const plaza = themes.plaza;

// A small theme to try things on: an open field 200 pixels across, with a fence across the middle.
const field = (overrides = {}) => ({
    id: 'field', name: 'Field', image: '/assets/maps/field.webp', art: 200, world: 400,
    spawn: { x: 100, y: 20 }, blocked: [], walkBehind: [], zones: [{ id: 'gate', rect: [80, 150, 40, 40] }], ...overrides,
});

test('the plaza theme file is valid and is written exactly as the studio writes it', () => {
    assert.deepEqual(validateTheme(plaza), { errors: [], warnings: [] });
    const file = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'shared', 'themes', 'plaza.json'), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(formatTheme(plaza), file, 'download it from the studio and you get the same file back');
    assert.deepEqual(JSON.parse(formatTheme(plaza)), JSON.parse(file));
});

test('a theme with problems is told so, in plain words', () => {
    assert.deepEqual(validateTheme(field()), { errors: [], warnings: [] });
    const messages = (theme) => validateTheme(theme).errors.join(' | ');
    assert.match(messages(field({ id: 'Big Field' })), /lower-case/);
    assert.match(messages(field({ name: ' ' })), /needs a name/);
    assert.match(messages(field({ spawn: { x: 500, y: 20 } })), /outside the picture/);
    assert.match(messages(field({ blocked: [[10, 10, 0, 5]] })), /Block 1 has no size/);
    assert.match(messages(field({ walkBehind: [{ shape: 'poly', points: [[1, 1], [5, 5]], sortY: 50 }] })), /three corners/);
    assert.match(messages(field({ walkBehind: [{ shape: 'ellipse', rect: [10, 10, 20, 20], sortY: 900 }] })), /ground line/);
    assert.match(messages(field({ zones: [{ id: 'a', rect: [0, 0, 5, 5] }, { id: 'a', rect: [9, 9, 5, 5] }] })), /Two zones are called "a"/);
    assert.match(messages(field({ blocked: [[90, 10, 20, 20]] })), /start position is inside a block/);
    assert.match(validateTheme(field({ blocked: [[500, 500, 10, 10]] })).warnings.join(' '), /outside the picture/);
});

test('the world is the picture scaled up, with the checks the server makes', () => {
    const world = makeWorld(field({ blocked: [[50, 50, 20, 20]], zones: [{ id: 'gate', rect: [80, 150, 40, 40] }] }));
    assert.equal(world.scale, 2);
    assert.deepEqual(world.SPAWN, { x: 200, y: 40 });
    assert.equal(world.isBlocked(110, 110), true);
    assert.equal(world.isBlocked(90, 90), false);
    assert.equal(world.zoneAt(200, 340), 'gate');
    assert.equal(world.zoneAt(10, 10), null);
    assert.equal(world.legalMove(200, 40, 210, 40, 200), true);
    assert.equal(world.legalMove(200, 40, 200, 340, 200), false, 'too far too fast');
});

test('an open field can be walked from the start to the gate, and a fence across it cannot', () => {
    assert.deepEqual(walkReport(field()).problems, []);
    const walled = walkReport(field({ blocked: [[0, 90, 200, 20]] }));
    assert.ok(walled.problems.some(problem => /Zone "gate" cannot be reached/.test(problem)), walled.problems.join(' | '));
    assert.ok(walled.problems.some(problem => /cut off/.test(problem)));
    // A gap in the fence lets everyone through again.
    assert.deepEqual(walkReport(field({ blocked: [[0, 90, 80, 20], [120, 90, 80, 20]] })).problems, []);
    assert.ok(walkReport(field({ blocked: [[80, 150, 40, 40]] })).problems.some(problem => /nowhere to stand/.test(problem)));
});

test('the avatar walks round a block by its feet, not its centre', () => {
    const theme = field({ blocked: [[90, 90, 20, 20]] });
    const map = reachability(theme);
    assert.equal(map.reachable(100, 20), true);
    assert.equal(map.reachable(100, 100), false, 'the block');
    assert.equal(map.reachable(100, 86), false, 'too close above it for the feet');
    assert.equal(map.reachable(100, 76), true, 'the feet clear it');
    assert.equal(feetBlocked(theme, 100, 100), true);
    assert.equal(feetBlocked(theme, 100, 86), true);
    assert.equal(feetBlocked(theme, 100, 60), false);
    // A start inside a block reaches nothing.
    assert.equal(reachability(theme, { x: 100, y: 100 }).reachable(100, 20), false);
});

test('the real plaza has no closed-off places', () => {
    const report = walkReport(plaza);
    assert.deepEqual(report.problems, []);
    assert.ok(report.reached > 10000);
});
