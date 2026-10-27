// Words never allowed in the class chat, however they are spelt: slurs about who people are (race, origin,
// sexuality, gender, disability), in English and in the class's Spanish and Catalan. A message with one is
// stopped before anyone sees it, never gets a spelling suggestion, and the teacher is told at once.
// No imports, so the page and the worker use the same list.

// Digits and signs that stand for letters, as in "n1gga".
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't' };

const SLURS: RegExp[] = [
    /^n+[iy]+g{2,}/,                                  // the n-word with any ending: nigga, nigger, niggas, nigg, niggus
    /^n+[iy]+g+(a|ah|as|az|u|us|uz|uh)$/,             // and with one g: niga, nigus (not Niger, Nigeria, night)
    /^nigh$/,                                         // an old word, used in class only as a stand-in for it
    /^n+[iy]+b{2,}(a|as|er|ers)$/,                    // nibba
    /^f+a+g+(s|ot|ots|got|gots|gy|gie|gies)?$/,       // fag, faggot
    /^(tranny|trannies|retard|retards|retarded)$/,
    /^(chink|chinks|spic|spics|wetback|wetbacks|paki|pakis)$/,
    /^(sudaca|sudacas|panchito|panchitos|moro|moros|moraco|moracos|negrata|negratas|bollera|bolleras)$/,
    /^maric(a|as|on|ona|ones|onas|onazo|onazos)$/,
];

// The words of a message as the list sees them: lower case, accents and stacked marks gone, digits read as
// letters, and a word spelt out letter by letter ("n i g g a") read as one word too.
function words(text: string): string[] {
    const plain = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[01!3457@$]/g, sign => LEET[sign]);
    const tokens = plain.split(/\s+/).map(token => token.replace(/[^\p{L}]/gu, '')).filter(Boolean);
    const spelt: string[] = [];
    let run = '';
    for (const token of [...tokens, '']) {
        if (token.length === 1) { run += token; continue; }
        if (run.length >= 3) spelt.push(run);
        run = '';
    }
    // "n.i.g.g.a": the letters of one chunk between spaces, read together.
    return [...(plain.match(/\p{L}+/gu) ?? []), ...tokens, ...spelt];
}

// The first word from the list in a message, as the list read it, or null.
export function slurIn(text: string): string | null {
    return words(text).find(word => SLURS.some(pattern => pattern.test(word))) ?? null;
}

// A small classroom backstop, independent of the remote classifier. Explicit
// sexual terms are stopped outright; ambiguous body words need a sexual action
// in the same message, so names, animals and ordinary health language still work.
const EXPLICIT_SEXUAL = /^(?:blowjobs?|handjobs?|porn(?:o|os|ography|ographic)?|masturbat(?:e|es|ed|ing|ion)|wank(?:s|er|ers|ed|ing)?|cum(?:s|ming|shot|shots)?)$/;
const SEXUAL_BODY = /^(?:dicks?|cocks?|puss(?:y|ies)|penis(?:es)?|vaginas?|genitals?)$/;
const SEXUAL_ACTION = /^(?:suck(?:s|ed|ing)?|lick(?:s|ed|ing)?|fuck(?:s|ed|ing)?|rid(?:e|es|ing)|stro(?:ke|kes|king))$/;

export function localHarm(text: string): Harm | null {
    if (slurIn(text)) return 'hate';
    const tokens = words(text);
    if (tokens.some(word => EXPLICIT_SEXUAL.test(word))
        || (tokens.some(word => SEXUAL_BODY.test(word)) && tokens.some(word => SEXUAL_ACTION.test(word)))) return 'sexual';
    return null;
}

// A harmful thing a student tried to send, as the teacher sees it: grouped per student and kind, with a count.
export type Incident = { id: string; studentKey: string; name: string; harm: Harm; texts: string[]; count: number; firstTs: number; lastTs: number };

// What kind of harm a message does, for the teacher: from the list, or from OpenAI's moderation categories.
export type Harm = 'self-harm' | 'threat' | 'sexual' | 'hate' | 'harassment' | 'violence' | 'other';
export const HARM_LABEL: Record<Harm, string> = {
    'self-harm': 'self-harm', threat: 'threat', sexual: 'sexual', hate: 'hate speech', harassment: 'bullying', violence: 'violence', other: 'flagged',
};

// The most serious harm among OpenAI's categories ("harassment/threatening", "sexual/minors"...).
export function harmFrom(categories: readonly string[]): Harm {
    const has = (prefix: string) => categories.some(category => category.startsWith(prefix));
    if (has('self-harm')) return 'self-harm';
    if (categories.some(category => category.endsWith('/threatening'))) return 'threat';
    if (has('sexual')) return 'sexual';
    if (has('hate')) return 'hate';
    if (has('harassment')) return 'harassment';
    if (has('violence') || has('illicit')) return 'violence';
    return 'other';
}
