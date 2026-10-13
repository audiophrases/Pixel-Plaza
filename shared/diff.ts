// Which words differ between a sentence and its correction. Plain function, no imports,
// so the page and the worker use the same one.

export type Span = [start: number, end: number];

const words = (text: string) => [...text.matchAll(/\S+/g)].map(match => ({
    // "Goes," and "goes" are the same word here; only the spelling of the word itself counts.
    key: match[0].toLowerCase().replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ''),
    span: [match.index, match.index + match[0].length] as Span
}));

// The spans (character ranges) of the words that are not in the other sentence, found as
// the words left over once the longest run of shared words in the same order is taken out.
export function wordDiff(original: string, corrected: string): { original: Span[]; corrected: Span[] } {
    const a = words(original);
    const b = words(corrected);
    const shared: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            shared[i][j] = a[i].key === b[j].key ? shared[i + 1][j + 1] + 1 : Math.max(shared[i + 1][j], shared[i][j + 1]);
        }
    }
    const result = { original: [] as Span[], corrected: [] as Span[] };
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i].key === b[j].key) { i++; j++; }
        else if (j >= b.length || (i < a.length && shared[i + 1][j] >= shared[i][j + 1])) result.original.push(a[i++].span);
        else result.corrected.push(b[j++].span);
    }
    return result;
}
