import type { SideQuestLibrary } from '../shared/sideQuests.ts';

// The side quest library, as data: one row with its version. Like missions, its home is the online server; the
// teacher's laptop keeps a copy (`synced`: the version the online server has) that PlazaRoom.syncMissions keeps in step.
// There is no editor for it: a new library is loaded from a file, and the online one wins if both changed.
type LibraryRow = { content: string; version: number; synced: number | null };

export class QuestLibrary {
    private sql: SqlStorage;
    private parsed: { version: number; library: SideQuestLibrary } | null = null;
    constructor(sql: SqlStorage) { this.sql = sql; }

    initialize(): void {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS quest_library (
            id INTEGER PRIMARY KEY CHECK (id = 1), content TEXT NOT NULL, version INTEGER NOT NULL, synced INTEGER, updated INTEGER NOT NULL)`);
    }

    private row(): LibraryRow | undefined {
        return this.sql.exec<LibraryRow>('SELECT content, version, synced FROM quest_library WHERE id = 1').toArray()[0];
    }
    private write(content: string, version: number, synced: number | null): void {
        this.sql.exec(`INSERT INTO quest_library (id, content, version, synced, updated) VALUES (1, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET content = excluded.content, version = excluded.version, synced = excluded.synced, updated = excluded.updated`,
            content, version, synced, Date.now());
    }

    get(): SideQuestLibrary | null {
        const row = this.row();
        if (!row) return null;
        if (this.parsed?.version !== row.version) this.parsed = { version: row.version, library: JSON.parse(row.content) };
        return this.parsed.library;
    }
    // Loaded from a file (the tests, a new server's first content): a new version when it differs.
    load(library: SideQuestLibrary): boolean {
        const content = JSON.stringify(library); const row = this.row();
        if (row?.content === content) return false;
        this.write(content, (row?.version ?? 0) + 1, row?.synced ?? null);
        return true;
    }

    // Online: a laptop's library, loaded there from the version `base` (null: never uploaded). It replaces this one when
    // nothing changed here since; otherwise this one stays, and the laptop takes it with its next download.
    receive(content: string, version: number, base: number | null): number | null {
        const row = this.row();
        if (row?.content === content) return row.version;
        if (row && base !== row.version) return null;
        const next = Math.max(version, (row?.version ?? 0) + 1);
        this.write(content, next, null);
        return next;
    }
    // Online: the library, when the laptop has another version.
    changes(have: number | null): { content: string; version: number } | null {
        const row = this.row();
        return row && row.version !== have ? { content: row.content, version: row.version } : null;
    }

    // On the laptop: the library to upload, when it was loaded here and is not on the online server yet.
    outbox(): { content: string; version: number; base: number | null } | null {
        const row = this.row();
        return row && row.synced !== row.version ? { content: row.content, version: row.version, base: row.synced } : null;
    }
    // On the laptop: the online server kept it at `version`, or kept its own (null), which the next download brings.
    uploaded(sent: number, version: number | null): void {
        const row = this.row();
        if (!row || row.version !== sent) return;
        if (version === null) this.sql.exec('UPDATE quest_library SET version = 0, synced = 0 WHERE id = 1'); // outdated: the download replaces it
        else this.sql.exec('UPDATE quest_library SET version = ?, synced = ? WHERE id = 1', version, version);
    }
    synced(): number | null {
        return this.row()?.synced ?? null;
    }
    // On the laptop: the online server's library. One loaded here and not uploaded yet waits for its upload.
    downloaded(content: string, version: number): void {
        const row = this.row();
        if (row && row.synced !== row.version) return;
        this.write(content, version, version);
    }
}
