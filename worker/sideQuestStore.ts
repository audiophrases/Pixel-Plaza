import { QUEST_LIMIT, checkQuest, checkQuestFile, newQuestId, type SideQuest, type SideQuestCopy, type SideQuestPushResult } from '../shared/sideQuests.ts';

export type SideQuestResult = { quests?: SideQuest[]; trash?: SideQuest[]; versions?: Record<string, number>; quest?: SideQuest; imported?: { added: number; updated: number; unchanged: number } } | { error: string; status: number };
type QuestRow = { quest_id: string; content: string; version: number; updated: number; created: number; synced: number | null; deleted: number };

// A quest sent by the teacher's laptop: the shape it must have, and content the library page itself would accept.
export function readQuestCopy(value: unknown): SideQuestCopy | null {
    const v = value as Partial<SideQuestCopy> | null;
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || typeof v.content !== 'string' || v.content.length > 20_000
        || !Number.isInteger(v.version) || !Number.isInteger(v.updated) || !Number.isInteger(v.created) || typeof v.deleted !== 'boolean') return null;
    let checked: ReturnType<typeof checkQuest>;
    try { checked = checkQuest(JSON.parse(v.content)); } catch { return null; }
    if ('error' in checked || checked.quest.id !== v.id) return null;
    return { id: v.id, content: JSON.stringify(checked.quest), version: v.version!, updated: v.updated!, created: v.created!, deleted: v.deleted };
}

// The side quests: one record each, which teachers write, change, delete and restore on the library page. Like
// missions, their home is the online server; the teacher's laptop keeps a copy that PlazaRoom.syncMissions keeps in
// step with the methods at the end. A quest changed in both places is kept twice, never overwritten.
export class SideQuestStore {
    private sql: SqlStorage;
    private cached: SideQuest[] | null = null; // the quests not in Trash, until the next write
    constructor(sql: SqlStorage) { this.sql = sql; }

    initialize(): void {
        const fresh = this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'side_quests'").toArray().length === 0;
        this.sql.exec(`CREATE TABLE IF NOT EXISTS side_quests (
            quest_id TEXT PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL, updated INTEGER NOT NULL,
            created INTEGER NOT NULL, synced INTEGER, deleted INTEGER NOT NULL DEFAULT 0)`);
        if (fresh) this.adoptLibrary();
    }
    // Before quests had a record each, the library was one file in `quest_library`. Its quests become records,
    // unedited and waiting to upload, so a laptop and the online server that both had it agree at the first sync.
    // The old table is left as it was.
    private adoptLibrary(): void {
        if (!this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'quest_library'").toArray().length) return;
        const row = this.sql.exec<{ content: string }>('SELECT content FROM quest_library WHERE id = 1').toArray()[0];
        if (!row) return;
        let quests: unknown[] = [];
        try { quests = (JSON.parse(row.content) as { quests?: unknown[] }).quests ?? []; } catch { return; }
        let order = 0;
        for (const value of quests.slice(0, QUEST_LIMIT)) {
            const checked = checkQuest(value);
            if ('error' in checked) continue;
            this.sql.exec('INSERT OR IGNORE INTO side_quests (quest_id, content, version, updated, created) VALUES (?, ?, 1, 0, ?)', checked.quest.id, JSON.stringify(checked.quest), ++order);
        }
    }

    private rows(deleted: boolean): QuestRow[] {
        return this.sql.exec<QuestRow>('SELECT * FROM side_quests WHERE deleted = ? ORDER BY created, quest_id', deleted ? 1 : 0).toArray();
    }
    private row(id: string): QuestRow | undefined {
        return this.sql.exec<QuestRow>('SELECT * FROM side_quests WHERE quest_id = ?', id).toArray()[0];
    }
    private count(): number { return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM side_quests').one().n; }
    private nextOrder(): number { return (this.sql.exec<{ last: number | null }>('SELECT MAX(created) AS last FROM side_quests').one().last ?? 0) + 1; }
    private write(sql: string, ...values: (string | number | null)[]): void { this.cached = null; this.sql.exec(sql, ...values); }

    // The quests teachers can add to games, in the order they were made. The same list until something changes.
    quests(): SideQuest[] {
        return this.cached ??= this.rows(false).map(row => JSON.parse(row.content) as SideQuest);
    }
    // The mission chapter a story quest belongs to, also in Trash; null for a generic quest or one not here.
    chapterOf(id: string): string | null {
        const row = this.row(id);
        return row ? (JSON.parse(row.content) as SideQuest).chapter ?? null : null;
    }
    private listing(): SideQuestResult {
        const versions = Object.fromEntries(this.sql.exec<{ id: string; version: number }>('SELECT quest_id AS id, version FROM side_quests').toArray().map(row => [row.id, row.version]));
        return { quests: this.quests(), trash: this.rows(true).map(row => JSON.parse(row.content) as SideQuest), versions };
    }

    execute(op: string, body: unknown): SideQuestResult {
        const b = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
        if (op === 'list') return this.listing();
        if (op === 'import') {
            const checked = checkQuestFile(b.quests);
            if ('error' in checked) return { error: checked.error, status: 400 };
            const fresh = checked.quests.filter(quest => !this.row(quest.id));
            if (this.count() + fresh.length > QUEST_LIMIT) return { error: `The library keeps at most ${QUEST_LIMIT} quests, Trash included.`, status: 400 };
            const imported = { added: 0, updated: 0, unchanged: 0 };
            for (const quest of checked.quests) {
                const content = JSON.stringify(quest); const here = this.row(quest.id);
                if (!here) { this.write('INSERT INTO side_quests (quest_id, content, version, updated, created) VALUES (?, ?, 1, ?, ?)', quest.id, content, Date.now(), this.nextOrder()); imported.added++; }
                else if (here.content !== content) { this.write('UPDATE side_quests SET content = ?, version = version + 1, updated = ? WHERE quest_id = ?', content, Date.now(), quest.id); imported.updated++; }
                else imported.unchanged++;
            }
            return { ...this.listing(), imported };
        }
        if (op === 'save') {
            // A new quest gets an ID of its own, whatever the page sent.
            const creating = b.create === true;
            const draft = b.quest && typeof b.quest === 'object' ? b.quest as Record<string, unknown> : {};
            const id = creating ? newQuestId(typeof draft.title === 'string' ? draft.title : '', candidate => !!this.row(candidate)) : draft.id;
            const checked = checkQuest({ ...draft, id });
            if ('error' in checked) return { error: checked.error, status: 400 };
            const content = JSON.stringify(checked.quest);
            if (creating) {
                if (this.count() >= QUEST_LIMIT) return { error: `The library keeps at most ${QUEST_LIMIT} quests, Trash included.`, status: 400 };
                this.write('INSERT INTO side_quests (quest_id, content, version, updated, created) VALUES (?, ?, 1, ?, ?)', checked.quest.id, content, Date.now(), this.nextOrder());
                return { ...this.listing(), quest: checked.quest };
            }
            const here = this.row(checked.quest.id);
            if (!here) return { error: 'Quest not found.', status: 404 };
            if (here.version !== b.version) return { error: 'This quest changed somewhere else. Copy your text, then open it again.', status: 409 };
            if (here.deleted) return { error: 'This quest is in Trash. Restore it before editing.', status: 409 };
            if (here.content !== content) this.write('UPDATE side_quests SET content = ?, version = version + 1, updated = ? WHERE quest_id = ?', content, Date.now(), here.quest_id);
            return { ...this.listing(), quest: checked.quest };
        }
        if (op === 'delete' || op === 'restore') {
            const here = typeof b.id === 'string' ? this.row(b.id) : undefined;
            if (!here) return { error: 'Quest not found.', status: 404 };
            if (here.version !== b.version) return { error: 'This quest changed somewhere else. Refresh the library and try again.', status: 409 };
            if (!!here.deleted !== (op === 'delete')) this.write('UPDATE side_quests SET deleted = ?, version = version + 1, updated = ? WHERE quest_id = ?', op === 'delete' ? 1 : 0, Date.now(), here.quest_id);
            return this.listing();
        }
        return { error: 'Unknown side quest action.', status: 400 };
    }

    // Quests from a file into a server that lacks them (the tests, a new server's first content): unedited, after the
    // quests already here, so a laptop's own copy of one can replace it on first sync. Returns how many were added.
    load(quests: readonly SideQuest[]): number {
        let added = 0;
        for (const quest of quests) {
            if (this.row(quest.id) || this.count() >= QUEST_LIMIT) continue;
            this.write('INSERT INTO side_quests (quest_id, content, version, updated, created) VALUES (?, ?, 1, 0, ?)', quest.id, JSON.stringify(quest), this.nextOrder());
            added++;
        }
        return added;
    }

    // ---------- In step with the online server ----------

    private copyOf(row: QuestRow): SideQuestCopy {
        return { id: row.quest_id, content: row.content, version: row.version, updated: row.updated, created: row.created, deleted: !!row.deleted };
    }
    // Online: a laptop's copy of one quest, edited from the server's version `base` (null: never uploaded). It replaces
    // the server's when nothing changed here since, or when nobody ever edited the server's. When both changed, both are
    // kept: the laptop's becomes a new quest marked "(laptop)".
    receive(copy: SideQuestCopy, base: number | null): SideQuestPushResult {
        const here = this.row(copy.id);
        if (here && here.content === copy.content && !!here.deleted === copy.deleted) return { outcome: 'saved', version: here.version };
        if (!here || (base === null ? here.updated === 0 : base === here.version)) {
            const version = here ? Math.max(copy.version, here.version + 1) : copy.version;
            this.write(`INSERT INTO side_quests (quest_id, content, version, updated, created, deleted) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (quest_id) DO UPDATE SET content = excluded.content, version = excluded.version, updated = excluded.updated, deleted = excluded.deleted`,
                copy.id, copy.content, version, copy.updated, copy.created, copy.deleted ? 1 : 0);
            return { outcome: 'saved', version };
        }
        const quest: SideQuest = JSON.parse(copy.content);
        const id = newQuestId(`${quest.id.replace(/^sq-/, '').slice(0, 33)} laptop`, candidate => !!this.row(candidate));
        const content = JSON.stringify({ ...quest, id, title: `${quest.title.slice(0, 110)} (laptop)` });
        this.write('INSERT INTO side_quests (quest_id, content, version, updated, created, deleted) VALUES (?, ?, 1, ?, ?, ?)', id, content, Date.now(), this.nextOrder(), copy.deleted ? 1 : 0);
        return { outcome: 'kept-both', version: here.version, copy: { id, content, deleted: copy.deleted } };
    }
    // Online: what a laptop is missing. `have` is the version of each quest it holds.
    changes(have: Record<string, number>): SideQuestCopy[] {
        return this.sql.exec<QuestRow>('SELECT * FROM side_quests ORDER BY created, quest_id').toArray().filter(row => have[row.quest_id] !== row.version).map(row => this.copyOf(row));
    }

    // On the laptop: the quests to upload: changed here since the last sync, or never uploaded.
    outbox(): { copy: SideQuestCopy; base: number | null }[] {
        return this.sql.exec<QuestRow>('SELECT * FROM side_quests WHERE synced IS NULL OR synced <> version ORDER BY created, quest_id').toArray()
            .map(row => ({ copy: this.copyOf(row), base: row.synced }));
    }
    waiting(): number {
        return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM side_quests WHERE synced IS NULL OR synced <> version').one().n;
    }
    // On the laptop: what the online server made of an upload. A quest edited again while it travelled stays waiting.
    uploaded(sent: SideQuestCopy, result: SideQuestPushResult): void {
        const here = this.row(sent.id);
        if (!here) return;
        if (result.outcome === 'kept-both' && result.copy) {
            // The server kept its own version under this ID; this laptop's lives on as the copy, and the server's
            // version arrives with the next download.
            this.write('UPDATE side_quests SET quest_id = ?, content = ?, version = 1, synced = 1, updated = ?, created = ?, deleted = ? WHERE quest_id = ? AND version = ?',
                result.copy.id, result.copy.content, Date.now(), this.nextOrder(), result.copy.deleted ? 1 : 0, sent.id, sent.version);
            return;
        }
        if (here.version === sent.version) this.write('UPDATE side_quests SET version = ?, synced = ? WHERE quest_id = ?', result.version, result.version, sent.id);
        else if (result.version === sent.version) this.write('UPDATE side_quests SET synced = ? WHERE quest_id = ?', result.version, sent.id);
    }
    // On the laptop: what it holds, to ask the online server only for what changed.
    known(): Record<string, number> {
        return Object.fromEntries(this.sql.exec<{ id: string; synced: number }>('SELECT quest_id AS id, synced FROM side_quests WHERE synced IS NOT NULL').toArray().map(row => [row.id, row.synced]));
    }
    // On the laptop: quests from the online server. One changed here and not uploaded yet waits for its upload.
    downloaded(copies: readonly SideQuestCopy[]): void {
        for (const copy of copies) {
            const here = this.row(copy.id);
            if (here && (here.synced === null || here.synced !== here.version)) continue;
            this.write(`INSERT INTO side_quests (quest_id, content, version, updated, created, synced, deleted) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (quest_id) DO UPDATE SET content = excluded.content, version = excluded.version, updated = excluded.updated,
                created = excluded.created, synced = excluded.synced, deleted = excluded.deleted`,
                copy.id, copy.content, copy.version, copy.updated, copy.created, copy.version, copy.deleted ? 1 : 0);
        }
    }
}
