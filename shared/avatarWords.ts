// Words for describing an avatar in a clue: "brown hair", "a cowboy hat", "glasses". Generated from
// public/cup/avatar-parts.js, whose lists are in the same order as the avatar's numbers (see AVATAR_PARTS
// in worker/rules.ts); regenerate it if the avatar parts change.

export const HAIR_COLOR_WORDS = ["black","brown","brown","orange","blonde","blonde","white","purple","pink","green","blue","black","brown","brown","black","brown","pink","black","brown","gray","brown","brown","black","brown","brown"];
export const HAT_NAMES = ["None","aura crown","checkpoint cap","orbit beanie","pixel miner","police cap","star beret","star cat headset","unicorn halo","christmas beanie","cowboy hat","earmuffs","gold royal crown","graduation mortarboard","judge curly wig","magician top hat","orange knit beanie","pancake stack hat","pie hat","pirate tricorn","propeller beanie","snowflake headband","ushanka fur hat","block trail cap","diamond helmet","moonlit witch","pumpkin lid","syrup pancake stack","reggae knit tam"];
export const GLASSES_NAMES = ["None","aura visor","clear lilac","heart sweet","hex lab","pixel shades","round studio","wing liner","wizard scar","pirate eye patch","rainbow ski visor","ski goggles purple","star glasses","rectangle scholar","batwing frames","copper square goggles","lennon wire round"];

const HAT_NOUNS = /(hat|cap|crown|beanie|helmet|beret|headband|tam|wig|lid|halo|earmuffs|tricorn|mortarboard|stack)$/;

export const hairColorWord = (index: number) => HAIR_COLOR_WORDS[index] ?? 'brown';

// "a cowboy hat", or null for no hat
export function hatPhrase(index: number): string | null {
    const name = HAT_NAMES[index];
    if (!name || name === 'None') return null;
    const noun = HAT_NOUNS.test(name) ? name : `${name} hat`;
    return `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`;
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
