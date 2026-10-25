import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { sceneryTheme, beachScene, SCENERY_PRESETS } from '../../shared/scenery.ts';
import { getTheme } from '../../shared/themeCatalog.ts';
import { formatTheme, parseTheme } from '../../shared/theme.ts';
import { walkReport } from '../../shared/walk.ts';
import { templateTextFiles } from '../../shared/artTemplate.ts';
import { buildMissionPrompt } from '../../shared/missionPrompt.ts';
import { sheetTransparencyProblem } from '../../shared/artSheet.ts';
import { installTheme } from '../../scripts/install-theme.mjs';

const root = path.join(import.meta.dirname, '../..');

test('snow, beach, deck and custom settings reuse paths while replacing all scenery and labels', () => {
    for (const preset of Object.keys(SCENERY_PRESETS)) {
        const theme = sceneryTheme(preset);
        assert.deepEqual(theme.blocked, beachScene.blocked);
        assert.deepEqual(theme.blockedShapes, beachScene.blockedShapes);
        assert.equal(theme.blocked.length + theme.blockedShapes.length, 10);
        assert.equal(theme.layers.length, 6);
        assert.equal(theme.layers.filter(l => l.sortY !== undefined).length, 2);
        assert.equal(theme.zones.length, 5);
        assert.deepEqual(theme.layers.map(l => l.rect), beachScene.layers.map(l => l.rect));
        assert.deepEqual(theme.layers.map(l => l.source), [[0,0,1/3,1/2],[1/3,0,1/3,1/2],[2/3,0,1/3,1/2],[0,1/2,1/3,1/2],[1/3,1/2,1/3,1/2],[2/3,1/2,1/3,1/2]]);
        assert.deepEqual(walkReport(theme).problems, []);
        assert.equal(walkReport(theme).cutOff, 0);
        assert.deepEqual(parseTheme(JSON.parse(formatTheme(theme))), theme);
    }
    assert.equal(getTheme('scene-beach').name, 'Summer beach');
    assert.equal(sceneryTheme('deck').zones[4].name, 'Sun deck');
    assert.equal(getTheme().id, 'plaza', 'old games keep the original map');
});

test('art kits and mission prompts describe the chosen whole world with stable discovery IDs', () => {
    const theme = sceneryTheme('deck');
    const files = templateTextFiles(theme, 'Midnight jazz cruise');
    assert.match(files['ground-prompt.md'], /Midnight jazz cruise/);
    assert.match(files['ground-prompt.md'], /wooden cruise-ship deck/);
    assert.match(files['ground-prompt.md'], /no mandatory grass, paving, fountain, bridge or pond/);
    assert.match(files['scenery-prompt.md'], /THREE columns and TWO rows/);
    assert.match(files['scenery-prompt.md'], /Tall sun umbrella/);
    assert.match(files['scenery-prompt.md'], /Circular hot tub/);
    assert.match(files['story-context.md'], /park: Sun deck/);
    assert.match(files['art-sheet-guide.svg'], /width="1536"/);
    assert.match(files['layout.svg'], /Sun deck/);
    assert.match(files['instructions.md'], /--picture "ground.png" --sheet "scenery.png"/);
    const campaign = { id: 'cruise', title: 'Cruise', roles: [], chapters: [], finale: 'Done' };
    const prompt = buildMissionPrompt(campaign, 'A lost passport', 'A2', 'create', undefined, theme);
    assert.match(prompt, /park: Sun deck/);
    assert.match(prompt, /replace its hotel references/);
    assert.match(buildMissionPrompt(campaign, 'Next episode', 'A2', 'extend', undefined, theme), /Preserve the existing campaign and answers/);
    for (const scenery of [{}, { setting: 'Deck', ground: '', objects: null }, { setting: 'Deck', ground: '', objects: ['one'] }]) {
        assert.throws(() => parseTheme({ ...theme, scenery }));
    }
    assert.throws(() => parseTheme({ ...theme, zones: [{ ...theme.zones[0], name: '' }] }));
    const edited = { ...theme, name: 'Sea, "sun", and stories', scenery: { ...theme.scenery, ground: 'Sand, deck, "escaped\\", punctuation.' } };
    assert.deepEqual(parseTheme(JSON.parse(formatTheme(edited))), edited, 'export preserves commas and escapes in authored descriptions');
});

test('the beach assets have a square ground and six independent transparent scenery cells', async () => {
    const ground = await sharp(path.join(root, 'public', beachScene.image)).metadata();
    assert.equal(ground.width, ground.height);
    const { data, info } = await sharp(path.join(root, 'public', beachScene.layers[0].image)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width / info.height, 1.5);
    assert.equal(sheetTransparencyProblem(data, info.width, info.height, 3, 2), null);
    // Omitting the sixth sprite is rejected even though the original four slots are present.
    for (let y = info.height / 2; y < info.height; y++) for (let x = info.width * 2 / 3; x < info.width; x++) data[(y * info.width + x) * 4 + 3] = 0;
    assert.match(sheetTransparencyProblem(data, info.width, info.height, 3, 2), /visible object/);
});

test('installing complete scenery copies both generated images and preserves names, crops and geometry', async t => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plaza-scene-install-'));
    t.after(() => { assert.equal(path.dirname(tempRoot), path.resolve(os.tmpdir())); fs.rmSync(tempRoot, { recursive: true, force: true }); });
    const theme = sceneryTheme('beach', 'scene-test');
    const source = path.join(tempRoot, 'theme.json'); fs.writeFileSync(source, formatTheme(theme));
    const result = (await installTheme({ root: tempRoot, source,
        sheet: path.join(root, 'public', beachScene.layers[0].image), picture: path.join(root, 'public', beachScene.image) })).theme;
    assert.equal(result.image, '/assets/maps/scene-test-background.png');
    assert.equal(result.layers[0].image, '/assets/maps/scene-test.png');
    assert.deepEqual(result.zones, theme.zones);
    assert.deepEqual(result.scenery, theme.scenery);
    assert.deepEqual(result.blockedShapes, theme.blockedShapes);
    assert.deepEqual(result.layers.map(l => l.source), theme.layers.map(l => l.source));
    assert.ok(fs.existsSync(path.join(tempRoot, 'public', result.image)));
    assert.ok(fs.existsSync(path.join(tempRoot, 'public', result.layers[0].image)));
    assert.match(fs.readFileSync(path.join(tempRoot, 'shared/themes/installed.ts'), 'utf8'), /scene-test/);
});
