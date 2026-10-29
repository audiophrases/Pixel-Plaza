import type { Objective } from '../shared/campaign.ts';
import { SIDE_QUEST_SOURCE } from '../shared/sideQuests.ts';

// Assignments and groups of a game's side quests carry this instead of a mission chapter: chapters never move them.
export const GAME_CHAPTER = -1;
export const GAME_SIDE_QUESTS = 100; // side quests one game holds, withdrawn ones included
const PREVIEW_MS = 10 * 60_000;
type Row = { quest_id: string; content: string; chapter_id: string | null; created: number; withdrawn: number; closed: number };
export type GamePreview = { preview_id: string; game_id: string; content: string; source_version: number; base_version: number; expires: number };

// The side quests a teacher adds to a game from the library. They are on the game's quest board until closed or
// withdrawn, whether or not a mission is running and whichever chapter it is on; a story quest, written for one
// mission chapter, only while that chapter runs. Who finished which is kept here too, for the whole game.
export class GameSideQuests {
    private sql: SqlStorage;
    constructor(sql: SqlStorage) { this.sql = sql; }
    initialize(): void {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS game_side_quests (
            game_id TEXT NOT NULL, quest_id TEXT NOT NULL, content TEXT NOT NULL, chapter_id TEXT, source_version INTEGER NOT NULL,
            created INTEGER NOT NULL, withdrawn INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (game_id, quest_id));
            CREATE TABLE IF NOT EXISTS side_quest_done (
            game_id TEXT NOT NULL, student_key TEXT NOT NULL, quest_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (game_id, student_key, quest_id));
            CREATE TABLE IF NOT EXISTS game_side_quest_previews (
            preview_id TEXT PRIMARY KEY, teacher_token TEXT NOT NULL, game_id TEXT NOT NULL, content TEXT NOT NULL,
            source_version INTEGER NOT NULL, base_version INTEGER NOT NULL, expires INTEGER NOT NULL);`);
    }

    private rows(game: string): Row[] {
        return this.sql.exec<Row>('SELECT quest_id, content, chapter_id, created, withdrawn, closed FROM game_side_quests WHERE game_id = ? ORDER BY created, rowid', game).toArray();
    }
    // Every quest the game was given, for the library page: withdrawn and closed ones too, and whether anyone started it.
    added(game: string): { id: string; text: string; chapter: string | null; closed: boolean; withdrawn: boolean; started: boolean }[] {
        return this.rows(game).map(row => ({ id: row.quest_id, text: (JSON.parse(row.content) as Objective).text, chapter: row.chapter_id, closed: !!row.closed, withdrawn: !!row.withdrawn,
            started: this.started(game, row.quest_id) }));
    }
    // Changes whenever a quest is added, closed or withdrawn: a review only holds for the board it was made for.
    version(game: string): number {
        return this.sql.exec<{ n: number }>('SELECT COUNT(*) + COALESCE(SUM(withdrawn), 0) + COALESCE(SUM(closed), 0) AS n FROM game_side_quests WHERE game_id = ?', game).one().n;
    }
    // On the board now: every quest not withdrawn; a story quest only while its chapter runs (`chapterId`).
    objectives(game: string, chapterId: string | null): Objective[] {
        return this.rows(game).filter(row => !row.withdrawn && (!row.chapter_id || row.chapter_id === chapterId)).map(row => JSON.parse(row.content) as Objective);
    }
    has(game: string, quest: string): boolean { return this.sql.exec('SELECT 1 FROM game_side_quests WHERE game_id = ? AND quest_id = ?', game, quest).toArray().length > 0; }
    closedIds(game: string): Set<string> { return new Set(this.rows(game).filter(row => row.closed && !row.withdrawn).map(row => row.quest_id)); }
    started(game: string, quest: string): boolean { return this.sql.exec('SELECT 1 FROM quest_assignments WHERE game_id = ? AND objective = ? LIMIT 1', game, quest).toArray().length > 0; }

    done(game: string, student: string): string[] {
        return this.sql.exec<{ quest_id: string }>('SELECT quest_id FROM side_quest_done WHERE game_id = ? AND student_key = ? ORDER BY at, quest_id', game, student).toArray().map(row => row.quest_id);
    }
    finish(game: string, student: string, quest: string): void {
        this.sql.exec('INSERT OR IGNORE INTO side_quest_done (game_id, student_key, quest_id, at) VALUES (?, ?, ?, ?)', game, student, quest, Date.now());
    }

    // A teacher's selection from the library, held for review before it reaches the board.
    preview(token: string, game: string, quests: { objective: Objective; chapterId: string | null }[], sourceVersion: number): { id: string; expires: number } | { error: string; status: number } {
        if (quests.some(({ objective }) => this.has(game, objective.id))) return { error: 'A side quest joins a game once: that one is already in this game.', status: 400 };
        if (this.rows(game).length + quests.length > GAME_SIDE_QUESTS) return { error: `A game holds at most ${GAME_SIDE_QUESTS} side quests.`, status: 400 };
        this.sql.exec('DELETE FROM game_side_quest_previews WHERE expires <= ?', Date.now());
        if (this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM game_side_quest_previews WHERE game_id = ?', game).one().n >= 10) return { error: 'Too many reviews are open. Add or cancel one first.', status: 409 };
        const id = crypto.randomUUID(); const expires = Date.now() + PREVIEW_MS;
        this.sql.exec('INSERT INTO game_side_quest_previews (preview_id, teacher_token, game_id, content, source_version, base_version, expires) VALUES (?, ?, ?, ?, ?, ?, ?)',
            id, token, game, JSON.stringify(quests), sourceVersion, this.version(game), expires);
        return { id, expires };
    }
    pending(token: string, id: string): GamePreview | undefined {
        return this.sql.exec<GamePreview>('SELECT preview_id, game_id, content, source_version, base_version, expires FROM game_side_quest_previews WHERE preview_id = ? AND teacher_token = ?', id, token).toArray()[0];
    }
    cancel(token: string, id: string): void { this.sql.exec('DELETE FROM game_side_quest_previews WHERE preview_id = ? AND teacher_token = ?', id, token); }
    release(preview: GamePreview, sourceVersion: number): string[] {
        const quests: { objective: Objective; chapterId: string | null }[] = JSON.parse(preview.content);
        const now = Date.now();
        quests.forEach(({ objective, chapterId }, n) => this.sql.exec('INSERT OR IGNORE INTO game_side_quests (game_id, quest_id, content, chapter_id, source_version, created) VALUES (?, ?, ?, ?, ?, ?)',
            preview.game_id, objective.id, JSON.stringify(objective), chapterId, sourceVersion, now + n));
        this.sql.exec('DELETE FROM game_side_quest_previews WHERE preview_id = ?', preview.preview_id);
        return quests.map(({ objective }) => objective.id);
    }
    // Closed: nobody new takes it; those doing it can finish.
    close(game: string, quest: string): string | null {
        const row = this.rows(game).find(item => item.quest_id === quest && !item.withdrawn);
        if (!row) return 'That side quest is not in this game.';
        if (row.closed) return 'That quest is already closed.';
        this.sql.exec('UPDATE game_side_quests SET closed = 1 WHERE game_id = ? AND quest_id = ?', game, quest);
        return null;
    }
    // Withdrawn: off the board, while nobody has started it.
    withdraw(game: string, quest: string): string | null {
        const row = this.rows(game).find(item => item.quest_id === quest && !item.withdrawn);
        if (!row) return 'That side quest is not in this game.';
        if (this.started(game, quest)) return 'A student already started this quest; close it instead.';
        this.sql.exec('UPDATE game_side_quests SET withdrawn = 1 WHERE game_id = ? AND quest_id = ?', game, quest);
        return null;
    }
    clear(game: string): void {
        for (const table of ['game_side_quests', 'side_quest_done', 'game_side_quest_previews']) this.sql.exec(`DELETE FROM ${table} WHERE game_id = ?`, game);
    }

    // Side quests added before they belonged to the game went into a mission chapter. They move here, with who finished
    // them and the pairs and groups doing them, so nothing a class started is lost; the mission keeps only its own.
    // Once moved they are no longer in the mission's additions, so this does nothing the next time.
    adoptMissionReleases(chapterOf: (quest: string) => string | null): void {
        const rows = this.sql.exec<{ game_id: string; objective_id: string; chapter_id: string; content: string; source_version: number; created: number; withdrawn: number; closed: number }>(
            'SELECT game_id, objective_id, chapter_id, content, source_version, created, withdrawn, closed FROM mission_live_quests WHERE source_id = ? ORDER BY created, rowid', SIDE_QUEST_SOURCE).toArray();
        const games = new Set<string>();
        for (const row of rows) {
            games.add(row.game_id);
            this.sql.exec(`INSERT OR IGNORE INTO game_side_quests (game_id, quest_id, content, chapter_id, source_version, created, withdrawn, closed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                row.game_id, row.objective_id, row.content, chapterOf(row.objective_id) ? row.chapter_id : null, row.source_version, row.created, row.withdrawn, row.closed);
            for (const player of this.sql.exec<{ student_key: string; done: string }>('SELECT student_key, done FROM campaign_players WHERE game_id = ?', row.game_id).toArray()) {
                if ((JSON.parse(player.done) as string[]).includes(row.objective_id)) this.finish(row.game_id, player.student_key, row.objective_id);
            }
            this.sql.exec('UPDATE quest_assignments SET chapter = ? WHERE game_id = ? AND objective = ?', GAME_CHAPTER, row.game_id, row.objective_id);
            this.sql.exec('UPDATE side_quest_groups SET chapter = ? WHERE game_id = ? AND objective = ?', GAME_CHAPTER, row.game_id, row.objective_id);
            this.sql.exec('DELETE FROM mission_live_quests WHERE game_id = ? AND objective_id = ?', row.game_id, row.objective_id);
        }
        for (const game of games) this.sql.exec('UPDATE campaigns SET live_version = live_version + 1 WHERE game_id = ?', game);
    }
}
