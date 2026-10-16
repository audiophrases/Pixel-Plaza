import { prerequisiteIds, type Campaign, type Objective } from '../shared/campaign.ts';
import { liveMissionCandidate } from '../shared/missionLive.ts';
import type { LiveMissionInspection, LiveMissionPreview, LiveMissionTarget } from '../shared/missionTypes.ts';
import type { MissionIssue } from '../shared/missionSchema.ts';

export type LiveMissionResult = { target: LiveMissionTarget | null; preview?: LiveMissionPreview; inspection?: LiveMissionInspection; released?: string[]; withdrawn?: string } | { error: string; status: number; errors?: MissionIssue[] };
export const LIVE_PER_CHAPTER = 40;
type LiveRow = { objective_id: string; chapter_id: string; content: string; withdrawn: number };
export type StoredPreview = { preview_id: string; game_id: string; revision_id: string; chapter_id: string; source_id: string; source_version: number; base_version: number; content: string; expires: number };

export class LiveMissions {
    private sql: SqlStorage;
    constructor(sql: SqlStorage) { this.sql = sql; }
    initialize(): void {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS mission_live_quests (
            game_id TEXT NOT NULL, objective_id TEXT NOT NULL, chapter_id TEXT NOT NULL, content TEXT NOT NULL,
            source_id TEXT NOT NULL, source_version INTEGER NOT NULL, created INTEGER NOT NULL, withdrawn INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (game_id, objective_id));
            CREATE TABLE IF NOT EXISTS mission_live_previews (
            preview_id TEXT PRIMARY KEY, teacher_token TEXT NOT NULL, game_id TEXT NOT NULL, revision_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL, source_id TEXT NOT NULL, source_version INTEGER NOT NULL,
            base_version INTEGER NOT NULL, content TEXT NOT NULL, expires INTEGER NOT NULL);`);
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('campaigns')").toArray().some(c => c.name === 'live_version')) this.sql.exec('ALTER TABLE campaigns ADD COLUMN live_version INTEGER NOT NULL DEFAULT 0');
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('campaigns')").toArray().some(c => c.name === 'live_epoch')) this.sql.exec('ALTER TABLE campaigns ADD COLUMN live_epoch TEXT');
        for (const row of this.sql.exec<{ game_id: string }>('SELECT game_id FROM campaigns WHERE live_epoch IS NULL').toArray()) this.sql.exec('UPDATE campaigns SET live_epoch = ? WHERE game_id = ?', crypto.randomUUID(), row.game_id);
    }
    rows(game: string): LiveRow[] { return this.sql.exec<LiveRow>('SELECT objective_id, chapter_id, content, withdrawn FROM mission_live_quests WHERE game_id = ? ORDER BY created, rowid', game).toArray(); } // released together: in the order the teacher chose
    inspect(game: string, id: string): LiveMissionInspection | null {
        const row = this.sql.exec<{ content: string; source_id: string; source_version: number; created: number; withdrawn: number }>('SELECT content, source_id, source_version, created, withdrawn FROM mission_live_quests WHERE game_id = ? AND objective_id = ?', game, id).toArray()[0];
        return row ? { id, definition: JSON.parse(row.content), sourceId: row.source_id, sourceVersion: row.source_version, created: row.created, withdrawn: !!row.withdrawn } : null;
    }
    apply(game: string, base: Campaign): Campaign {
        const rows = this.rows(game).filter(r => !r.withdrawn);
        if (!rows.length) return base;
        const campaign = structuredClone(base);
        for (const row of rows) campaign.chapters.find(c => c.id === row.chapter_id)?.objectives.push(JSON.parse(row.content));
        return campaign;
    }
    additions(game: string, chapterId: string): LiveMissionTarget['additions'] {
        return this.rows(game).filter(row => row.chapter_id === chapterId).map(row => ({ id: row.objective_id, text: (JSON.parse(row.content) as Objective).text, withdrawn: !!row.withdrawn,
            started: this.sql.exec('SELECT 1 FROM quest_assignments WHERE game_id = ? AND objective = ? LIMIT 1', game, row.objective_id).toArray().length > 0 }));
    }
    preview(token: string, target: LiveMissionTarget, base: Campaign, source: Campaign, sourceVersion: number, ids: string[]): { preview: LiveMissionPreview; quests: Objective[] } | { error: string; status: number; errors?: MissionIssue[] } {
        // Bounded per chapter (a chapter holds at most 100 objectives), so a long campaign or a run of free-play
        // sessions can keep receiving library quests.
        if (this.rows(target.game.id).filter(row => row.chapter_id === target.chapter.id).length + ids.length > LIVE_PER_CHAPTER) return { error: `A chapter can receive at most ${LIVE_PER_CHAPTER} live quest additions, including withdrawn ones. Start the next chapter or session for more.`, status: 400 };
        const checked = liveMissionCandidate(base, source, target.chapter.id, ids, this.rows(target.game.id).map(r => r.objective_id));
        if (!checked.campaign) return { error: 'These quests cannot be added to this game.', errors: checked.errors, status: 400 };
        const id = crypto.randomUUID(); const expires = Date.now() + 10 * 60_000;
        this.sql.exec('DELETE FROM mission_live_previews WHERE expires <= ?', Date.now());
        if (this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM mission_live_previews WHERE game_id = ?', target.game.id).one().n >= 10) return { error: 'Too many pending previews. Apply or cancel one before reviewing more.', status: 400 };
        this.sql.exec(`INSERT INTO mission_live_previews (preview_id, teacher_token, game_id, revision_id, chapter_id, source_id, source_version, base_version, content, expires)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, token, target.game.id, target.campaign.revision, target.chapter.id, source.id, sourceVersion, target.version, JSON.stringify(checked.quests), expires);
        return { quests: checked.quests, preview: { id, game: target.game, chapter: { id: target.chapter.id, title: target.chapter.title }, expires,
            quests: checked.quests.map(q => ({ id: q.id, text: q.text, activity: q.activity ?? null, audience: q.board?.roles?.length ? q.board.roles.map(id => base.roles.find(r => r.id === id)?.name ?? id).join(', ') : 'All roles', eligibleNow: 0, definition: q })) } };
    }
    pending(token: string, id: string): StoredPreview | undefined {
        return this.sql.exec<StoredPreview>('SELECT * FROM mission_live_previews WHERE preview_id = ? AND teacher_token = ?', id, token).toArray()[0];
    }
    cancel(token: string, id: string): void { this.sql.exec('DELETE FROM mission_live_previews WHERE preview_id = ? AND teacher_token = ?', id, token); }
    release(preview: StoredPreview): string[] {
        const quests: Objective[] = JSON.parse(preview.content);
        for (const quest of quests) this.sql.exec(`INSERT INTO mission_live_quests (game_id, objective_id, chapter_id, content, source_id, source_version, created) VALUES (?, ?, ?, ?, ?, ?, ?)`, preview.game_id, quest.id, preview.chapter_id, JSON.stringify(quest), preview.source_id, preview.source_version, Date.now());
        this.sql.exec('UPDATE campaigns SET live_version = live_version + 1 WHERE game_id = ?', preview.game_id);
        this.sql.exec('DELETE FROM mission_live_previews WHERE preview_id = ?', preview.preview_id);
        return quests.map(q => q.id);
    }
    withdraw(game: string, id: string, effective: Campaign): string | null {
        const row = this.rows(game).find(r => r.objective_id === id && !r.withdrawn);
        if (!row) return 'That live quest is no longer available.';
        if (this.sql.exec('SELECT 1 FROM quest_assignments WHERE game_id = ? AND objective = ? LIMIT 1', game, id).toArray().length) return 'A student already started this quest; it cannot be withdrawn.';
        if (effective.chapters.some(c => c.objectives.some(o => prerequisiteIds(o).includes(id)))) return 'Another quest depends on this one. Withdraw the dependent quests first.';
        this.sql.exec('UPDATE mission_live_quests SET withdrawn = 1 WHERE game_id = ? AND objective_id = ?', game, id);
        this.sql.exec('UPDATE campaigns SET live_version = live_version + 1 WHERE game_id = ?', game);
        this.sql.exec('DELETE FROM quest_releases WHERE game_id = ? AND objective = ?', game, id);
        return null;
    }
}
