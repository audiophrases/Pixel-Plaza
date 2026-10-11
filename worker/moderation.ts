// Asks OpenAI's moderation endpoint whether a message is safe for the class.
// No Workers-only APIs here, so the unit tests can run it under `node --test`.

export type ModerationEnv = { OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string };

export type Moderation =
    | { result: 'clean' }
    | { result: 'flagged'; categories: string[] }
    | { result: 'off' }        // no key is set: only the word filter and the teacher check messages
    | { result: 'unchecked' }; // a key is set but OpenAI did not answer in time

const TIMEOUT_MS = 3000;

// Never throws and never holds a message for long: when OpenAI cannot be
// reached the message still goes to the teacher, who remains the gate.
export async function moderate(text: string, env: ModerationEnv): Promise<Moderation> {
    if (!env.OPENAI_API_KEY) return { result: 'off' };
    try {
        const response = await fetch(`${env.OPENAI_BASE_URL || 'https://api.openai.com'}/v1/moderations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
            body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (!response.ok) return { result: 'unchecked' };
        const verdict = ((await response.json()) as { results?: { flagged?: boolean; categories?: Record<string, boolean> }[] }).results?.[0];
        if (!verdict || typeof verdict.flagged !== 'boolean') return { result: 'unchecked' };
        if (!verdict.flagged) return { result: 'clean' };
        const categories = Object.entries(verdict.categories ?? {}).filter(([, on]) => on).map(([name]) => name);
        return { result: 'flagged', categories: categories.length ? categories : ['flagged'] };
    } catch {
        return { result: 'unchecked' };
    }
}
