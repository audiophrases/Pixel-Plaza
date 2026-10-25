import { IDENTITIES, identityById, type Identity } from './warmupKinds.ts';

export const IDENTITY_CHAT_REMINDER = 'Keep your secret identity hidden. Answer your classmate with yes or no. When guessing, you may ask names and type your final answer.';

const words = (text: string) => text.normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const unstretched = (word: string) => word.replace(/(.)\1+/gu, '$1');

// Only the sender's own secret is protected. Other identities remain available as
// guesses; the private answer box and messages to the teacher do not use this rule.
export function identityRevealProblem(text: string, identityId: string, identities: readonly Identity[] = IDENTITIES): string | null {
    const identity = identityById(identityId, identities);
    if (!identity) return null;
    const tokens = words(text);
    // Also recognize the elementary spelling-out escape: "m e s s i" / "m.e.s.s.i".
    const joined: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].length !== 1) { joined.push(tokens[i]); continue; }
        let letters = tokens[i];
        while (i + 1 < tokens.length && tokens[i + 1].length === 1) letters += tokens[++i];
        joined.push(letters);
    }
    const contains = (candidate: string[], phrase: string[]) => candidate.some((_, start) =>
        phrase.every((word, offset) => candidate[start + offset] !== undefined && unstretched(candidate[start + offset]) === unstretched(word)));
    return [identity.name, ...identity.accept].some(alias => {
        const phrase = words(alias);
        return phrase.length > 0 && (contains(tokens, phrase) || contains(joined, phrase));
    }) ? IDENTITY_CHAT_REMINDER : null;
}
