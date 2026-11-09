// A mission's story characters: people in the story, not students. Students see them in a Who's who list, and their
// names are marked wherever the story mentions them, so a character never looks like a classmate.
import type { CastMember } from './campaign.ts';

export const CAST_MAX = 20;
export const CAST_NAME_MAX = 60;
export const CAST_ABOUT_MAX = 200;

const TITLES = ['Mr', 'Mrs', 'Ms', 'Miss', 'Mx', 'Dr', 'Prof', 'Sr', 'Sra'];
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isTitle = (word: string) => TITLES.includes(word.replace(/\.$/, ''));

// The ways the story may name a character: the full name, the name without a title, and each name of three letters or
// more ("Laia Garcia" is also "Laia" and "Garcia"; "Ms Awa Diop" is also "Ms Diop").
export function castForms(member: CastMember): string[] {
    const words = member.name.trim().split(/\s+/).filter(Boolean);
    const names = words.filter(word => !isTitle(word));
    return [...new Set([words.join(' '), names.join(' '), ...(names.length > 1 ? names.filter(word => word.length >= 3) : [])])].filter(Boolean);
}

export type CastPart = string | { text: string; member: CastMember };

// A text split into plain text and mentions of story characters, as whole words, with a title before them or not.
// Names are matched with their capital letters, so "Will" the character is not "will" the verb.
export function castParts(text: string, cast?: readonly CastMember[]): CastPart[] {
    if (!text || !cast?.length) return text ? [text] : [];
    const owner = new Map<string, CastMember>();
    for (const member of cast) for (const form of castForms(member)) if (!owner.has(form)) owner.set(form, member);
    if (!owner.size) return [text];
    const forms = [...owner.keys()].sort((a, b) => b.length - a.length).map(escape);
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:(?:${TITLES.join('|')})\\.?\\s+)?(?:${forms.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
    const parts: CastPart[] = [];
    let last = 0;
    for (const match of text.matchAll(pattern)) {
        const said = match[0];
        const bare = said.split(/\s+/).filter((word, i) => i > 0 || !isTitle(word)).join(' ');
        const member = owner.get(said) ?? owner.get(bare);
        if (!member) continue;
        if (match.index > last) parts.push(text.slice(last, match.index));
        parts.push({ text: said, member });
        last = match.index + said.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
}

// The story characters who share a name with a student here ("Laia" in the story and Laia in the class): the teacher is
// told, so they can point out the 📖 mark. Names are compared without capitals or accents.
export function castClashes(cast: readonly CastMember[] | undefined, students: readonly string[]): string[] {
    const plain = (word: string) => word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const called = new Set(students.flatMap(name => name.split(/\s+/)).filter(word => word.length >= 3).map(plain));
    return (cast ?? []).filter(member => castForms(member).some(form => !form.includes(' ') && called.has(plain(form)))).map(member => member.name);
}

// Every word a character can be called by, for the English chat check.
export const castWords = (cast?: readonly CastMember[]): string[] => [...new Set((cast ?? []).flatMap(castForms))];
