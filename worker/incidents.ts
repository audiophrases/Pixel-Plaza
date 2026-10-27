// Safety incidents: a slur, a threat, sexual content, bullying or self-harm in something a student tried to
// send, whether or not it was sent. The teacher is told at the top of the class view; nothing else happens to
// the student. One open incident per student and kind of harm, counting repeats and keeping the latest words.
// No Workers-only APIs, so the unit tests can run it on node's SQLite.
import type { Harm, Incident } from '../shared/safety.ts';

type Row = { id: string; game_id: string; student_key: string; name: string; harm: Harm; texts: string; count: number; first_ts: number; last_ts: number };
export type { Incident };

const KEEP_TEXTS = 3;

export class SafetyIncidents {
    private sql: SqlStorage;
    constructor(sql: SqlStorage) { this.sql = sql; }

    initialize(): void {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS safety_incidents (id TEXT PRIMARY KEY, game_id TEXT NOT NULL, student_key TEXT NOT NULL,
            name TEXT NOT NULL, harm TEXT NOT NULL, texts TEXT NOT NULL, count INTEGER NOT NULL, first_ts INTEGER NOT NULL, last_ts INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'open');
            CREATE INDEX IF NOT EXISTS safety_incidents_open ON safety_incidents (game_id, status);
            CREATE TABLE IF NOT EXISTS safety_attempts (attempt_id TEXT PRIMARY KEY, ts INTEGER NOT NULL);`);
    }

    // Counts one attempt, once: the same attempt can meet the checks more than once (the hint, then sending).
    // True when it was new.
    record(game: string, studentKey: string, name: string, harm: Harm, text: string, attempt?: string | null, now = Date.now()): boolean {
        if (attempt && !this.sql.exec('INSERT OR IGNORE INTO safety_attempts (attempt_id, ts) VALUES (?, ?) RETURNING 1', attempt, now).toArray().length) return false;
        const words = text.trim().slice(0, 200);
        const open = this.sql.exec<Row>(`SELECT * FROM safety_incidents WHERE game_id = ? AND student_key = ? AND harm = ? AND status = 'open'`,
            game, studentKey, harm).toArray()[0];
        if (open) {
            const texts = [words, ...(JSON.parse(open.texts) as string[]).filter(item => item !== words)].slice(0, KEEP_TEXTS);
            this.sql.exec('UPDATE safety_incidents SET count = count + 1, texts = ?, last_ts = ?, name = ? WHERE id = ?', JSON.stringify(texts), now, name, open.id);
        } else {
            this.sql.exec(`INSERT INTO safety_incidents (id, game_id, student_key, name, harm, texts, count, first_ts, last_ts) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
                crypto.randomUUID(), game, studentKey, name, harm, JSON.stringify([words]), now, now);
        }
        return true;
    }

    // Open incidents in a game, the latest first, with the names the plaza shows now.
    open(game: string, names: ReadonlyMap<string, string>): Incident[] {
        return this.sql.exec<Row>(`SELECT * FROM safety_incidents WHERE game_id = ? AND status = 'open' ORDER BY last_ts DESC`, game).toArray()
            .map(row => ({ id: row.id, studentKey: row.student_key, name: names.get(row.student_key) ?? row.name, harm: row.harm,
                texts: JSON.parse(row.texts) as string[], count: row.count, firstTs: row.first_ts, lastTs: row.last_ts }));
    }

    // The teacher has seen it: off the list. A new attempt opens a new one.
    seen(game: string, id: string): boolean {
        return this.sql.exec(`UPDATE safety_incidents SET status = 'seen' WHERE game_id = ? AND id = ? AND status = 'open' RETURNING 1`, game, id).toArray().length > 0;
    }

    forget(game: string): void {
        this.sql.exec('DELETE FROM safety_incidents WHERE game_id = ?', game);
    }
}
