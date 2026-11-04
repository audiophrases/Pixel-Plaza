import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { readMissionFile, MISSION_PACK_MAX_BYTES } from '../../shared/missionFile.ts';
import { zipFiles } from '../../shared/zip.ts';
import { missionEnvelope, MISSION_MAX_BYTES } from '../../shared/missionSchema.ts';
import { castanyada } from './fixtures/season-1.mjs';

const text = JSON.stringify(missionEnvelope(castanyada));
const bytes = new TextEncoder().encode(text);
const file = (name, data) => new File([data], name);
// A standard single-entry deflated ZIP, as produced by desktop archive tools.
function deflated() {
    const base = zipFiles({ 'campaign.json': bytes }), v = new DataView(base.buffer);
    const start = 30 + v.getUint16(26, true), centralAt = v.getUint32(base.length - 6, true);
    const local = base.slice(0, start), packed = new Uint8Array(deflateRawSync(bytes)), central = base.slice(centralAt, -22), end = base.slice(-22);
    const l = new DataView(local.buffer), c = new DataView(central.buffer), e = new DataView(end.buffer);
    l.setUint16(8, 8, true); l.setUint32(18, packed.length, true);
    c.setUint16(10, 8, true); c.setUint32(20, packed.length, true); e.setUint32(16, local.length + packed.length, true);
    return new Uint8Array([...local, ...packed, ...central, ...end]);
}

test('direct import reads JSON, Windows BOM, and the complete season ZIP without unpacking artwork', async () => {
    assert.deepEqual((await readMissionFile(file('lesson.json', text))).campaign, castanyada);
    assert.deepEqual((await readMissionFile(file('lesson.txt', '\uFEFF' + text))).campaign, castanyada);
    const pack = fs.readFileSync(new URL('../../content/season-2/protocol-815-season-2.zip', import.meta.url));
    const expected = JSON.parse(fs.readFileSync(new URL('../../content/season-2/campaign.json', import.meta.url), 'utf8')).campaign;
    const imported = await readMissionFile(file('season.zip', pack));
    assert.deepEqual(imported.campaign, expected);
    assert.match(imported.source, /campaign.json/);
});

test('desktop deflated ZIPs and nested pack inventories select the complete mission', async () => {
    assert.deepEqual((await readMissionFile(file('compressed.zip', deflated()))).campaign, castanyada);
    const nested = zipFiles({
        'lesson/manifest.json': new TextEncoder().encode(JSON.stringify({ format: 'pixel-plaza-season-pack', campaign: 'adventure.json' })),
        'lesson/adventure.json': bytes, 'lesson/chapters/01.json': bytes,
    });
    assert.deepEqual((await readMissionFile(file('nested.zip', nested))).campaign, castanyada);
});

test('bad archives, wrong JSON, ambiguous missions and size-limit bypasses cannot become imports', async () => {
    for (const [name, data] of [
        ['broken.zip', new Uint8Array(35)], ['wrong.json', '{"theme":{}}'],
        ['empty.zip', zipFiles({ 'README.md': bytes })],
        ['ambiguous.zip', zipFiles({ 'a/campaign.json': bytes, 'b/campaign.json': bytes })],
        ['traversal.zip', zipFiles({ '../campaign.json': bytes })],
    ]) await assert.rejects(readMissionFile(file(name, data)));
    const corrupt = zipFiles({ 'campaign.json': bytes }); corrupt[43] ^= 1;
    await assert.rejects(readMissionFile(file('corrupt.zip', corrupt)), /damaged/);
    await assert.rejects(readMissionFile({ name: 'huge.zip', size: MISSION_PACK_MAX_BYTES + 1 }), /32 MB/);
    await assert.rejects(readMissionFile({ name: 'huge.json', size: MISSION_MAX_BYTES + 1 }), /512 KB/);
    const lying = deflated(), view = new DataView(lying.buffer), central = view.getUint32(lying.length - 6, true);
    view.setUint32(central + 24, 10, true);
    await assert.rejects(readMissionFile(file('lying.zip', lying)), /damaged/);
});
