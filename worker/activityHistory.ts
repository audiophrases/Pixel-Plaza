import type { ActivityHistoryView, ActivityPlay, PlayStats } from '../shared/activityHistory.ts';
import { assignedWarmupTasks } from '../shared/activityHistory.ts';
import { defaultWarmup, type WarmupDefinition } from '../shared/warmupConfig.ts';
import { isWarmupKind } from '../shared/warmupKinds.ts';

type PlayRow = { type: ActivityPlay['type']; activity_id: string; title: string; played_at: number | null; recovered: number };
export class ActivityHistory {
    private sql: SqlStorage;
    constructor(sql: SqlStorage) { this.sql = sql; }
    initialize(): void {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS activity_plays (
            game_id TEXT NOT NULL, type TEXT NOT NULL, activity_id TEXT NOT NULL, run_id TEXT NOT NULL,
            title TEXT NOT NULL, played_at INTEGER, recovered INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (game_id, type, activity_id, run_id));
            CREATE INDEX IF NOT EXISTS activity_plays_recent ON activity_plays(game_id, played_at DESC);
            CREATE TABLE IF NOT EXISTS activity_play_tasks (
                game_id TEXT NOT NULL, kind TEXT NOT NULL, run_id TEXT NOT NULL, task_id TEXT NOT NULL,
                PRIMARY KEY (game_id, kind, run_id, task_id));
            CREATE TABLE IF NOT EXISTS activity_history_meta (key TEXT PRIMARY KEY);`);
    }
    record(game: string, type: ActivityPlay['type'], id: string, run: string, title: string, at: number | null = Date.now(), recovered = false): void {
        this.sql.exec(`INSERT OR IGNORE INTO activity_plays (game_id, type, activity_id, run_id, title, played_at, recovered)
            VALUES (?, ?, ?, ?, ?, ?, ?)`, game, type, id, run, title.slice(0, 160), at, recovered ? 1 : 0);
    }
    warmup(game: string, started: number, definition: WarmupDefinition, players: { fact: string; targets: string[] }[], recovered = false): void {
        const run = String(started);
        this.record(game, 'warmup', definition.kind, run, definition.title, started, recovered);
        for (const task of assignedWarmupTasks(definition, players)) this.sql.exec(
            'INSERT OR IGNORE INTO activity_play_tasks (game_id, kind, run_id, task_id) VALUES (?, ?, ?, ?)', game, definition.kind, run, task.id);
    }
    // Older versions retained assignments and only the most recent warm-up. Recover a known minimum once;
    // never invent earlier counts or let an already-used task appear as never played.
    recover(current?: { game: string; session: string; opened: number }): void {
        if (this.sql.exec("SELECT 1 FROM activity_history_meta WHERE key = 'recovered-v1'").toArray().length) return;
        const quests = this.sql.exec<{ game_id: string; objective: string; at: number | null; content: string | null }>(
            `SELECT a.game_id, a.objective, MIN(a.accepted) AS at, q.content FROM quest_assignments a
             LEFT JOIN game_side_quests q ON q.game_id = a.game_id AND q.quest_id = a.objective
             LEFT JOIN side_quest_groups g ON g.game_id = a.game_id AND g.objective = a.objective
                AND EXISTS (SELECT 1 FROM side_quest_members m WHERE m.group_id = g.group_id AND m.student_key = a.student_key)
             WHERE g.group_id IS NULL OR g.state <> 'open' GROUP BY a.game_id, a.objective`).toArray();
        for (const quest of quests) {
            let title = quest.objective;
            try { title = JSON.parse(quest.content ?? '{}').text || title; } catch { /* legacy title unavailable */ }
            const run = current && quest.game_id === current.game && quest.at !== null && quest.at >= current.opened ? current.session : 'recovered';
            this.record(quest.game_id, 'quest', quest.objective, run, title, quest.at, true);
        }
        for (const done of this.sql.exec<{ game_id: string; quest_id: string; content: string | null }>(
            `SELECT DISTINCT d.game_id, d.quest_id, q.content FROM side_quest_done d
             LEFT JOIN game_side_quests q ON q.game_id = d.game_id AND q.quest_id = d.quest_id`).toArray()) {
            if (quests.some(quest => quest.game_id === done.game_id && quest.objective === done.quest_id)) continue;
            let title = done.quest_id;
            try { title = JSON.parse(done.content ?? '{}').text || title; } catch { /* legacy title unavailable */ }
            this.record(done.game_id, 'quest', done.quest_id, 'recovered', title, null, true);
        }
        for (const row of this.sql.exec<{ game_id: string; started: number; kind: string; definition: string | null }>('SELECT game_id, started, kind, definition FROM warmups').toArray()) {
            const players = this.sql.exec<{ fact: string; targets: string }>('SELECT fact, targets FROM warmup_players WHERE game_id = ?', row.game_id).toArray();
            if (!players.length || !isWarmupKind(row.kind)) continue;
            try { this.warmup(row.game_id, row.started, row.definition ? JSON.parse(row.definition) : defaultWarmup(row.kind), players.map(player => ({ fact: player.fact, targets: JSON.parse(player.targets) })), true); }
            catch { /* an unreadable legacy definition cannot establish which tasks were assigned */ }
        }
        this.sql.exec("INSERT OR IGNORE INTO activity_history_meta (key) VALUES ('recovered-v1')");
    }
    view(game: ActivityHistoryView['game'], games: ActivityHistoryView['games']): ActivityHistoryView {
        const view: ActivityHistoryView = { game, games, quests: {}, warmups: {}, tasks: {}, recent: [] };
        if (!game) return view;
        for (const row of this.sql.exec<{ type: ActivityPlay['type']; activity_id: string; plays: number; lastPlayed: number | null; recovered: number }>(
            `SELECT type, activity_id, COUNT(*) AS plays, MAX(played_at) AS lastPlayed, MAX(recovered) AS recovered
             FROM activity_plays WHERE game_id = ? GROUP BY type, activity_id`, game.id).toArray()) {
            const stats: PlayStats = { plays: row.plays, lastPlayed: row.lastPlayed, recovered: !!row.recovered };
            if (row.type === 'quest') view.quests[row.activity_id] = stats;
            else if (isWarmupKind(row.activity_id)) view.warmups[row.activity_id] = stats;
        }
        for (const row of this.sql.exec<{ kind: string; task_id: string; plays: number; lastPlayed: number | null; recovered: number }>(
            `SELECT t.kind, t.task_id, COUNT(*) AS plays, MAX(p.played_at) AS lastPlayed, MAX(p.recovered) AS recovered
             FROM activity_play_tasks t JOIN activity_plays p ON p.game_id = t.game_id AND p.type = 'warmup' AND p.activity_id = t.kind AND p.run_id = t.run_id
             WHERE t.game_id = ? GROUP BY t.kind, t.task_id`, game.id).toArray()) {
            if (isWarmupKind(row.kind)) (view.tasks[row.kind] ??= {})[row.task_id] = { plays: row.plays, lastPlayed: row.lastPlayed, recovered: !!row.recovered };
        }
        view.recent = this.sql.exec<PlayRow>('SELECT type, activity_id, title, played_at, recovered FROM activity_plays WHERE game_id = ? ORDER BY played_at DESC, rowid DESC LIMIT 30', game.id).toArray()
            .map(row => ({ type: row.type, id: row.activity_id, title: row.title, playedAt: row.played_at, recovered: !!row.recovered }));
        return view;
    }
    warmupCounts(game: string): ActivityHistoryView['warmups'] {
        const counts: ActivityHistoryView['warmups'] = {};
        for (const row of this.sql.exec<{ activity_id: string; plays: number; lastPlayed: number | null; recovered: number }>(
            `SELECT activity_id, COUNT(*) AS plays, MAX(played_at) AS lastPlayed, MAX(recovered) AS recovered
             FROM activity_plays WHERE game_id = ? AND type = 'warmup' GROUP BY activity_id`, game).toArray()) {
            if (isWarmupKind(row.activity_id)) counts[row.activity_id] = { plays: row.plays, lastPlayed: row.lastPlayed, recovered: !!row.recovered };
        }
        return counts;
    }
    clear(game: string): void {
        this.sql.exec('DELETE FROM activity_play_tasks WHERE game_id = ?', game);
        this.sql.exec('DELETE FROM activity_plays WHERE game_id = ?', game);
    }
}
