import { parseMission, MISSION_MAX_BYTES } from './missionSchema.ts';
import type { Campaign } from './campaign.ts';
import { zipCrc32 } from './zip.ts';

export const MISSION_PACK_MAX_BYTES = 32_000_000;
type Entry = { name: string; flags: number; method: number; crc: number; packed: number; size: number; offset: number };
const invalidZip = () => new Error('This ZIP is incomplete or damaged. Choose the original pack or its campaign.json file.');
const safePath = (name: string) => name.length > 0 && !name.startsWith('/') && !name.includes('\\') && !name.includes(':') && !name.includes('\0') && !name.split('/').some(part => part === '..' || part === '.');

// Read the directory, then decompress only the mission and optional inventory.
// Artwork, source files and instructions inside a pack are never executed.
function directory(bytes: Uint8Array): Entry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = bytes.length - 22;
    for (; end >= Math.max(0, bytes.length - 65557); end--) {
        if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
    }
    if (end < Math.max(0, bytes.length - 65557)) throw invalidZip();
    const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) || count > 512 || start + size !== end) throw invalidZip();
    const entries: Entry[] = [], names = new Set<string>();
    let at = start;
    for (let i = 0; i < count; i++) {
        if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw invalidZip();
        const length = view.getUint16(at + 28, true), next = at + 46 + length + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
        if (next > end || view.getUint16(at + 34, true)) throw invalidZip();
        const name = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes.subarray(at + 46, at + 46 + length));
        if (!safePath(name) || names.has(name)) throw invalidZip();
        names.add(name);
        const entry = { name, flags: view.getUint16(at + 8, true), method: view.getUint16(at + 10, true), crc: view.getUint32(at + 16, true), packed: view.getUint32(at + 20, true), size: view.getUint32(at + 24, true), offset: view.getUint32(at + 42, true) };
        if (entry.offset + 30 + entry.packed > start) throw invalidZip();
        entries.push(entry); at = next;
    }
    if (at !== end) throw invalidZip();
    return entries;
}

async function extract(bytes: Uint8Array, entry: Entry, limit: number): Promise<string> {
    if (entry.size > limit) throw new Error('The mission inside this pack exceeds the 512 KB limit. Choose an individual chapter file.');
    if (entry.flags & 1) throw new Error('Choose a ZIP without password protection.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), at = entry.offset;
    if (view.getUint32(at, true) !== 0x04034b50 || view.getUint16(at + 8, true) !== entry.method || view.getUint16(at + 6, true) !== entry.flags) throw invalidZip();
    const length = view.getUint16(at + 26, true), start = at + 30 + length + view.getUint16(at + 28, true);
    if (start + entry.packed > bytes.length || new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + length)) !== entry.name) throw invalidZip();
    const data = bytes.slice(start, start + entry.packed);
    let result: Uint8Array = data;
    if (entry.method === 8) {
        const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        const chunks: Uint8Array[] = []; let total = 0;
        try {
            while (true) {
                const { done, value } = await reader.read(); if (done) break;
                total += value.length;
                if (total > limit || total > entry.size) { await reader.cancel(); throw invalidZip(); }
                chunks.push(value);
            }
        } finally { reader.releaseLock(); }
        result = new Uint8Array(total); let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    } else if (entry.method !== 0) throw new Error('This ZIP uses unsupported compression. Extract it and choose campaign.json.');
    if (result.length !== entry.size || zipCrc32(result) !== entry.crc) throw invalidZip();
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(result);
}

export async function readMissionFile(file: Pick<File, 'name' | 'size' | 'arrayBuffer' | 'text'>): Promise<{ campaign: Campaign; source: string }> {
    if (file.size > MISSION_PACK_MAX_BYTES) throw new Error('Choose a mission pack smaller than 32 MB.');
    let source = file.name, text: string;
    if (/\.zip$/i.test(file.name)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length < 22 || bytes.length > MISSION_PACK_MAX_BYTES) throw invalidZip();
        const entries = directory(bytes);
        const manifests = entries.filter(entry => /(^|\/)manifest\.json$/i.test(entry.name));
        let target: Entry | undefined;
        if (manifests.length === 1) {
            const manifest = JSON.parse(await extract(bytes, manifests[0], 16000));
            if (manifest?.format === 'pixel-plaza-season-pack') {
                if (typeof manifest.campaign !== 'string' || !safePath(manifest.campaign)) throw invalidZip();
                const folder = manifests[0].name.slice(0, -'manifest.json'.length);
                target = entries.find(entry => entry.name === folder + manifest.campaign);
                if (!target) throw new Error('This pack is missing the mission file named in its inventory.');
            }
        }
        if (!target) {
            const candidates = entries.filter(entry => /(^|\/)campaign\.json$/i.test(entry.name));
            if (candidates.length === 1) target = candidates[0];
            else if (candidates.length > 1) throw new Error('This ZIP contains several missions. Extract it and choose the mission JSON you want.');
            else {
                const json = entries.filter(entry => /\.json$/i.test(entry.name) && !/(^|\/)(__MACOSX\/|manifest\.json$)/i.test(entry.name));
                if (json.length === 1) target = json[0];
            }
        }
        if (!target) throw new Error('No mission was found in this ZIP. Choose a mission JSON file or a season pack containing campaign.json.');
        text = await extract(bytes, target, MISSION_MAX_BYTES); source += ` · ${target.name}`;
    } else {
        if (file.size > MISSION_MAX_BYTES) throw new Error('Mission files must be smaller than 512 KB. Choose an individual chapter or a season ZIP.');
        text = await file.text();
    }
    const checked = parseMission(text.replace(/^\uFEFF/, ''), 'draft');
    if (!checked.campaign) throw new Error(checked.errors.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
    return { campaign: checked.campaign, source };
}
