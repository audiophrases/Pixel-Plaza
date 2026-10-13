// The thief of a chapter: how many there are, and the clues that describe how they look. Plain
// functions, so the worker and the tests use the same ones.
import { coatColorWord, glassesPhrase, hairColorWord, hatPhrase } from './avatarWords.ts';

// One thief for a class, two for a class of more than fifteen.
export const thiefCount = (students: number) => (students > 15 ? 2 : 1);

export type Look = { hair: string; hat: string | null; glasses: string | null; coat: string };

// How an avatar looks, in words a student can match against the avatars in the plaza.
export const lookOf = (avatar: { hairColor: number; hat: number; glasses: number; shirt: number }): Look => ({
    hair: hairColorWord(avatar.hairColor), hat: hatPhrase(avatar.hat), glasses: glassesPhrase(avatar.glasses), coat: coatColorWord(avatar.shirt),
});

type Part = 'hat' | 'glasses' | 'hair' | 'coat';
const sentence = (look: Look, part: Part, who: string) =>
    part === 'hair' ? `${who} had ${look.hair} hair.`
        : part === 'coat' ? `${who} wore a ${look.coat} coat.`
        : part === 'hat' ? (look.hat ? `${who} wore ${look.hat}.` : `${who} wore no hat.`)
            : (look.glasses ? `${who} had ${look.glasses}.` : `${who} had no glasses.`);

// Fills {hat}, {glasses}, {hair} and {coat} in a clue with how the thieves look: "They wore a cowboy hat." for one
// thief, "Person 1 wore a cowboy hat. Person 2 wore no hat." for two, always in the same order so a class can
// put the clues side by side. With no thieves chosen yet the gap is simply left out.
export function fillThiefClue(template: string, looks: readonly Look[]): string {
    return template.replace(/\s*\{(hat|glasses|hair|coat)\}/g, (_, part: Part) => {
        if (looks.length === 0) return '';
        return ' ' + (looks.length === 1 ? sentence(looks[0], part, 'They') : looks.map((look, index) => sentence(look, part, `Person ${index + 1}`)).join(' '));
    }).trim();
}
