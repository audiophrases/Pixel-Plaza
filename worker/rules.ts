// Rules shared by the HTTP routes and the room. No Workers APIs here, so the
// tests run this file directly under `node --test`.

import { MAP_SIZE, SPAWN, isBlocked } from '../shared/plazaMap.ts';
import { isEnglishVoice } from '../shared/voices.ts';

export { MAP_SIZE, SPAWN, isBlocked };
// The emotes everyone has; levels add more (shared/levels.ts).
export { BASE_EMOTES as EMOTES } from '../shared/levels.ts';

// One index per part. Counts come from public/cup/avatar-parts.js, the same
// numbers as PinPlay's ARENA_AVATAR_PARTS; update both after a rebuild.
export const AVATAR_PARTS = { head: 17, skin: 20, hairColor: 25, hair: 29, eyes: 37, mouth: 41, glasses: 17, shirt: 28, hat: 29 };
export type Avatar = Record<keyof typeof AVATAR_PARTS, number> & { voice?: string };

export function sanitizeAvatar(value: unknown): Avatar | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const avatar = {} as Avatar;
    for (const [part, count] of Object.entries(AVATAR_PARTS) as [keyof typeof AVATAR_PARTS, number][]) {
        const index = (value as Record<string, unknown>)[part] ?? 0;
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= count) return null;
        avatar[part] = index;
    }
    const voice = (value as Record<string, unknown>).voice;
    if (voice !== undefined) {
        if (!isEnglishVoice(voice)) return null;
        avatar.voice = voice;
    }
    return avatar;
}

export const defaultAvatar = (): Avatar => sanitizeAvatar({}) as Avatar;

export function clampPosition(x: unknown, y: unknown): { x: number; y: number } | null {
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < 0 || x > MAP_SIZE || y < 0 || y > MAP_SIZE) return null;
    return { x: Math.round(x), y: Math.round(y) };
}

const blockedWords = new Set(['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot']);
const blockedPhrases = [/\bnobody likes you\b/i, /\bkill yourself\b/i, /\byou are stupid\b/i];

export function chatProblem(value: unknown): string | null {
    if (typeof value !== 'string') return 'Enter a text message.';
    const text = value.trim();
    if (!text || text.length > 200) return 'Messages must be 1–200 characters.';
    if (Array.from(text).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
        return 'Control characters are not allowed.';
    }
    const words = text.toLowerCase().match(/[\p{L}]+/gu) || [];
    if (words.some(word => blockedWords.has(word)) || blockedPhrases.some(pattern => pattern.test(text))) {
        return 'That message cannot be sent. Please rewrite it.';
    }
    return null;
}

// PinPlay's roster name, reduced to what fits on a nameplate.
export function plazaName(displayName: string): string {
    const name = displayName.replace(/[^\p{L}\p{N} _-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
    return /^[\p{L}\p{N} _-]{2,24}$/u.test(name) && chatProblem(name) === null ? name : 'Student';
}

// The teacher laptop's address as students reach it on the school network.
// Only an http(s) origin is kept, so nothing else rides along in the redirect.
export function laptopOrigin(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 200) return null;
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        return url.origin;
    } catch {
        return null;
    }
}

// Constant-time for equal lengths; the length itself is not secret here.
export function secretsMatch(actual: unknown, expected: string): boolean {
    if (typeof actual !== 'string' || !expected || actual.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
    return difference === 0;
}

// Same scheme as PinPlay's CREATE_PASSWORD_HASH, so it can be the same password.
export async function sha256Hex(input: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function teacherPasswordMatches(password: unknown, hash: string | undefined): Promise<boolean> {
    const expected = (hash || '').trim().toLowerCase();
    if (!expected || typeof password !== 'string') return false;
    return secretsMatch(await sha256Hex(password.trim().normalize('NFC')), expected);
}
