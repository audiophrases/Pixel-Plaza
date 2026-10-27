// Students' text as the teacher reads it, without the floods. No imports, so the page and the worker share it.

// "Glitch" text buries each letter under dozens of stacked marks and fills the screen. Cut back to at most two
// marks a letter: accents stay (é, ñ), the stacks go.
export const tidy = (text: string): string => text.normalize('NFD').replace(/(\p{M}{2})\p{M}+/gu, '$1').normalize('NFC');

// Mostly stacked marks with few letters: glitch spam, not a language problem to help with.
export function isGlitch(text: string): boolean {
    const decomposed = text.normalize('NFD');
    const marks = decomposed.match(/\p{M}/gu)?.length ?? 0;
    const letters = decomposed.match(/\p{L}/gu)?.length ?? 0;
    return marks >= 10 && marks > letters;
}

// Runs of the same thing one after the other, as one item with how many times: "×6" instead of six lines.
export function groupRepeats<T>(items: readonly T[], same: (a: T, b: T) => boolean): { item: T; count: number }[] {
    const groups: { item: T; count: number }[] = [];
    for (const item of items) {
        const last = groups.at(-1);
        if (last && same(last.item, item)) last.count += 1;
        else groups.push({ item, count: 1 });
    }
    return groups;
}
