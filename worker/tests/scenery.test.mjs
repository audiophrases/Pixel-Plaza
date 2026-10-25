import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { sceneryTheme, SCENERY_PRESETS } from '../../shared/scenery.ts';
import { getTheme, hasTheme } from '../../shared/themeCatalog.ts';
import { formatTheme, parseTheme } from '../../shared/theme.ts';
import { walkReport } from '../../shared/walk.ts';
import { templateTextFiles } from '../../shared/artTemplate.ts';
import { buildMissionPrompt } from '../../shared/missionPrompt.ts';
import { installTheme } from '../../scripts/install-theme.mjs';

test('background briefs start with five simple obstacles, two hiding areas and accessible places', () => {
    const base = sceneryTheme('custom');
    for (const preset of Object.keys(SCENERY_PRESETS)) {
        const theme = sceneryTheme(preset);
        assert.equal(theme.blocked.length + theme.blockedShapes.length, 9, 'four boundaries plus five obstacles');
        assert.equal(theme.walkBehind.length, 2);
        assert.equal((theme.layers ?? []).length, 0, 'one complete background needs no sprite sheet');
        assert.equal(theme.zones.length, 5);
        assert.deepEqual(theme.blocked, base.blocked);
        assert.deepEqual(theme.blockedShapes, base.blockedShapes);
        assert.deepEqual(walkReport(theme).problems, []);
        assert.equal(walkReport(theme).cutOff, 0);
        assert.deepEqual(parseTheme(JSON.parse(formatTheme(theme))), theme);
    }
    assert.equal(hasTheme('scene-beach'), false, 'generated demo is not offered as a game map');
    assert.equal(getTheme().id, 'plaza');
});

test('the external AI kit requests one complete background, simple silhouettes and adjustable zones', () => {
    const theme = sceneryTheme('deck');
    const files = templateTextFiles(theme, 'Midnight jazz cruise; a missing passport');
    assert.match(files['prompt.md'], /ONE complete square background/);
    assert.match(files['prompt.md'], /Midnight jazz cruise; a missing passport/);
    assert.match(files['prompt.md'], /wooden cruise-ship deck/);
    assert.match(files['prompt.md'], /no fountain, park, pond or bridge is required/);
    assert.match(files['prompt.md'], /at most two intentional hiding features/);
    assert.match(files['instructions.md'], /Import AI background/);
    assert.match(files['instructions.md'], /--picture "background.png"/);
    assert.equal(files['scenery-prompt.md'], undefined);
    assert.equal(files['ground-prompt.md'], undefined);
    assert.equal(files['art-sheet-guide.svg'], undefined);
    assert.match(files['story-context.md'], /park: Sun deck/);
    assert.match(files['layout.svg'], /Sun deck/);
    assert.match(files['layout.svg'], /M144 778H304/, 'hiding ground line is visible in the guide');
    const moved = structuredClone(theme); moved.blocked[4] = [90, 80, 210, 220];
    assert.match(templateTextFiles(moved, '')['prompt.md'], /\[90,80,210,220\]/, 'export follows adjusted geometry');
});

test('scenery descriptions round-trip verbatim and matching mission prompts retain discovery IDs', () => {
    const theme = sceneryTheme('deck');
    const edited = { ...theme, name: 'Sea, "sun", and stories', scenery: { ...theme.scenery, ground: 'Sand, deck, "escaped\\", punctuation.' } };
    assert.deepEqual(parseTheme(JSON.parse(formatTheme(edited))), edited);
    for (const scenery of [{}, { setting: 'Deck', ground: '', objects: null }, { ...theme.scenery, objects: Array(9).fill('too many') }]) assert.throws(() => parseTheme({ ...theme, scenery }));
    assert.throws(() => parseTheme({ ...theme, zones: [{ ...theme.zones[0], name: '' }] }));
    const campaign = { id: 'cruise', title: 'Cruise', roles: [], chapters: [], finale: 'Done' };
    assert.match(buildMissionPrompt(campaign, 'A lost passport', 'A2', 'create', undefined, theme), /park: Sun deck/);
    assert.match(buildMissionPrompt(campaign, 'Next episode', 'A2', 'extend', undefined, theme), /Preserve the existing campaign and answers/);
});

test('installation needs only the external background and preserves the adjusted areas', async t => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plaza-background-install-'));
    t.after(() => { assert.equal(path.dirname(tempRoot), path.resolve(os.tmpdir())); fs.rmSync(tempRoot, { recursive: true, force: true }); });
    const theme = sceneryTheme('snow', 'winter-test'); theme.walkBehind[0].rect = [148, 590, 156, 164];
    const source = path.join(tempRoot, 'theme.json'); fs.writeFileSync(source, formatTheme(theme));
    const picture = path.join(tempRoot, 'external-background.png');
    // Plain decoding fixture, not generated artwork or a released map.
    await sharp({ create: { width: 512, height: 512, channels: 3, background: '#eeeeee' } }).png().toFile(picture);
    await assert.rejects(installTheme({ root: tempRoot, source }), /Missing/);
    const result = (await installTheme({ root: tempRoot, source, picture })).theme;
    assert.equal(result.image, '/assets/maps/winter-test-background.png');
    assert.equal((result.layers ?? []).length, 0);
    assert.deepEqual(result.walkBehind, theme.walkBehind);
    assert.deepEqual(result.zones, theme.zones);
    assert.deepEqual(result.blockedShapes, theme.blockedShapes);
    assert.deepEqual(result.scenery, theme.scenery);
    assert.ok(fs.existsSync(path.join(tempRoot, 'public', result.image)));
    assert.match(fs.readFileSync(path.join(tempRoot, 'shared/themes/installed.ts'), 'utf8'), /winter-test/);
});
