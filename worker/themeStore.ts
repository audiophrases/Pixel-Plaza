import { makeWorld, type Theme } from '../shared/theme.ts';
import { themes as starterThemes } from '../shared/themeCatalog.ts';

type ThemeRow = { theme_id: string; content: string; draft: string | null; version: number; updated: number; created: number; synced: number | null; deleted: number };
type World = ReturnType<typeof makeWorld>;

// The maps games are played on: one record each, like missions and side quests, so they can be changed, added and
// deleted without a new version of the app. `content` is the published map every game on it follows; `draft` is
// work in progress from the theme studio. A map in Trash cannot be chosen for a new game, but games already on it
// keep it. A new server starts with the starter maps (shared/themeCatalog.ts) as ordinary records, unedited; a map
// installed there later (npm run theme) joins on the next start. A map the server already has is never overwritten.
export class ThemeStore {
    private sql: SqlStorage;
    private cached: { themes: Map<string, Theme>; worlds: Map<string, World>; order: string[] } | null = null;
    constructor(sql: SqlStorage) { this.sql = sql; }

    initialize(): void {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS themes (
            theme_id TEXT PRIMARY KEY, content TEXT NOT NULL, draft TEXT, version INTEGER NOT NULL, updated INTEGER NOT NULL,
            created INTEGER NOT NULL, synced INTEGER, deleted INTEGER NOT NULL DEFAULT 0)`);
        for (const theme of Object.values(starterThemes)) {
            if (this.sql.exec('SELECT 1 FROM themes WHERE theme_id = ?', theme.id).toArray().length) continue;
            const order = (this.sql.exec<{ last: number | null }>('SELECT MAX(created) AS last FROM themes').one().last ?? 0) + 1;
            this.sql.exec('INSERT INTO themes (theme_id, content, version, updated, created) VALUES (?, ?, 1, 0, ?)', theme.id, JSON.stringify(theme), order);
        }
    }

    private load() {
        if (this.cached) return this.cached;
        const rows = this.sql.exec<ThemeRow>('SELECT * FROM themes ORDER BY created, theme_id').toArray();
        const themes = new Map(rows.map(row => [row.theme_id, JSON.parse(row.content) as Theme]));
        this.cached = { themes, worlds: new Map(), order: rows.filter(row => !row.deleted).map(row => row.theme_id) };
        return this.cached;
    }

    // The maps a new game can be played on, in the order they were made.
    list(): Theme[] { const { themes, order } = this.load(); return order.map(id => themes.get(id)!); }
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
}
