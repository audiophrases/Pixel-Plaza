import { makeWorld, parseTheme, validateTheme, type Theme } from '../shared/theme.ts';
import { themes as starterThemes } from '../shared/themeCatalog.ts';

type ThemeRow = { theme_id: string; content: string; draft: string | null; version: number; updated: number; created: number; synced: number | null; deleted: number; published: number };
type World = ReturnType<typeof makeWorld>;
// A map as the theme studio sees it: what games play (`theme`, once published), the work in progress (`draft`), and
// how many saved games are on it.
export type StudioMap = { id: string; theme: Theme; draft: Theme | null; version: number; published: boolean; deleted: boolean; updated: number; games: number };
export type ThemeResult = { maps: StudioMap[]; map?: StudioMap; published?: string } | { error: string; status: number; errors?: string[] };

const THEME_MAX_BYTES = 200_000;
// Pictures come from the app's own map folder or from the server's picture store; never from another site.
const ownPicture = (url: string) => /^\/assets\/maps\/[\w.-]+$/.test(url) || /^\/api\/theme-assets\/[0-9a-f]{64}$/.test(url);

// A map from the theme studio, a file or the other server: the shape the game relies on and the studio's own checks,
// or what is wrong with it.
export function checkMap(value: unknown): { theme: Theme } | { error: string; errors?: string[] } {
    let theme: Theme;
    try { theme = parseTheme(value); } catch (cause) { return { error: cause instanceof Error ? cause.message : 'That is not a map.' }; }
    const { errors } = validateTheme(theme);
    if (theme.id.length > 64 || theme.name.length > 120) errors.push('Use an id of up to 64 characters and a name of up to 120.');
    if (![theme.image, ...(theme.layers ?? []).map(layer => layer.image)].every(ownPicture)) errors.push('Pictures must be uploaded to the server or come from the app’s own maps.');
    if (JSON.stringify(theme).length > THEME_MAX_BYTES) errors.push('The map is too big.');
    return errors.length ? { error: 'The map is not ready to save.', errors } : { theme };
}

// The maps games are played on: one record each, like missions and side quests, so they can be changed, added and
// deleted without a new version of the app. `content` is the published map every game on it follows; `draft` is
// work in progress from the theme studio; a map nobody has published yet is not offered to games. A map in Trash
// cannot be chosen for a new game, but games already on it keep it. A new server starts with the starter maps
// (shared/themeCatalog.ts) as ordinary records, unedited; a map installed there later (npm run theme) joins on the
// next start. A map the server already has is never overwritten.
export class ThemeStore {
    private sql: SqlStorage;
    private cached: { themes: Map<string, Theme>; worlds: Map<string, World>; order: string[]; trash: string[] } | null = null;
    // `hasPicture` tells whether the picture store holds an uploaded picture, so a map cannot point at one it lacks.
    private hasPicture: (hash: string) => boolean;
    constructor(sql: SqlStorage, hasPicture: (hash: string) => boolean = () => true) { this.sql = sql; this.hasPicture = hasPicture; }

    initialize(): void {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS themes (
            theme_id TEXT PRIMARY KEY, content TEXT NOT NULL, draft TEXT, version INTEGER NOT NULL, updated INTEGER NOT NULL,
            created INTEGER NOT NULL, synced INTEGER, deleted INTEGER NOT NULL DEFAULT 0)`);
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('themes')").toArray().some(column => column.name === 'published')) {
            this.sql.exec('ALTER TABLE themes ADD COLUMN published INTEGER NOT NULL DEFAULT 1');
        }
        for (const theme of Object.values(starterThemes)) {
            if (this.row(theme.id)) continue;
            this.sql.exec('INSERT INTO themes (theme_id, content, version, updated, created) VALUES (?, ?, 1, 0, ?)', theme.id, JSON.stringify(theme), this.nextOrder());
        }
    }

    private row(id: string): ThemeRow | undefined { return this.sql.exec<ThemeRow>('SELECT * FROM themes WHERE theme_id = ?', id).toArray()[0]; }
    private nextOrder(): number { return (this.sql.exec<{ last: number | null }>('SELECT MAX(created) AS last FROM themes').one().last ?? 0) + 1; }
    private write(sql: string, ...values: (string | number | null)[]): void { this.cached = null; this.sql.exec(sql, ...values); }

    private load() {
        if (this.cached) return this.cached;
        const rows = this.sql.exec<ThemeRow>('SELECT * FROM themes WHERE published = 1 ORDER BY created, theme_id').toArray();
        this.cached = { themes: new Map(rows.map(row => [row.theme_id, JSON.parse(row.content) as Theme])), worlds: new Map(),
            order: rows.filter(row => !row.deleted).map(row => row.theme_id), trash: rows.filter(row => row.deleted).map(row => row.theme_id) };
        return this.cached;
    }

    // The maps a new game can be played on, in the order they were made.
    list(): Theme[] { const { themes, order } = this.load(); return order.map(id => themes.get(id)!); }
    // Maps in Trash that games may still be on.
    trash(): Theme[] { const { themes, trash } = this.load(); return trash.map(id => themes.get(id)!); }
    // A map that can be chosen for a new game.
    has(id: unknown): id is string { return typeof id === 'string' && this.load().order.includes(id); }
    // The map a new game gets when none is chosen: the first one.
    defaultId(): string { return this.load().order[0] ?? this.load().themes.keys().next().value ?? 'plaza'; }
    // The map of a game, also when it is in Trash; a game whose map is gone plays on the default one.
    theme(id?: string | null): Theme {
        const { themes } = this.load();
        return (id && themes.get(id)) || themes.get(this.defaultId()) || starterThemes.plaza;
    }
    world(id?: string | null): World {
        const theme = this.theme(id); const { worlds } = this.load();
        let world = worlds.get(theme.id);
        if (!world) { world = makeWorld(theme); worlds.set(theme.id, world); }
        return world;
    }
    // Changes whenever a map is added, changed or deleted, so a page knows to fetch the maps again.
    version(): number { return this.sql.exec<{ n: number }>('SELECT COALESCE(SUM(version), 0) + COUNT(*) AS n FROM themes').one().n; }

    // ---------- The theme studio ----------

    private studioMap(row: ThemeRow): StudioMap {
        const games = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM games WHERE theme_id = ?', row.theme_id).one().n;
        return { id: row.theme_id, theme: JSON.parse(row.content), draft: row.draft ? JSON.parse(row.draft) : null, version: row.version,
            published: !!row.published, deleted: !!row.deleted, updated: row.updated, games };
    }
    private listing(id?: string): ThemeResult {
        const maps = this.sql.exec<ThemeRow>('SELECT * FROM themes ORDER BY created, theme_id').toArray().map(row => this.studioMap(row));
        return { maps, ...(id ? { map: maps.find(map => map.id === id) } : {}) };
    }

    private check(value: unknown): ReturnType<typeof checkMap> {
        const checked = checkMap(value);
        if ('error' in checked) return checked;
        const theme = checked.theme;
        const missing = [theme.image, ...(theme.layers ?? []).map(layer => layer.image)].some(url => url.startsWith('/api/theme-assets/') && !this.hasPicture(url.slice('/api/theme-assets/'.length)));
        return missing ? { error: 'The map is not ready to save.', errors: ['A picture of this map is not on the server. Open it again and save.'] } : checked;
    }

    execute(op: string, body: unknown): ThemeResult {
        const b = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
        if (op === 'list') return this.listing();
        if (op === 'save') {
            const checked = this.check(b.theme);
            if ('error' in checked) return { error: checked.error, errors: checked.errors, status: 400 };
            const content = JSON.stringify(checked.theme); const id = checked.theme.id;
            const here = this.row(id);
            // A new map, or a copy: a draft only, offered to games once it is published.
            if (b.create === true) {
                if (here) return { error: 'A map with that id already exists. Choose another id.', status: 409 };
                if (this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM themes').one().n >= 100) return { error: 'The server keeps at most 100 maps, Trash included.', status: 400 };
                this.write('INSERT INTO themes (theme_id, content, draft, version, updated, created, published) VALUES (?, ?, ?, 1, ?, ?, 0)', id, content, content, Date.now(), this.nextOrder());
                return this.listing(id);
            }
            if (!here) return { error: 'That map is not on the server. Save it as a new map.', status: 404 };
            if (here.version !== b.version) return { error: 'This map changed somewhere else. Download your work, then open it again.', status: 409 };
            if (here.deleted) return { error: 'This map is in Trash. Restore it before editing.', status: 409 };
            this.write('UPDATE themes SET draft = ?, version = version + 1, updated = ? WHERE theme_id = ?', content, Date.now(), id);
            return this.listing(id);
        }
        const here = typeof b.id === 'string' ? this.row(b.id) : undefined;
        if (!here) return { error: 'Map not found.', status: 404 };
        if (here.version !== b.version) return { error: 'This map changed somewhere else. Refresh and try again.', status: 409 };
        if (op === 'publish') {
            if (here.deleted) return { error: 'This map is in Trash. Restore it before publishing.', status: 409 };
            const content = here.draft ?? here.content;
            const checked = this.check(JSON.parse(content));
            if ('error' in checked) return { error: checked.error, errors: checked.errors, status: 400 };
            this.write('UPDATE themes SET content = ?, draft = NULL, published = 1, version = version + 1, updated = ? WHERE theme_id = ?', content, Date.now(), here.theme_id);
            return { ...this.listing(here.theme_id), published: here.theme_id };
        }
        if (op === 'discard') {
            if (!here.published) return { error: 'This map has never been published: move it to Trash instead.', status: 409 };
            this.write('UPDATE themes SET draft = NULL, version = version + 1, updated = ? WHERE theme_id = ?', Date.now(), here.theme_id);
            return this.listing(here.theme_id);
        }
        if (op === 'delete' || op === 'restore') {
            if (op === 'delete' && here.published && !here.deleted && this.list().length <= 1) return { error: 'Keep at least one map for new games.', status: 409 };
            this.write('UPDATE themes SET deleted = ?, version = version + 1, updated = ? WHERE theme_id = ?', op === 'delete' ? 1 : 0, Date.now(), here.theme_id);
            return this.listing(here.theme_id);
        }
        return { error: 'Unknown theme studio action.', status: 400 };
    }
}
