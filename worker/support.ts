import type { AttemptPage, AttemptSource, HelpAlert, HelpStatus, HelpTopic, MessageAttempt, StudentSupport } from '../shared/support.ts';

const TEXT_LIMIT = 1000;
const SIGNAL_WINDOW = 5 * 60_000;
const SIGNAL_THRESHOLD = 3;

type BeginAttempt = {
    game: string; studentKey: string; name: string; id?: string; text: string; source: AttemptSource;
    target?: string | null; objective?: string | null;
};
type AlertRow = {
    id: string; game_id: string; student_key: string; name: string; topic: HelpTopic;
    kind: 'requested' | 'suggested'; status: HelpStatus; note: string; ts: number; updated: number; resolved_signal: number;
};
type SignalRow = { reason: string; text: string; timestamp: number };
type Cursor = { timestamp: number; id: string; game: string; studentKey: string | null };

// The audit is independent of bounded chat history. It records submitted text before
// filters run and keeps rejected attempts, private assistance, and teacher decisions.
export class StudentAssistance {
    private sql: SqlStorage;
    constructor(sql: SqlStorage) { this.sql = sql; }

    initialize(): void {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS assistance_ai_students (
            session_id TEXT NOT NULL, game_id TEXT NOT NULL, student_key TEXT NOT NULL,
            used INTEGER NOT NULL DEFAULT 0, pending TEXT, pending_until INTEGER NOT NULL DEFAULT 0,
            tip TEXT, last_attempt TEXT, last_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(session_id, student_key));`);
        this.sql.exec(`CREATE TABLE IF NOT EXISTS assistance_attempts (
            id TEXT PRIMARY KEY, game_id TEXT NOT NULL, student_key TEXT NOT NULL, sender TEXT NOT NULL,
            client_id TEXT, text TEXT NOT NULL, ts INTEGER NOT NULL, source TEXT NOT NULL,
            status TEXT NOT NULL, reason TEXT, target TEXT, objective TEXT, chat_id TEXT, correction TEXT, final_text TEXT,
            UNIQUE(game_id, student_key, client_id));
            CREATE INDEX IF NOT EXISTS assistance_attempts_page ON assistance_attempts(game_id, ts DESC, id DESC);
            CREATE INDEX IF NOT EXISTS assistance_attempts_student ON assistance_attempts(game_id, student_key, ts DESC, id DESC);
            CREATE INDEX IF NOT EXISTS assistance_attempts_chat ON assistance_attempts(chat_id);
            CREATE TABLE IF NOT EXISTS assistance_signals (
                id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, student_key TEXT NOT NULL,
                name TEXT NOT NULL, topic TEXT NOT NULL, reason TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS assistance_signals_student ON assistance_signals(game_id, student_key, ts);
            CREATE TABLE IF NOT EXISTS assistance_help (
                id TEXT PRIMARY KEY, game_id TEXT NOT NULL, student_key TEXT NOT NULL, name TEXT NOT NULL,
                topic TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL,
                ts INTEGER NOT NULL, updated INTEGER NOT NULL, resolved_signal INTEGER NOT NULL DEFAULT 0);
            CREATE INDEX IF NOT EXISTS assistance_help_student ON assistance_help(game_id, student_key, updated);
            CREATE TABLE IF NOT EXISTS assistance_teacher_messages (
                id TEXT PRIMARY KEY, game_id TEXT NOT NULL, student_key TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS assistance_teacher_messages_student ON assistance_teacher_messages(game_id, student_key, ts);`);
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('assistance_attempts')").toArray().some(row => row.name === 'final_text')) {
            this.sql.exec('ALTER TABLE assistance_attempts ADD COLUMN final_text TEXT');
        }
        this.backfillChat();
    }

    // A supplied client id belongs to one student in one game. Never trust it as a
    // database id: another student may deliberately reuse the same client value.
    owned(game: string, studentKey: string, clientId: string): string | null {
        return this.sql.exec<{ id: string }>('SELECT id FROM assistance_attempts WHERE game_id = ? AND student_key = ? AND client_id = ?',
            game, studentKey, clientId).toArray()[0]?.id ?? null;
    }

    begin(attempt: BeginAttempt): string {
        if (attempt.id !== undefined) {
            const existing = this.owned(attempt.game, attempt.studentKey, attempt.id);
            if (existing) return existing;
        }
        const id = crypto.randomUUID();
        this.sql.exec(`INSERT INTO assistance_attempts
            (id, game_id, student_key, sender, client_id, text, ts, source, status, target, objective)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)`,
            id, attempt.game, attempt.studentKey, attempt.name, attempt.id ?? null, attempt.text.slice(0, TEXT_LIMIT),
            Date.now(), attempt.source, attempt.target ?? null, attempt.objective ?? null);
        return id;
    }

    get(id: string): MessageAttempt | null {
        return this.sql.exec<MessageAttempt>(`SELECT id, student_key AS studentKey, sender, text, ts AS timestamp,
            source, status, reason, target, objective, chat_id AS chatId, correction, final_text AS finalText
            FROM assistance_attempts WHERE id = ?`, id).toArray()[0] ?? null;
    }

    submitted(id: string, text: string): void {
        this.sql.exec('UPDATE assistance_attempts SET final_text = ? WHERE id = ?', text.slice(0, TEXT_LIMIT), id);
    }

    update(id: string, status: string, reason?: string | null, correction?: string | null, chatId?: string | null): void {
        this.sql.exec(`UPDATE assistance_attempts SET status = ?, reason = ?, correction = ?, chat_id = COALESCE(?, chat_id) WHERE id = ?`,
            status, reason?.slice(0, TEXT_LIMIT) ?? null, correction?.slice(0, TEXT_LIMIT) ?? null, chatId ?? null, id);
    }

    chatStatus(chatId: string, status: string): void {
        this.sql.exec('UPDATE assistance_attempts SET status = ? WHERE chat_id = ?', status, chatId);
    }

    signal(game: string, studentKey: string, name: string, reason: string, text: string, topic: HelpTopic = 'writing'): HelpAlert | null {
        const now = Date.now();
        this.sql.exec('INSERT INTO assistance_signals (game_id, student_key, name, topic, reason, text, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
            game, studentKey, name, topic, reason.slice(0, TEXT_LIMIT), text.slice(0, TEXT_LIMIT), now);
        const after = this.resolvedSignal(game, studentKey);
        const count = this.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM assistance_signals
            WHERE game_id = ? AND student_key = ? AND topic = ? AND ts >= ? AND ts <= ? AND id > ?`,
            game, studentKey, topic, now - SIGNAL_WINDOW, now, after).toArray()[0].count;
        if (count < SIGNAL_THRESHOLD) return null;
        const existing = this.unresolved(game, studentKey);
        if (existing) return this.alert(existing, name);
        const id = crypto.randomUUID();
        this.sql.exec(`INSERT INTO assistance_help (id, game_id, student_key, name, topic, kind, status, note, ts, updated)
            VALUES (?, ?, ?, ?, ?, 'suggested', 'open', ?, ?, ?)`,
            id, game, studentKey, name, topic, `${count} recent attempts may need your help.`, now, now);
        return this.alert(this.help(game, id)!, name);
    }

    request(game: string, studentKey: string, name: string, topic: HelpTopic, note: string, log = true): StudentSupport {
        const text = note.slice(0, TEXT_LIMIT);
        if (log) {
            const attempt = this.begin({ game, studentKey, name, text: note, source: 'help', objective: topic });
            this.update(attempt, 'requested');
        }
        const now = Date.now();
        const existing = this.unresolved(game, studentKey);
        if (existing) {
            this.sql.exec(`UPDATE assistance_help SET name = ?, topic = ?, kind = 'requested', note = ?, updated = ? WHERE id = ?`,
                name, topic, text, now, existing.id);
        } else {
            this.sql.exec(`INSERT INTO assistance_help (id, game_id, student_key, name, topic, kind, status, note, ts, updated)
                VALUES (?, ?, ?, ?, ?, 'requested', 'open', ?, ?, ?)`,
                crypto.randomUUID(), game, studentKey, name, topic, text, now, now);
        }
        return this.studentState(game, studentKey);
    }

    alerts(game: string, names: ReadonlyMap<string, string> | Record<string, string>): HelpAlert[] {
        return this.sql.exec<AlertRow>(`SELECT * FROM assistance_help WHERE game_id = ? AND status != 'resolved' ORDER BY updated DESC, id DESC`, game)
            .toArray().map(row => this.alert(row, names instanceof Map ? names.get(row.student_key) : (names as Record<string, string>)[row.student_key]));
    }

    helpStatus(game: string, id: string, status: HelpStatus): boolean {
        const existing = this.help(game, id);
        if (!existing || existing.status === 'resolved' || !['open', 'acknowledged', 'resolved'].includes(status)) return false;
        const lastSignal = status === 'resolved'
            ? this.sql.exec<{ last: number }>('SELECT COALESCE(MAX(id), 0) AS last FROM assistance_signals WHERE game_id = ? AND student_key = ?',
                game, existing.student_key).toArray()[0].last : existing.resolved_signal;
        this.sql.exec('UPDATE assistance_help SET status = ?, updated = ?, resolved_signal = ? WHERE game_id = ? AND id = ?',
            status, Date.now(), lastSignal, game, id);
        return true;
    }

    teacherMessage(game: string, studentKey: string, text: string): StudentSupport {
        const id = this.begin({ game, studentKey, name: 'Teacher', source: 'teacher', text, target: studentKey });
        this.update(id, 'sent');
        this.sql.exec('INSERT INTO assistance_teacher_messages (id, game_id, student_key, text, ts) VALUES (?, ?, ?, ?, ?)',
            id, game, studentKey, text.slice(0, TEXT_LIMIT), Date.now());
        return this.studentState(game, studentKey);
    }

    studentState(game: string, studentKey: string): StudentSupport {
        const request = this.sql.exec<{ id: string; topic: HelpTopic; status: HelpStatus }>(`SELECT id, topic, status FROM assistance_help
            WHERE game_id = ? AND student_key = ? AND kind = 'requested'
            ORDER BY CASE WHEN status = 'resolved' THEN 1 ELSE 0 END, updated DESC, id DESC LIMIT 1`, game, studentKey).toArray()[0] ?? null;
        const messages = this.sql.exec<{ id: string; text: string; timestamp: number }>(`SELECT id, text, ts AS timestamp FROM assistance_teacher_messages
            WHERE game_id = ? AND student_key = ? ORDER BY ts DESC, id DESC LIMIT 50`, game, studentKey).toArray().reverse();
        return { request, messages };
    }

    joinSession(session: string, game: string, student: string): void {
        this.sql.exec('INSERT OR IGNORE INTO assistance_ai_students (session_id, game_id, student_key) VALUES (?, ?, ?)', session, game, student);
    }

    aiState(session: string, student: string, enabled: boolean, now = Date.now()): NonNullable<StudentSupport['ai']> {
        const row = this.sql.exec<{ used: number; pending: string | null; pending_until: number; tip: string | null; last_attempt: string | null }>(
            'SELECT * FROM assistance_ai_students WHERE session_id = ? AND student_key = ?', session, student).toArray()[0];
        return { session, available: enabled && !row?.used, used: !!row?.used,
            pending: !!row?.pending && row.pending_until > now, tip: row?.tip ?? null, resultId: row?.last_attempt ?? null };
    }

    reserveAi(session: string, student: string, attempt: string, now = Date.now()): boolean {
        return this.sql.exec(`UPDATE assistance_ai_students SET pending = ?, pending_until = ?, last_attempt = ?, last_at = ?
            WHERE session_id = ? AND student_key = ? AND used = 0 AND pending_until <= ?
            AND (last_attempt IS NULL OR (last_attempt != ? AND last_at <= ?)) RETURNING student_key`,
            attempt, now + 6000, attempt, now, session, student, now, attempt, now - 30_000).toArray().length === 1;
    }

    finishAi(session: string, student: string, attempt: string, tip: string | null): boolean {
        return this.sql.exec(`UPDATE assistance_ai_students SET used = ?, tip = ?, pending = NULL, pending_until = 0
            WHERE session_id = ? AND student_key = ? AND pending = ? RETURNING student_key`,
            tip ? 1 : 0, tip, session, student, attempt).toArray().length === 1;
    }

    aiCount(session: string): { used: number; students: number } {
        return this.sql.exec<{ used: number; students: number }>(
            'SELECT COALESCE(SUM(used), 0) AS used, COUNT(*) AS students FROM assistance_ai_students WHERE session_id = ?', session).toArray()[0];
    }

    page(game: string, studentKey?: string, cursor?: string | null, limit = 50): AttemptPage {
        const count = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 50;
        const where = ['game_id = ?'];
        const args: (string | number)[] = [game];
        if (studentKey !== undefined) { where.push('student_key = ?'); args.push(studentKey); }
        if (cursor) {
            const position = this.cursor(cursor, game, studentKey);
            where.push('(ts < ? OR (ts = ? AND id < ?))'); args.push(position.timestamp, position.timestamp, position.id);
        }
        const rows = this.sql.exec<AttemptPage['attempts'][number]>(`SELECT id, student_key AS studentKey, sender, text, ts AS timestamp,
            source, status, reason, target, objective, chat_id AS chatId, correction, final_text AS finalText FROM assistance_attempts
            WHERE ${where.join(' AND ')} ORDER BY ts DESC, id DESC LIMIT ?`, ...args, count + 1).toArray();
        const attempts = rows.slice(0, count);
        const last = attempts.at(-1);
        const next = rows.length > count && last ? btoa(encodeURIComponent(JSON.stringify({ timestamp: last.timestamp, id: last.id, game, studentKey: studentKey ?? null })))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null;
        return { attempts, next };
    }

    // Only retained historical chat can be migrated. Earlier pruned messages cannot
    // be recovered. Linked attempts prevent duplicates when a room restarts.
    backfillChat(): void {
        if (!this.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat'").toArray().length) return;
        const columns = new Set(this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('chat')").toArray().map(row => row.name));
        if (!columns.has('game_id')) return;
        const target = columns.has('target_key') ? 'chat.target_key' : 'NULL';
        const reason = columns.has('flag') && columns.has('note') ? 'COALESCE(chat.flag, chat.note)' : columns.has('flag') ? 'chat.flag' : columns.has('note') ? 'chat.note' : 'NULL';
        this.sql.exec(`INSERT OR IGNORE INTO assistance_attempts
            (id, game_id, student_key, sender, text, ts, source, status, reason, target, chat_id)
            SELECT 'legacy-chat:' || chat.id, chat.game_id, chat.student_key, chat.sender, substr(chat.text, 1, ${TEXT_LIMIT}),
                chat.ts, 'chat', chat.status, ${reason}, ${target}, chat.id FROM chat
            WHERE chat.game_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assistance_attempts WHERE chat_id = chat.id)`);
    }

    clear(game: string): void {
        for (const table of ['assistance_attempts', 'assistance_signals', 'assistance_help', 'assistance_teacher_messages', 'assistance_ai_students']) {
            this.sql.exec(`DELETE FROM ${table} WHERE game_id = ?`, game);
        }
    }

    private help(game: string, id: string): AlertRow | undefined {
        return this.sql.exec<AlertRow>('SELECT * FROM assistance_help WHERE game_id = ? AND id = ?', game, id).toArray()[0];
    }

    private unresolved(game: string, studentKey: string): AlertRow | undefined {
        return this.sql.exec<AlertRow>(`SELECT * FROM assistance_help WHERE game_id = ? AND student_key = ? AND status != 'resolved'
            ORDER BY updated DESC, id DESC LIMIT 1`, game, studentKey).toArray()[0];
    }

    private resolvedSignal(game: string, studentKey: string): number {
        return this.sql.exec<{ last: number }>(`SELECT COALESCE(MAX(resolved_signal), 0) AS last FROM assistance_help
            WHERE game_id = ? AND student_key = ? AND status = 'resolved'`, game, studentKey).toArray()[0].last;
    }

    private alert(row: AlertRow, name?: string): HelpAlert {
        const evidence = this.sql.exec<SignalRow>(`SELECT reason, text, ts AS timestamp FROM assistance_signals
            WHERE game_id = ? AND student_key = ? AND ts >= ? AND id > ? ORDER BY ts DESC, id DESC LIMIT 3`,
            row.game_id, row.student_key, row.ts - SIGNAL_WINDOW, this.resolvedSignal(row.game_id, row.student_key)).toArray().reverse();
        const latestHelp = this.sql.exec<{ status: string; reason: string | null }>(`SELECT status, reason FROM assistance_attempts
            WHERE game_id = ? AND student_key = ? AND source = 'help' ORDER BY ts DESC, rowid DESC LIMIT 1`,
            row.game_id, row.student_key).toArray()[0];
        const ai = latestHelp?.status === 'ai-help-pending' ? { pending: true, tip: null }
            : latestHelp?.status === 'ai-help' ? { pending: false, tip: latestHelp.reason } : undefined;
        return { id: row.id, studentKey: row.student_key, name: name ?? row.name, topic: row.topic, kind: row.kind,
            status: row.status, note: row.note, timestamp: row.ts, updated: row.updated, evidence, ...(ai ? { ai } : {}) };
    }

    private cursor(value: string, game: string, studentKey?: string): Cursor {
        try {
            if (value.length > 1024) throw new Error();
            const decoded: unknown = JSON.parse(decodeURIComponent(atob(value.replace(/-/g, '+').replace(/_/g, '/'))));
            if (typeof decoded !== 'object' || decoded === null) throw new Error();
            const result = decoded as Partial<Cursor>;
            if (!Number.isSafeInteger(result.timestamp) || result.timestamp! < 0 || typeof result.id !== 'string' || result.id.length > 256
                || result.game !== game || result.studentKey !== (studentKey ?? null)) throw new Error();
            return { timestamp: result.timestamp!, id: result.id, game, studentKey: studentKey ?? null };
        } catch { throw new Error('Invalid audit cursor.'); }
    }
}
