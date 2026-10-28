import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defaultWarmup, validateWarmup, WARMUP_MAX_IDENTITIES, WARMUP_MAX_BYTES } from '../../shared/warmupConfig.ts';
import { parseWarmupImport, previewWarmupImport } from '../../shared/warmupImport.ts';

const source = fs.readFileSync(new URL('./fixtures/who-am-i-110.json', import.meta.url), 'utf8');
const collection = count => ({ ...defaultWarmup('identity'), identities: Array.from({ length: count }, (_, i) => ({
    id: `person-${i}`, name: `Person ${i.toString(36).split('').join(' ')}`, accept: [],
})) });
const envelope = definition => JSON.stringify({ format: 'pixel-plaza-warmup', schemaVersion: 1, definition });

test('the reported 110-identity file imports intact and appends 77 new identities to the built-ins', () => {
    const incoming = parseWarmupImport(source, 'identity');
    assert.equal(incoming.identities.length, 110);
    const draft = defaultWarmup('identity'), before = structuredClone(draft);
    const replace = previewWarmupImport(draft, incoming, 'replace');
    assert.deepEqual(replace.definition, incoming);
    const append = previewWarmupImport(draft, incoming, 'append');
    assert.deepEqual(append.errors, []);
    assert.equal(append.added, 77); assert.equal(append.skipped, 33); assert.equal(append.total, 110);
    assert.deepEqual(draft, before, 'preview leaves the draft alone');
    assert.equal(append.definition.title, draft.title);
    const messi = append.definition.identities.find(row => row.id === 'messi');
    assert.ok(messi.accept.includes('lionel messi'), 'existing aliases survive append');
    const repeated = previewWarmupImport(append.definition, incoming, 'append');
    assert.equal(repeated.added, 0); assert.equal(repeated.skipped, 110); assert.equal(repeated.total, 110);
});

test('identity limits accept 200 and reject 201, including combined append totals', () => {
    assert.equal(WARMUP_MAX_IDENTITIES, 200);
    assert.equal(parseWarmupImport(envelope(collection(200)), 'identity').identities.length, 200);
    assert.throws(() => parseWarmupImport(envelope(collection(201)), 'identity'), /found 201 entries; the maximum is 200/);
    const extra = { ...collection(2), identities: [{ id: 'extra', name: 'Extra Person', accept: [] }, collection(1).identities[0]] };
    const result = previewWarmupImport(collection(200), extra, 'append');
    assert.equal(result.definition, null); assert.match(result.errors.join(' '), /found 201/);
});

test('append keeps metadata and duplicates, but blocks ID and alias conflicts', () => {
    const draft = { ...defaultWarmup('identity'), title: 'Keep my title' };
    const sameName = { ...collection(2), identities: [{ id: 'another-messi', name: 'MESSI', accept: ['new alias'] }, collection(1).identities[0]] };
    const duplicate = previewWarmupImport(draft, sameName, 'append');
    assert.equal(duplicate.skipped, 1); assert.equal(duplicate.added, 1); assert.deepEqual(duplicate.errors, []);
    assert.equal(duplicate.definition.title, 'Keep my title');
    assert.ok(!duplicate.definition.identities[0].accept.includes('new alias'));
    const conflictingId = structuredClone(sameName); conflictingId.identities[0] = { id: 'messi', name: 'Different Person', accept: [] };
    const conflict = previewWarmupImport(draft, conflictingId, 'append');
    assert.equal(conflict.definition, null); assert.match(conflict.errors.join(' '), /same ID as “Messi”/);
    const conflictingAlias = structuredClone(sameName); conflictingAlias.identities[0] = { id: 'new-person', name: 'Different Person', accept: ['líonel messi'] };
    const aliasConflict = previewWarmupImport(draft, conflictingAlias, 'append');
    assert.equal(aliasConflict.definition, null); assert.match(aliasConflict.errors.join(' '), /belongs to more than one identity/);
});

test('imports reject malformed JSON, the wrong format, version, type and invalid identities', () => {
    assert.throws(() => parseWarmupImport('{', 'identity'), /not valid JSON/);
    for (const value of [null, [], {}, { format: 'pixel-plaza-warmup', schemaVersion: 2 }]) {
        assert.throws(() => parseWarmupImport(JSON.stringify(value), 'identity'), /schema version 1/);
    }
    assert.throws(() => parseWarmupImport(source, 'facts'), /matching warm-up type/);
    const duplicate = collection(2); duplicate.identities[1].id = duplicate.identities[0].id;
    assert.throws(() => parseWarmupImport(envelope(duplicate), 'identity'), /unique lowercase ID/);
    assert.throws(() => parseWarmupImport(envelope({ ...collection(2), identities: [] }), 'identity'), /2–200/);
    for (const kind of ['facts', 'pairs']) assert.equal(parseWarmupImport(envelope(defaultWarmup(kind)), kind).kind, kind);
});

test('the file byte limit counts whitespace and UTF-8 bytes; combined appends also respect it', () => {
    const small = envelope(collection(2));
    const atLimit = small + ' '.repeat(WARMUP_MAX_BYTES - Buffer.byteLength(small));
    assert.equal(parseWarmupImport(atLimit, 'identity').identities.length, 2);
    assert.throws(() => parseWarmupImport(atLimit + ' ', 'identity'), /64,000 bytes/);
    const unicode = JSON.stringify({ ignored: 'é'.repeat(32_000) });
    assert.ok(unicode.length < WARMUP_MAX_BYTES);
    assert.throws(() => parseWarmupImport(unicode, 'identity'), /64,000 bytes/);
    const full = offset => ({ ...collection(100), identities: Array.from({ length: 100 }, (_, n) => {
        const number = (n + offset).toString(36).split('').join(' ');
        return { id: `person-${n + offset}`, name: `Person ${number}`, accept: Array.from({ length: 6 }, (_, a) => `Person ${number} alias ${a} ${'x'.repeat(60)}`) };
    }) });
    const first = full(0), second = full(100);
    assert.deepEqual(validateWarmup(first).errors, []); assert.deepEqual(validateWarmup(second).errors, []);
    const result = previewWarmupImport(first, second, 'append');
    assert.equal(result.definition, null); assert.match(result.errors.join(' '), /64 KB/);
});
