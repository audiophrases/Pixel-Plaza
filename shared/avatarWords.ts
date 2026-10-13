// Words for describing an avatar in a clue: "brown hair", "a cowboy hat", "glasses", "a green coat".
// Generated from public/cup/avatar-parts.js (scripts/ has no copy; the lists are in the same order as the
// avatar's numbers, see AVATAR_PARTS in worker/rules.ts). Regenerate it if the avatar parts change.

export const HAIR_COLOR_WORDS = ["black","dark brown","light brown","orange","blonde","blonde","blue","purple","pink","green","blue","black","brown","brown","black","brown","purple","purple","dark brown","light gray","brown","brown","dark brown","brown","dark brown"];
export const COAT_COLOR_WORDS = ["dark blue","blue","black","blue","blue","dark blue","pink","green","orange","dark green","black","red","blue","blue","dark blue","blue","green","light blue","light blue","dark blue","orange","dark blue","purple","purple","yellow","yellow","dark blue","light blue"];
export const HAT_NAMES = ["None","aura crown","checkpoint cap","orbit beanie","pixel miner","police cap","star beret","star cat headset","unicorn halo","christmas beanie","cowboy hat","earmuffs","gold royal crown","graduation mortarboard","judge curly wig","magician top hat","orange knit beanie","pancake stack hat","pie hat","pirate tricorn","propeller beanie","snowflake headband","ushanka fur hat","block trail cap","diamond helmet","moonlit witch","pumpkin lid","syrup pancake stack","reggae knit tam"];
export const GLASSES_NAMES = ["None","aura visor","clear lilac","heart sweet","hex lab","pixel shades","round studio","wing liner","wizard scar","pirate eye patch","rainbow ski visor","ski goggles purple","star glasses","rectangle scholar","batwing frames","copper square goggles","lennon wire round"];

export const hairColorWord = (index: number) => HAIR_COLOR_WORDS[index] ?? 'brown';
export const coatColorWord = (index: number) => COAT_COLOR_WORDS[index] ?? 'white';

// Names whose last word already says what the thing is; any other gets "hat" added
const HAT_NOUNS = /(hat|cap|crown|beanie|helmet|beret|headband|headset|tam|wig|lid|halo|earmuffs|tricorn|mortarboard|stack)$/;
// Names that start with a vowel letter but a consonant sound, and names that are plural
const SOUNDS_LIKE_Y = /^(uni|use|eu)/;
const PLURAL = /(earmuffs)$/;

// "a cowboy hat", "an orange knit beanie", "earmuffs", or null for no hat
export function hatPhrase(index: number): string | null {
    const name = HAT_NAMES[index];
    if (!name || name === 'None') return null;
    const noun = HAT_NOUNS.test(name) ? name : `${name} hat`;
    if (PLURAL.test(noun)) return noun;
    return `${/^[aeiou]/.test(noun) && !SOUNDS_LIKE_Y.test(noun) ? 'an' : 'a'} ${noun}`;
}

// "glasses", "goggles", "an eye patch", or null for none
export function glassesPhrase(index: number): string | null {
    const name = GLASSES_NAMES[index];
    if (!name || name === 'None') return null;
    if (/eye patch/.test(name)) return 'an eye patch';
    if (/goggles/.test(name)) return 'goggles';
    if (/visor/.test(name)) return 'a visor';
    return 'glasses';
}
