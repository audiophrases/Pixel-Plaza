import { validateWarmup, WARMUP_MAX_BYTES, type WarmupDefinition } from './warmupConfig.ts';
import type { WarmupKind } from './warmupKinds.ts';

export type WarmupImportMode = 'replace' | 'append';
export const warmupEntryCount = (definition: WarmupDefinition) => definition.kind === 'identity' ? definition.identities.length
    : definition.kind === 'facts' ? definition.facts.length : definition.pairs.length;

export function parseWarmupImport(text: string, kind: WarmupKind): WarmupDefinition {
    if (new TextEncoder().encode(text).length > WARMUP_MAX_BYTES) throw new Error('Warm-up files must be at most 64 KB (64,000 bytes).');
    let value;
    try { value = JSON.parse(text); }
    catch { throw new Error('This file is not valid JSON. Check its syntax or export it again, then retry.'); }
    if (!value || value.format !== 'pixel-plaza-warmup' || value.schemaVersion !== 1) throw new Error('Choose a Pixel Plaza warm-up file with format pixel-plaza-warmup and schema version 1.');
    const checked = validateWarmup(value.definition);
    if (!checked.definition) throw new Error(checked.errors.join('\n'));
    if (checked.definition.kind !== kind) throw new Error('Select the matching warm-up type before importing this file.');
    return checked.definition;
}

const nameKey = (name: string) => name.normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Pure preview: never change the current draft until the teacher applies the result.
export function previewWarmupImport(draft: WarmupDefinition, incoming: WarmupDefinition, mode: WarmupImportMode): {
    definition: WarmupDefinition | null; added: number; skipped: number; total: number; errors: string[];
} {
    const count = warmupEntryCount(incoming);
    if (draft.kind !== incoming.kind) return { definition: null, added: 0, skipped: 0, total: 0, errors: ['Select the matching warm-up type before importing this file.'] };
    if (mode === 'replace') return { definition: incoming, added: count, skipped: 0, total: count, errors: [] };
    if (draft.kind !== 'identity' || incoming.kind !== 'identity') return { definition: null, added: 0, skipped: 0, total: 0, errors: ['Appending is available for secret identities.'] };
    const identities = [...draft.identities], errors: string[] = [];
    let added = 0, skipped = 0;
    for (const row of incoming.identities) {
        const sameId = draft.identities.find(existing => existing.id === row.id);
        if (sameId && nameKey(sameId.name) !== nameKey(row.name)) {
            errors.push(`“${row.name}” uses the same ID as “${sameId.name}”. Give different identities different IDs before appending.`);
        } else if (sameId || draft.identities.some(existing => nameKey(existing.name) === nameKey(row.name))) {
            skipped++;
        } else {
            identities.push(row); added++;
        }
    }
    const checked = validateWarmup({ ...draft, identities });
    errors.push(...checked.errors);
    return { definition: errors.length ? null : checked.definition, added, skipped, total: identities.length, errors: [...new Set(errors)] };
}
