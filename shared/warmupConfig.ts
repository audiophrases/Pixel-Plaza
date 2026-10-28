import { FACTS, WARMUP_ROUNDS, type Fact } from './warmup.ts';
import { IDENTITIES, PAIRS, WARMUP_KINDS, isWarmupKind, type Identity, type WarmupKind } from './warmupKinds.ts';

export const WARMUP_MAX_BYTES = 64_000;
export const WARMUP_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
type Base = { title: string; instructions: string; level: typeof WARMUP_LEVELS[number] };
export type WarmupDefinition = Base & (
    { kind: 'identity'; identities: Identity[] } |
    { kind: 'facts'; facts: Fact[]; rounds: number } |
    { kind: 'pairs'; pairs: [string, string][] }
);
export type SavedWarmup = { definition: WarmupDefinition; version: number };

export function defaultWarmup(kind: WarmupKind): WarmupDefinition {
    const base = { title: WARMUP_KINDS.find(k => k.id === kind)!.label, level: 'A2' as const,
        instructions: kind === 'identity' ? 'Ask yes or no questions to discover your classmate’s identity. Keep your own identity secret. You may name guesses; helpers confirm with yes or no.'
            : kind === 'facts' ? 'Ask classmates about their facts. Find someone who matches each task and type their name. Use the made-up fact on your card.'
                : 'Ask classmates about their words. Find the word that goes with yours, then type that classmate’s name.' };
    return structuredClone(kind === 'identity' ? { ...base, kind, identities: IDENTITIES }
        : kind === 'facts' ? { ...base, kind, facts: FACTS, rounds: WARMUP_ROUNDS } : { ...base, kind, pairs: PAIRS });
}

const fold = (text: string) => text.normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function validateWarmup(value: unknown): { definition: WarmupDefinition | null; errors: string[] } {
    const errors: string[] = [];
    const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
    if (!object(value)) return { definition: null, errors: ['Choose a warm-up definition.'] };
    try { if (new TextEncoder().encode(JSON.stringify(value)).length > WARMUP_MAX_BYTES) return { definition: null, errors: ['Warm-up files must be at most 64 KB (64,000 bytes).'] }; }
    catch { return { definition: null, errors: ['Use JSON warm-up data.'] }; }
    const text = (v: unknown, label: string, limit: number) => {
        if (typeof v !== 'string' || !v.trim() || v.length > limit) { errors.push(`${label}: use 1–${limit} characters.`); return ''; }
        return v.trim();
    };
    const list = (v: unknown, label: string, min: number, max?: number): unknown[] => {
        if (max !== undefined && Array.isArray(v) && v.length > max) { errors.push(`${label}: found ${v.length} entries; the maximum is ${max}.`); return []; }
        if (!Array.isArray(v) || v.length < min) { errors.push(`${label}: include ${max === undefined ? `at least ${min}` : `${min}–${max}`} entries.`); return []; }
        return v;
    };
    const ids = new Set<string>();
    const id = (v: unknown) => {
        if (typeof v !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(v) || ids.has(v)) { errors.push('Every entry needs a unique lowercase ID.'); return ''; }
        ids.add(v); return v;
    };
    if (!isWarmupKind(value.kind)) return { definition: null, errors: ['Choose facts, identity or pairs.'] };
    const base = { title: text(value.title, 'Title', 120), instructions: text(value.instructions, 'Instructions', 2000), level: value.level as Base['level'] };
    if (!WARMUP_LEVELS.includes(base.level)) errors.push('Choose a language level from A1 to C2.');
    let definition: WarmupDefinition;
    if (value.kind === 'identity') {
        const names = new Map<string, string>();
        const identities = list(value.identities, 'Identities', 2).map((v, i): Identity => {
            const row = object(v) ? v : {};
            const rowId = id(row.id), name = text(row.name, `Identity ${i + 1}`, 80);
            const accept = [...new Set([name, ...list(row.accept, `Aliases for identity ${i + 1}`, 0, 20).map(a => text(a, 'Alias', 80))].filter(Boolean))];
            for (const alias of accept) {
                const key = fold(alias).replace(/(.)\1+/gu, '$1');
                if (key.length < 2 || key.split(' ').length > 8 || ['yes', 'no', 'i', 'you', 'yes i am', 'no i am not'].includes(key)) errors.push(`“${alias}” cannot be a secret name: keep yes/no replies available.`);
                if (names.has(key) && names.get(key) !== rowId) errors.push(`“${alias}” belongs to more than one identity. Use distinct names and aliases.`);
                names.set(key, rowId);
            }
            return { id: rowId, name, accept };
        });
        definition = { ...base, kind: 'identity', identities };
    } else if (value.kind === 'facts') {
        const facts = list(value.facts, 'Facts', 2, 80).map((v, i): Fact => {
            const row = object(v) ? v : {};
            return { id: id(row.id), mine: text(row.mine, `Fact ${i + 1}: your card`, 300), find: text(row.find, `Fact ${i + 1}: find someone who`, 300) };
        });
        if (!Number.isInteger(value.rounds) || Number(value.rounds) < 1 || Number(value.rounds) > 10) errors.push('Choose 1–10 facts to find per student.');
        definition = { ...base, kind: 'facts', facts, rounds: Number(value.rounds) };
    } else {
        const seen = new Set<string>();
        const pairs = list(value.pairs, 'Word pairs', 1, 40).map((v, i): [string, string] => {
            const pair = Array.isArray(v) && v.length === 2 ? v : [];
            const words: [string, string] = [text(pair[0], `Pair ${i + 1}: first word`, 80), text(pair[1], `Pair ${i + 1}: second word`, 80)];
            for (const word of words) { const key = fold(word); if (!key || seen.has(key)) errors.push('Each word must belong to exactly one pair.'); seen.add(key); }
            return words;
        });
        definition = { ...base, kind: 'pairs', pairs };
    }
    return { definition: errors.length ? null : definition, errors: [...new Set(errors)] };
}

export const warmupVocabulary = (definition: WarmupDefinition) => definition.kind === 'identity'
    ? [...new Set(definition.identities.flatMap(i => [i.name, ...i.accept]))] : [];
