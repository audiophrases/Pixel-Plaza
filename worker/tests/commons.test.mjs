import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { gardenCommons, autumnCommons } from '../../shared/commons.ts';
import { getTheme, getWorld, hasTheme } from '../../shared/themeCatalog.ts';
import { formatTheme, parseTheme } from '../../shared/theme.ts';
import { reachability, walkReport } from '../../shared/walk.ts';
import { artInstructions, templateTextFiles } from '../../shared/artTemplate.ts';
import { installTheme } from '../../scripts/install-theme.mjs';
import { sheetTransparencyProblem } from '../../shared/artSheet.ts';

const root = path.join(import.meta.dirname, '..', '..');

test('both seasons use the same simple geometry and every gathering place is reachable', () => {
    const geometry = t => ({ art: t.art, world: t.world, blocked: t.blocked, shapes: t.blockedShapes, zones: t.zones,
        spawn: t.spawn, layers: t.layers.map(({ source, rect, sortY }) => ({ source, rect, sortY })) });
    assert.deepEqual(geometry(gardenCommons), geometry(autumnCommons));
    for (const theme of [gardenCommons, autumnCommons]) {
        assert.equal(theme.blocked.length + theme.blockedShapes.length, 10);
        assert.equal(theme.layers.filter(p => p.sortY !== undefined).length, 2);
        assert.deepEqual(walkReport(theme).problems, []);
        assert.equal(walkReport(theme).cutOff, 0);
        const map = reachability(theme);
        // Across the broad street, around both trees, and around both pond ends.
        for (const [x, y] of [[60, 450], [960, 450], [200, 380], [512, 380], [824, 380], [200, 800], [800, 810], [680, 890], [940, 890], [808, 964]]) {
            assert.ok(map.reachable(x, y), `${theme.id}: ${x},${y}`);
        }
        assert.equal(map.walkable(224, 764), false, 'tree trunk is solid');
        assert.equal(map.walkable(808, 890), false, 'pond is solid');
        assert.equal(map.reachable(224, 700), true, 'walk under the tree crown');
        assert.equal(getWorld(theme.id).zoneAt(1648, 760), 'shop');
        assert.deepEqual(parseTheme(JSON.parse(formatTheme(theme))), theme);
    }
    assert.equal(getTheme().id, 'plaza');
    assert.equal(hasTheme('__proto__'), false);
    assert.equal(getTheme('__proto__').id, 'plaza');
});

test('both AI sheets contain four visible sprites and real transparency', async () => {
    for (const theme of [gardenCommons, autumnCommons]) {
        const image = sharp(path.join(root, 'public', theme.layers[0].image));
        const metadata = await image.metadata();
        assert.equal(metadata.width, metadata.height);
        assert.equal(metadata.hasAlpha, true);
        const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        for (let cell = 0; cell < 4; cell++) {
            let clear = 0, solid = 0;
            const half = Math.floor(info.width / 2);
            for (let y = 0; y < half; y += 4) for (let x = 0; x < half; x += 4) {
                const a = data[((y + Math.floor(cell / 2) * half) * info.width + x + cell % 2 * half) * 4 + 3];
                if (a < 32) clear++; if (a > 200) solid++;
            }
            assert.ok(clear > 20 && solid > 1000, `${theme.id} cell ${cell} is a transparent sprite`);
        }
        assert.ok(fs.existsSync(path.join(root, 'public', theme.image)));
    }
});

test('malformed imported themes fail before walking or rendering', () => {
    for (const invalid of [null, [], {}, { ...gardenCommons, blocked: [[1, 2]] }, { ...gardenCommons, world: 1e9 },
        { ...gardenCommons, layers: [{ image: '/bad', source: [0, 0, 2, 1], rect: [0, 0, 1, 1] }] },
        { ...gardenCommons, walkBehind: [{ shape: 'poly', points: null }] }, { ...gardenCommons, spawn: null }]) {
        assert.throws(() => parseTheme(invalid));
    }
    assert.equal(artInstructions(gardenCommons, 'Snowy village').includes('Snowy village'), true);
    assert.ok(templateTextFiles(gardenCommons, '')['art-sheet-guide.svg']);
    const hostile = { ...gardenCommons, zones: [{ id: '<script>&"', rect: [10, 10, 30, 30] }] };
    assert.ok(templateTextFiles(hostile, '')['layout.svg'].includes('&lt;script&gt;&amp;&quot;'));
});

test('opaque art and a sheet with a missing cell are rejected even with an alpha channel', () => {
    const pixels = new Uint8Array(64 * 64 * 4).fill(255);
    assert.match(sheetTransparencyProblem(pixels, 64, 64), /transparent background/);
    pixels.fill(0);
    assert.match(sheetTransparencyProblem(pixels, 64, 64), /visible object/);
    for (let cell = 0; cell < 4; cell++) {
        for (let y = 4; y < 28; y++) for (let x = 4; x < 28; x++) pixels[((y + Math.floor(cell / 2) * 32) * 64 + x + cell % 2 * 32) * 4 + 3] = 255;
    }
    assert.equal(sheetTransparencyProblem(pixels, 64, 64), null);
    for (let y = 32; y < 64; y++) for (let x = 32; x < 64; x++) pixels[(y * 64 + x) * 4 + 3] = 0;
    assert.match(sheetTransparencyProblem(pixels, 64, 64), /visible object/);
});

test('installing a treatment copies art and registers it without changing its geometry or Season 1', async t => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plaza-theme-install-'));
    t.after(() => { assert.equal(path.dirname(tempRoot), path.resolve(os.tmpdir())); fs.rmSync(tempRoot, { recursive: true, force: true }); });
    fs.mkdirSync(path.join(tempRoot, 'public', 'assets', 'maps'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'shared', 'themes'), { recursive: true });
    const original = fs.readFileSync(path.join(root, 'shared', 'themes', 'plaza.json'));
    fs.writeFileSync(path.join(tempRoot, 'shared', 'themes', 'plaza.json'), original);
    fs.copyFileSync(path.join(root, 'public', 'assets', 'maps', 'plaza.webp'), path.join(tempRoot, 'public', 'assets', 'maps', 'plaza.webp'));
    const legacy = await installTheme({ root: tempRoot, source: path.join(tempRoot, 'shared', 'themes', 'plaza.json') });
    assert.equal(legacy.theme.id, 'plaza', 'the original install command remains supported');
    assert.match(fs.readFileSync(path.join(tempRoot, 'shared', 'themes', 'installed.ts'), 'utf8'), /import type/);
    fs.copyFileSync(path.join(root, 'public', gardenCommons.image), path.join(tempRoot, 'public', gardenCommons.image));
    const theme = { ...gardenCommons, id: 'commons-test', name: 'Test season' };
    const source = path.join(tempRoot, 'theme.json'); fs.writeFileSync(source, formatTheme(theme));
    const sheet = path.join(root, 'public', gardenCommons.layers[0].image);
    const installed = (await installTheme({ root: tempRoot, source, sheet })).theme;
    assert.deepEqual(installed.blocked, gardenCommons.blocked);
    assert.deepEqual(installed.blockedShapes, gardenCommons.blockedShapes);
    assert.equal(installed.layers[0].image, '/assets/maps/commons-test.png');
    assert.ok(fs.existsSync(path.join(tempRoot, 'public', installed.layers[0].image)));
    const registry = fs.readFileSync(path.join(tempRoot, 'shared', 'themes', 'installed.ts'), 'utf8');
    assert.match(registry, /commons-test/);
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{"type":"module"}');
    fs.copyFileSync(path.join(root, 'shared', 'theme.ts'), path.join(tempRoot, 'shared', 'theme.ts'));
    const loaded = await import(pathToFileURL(path.join(tempRoot, 'shared', 'themes', 'installed.ts')).href);
    assert.equal(loaded.installedThemes['commons-test'].name, 'Test season', 'the generated registry really loads the new map');
    assert.deepEqual(loaded.installedThemes['commons-test'].layers, installed.layers);
    assert.deepEqual(fs.readFileSync(path.join(tempRoot, 'shared', 'themes', 'plaza.json')), original);
    const before = fs.readFileSync(path.join(tempRoot, 'shared', 'themes', 'commons-test.json'), 'utf8');
    await assert.rejects(installTheme({ root: tempRoot, source, sheet: path.join(tempRoot, 'missing.png') }));
    assert.equal(fs.readFileSync(path.join(tempRoot, 'shared', 'themes', 'commons-test.json'), 'utf8'), before);
});
