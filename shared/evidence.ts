// Small embedded pictures travel with mission revisions, exports and offline sync.
// Only the matching visible card is projected to a student; no public asset catalogue.
export type EvidenceImage = { src: string; alt: string };
export const EVIDENCE_MAX_CHARS = 100_000;
export function evidenceSource(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > EVIDENCE_MAX_CHARS) return false;
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[2].length % 4 !== 0) return false;
    try {
        const bytes = atob(match[2]);
        return match[1] === 'png' ? bytes.startsWith('\x89PNG\r\n\x1a\n')
            : match[1] === 'jpeg' ? bytes.startsWith('\xff\xd8\xff')
            : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
    } catch { return false; }
}
