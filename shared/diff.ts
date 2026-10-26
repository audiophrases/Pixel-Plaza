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

// ---------- A teacher's correction, as PinPlay shows it ----------
// The student's own words with the wrong ones crossed out in red and the right ones in green after an arrow:
// "I [-goed-] {+went+} to the park". It travels as that text (readable anywhere, in a report too), marked with
// CORRECTION so the student's chat can draw the colours.

export const CORRECTION = '✏️ ';
export type CorrectionPart = { kind: 'same' | 'del' | 'ins'; text: string };

// Word by word, the longest run of shared words kept, as PinPlay's computeWordDiff.
export function correctionParts(original: string, corrected: string): CorrectionPart[] {
    const a = original.match(/\S+/g) ?? [];
    const b = corrected.match(/\S+/g) ?? [];
    const shared: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) shared[i][j] = a[i] === b[j] ? shared[i + 1][j + 1] + 1 : Math.max(shared[i + 1][j], shared[i][j + 1]);
    }
    const parts: CorrectionPart[] = [];
    const add = (kind: CorrectionPart['kind'], word: string) => {
        const last = parts.at(-1);
        if (last?.kind === kind) last.text += ` ${word}`;
        else parts.push({ kind, text: word });
    };
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) { add('same', a[i]); i++; j++; }
        else if (j >= b.length || (i < a.length && shared[i + 1][j] >= shared[i][j + 1])) add('del', a[i++]);
        else add('ins', b[j++]);
    }
    // A removal is shown before what replaces it.
    for (let k = 0; k + 1 < parts.length; k++) {
        if (parts[k].kind === 'ins' && parts[k + 1].kind === 'del') [parts[k], parts[k + 1]] = [parts[k + 1], parts[k]];
    }
    return parts;
}

export function correctionText(original: string, corrected: string): string {
    return CORRECTION + correctionParts(original.trim(), corrected.trim())
        .map(part => part.kind === 'del' ? `[-${part.text}-]` : part.kind === 'ins' ? `{+${part.text}+}` : part.text).join(' ');
}

// The parts of a correction message, or null for any other message.
export function readCorrection(text: string): CorrectionPart[] | null {
    if (!text.startsWith(CORRECTION)) return null;
    const parts: CorrectionPart[] = [];
    for (const match of text.slice(CORRECTION.length).matchAll(/\[-([\s\S]+?)-\]|\{\+([\s\S]+?)\+\}|((?:(?!\[-|\{\+)[\s\S])+)/g)) {
        if (match[1] !== undefined) parts.push({ kind: 'del', text: match[1] });
        else if (match[2] !== undefined) parts.push({ kind: 'ins', text: match[2] });
        else if (match[3].trim()) parts.push({ kind: 'same', text: match[3].trim() });
    }
    return parts.some(part => part.kind !== 'same') ? parts : null;
}

// The corrected sentence alone, for a preview line.
export const correctedSentence = (parts: CorrectionPart[]) => parts.filter(part => part.kind !== 'del').map(part => part.text).join(' ');
