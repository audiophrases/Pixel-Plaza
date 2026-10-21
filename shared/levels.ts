// Levels, as in Minecraft: experience fills a bar, and each full bar is a level. A student keeps their
// experience for good, across games and lessons. Levels unlock looks only, never an advantage in play,
// so the mysteries stay fair. Experience comes from the teacher and from a few moments in the game, each
// counted once. Chat rewards depend on useful, varied communication, with a small lesson limit.

// How much each thing is worth.
export const XP = {
    participation: 1, // a useful, varied contribution to a classmate conversation
    teacher: 5, // the teacher stars a message or a report
    answer: 2,  // a chapter question answered right, the first time
    quest: 5,   // a partner quest completed
    warmup: 3,  // every classmate found in a warm-up
} as const;

// Each level needs a little more than the last: 10 experience for level 1, 15 more for level 2, then 20, 25...
export const needFor = (level: number): number => 10 + 5 * level;

// Where a student is: their level, how far into the next one, and how much that one needs.
export function levelOf(xp: number): { level: number; into: number; need: number } {
    let level = 0;
    let left = Math.max(0, Math.floor(xp));
    while (left >= needFor(level)) { left -= needFor(level); level += 1; }
    return { level, into: left, need: needFor(level) };
}

// ---------- What levels unlock ----------

// Name colours on the map; the first is the usual white, for everyone.
export const NAME_COLOURS = ['#FFFFFF', '#FFD54F', '#81D4FA', '#A5D6A7', '#F48FB1', '#CE93D8', '#FFAB91'] as const;
// A small badge before the name.
export const FLAIRS = ['🌟', '📚', '⚽', '🎵', '🐱', '🐶', '🎨', '🍕', '🚀', '🌈', '🎮', '🍀'] as const;
// Emotes everyone has, and more for later.
export const BASE_EMOTES = ['🙋', '❓', '👍', '😂'] as const;
export const EXTRA_EMOTES = ['❤️', '👋', '😮', '🎉'] as const;

export type RewardId = 'colour' | 'flair' | 'emotes';
export const REWARDS: { id: RewardId; level: number; name: string }[] = [
    { id: 'colour', level: 1, name: 'Name colour' },
    { id: 'flair', level: 2, name: 'Flair' },
    { id: 'emotes', level: 3, name: 'More emotes' },
];
export const unlocked = (reward: RewardId, level: number): boolean => level >= (REWARDS.find(item => item.id === reward)?.level ?? Infinity);
// What a level newly unlocks, for the "Level up!" message.
export const unlockedAt = (level: number): string[] => REWARDS.filter(item => item.level === level).map(item => item.name);

export const emotesFor = (level: number): string[] => [...BASE_EMOTES, ...(unlocked('emotes', level) ? EXTRA_EMOTES : [])];

// What a student chose to show: a name colour (an index into NAME_COLOURS) and a flair, or neither.
export type Style = { colour: number; flair: string | null };
export const DEFAULT_STYLE: Style = { colour: 0, flair: null };

// A chosen style, or null if it is not one or not unlocked yet at this level.
export function checkStyle(value: unknown, level: number): Style | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { colour = 0, flair = null } = value as Record<string, unknown>;
    if (typeof colour !== 'number' || !Number.isInteger(colour) || colour < 0 || colour >= NAME_COLOURS.length) return null;
    if (flair !== null && (typeof flair !== 'string' || !(FLAIRS as readonly string[]).includes(flair))) return null;
    if (colour !== 0 && !unlocked('colour', level)) return null;
    if (flair !== null && !unlocked('flair', level)) return null;
    return { colour, flair };
}

// A saved style as far as the level still allows (it always does: experience is never taken away).
export function readStyle(saved: string | null, level: number): Style {
    try { return (saved && checkStyle(JSON.parse(saved), level)) || DEFAULT_STYLE; } catch { return DEFAULT_STYLE; }
}
