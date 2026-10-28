// Pictures for maps, uploaded from the theme studio and kept in the plaza's own database, so a map needs no file in
// the app. Each picture is named by its SHA-256, so the same picture is kept once and its address never changes;
// it is stored in pieces, as one picture can be larger than a database value may be. Only PNG, WebP and JPEG are
// taken: they cannot carry scripts, as an SVG could.
export const ASSET_MAX_BYTES = 8_000_000;
const PIECE = 1_000_000;

export function pictureType(bytes: Uint8Array): string | null {
    const starts = (...values: number[]) => values.every((value, i) => bytes[i] === value);
    if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
    if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
    if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
    return null;
}

export class ThemeAssets {
    private sql: SqlStorage;
    constructor(sql: SqlStorage) { this.sql = sql; }
    initialize(): void {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS theme_assets (hash TEXT PRIMARY KEY, type TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS theme_asset_pieces (hash TEXT NOT NULL, part INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (hash, part));`);
    }
    // Keeps a picture and gives its address in the game, or why it was not taken.
    async put(bytes: Uint8Array): Promise<{ url: string; hash: string } | { error: string; status: number }> {
        if (!bytes.length || bytes.length > ASSET_MAX_BYTES) return { error: `Use a picture of up to ${ASSET_MAX_BYTES / 1_000_000} MB.`, status: 413 };
        const type = pictureType(bytes);
        if (!type) return { error: 'Use a PNG, WebP or JPEG picture.', status: 415 };
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (!this.sql.exec('SELECT 1 FROM theme_assets WHERE hash = ?', hash).toArray().length) {
            for (let part = 0; part * PIECE < bytes.length; part++) {
                this.sql.exec('INSERT OR REPLACE INTO theme_asset_pieces (hash, part, data) VALUES (?, ?, ?)', hash, part, bytes.slice(part * PIECE, (part + 1) * PIECE));
            }
            this.sql.exec('INSERT INTO theme_assets (hash, type, size, created) VALUES (?, ?, ?, ?)', hash, type, bytes.length, Date.now());
        }
        return { url: `/api/theme-assets/${hash}`, hash };
    }
    has(hash: string): boolean {
        return this.sql.exec('SELECT 1 FROM theme_assets WHERE hash = ?', hash).toArray().length > 0;
    }
    get(hash: string): { type: string; bytes: Uint8Array } | null {
        const asset = this.sql.exec<{ type: string; size: number }>('SELECT type, size FROM theme_assets WHERE hash = ?', hash).toArray()[0];
        if (!asset) return null;
        const bytes = new Uint8Array(asset.size); let offset = 0;
        for (const piece of this.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM theme_asset_pieces WHERE hash = ? ORDER BY part', hash).toArray()) {
            const data = new Uint8Array(piece.data); bytes.set(data, offset); offset += data.length;
        }
        return offset === asset.size ? { type: asset.type, bytes } : null;
    }
}
