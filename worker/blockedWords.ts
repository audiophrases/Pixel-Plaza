// What a teacher blocked in each lesson of a game: words and phrases no message may say until the class closes,
// how many messages each one took down and stopped, from whom, and the repeats the teacher let through.
// No Workers-only APIs, so the unit tests run it on node's SQLite.
import { blockable, type Term } from '../shared/blockedWords.ts';

const MAX_BLOCKED = 50; // in one lesson

export type BlockedView = { key: string; words: string; removed: number; stopped: number; by: { studentKey: string; count: number }[] };

export class BlockedWords {
    private sql: SqlStorage;
    constructor(sql: SqlStorage) { this.sql = sql; }

    initialize(): void {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS blocked_words (game_id TEXT NOT NULL, lesson TEXT NOT NULL, key TEXT NOT NULL, words TEXT NOT NULL,
                status TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL, PRIMARY KEY (game_id, lesson, key));
            CREATE TABLE IF NOT EXISTS blocked_tries (game_id TEXT NOT NULL, lesson TEXT NOT NULL, key TEXT NOT NULL, student_key TEXT NOT NULL,
                count INTEGER NOT NULL, PRIMARY KEY (game_id, lesson, key, student_key));`);
    }

    // What no message may say in this lesson, in the order it was blocked.
    terms(game: string, lesson: string): Term[] {
        return this.sql.exec<Term>("SELECT key, words FROM blocked_words WHERE game_id = ? AND lesson = ? AND status = 'blocked' ORDER BY ts, rowid",
            game, lesson).toArray().map(row => ({ key: row.key, words: row.words }));
    }

    // Blocks each of `words` for the lesson. Returns the terms that were not blocked yet, or what is wrong.
    block(game: string, lesson: string, words: readonly string[], now = Date.now()): Term[] | string {
        const terms = words.map(blockable).filter((term): term is Term => term !== null);
        if (!terms.length || terms.length !== words.length) return 'Each word or phrase needs at least two letters, and 60 characters at most.';
        const blocked = new Set(this.terms(game, lesson).map(term => term.key));
        const fresh = terms.filter(term => !blocked.has(term.key) && !!blocked.add(term.key)); // each once, as first typed
        if (blocked.size > MAX_BLOCKED) return `Up to ${MAX_BLOCKED} words or phrases in one lesson.`;
        // Only this lesson and the last one with blocked words are kept: that one, to block again.
        this.sql.exec(`DELETE FROM blocked_words WHERE game_id = ? AND lesson != ? AND lesson != COALESCE((SELECT lesson FROM blocked_words
            WHERE game_id = ? AND lesson != ? AND status = 'blocked' ORDER BY ts DESC LIMIT 1), '')`, game, lesson, game, lesson);
        this.sql.exec('DELETE FROM blocked_tries WHERE game_id = ? AND lesson != ?', game, lesson);
        for (const term of fresh) {
            this.sql.exec(`INSERT INTO blocked_words (game_id, lesson, key, words, status, ts) VALUES (?, ?, ?, ?, 'blocked', ?)
                ON CONFLICT (game_id, lesson, key) DO UPDATE SET words = excluded.words, status = 'blocked', ts = excluded.ts`, game, lesson, term.key, term.words, now);
        }
        return fresh;
    }

    unblock(game: string, lesson: string, key: string): boolean {
        return this.sql.exec("DELETE FROM blocked_words WHERE game_id = ? AND lesson = ? AND key = ? AND status = 'blocked' RETURNING 1", game, lesson, key).toArray().length > 0;
    }

    // A repeat the teacher chose to leave alone: not offered again this lesson.
    letThrough(game: string, lesson: string, key: string, words: string, now = Date.now()): void {
        this.sql.exec(`INSERT INTO blocked_words (game_id, lesson, key, words, status, ts) VALUES (?, ?, ?, ?, 'let-through', ?)
            ON CONFLICT (game_id, lesson, key) DO NOTHING`, game, lesson, key, words.slice(0, 60), now);
    }
    letThroughKeys(game: string, lesson: string): Set<string> {
        return new Set(this.sql.exec<{ key: string }>("SELECT key FROM blocked_words WHERE game_id = ? AND lesson = ? AND status = 'let-through'", game, lesson)
            .toArray().map(row => row.key));
    }

    // A message a student tried to send that said the term.
    tried(game: string, lesson: string, key: string, studentKey: string): void {
        this.sql.exec(`INSERT INTO blocked_tries (game_id, lesson, key, student_key, count) VALUES (?, ?, ?, ?, 1)
            ON CONFLICT (game_id, lesson, key, student_key) DO UPDATE SET count = count + 1`, game, lesson, key, studentKey);
    }

    // Messages already posted or waiting that came down when the term was blocked.
    removed(game: string, lesson: string, key: string, count: number): void {
        this.sql.exec('UPDATE blocked_words SET removed = removed + ? WHERE game_id = ? AND lesson = ? AND key = ?', count, game, lesson, key);
    }

    // For the teacher: each blocked term, what it took down and stopped, and who tried most.
    view(game: string, lesson: string): BlockedView[] {
        const tries = this.sql.exec<{ key: string; student_key: string; count: number }>(
            'SELECT key, student_key, count FROM blocked_tries WHERE game_id = ? AND lesson = ? ORDER BY count DESC, student_key', game, lesson).toArray();
        return this.sql.exec<{ key: string; words: string; removed: number }>(
            "SELECT key, words, removed FROM blocked_words WHERE game_id = ? AND lesson = ? AND status = 'blocked' ORDER BY ts, rowid", game, lesson).toArray()
            .map(row => {
                const by = tries.filter(item => item.key === row.key).map(item => ({ studentKey: item.student_key, count: item.count }));
                return { key: row.key, words: row.words, removed: row.removed, stopped: by.reduce((sum, item) => sum + item.count, 0), by };
            });
    }

    // What was blocked in the game's last lesson with blocked words, and is not blocked now: to block again.
    before(game: string, lesson: string): string[] {
        const last = this.sql.exec<{ lesson: string }>("SELECT lesson FROM blocked_words WHERE game_id = ? AND lesson != ? AND status = 'blocked' ORDER BY ts DESC LIMIT 1",
            game, lesson).toArray()[0];
        if (!last) return [];
        const now = new Set(this.terms(game, lesson).map(term => term.key));
        return this.terms(game, last.lesson).filter(term => !now.has(term.key)).map(term => term.words);
    }

    forget(game: string): void {
        this.sql.exec('DELETE FROM blocked_words WHERE game_id = ?', game);
        this.sql.exec('DELETE FROM blocked_tries WHERE game_id = ?', game);
    }
}
