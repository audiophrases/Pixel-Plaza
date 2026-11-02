// Levels, as in Minecraft: experience fills a bar, and each full bar is a level. A student keeps their
// experience for good, across games and lessons. Levels unlock looks only, never an advantage in play,
// so the mysteries stay fair. Experience comes from the teacher and from a few moments in the game, each
// counted once. Chat rewards depend on useful, varied communication, with a small lesson limit.

// How much each thing is worth.
export const XP = {
    firstMessage: 1, // the student's first approved message delivered to a classmate, once across games
    participation: 1, // a useful, varied contribution to a classmate conversation
    teacher: 5, // the teacher stars a message or a report
    answer: 2,  // a chapter question answered right, the first time
    quest: 5,   // a partner quest completed
    warmup: 3,  // every classmate found in a warm-up
} as const;

// Each level needs a little more than the last: 3 experience for level 1, 5 more for level 2, then 7, 9...
// The first unlock comes within minutes of a first lesson, and later ones still every lesson or so.
export const needFor = (level: number): number => 3 + 2 * level;

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
// Trousers, shoes and capes.
export const CLOTH_COLOURS = ['#E53935', '#FDD835', '#43A047', '#1E88E5', '#8E24AA', '#EC407A', '#6D4C41', '#263238', '#F5F5F5'] as const; // one row with "none"
// A glow under the feet, and the sparkles left behind when walking.
export const LIGHT_COLOURS = ['#FFD54F', '#FFFFFF', '#4DD0E1', '#69F0AE', '#FF80AB', '#B388FF', '#FF9E40', '#FF5252'] as const;
// A pet that follows its owner around the map.
export const PETS = ['🐱', '🐶', '🐰', '🐤', '🐢', '🐹'] as const;
export const RARE_PETS = ['🐉', '🦄', '🦖', '🦉', '🐙', '🦊'] as const;

// The parts of a look a student picks, each one of a reward's options or null for the usual look (or none).
export const PICKS = ['flair', 'pants', 'shoes', 'glow', 'pet', 'cape', 'trail'] as const;
export type Pick = typeof PICKS[number];

export type RewardId = 'colour' | 'pants' | 'flair' | 'shoes' | 'emotes' | 'glow' | 'pet' | 'cape' | 'trail' | 'rarePets';
// One small step per level. A later reward can add options to an earlier pick (rare pets).
export const REWARDS: { id: RewardId; level: number; name: string; icon: string; pick?: Pick; options?: readonly string[] }[] = [
    { id: 'colour', level: 1, name: 'Name colour', icon: '🎨' },
    { id: 'pants', level: 2, name: 'Trousers', icon: '👖', pick: 'pants', options: CLOTH_COLOURS },
    { id: 'flair', level: 3, name: 'Flair', icon: '🌟', pick: 'flair', options: FLAIRS },
    { id: 'shoes', level: 4, name: 'Shoes', icon: '👟', pick: 'shoes', options: CLOTH_COLOURS },
    { id: 'emotes', level: 5, name: 'More emotes', icon: '🎉' },
    { id: 'glow', level: 6, name: 'Glow', icon: '✨', pick: 'glow', options: LIGHT_COLOURS },
    { id: 'pet', level: 7, name: 'Pet', icon: '🐾', pick: 'pet', options: PETS },
    { id: 'cape', level: 8, name: 'Cape', icon: '🦸', pick: 'cape', options: CLOTH_COLOURS },
    { id: 'trail', level: 9, name: 'Sparkle trail', icon: '💫', pick: 'trail', options: LIGHT_COLOURS },
    { id: 'rarePets', level: 10, name: 'Rare pets', icon: '🐉', pick: 'pet', options: RARE_PETS },
];
export const unlocked = (reward: RewardId, level: number): boolean => level >= (REWARDS.find(item => item.id === reward)?.level ?? Infinity);
// What going from one level to another newly unlocks, for the "Level up!" message.
export const unlockedBetween = (from: number, to: number): string[] =>
    REWARDS.filter(item => item.level > from && item.level <= to).map(item => `${item.icon} ${item.name}`);
// The next thing to look forward to, or null when everything is open.
export const nextReward = (level: number) => REWARDS.find(item => item.level > level) ?? null;

export const emotesFor = (level: number): string[] => [...BASE_EMOTES, ...(unlocked('emotes', level) ? EXTRA_EMOTES : [])];

// What a student chose to show: a name colour (an index into NAME_COLOURS) and each pick, or null.
export type Style = { colour: number } & Record<Pick, string | null>;
export const DEFAULT_STYLE: Style = { colour: 0, flair: null, pants: null, shoes: null, glow: null, pet: null, cape: null, trail: null };

// A chosen style, or null if it is not one or not unlocked yet at this level. Missing picks are the usual look.
export function checkStyle(value: unknown, level: number): Style | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const given = value as Record<string, unknown>;
    const { colour = 0 } = given;
    if (typeof colour !== 'number' || !Number.isInteger(colour) || colour < 0 || colour >= NAME_COLOURS.length) return null;
    if (colour !== 0 && !unlocked('colour', level)) return null;
    const style: Style = { ...DEFAULT_STYLE, colour };
    for (const pick of PICKS) {
        const chosen = given[pick] ?? null;
        if (chosen === null) continue;
        if (typeof chosen !== 'string' || !REWARDS.some(item => item.pick === pick && level >= item.level && item.options!.includes(chosen))) return null;
        style[pick] = chosen;
    }
    return style;
}

// A saved style as far as the level still allows (it always does: experience is never taken away).
export function readStyle(saved: string | null, level: number): Style {
    try { return (saved && checkStyle(JSON.parse(saved), level)) || DEFAULT_STYLE; } catch { return DEFAULT_STYLE; }
}
