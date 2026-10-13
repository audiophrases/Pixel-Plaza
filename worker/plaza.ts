import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index.ts';
import type { PinPlayStudent } from './pinplay.ts';
import { checkGrammar } from './grammar.ts';
import { moderate } from './moderation.ts';
import { answerMatches, campaignById, campaigns, chapterDone, pickRole, type QuestView } from '../shared/campaign.ts';
import { wordDiff } from '../shared/diff.ts';
import { cleanName, shownNames } from '../shared/names.ts';
import { randomName } from '../shared/randomNames.ts';
import { legalMove, zoneAt } from '../shared/plazaMap.ts';
import { type Avatar, EMOTES, SPAWN, chatProblem, clampPosition, defaultAvatar, isBlocked, plazaName, sanitizeAvatar, secretsMatch } from './rules.ts';

const TICKET_MS = 60_000;
const TEACHER_SESSION_MS = 12 * 60 * 60 * 1000;
const CHAT_KEEP = 500;
const STATUS_HISTORY = 100;
const CHAT_GAP_MS = 1500;
const REROLL_GAP_MS = 300; // between asks for another name
const WRONG_ANSWER_WAIT_MS = 3000; // before a student can try a chapter question again
const CHECK_GAP_MS = 800; // grammar hints cost money: no more than one a student can read
// Nearby chat reaches students within this many map pixels of where the sender stood.
export const HEARING_RANGE = 350;

// Close codes the client acts on.
const CLOSE_JOIN_AGAIN = 4001; // ticket unknown, used or expired
const CLOSE_REPLACED = 4009;   // the same student joined from another window
const CLOSE_CLASS_CLOSED = 4002; // the teacher closed the game

// Per-socket state. It lives in the socket's attachment, so it survives the
// room hibernating between messages.
type Seat = { id: string; game: string; zone?: string | null; studentKey: string; name: string; avatar: Avatar; x: number; y: number; lastChat: number; lastCheck?: number; lastReroll?: number; movedAt?: number; left?: boolean };

// 'approve': every message waits for the teacher. 'review': nearby chat that OpenAI
// cleared posts at once and the teacher reviews afterwards; whispers still wait.
export type ChatMode = 'approve' | 'review';

export type TeacherAction =
    | { kind: 'status' }
    | { kind: 'open'; open: boolean; game?: string } // a saved game (the last played by default), or close the open one
    | { kind: 'newGame'; name: string; randomNames?: boolean } // a new game with its own PIN, opened at once
    | { kind: 'campaign'; op: 'start' | 'next' | 'reset'; campaign?: string; confirm?: boolean }
    | { kind: 'review'; id: string; approve: boolean } // approve = false also takes down a message already posted
    | { kind: 'approveAll' }
    | { kind: 'mode'; mode: ChatMode }
    | { kind: 'mute'; studentKey: string; muted: boolean };

export type GameSummary = { id: string; name: string; pin: string; lastOpened: number; open: boolean; randomNames: boolean };

// Where this game's campaign stands, and what every student has done in it.
export type CampaignStatus = {
    id: string; title: string; status: QuestView['status']; chapter: number; chapters: number; chapterTitle: string;
    players: { studentKey: string; name: string; role: string; clues: number; done: string[] }[];
};

export type TeacherStatus = {
    campaign: CampaignStatus | null; // the open game's campaign, once started
    campaigns: { id: string; title: string }[]; // those that can be started
    open: boolean;
    game: { id: string; name: string; randomNames: boolean } | null; // the open game, or the one last played
    realNames: Record<string, string>; // every student's real name, since the plaza may show made-up ones
    games: GameSummary[];                      // every saved game, most recently played first
    pin: string | null; // the open game's PIN, which students type to join
    entries: { id: string; studentKey: string; sender: string; target: string | null; flag: string | null; note: string | null; text: string; timestamp: number; status: string }[];
    mode: ChatMode;
    moderation: boolean; // an OpenAI key is set, so 'review' mode can post anything
    muted: string[];
    online: { studentKey: string; name: string }[];
};

const publicSeat = (seat: Seat) => ({ id: seat.id, name: seat.name, x: seat.x, y: seat.y, ...seat.avatar });

// The plaza. Everything that must outlast a lesson is a SQLite row: each student's
// looks, the games (a PIN each, kept for good) with where every student stood in
// them, the chat log, mutes, and which game is open. One game is open at a time. Who is online right now is the set of open sockets.
export class PlazaRoom extends DurableObject<Env> {
    private sql: SqlStorage;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.sql = ctx.storage.sql;
        this.sql.exec(`
            CREATE TABLE IF NOT EXISTS students (
                student_key TEXT PRIMARY KEY, name TEXT NOT NULL, class_name TEXT NOT NULL DEFAULT '',
                avatar TEXT, x REAL, y REAL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS tickets (ticket TEXT PRIMARY KEY, student_key TEXT NOT NULL, expires INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS chat (
                id TEXT PRIMARY KEY, student_key TEXT NOT NULL, sender TEXT NOT NULL,
                text TEXT NOT NULL, ts INTEGER NOT NULL, status TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS chat_ts ON chat (ts);
            CREATE INDEX IF NOT EXISTS chat_status ON chat (status);
            CREATE TABLE IF NOT EXISTS mutes (student_key TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS teacher_sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS games (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, pin TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, last_opened INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS positions (
                game_id TEXT NOT NULL, student_key TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, PRIMARY KEY (game_id, student_key));
            CREATE TABLE IF NOT EXISTS aliases (
                game_id TEXT NOT NULL, student_key TEXT NOT NULL, name TEXT NOT NULL, kept INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (game_id, student_key));
            CREATE TABLE IF NOT EXISTS game_students (game_id TEXT NOT NULL, student_key TEXT NOT NULL, PRIMARY KEY (game_id, student_key));
            CREATE TABLE IF NOT EXISTS campaigns (
                game_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, chapter INTEGER NOT NULL, status TEXT NOT NULL, started INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS campaign_players (
                game_id TEXT NOT NULL, student_key TEXT NOT NULL, role_id TEXT NOT NULL, clues TEXT NOT NULL DEFAULT '[]',
                done TEXT NOT NULL DEFAULT '[]', last_wrong INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (game_id, student_key));`);
        // Older rooms predate nearby chat and whispers: their messages were for everyone.
        const chatColumns = this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('chat')").toArray().map(row => row.name);
        for (const [column, type] of [['target_key', 'TEXT'], ['target_name', 'TEXT'], ['x', 'REAL'], ['y', 'REAL'], ['flag', 'TEXT'], ['note', 'TEXT'], ['game_id', 'TEXT'], ['marks', 'TEXT']]) {
            if (!chatColumns.includes(column)) this.sql.exec(`ALTER TABLE chat ADD COLUMN ${column} ${type}`);
        }
        // The whole name as PinPlay gives it, from which each game works out what to show.
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('students')").toArray().some(row => row.name === 'full_name')) {
            this.sql.exec('ALTER TABLE students ADD COLUMN full_name TEXT');
        }
        // Games from before made-up names keep showing real first names.
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('games')").toArray().some(row => row.name === 'random_names')) {
            this.sql.exec('ALTER TABLE games ADD COLUMN random_names INTEGER NOT NULL DEFAULT 0');
        }
        this.adoptOldClass();
        // Keepalive pings are answered without waking the room.
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }

    // ---------- Called by the Worker ----------

    // The PIN students type to join, or null while no game is open.
    classPin(): string | null {
        return (this.isOpen() ? this.game(this.activeGame())?.pin : null) ?? null;
    }

    savedAvatar(studentKey: string): Avatar | null {
        const row = this.sql.exec<{ avatar: string | null }>('SELECT avatar FROM students WHERE student_key = ?', studentKey).toArray()[0];
        return row?.avatar ? sanitizeAvatar(JSON.parse(row.avatar)) : null;
    }

    // A verified student gets a one-use ticket for the socket, which cannot
    // carry headers. A null avatar keeps the saved one.
    issueTicket(student: PinPlayStudent, avatar: Avatar | null): { ticket: string } | { error: string } {
        if (!this.isOpen()) return { error: 'Your teacher has not opened the class yet.' };
        const now = Date.now();
        const ticket = crypto.randomUUID();
        this.sql.exec(`INSERT INTO students (student_key, name, full_name, class_name, avatar, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (student_key) DO UPDATE SET name = excluded.name, full_name = excluded.full_name, class_name = excluded.class_name,
                avatar = COALESCE(excluded.avatar, students.avatar), last_seen = excluded.last_seen`,
            student.studentKey, plazaName(student.displayName), cleanName(student.displayName) || 'Student', student.className,
            avatar ? JSON.stringify(avatar) : null, now, now);
        this.sql.exec('DELETE FROM tickets WHERE expires < ?', now);
        this.sql.exec('INSERT INTO tickets (ticket, student_key, expires) VALUES (?, ?, ?)', ticket, student.studentKey, now + TICKET_MS);
        return { ticket };
    }

    startTeacherSession(): string {
        const now = Date.now();
        const token = crypto.randomUUID() + crypto.randomUUID();
        this.sql.exec('DELETE FROM teacher_sessions WHERE expires < ?', now);
        this.sql.exec('INSERT INTO teacher_sessions (token, expires) VALUES (?, ?)', token, now + TEACHER_SESSION_MS);
        return token;
    }

    // Online: where the teacher's laptop runs the class (README, "Play on the
    // teacher's laptop"), so students are sent there after signing in. The lease
    // lets the laptop move or withdraw it later without the password.
    linkLaptop(url: string): string {
        const lease = crypto.randomUUID() + crypto.randomUUID();
        this.saveSetting('laptop', JSON.stringify({ url, lease, expires: Date.now() + TEACHER_SESSION_MS }));
        return lease;
    }

    updateLaptop(lease: string, url: string | null): boolean {
        const laptop = this.laptop();
        if (!laptop || !secretsMatch(lease, laptop.lease)) return false;
        this.saveSetting('laptop', JSON.stringify({ ...laptop, url, expires: Date.now() + TEACHER_SESSION_MS }));
        return true;
    }

    laptopUrl(): string | null {
        return this.laptop()?.url ?? null;
    }

    // On the laptop, this keeps the online plaza's lease.
    setting(key: string): string | null {
        return this.sql.exec<{ value: string }>('SELECT value FROM settings WHERE key = ?', key).toArray()[0]?.value ?? null;
    }

    saveSetting(key: string, value: string): void {
        this.sql.exec('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
    }

    teacher(token: string, action: TeacherAction): TeacherStatus | { error: string; status: number } {
        const session = this.sql.exec('SELECT 1 FROM teacher_sessions WHERE token = ? AND expires > ?', token, Date.now()).toArray();
        if (!token || session.length === 0) return { error: 'Please sign in again.', status: 401 };
        if (action.kind === 'open') {
            if (action.open && action.game !== undefined && !this.game(action.game)) return { error: 'That game does not exist.', status: 400 };
            this.setOpen(action.open, action.game);
        }
        if (action.kind === 'campaign') {
            const failed = this.campaignAction(action);
            if (failed) return { error: failed, status: 400 };
        }
        if (action.kind === 'newGame') {
            const name = action.name.trim().replace(/\s+/g, ' ').slice(0, 40);
            if (!name) return { error: 'Give the game a name.', status: 400 };
            this.setOpen(true, this.createGame(name, action.randomNames !== false));
        }
        if (action.kind === 'review' && !this.review(action.id, action.approve)) {
            return { error: 'That message is no longer pending.', status: 400 };
        }
        if (action.kind === 'approveAll') {
            const pending = this.sql.exec<{ id: string }>("SELECT id FROM chat WHERE status = 'pending' AND game_id IS ? ORDER BY ts", this.activeGame()).toArray();
            for (const { id } of pending) this.review(id, true);
        }
        if (action.kind === 'mode') this.saveSetting('mode', action.mode);
        if (action.kind === 'mute') {
            if (action.muted) this.sql.exec('INSERT OR IGNORE INTO mutes (student_key) VALUES (?)', action.studentKey);
            else this.sql.exec('DELETE FROM mutes WHERE student_key = ?', action.studentKey);
        }
        // The dashboard polls every 2 seconds: send everything still pending plus
        // recent history, read through the indexes, not the whole log each time.
        const current = this.game(this.activeGame());
        return {
            campaign: this.campaignStatus(current?.id ?? null),
            campaigns: campaigns.map(campaign => ({ id: campaign.id, title: campaign.title })),
            open: this.isOpen(),
            game: current && { id: current.id, name: current.name, randomNames: this.isRandom(current.id) },
            realNames: Object.fromEntries(this.sql.exec<{ student_key: string; full: string }>(
                'SELECT student_key, COALESCE(full_name, name) AS full FROM students').toArray().map(row => [row.student_key, row.full])),
            games: this.sql.exec<{ id: string; name: string; pin: string; lastOpened: number; randomNames: number }>(
                'SELECT id, name, pin, last_opened AS lastOpened, random_names AS randomNames FROM games ORDER BY last_opened DESC').toArray()
                .map(game => ({ ...game, randomNames: game.randomNames === 1, open: this.isOpen() && game.id === current?.id })),
            pin: this.classPin(),
            entries: this.sql.exec<TeacherStatus['entries'][number]>(`SELECT id, student_key AS studentKey, sender, target_name AS target, flag, note, text,
                ts AS timestamp, status FROM (
                    SELECT * FROM chat WHERE status = 'pending' AND game_id IS ?
                    UNION SELECT * FROM (SELECT * FROM chat WHERE game_id IS ? ORDER BY ts DESC LIMIT ?))
                ORDER BY ts DESC`, current?.id ?? null, current?.id ?? null, STATUS_HISTORY).toArray(),
            mode: this.mode(),
            moderation: !!this.env.OPENAI_API_KEY,
            muted: this.sql.exec<{ student_key: string }>('SELECT student_key FROM mutes').toArray().map(row => row.student_key),
            online: this.seats().map(seat => ({ studentKey: seat.studentKey, name: seat.name }))
        };
    }

    // ---------- The plaza socket ----------

    async fetch(request: Request): Promise<Response> {
        const { 0: client, 1: server } = new WebSocketPair();
        const ticket = new URL(request.url).searchParams.get('ticket') || '';
        const row = this.sql.exec<{ student_key: string }>(
            'DELETE FROM tickets WHERE ticket = ? AND expires >= ? RETURNING student_key', ticket, Date.now()).toArray()[0];
        if (!row || !this.isOpen()) {
            server.accept();
            server.close(CLOSE_JOIN_AGAIN, 'Join again.');
            return new Response(null, { status: 101, webSocket: client });
        }

        // One avatar per student: a newer window takes over, where the older one stood.
        const replaced = this.ctx.getWebSockets(row.student_key).filter(ws => !(ws.deserializeAttachment() as Seat | null)?.left);
        for (const old of replaced) {
            this.leave(old, false);
            try { old.close(CLOSE_REPLACED, 'Opened in another window.'); } catch { /* already closing */ }
        }

        const game = this.activeGame() ?? '';
        // Joining may make two students share a first name: everyone already here is told their new name.
        this.sql.exec('INSERT OR IGNORE INTO game_students (game_id, student_key) VALUES (?, ?)', game, row.student_key);
        this.refreshNames(game);
        const saved = this.sql.exec<{ name: string; avatar: string | null; x: number | null; y: number | null }>(
            `SELECT s.name AS name, s.avatar AS avatar, p.x AS x, p.y AS y FROM students s
             LEFT JOIN positions p ON p.student_key = s.student_key AND p.game_id = ? WHERE s.student_key = ?`,
            game, row.student_key).one();
        // Where they stood last time in this game, unless the map has changed under them since
        const spot = saved.x != null && saved.y != null && !isBlocked(saved.x, saved.y)
            ? { x: saved.x, y: saved.y }
            : { x: SPAWN.x + Math.round(Math.random() * 100 - 50), y: SPAWN.y + Math.round(Math.random() * 100 - 50) };
        const seat: Seat = {
            id: crypto.randomUUID().slice(0, 8), game, studentKey: row.student_key, name: this.rosterNames(game).get(row.student_key) ?? saved.name,
            avatar: (saved.avatar && sanitizeAvatar(JSON.parse(saved.avatar))) || defaultAvatar(),
            x: spot.x, y: spot.y,
            lastChat: 0, movedAt: Date.now()
        };
        const others = this.seats();
        this.ctx.acceptWebSocket(server, [seat.studentKey]);
        server.serializeAttachment(seat);
        server.send(JSON.stringify({ t: 'welcome', id: seat.id, players: [...others, seat].map(publicSeat) }));
        this.broadcast({ t: 'join', player: publicSeat(seat) }, server);
        if (replaced.length === 0) this.systemChat(`${seat.name} has joined the Plaza.`, server);
        this.sendQuest(server, seat.game, seat.studentKey);
        this.sendAlias(server, seat.game, seat.studentKey);
        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
        if (typeof message !== 'string' || message.length > 1000) return;
        const seat = ws.deserializeAttachment() as Seat | null;
        if (!seat || seat.left) return;
        let data: any;
        try { data = JSON.parse(message); } catch { return; }

        if (data?.t === 'move') {
            const position = clampPosition(data.x, data.y);
            if (!position) return;
            // A move through a wall, or further than anyone can walk, puts the student back where they were.
            const now = Date.now();
            if (this.env.MOVEMENT_CHECK !== '0' && !legalMove(seat.x, seat.y, position.x, position.y, now - (seat.movedAt ?? now))) {
                try { ws.send(JSON.stringify({ t: 'snap', x: seat.x, y: seat.y })); } catch { /* closing */ }
                return;
            }
            seat.movedAt = now;
            seat.x = position.x;
            seat.y = position.y;
            this.discover(seat);
            ws.serializeAttachment(seat);
            this.broadcast({ t: 'move', id: seat.id, ...position }, ws);
        } else if (data?.t === 'answer' && typeof data.objective === 'string' && typeof data.text === 'string' && data.text.length <= 80) {
            this.answer(ws, seat, data.objective, data.text);
        } else if (data?.t === 'reroll' || data?.t === 'keep') {
            this.chooseAlias(ws, seat, data.t === 'keep');
        } else if (data?.t === 'emote' && EMOTES.includes(data.emote)) {
            this.broadcast({ t: 'emote', id: seat.id, emote: data.emote });
        } else if (data?.t === 'check') {
            await this.grammar(ws, seat, data.id, data.text);
        } else if (data?.t === 'chat') {
            // What the student did with a grammar hint, for the teacher to see.
            const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 200) : null);
            const note = text(data.was) ? `Used the suggestion. They wrote: "${text(data.was)}"`
                : text(data.better) ? `Kept their own words. Suggested: "${text(data.better)}"` : null;
            await this.chat(ws, seat, data.text, data.to, note, typeof data.cid === 'string' ? data.cid.slice(0, 64) : undefined, text(data.better));
        }
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
        this.leave(ws, true);
        try { ws.close(code, reason); } catch { /* reserved code, or already closed */ }
    }

    async webSocketError(ws: WebSocket): Promise<void> {
        this.leave(ws, true);
    }

    // ---------- Internals ----------

    // ---------- The campaign ----------
    // One per game, saved with it: closing the game is the checkpoint, and reopening it picks the
    // story up where it stopped. Each student's role and finds are saved too, and only that
    // student's own are ever sent to them.

    private campaignRow(game: string | null): { campaign_id: string; chapter: number; status: QuestView['status'] } | null {
        return game === null ? null : this.sql.exec<{ campaign_id: string; chapter: number; status: QuestView['status'] }>(
            'SELECT campaign_id, chapter, status FROM campaigns WHERE game_id = ?', game).toArray()[0] ?? null;
    }

    private campaignPlayers(game: string): { student_key: string; role_id: string; clues: string[]; done: string[]; last_wrong: number }[] {
        return this.sql.exec<{ student_key: string; role_id: string; clues: string; done: string; last_wrong: number }>(
            'SELECT student_key, role_id, clues, done, last_wrong FROM campaign_players WHERE game_id = ?', game).toArray()
            .map(row => ({ ...row, clues: JSON.parse(row.clues), done: JSON.parse(row.done) }));
    }

    // The student's role, chosen at random the first time and the same ever after.
    private player(game: string, studentKey: string, campaignId: string) {
        const existing = this.campaignPlayers(game).find(row => row.student_key === studentKey);
        if (existing) return existing;
        const campaign = campaignById(campaignId);
        if (!campaign) return null;
        const role = pickRole(campaign.roles, this.campaignPlayers(game).map(row => row.role_id), Math.random());
        this.sql.exec('INSERT INTO campaign_players (game_id, student_key, role_id) VALUES (?, ?, ?)', game, studentKey, role.id);
        return { student_key: studentKey, role_id: role.id, clues: [] as string[], done: [] as string[], last_wrong: 0 };
    }

    // What this student may see of the campaign, or null before it starts.
    private questView(game: string, studentKey: string): QuestView | null {
        const row = this.campaignRow(game);
        const campaign = row && campaignById(row.campaign_id);
        if (!row || !campaign) return null;
        const player = this.player(game, studentKey, row.campaign_id);
        const role = campaign.roles.find(item => item.id === player?.role_id);
        const chapter = campaign.chapters[Math.min(row.chapter, campaign.chapters.length - 1)];
        if (!player || !role) return null;
        const found = campaign.chapters.flatMap(item => item.discoveries).filter(discovery => player.clues.includes(discovery.id));
        return {
            campaign: { id: campaign.id, title: campaign.title },
            status: row.status,
            chapter: { index: row.chapter, of: campaign.chapters.length, title: chapter.title, intro: chapter.intro,
                ending: row.status === 'active' ? null : chapter.ending },
            role: { id: role.id, name: role.name, card: role.card },
            clues: [{ id: `role-${role.id}`, text: role.clue, from: 'job' }, ...found.map(item => ({ id: item.id, text: item.text, from: item.zone }))],
            objectives: chapter.objectives.map(objective => ({ id: objective.id, text: objective.text, done: player.done.includes(objective.id) })),
            finale: row.status === 'campaign_complete' ? campaign.finale : null
        };
    }

    private sendQuest(target: WebSocket, game: string, studentKey: string): void {
        const quest = this.questView(game, studentKey);
        if (quest) try { target.send(JSON.stringify({ t: 'quest', quest })); } catch { /* closing */ }
    }

    // Everyone in the game gets their own view again, after the story moved on.
    private sendQuestToAll(game: string): void {
        for (const seat of this.seats()) {
            if (seat.game !== game) continue;
            const quest = this.questView(game, seat.studentKey);
            for (const ws of this.ctx.getWebSockets(seat.studentKey)) {
                try { ws.send(JSON.stringify({ t: 'quest', quest })); } catch { /* closing */ }
            }
        }
    }

    // Stepping into a named place can reveal a clue, once.
    private discover(seat: Seat): void {
        const zone = zoneAt(seat.x, seat.y);
        if (zone === (seat.zone ?? null)) return;
        seat.zone = zone;
        const row = zone ? this.campaignRow(seat.game) : null;
        const campaign = row && campaignById(row.campaign_id);
        if (!zone || !row || !campaign || row.status !== 'active') return;
        const player = this.player(seat.game, seat.studentKey, row.campaign_id);
        const fresh = campaign.chapters[row.chapter]?.discoveries.filter(item => item.zone === zone && !player?.clues.includes(item.id)) ?? [];
        if (!player || fresh.length === 0) return;
        this.sql.exec('UPDATE campaign_players SET clues = ? WHERE game_id = ? AND student_key = ?',
            JSON.stringify([...player.clues, ...fresh.map(item => item.id)]), seat.game, seat.studentKey);
        for (const ws of this.ctx.getWebSockets(seat.studentKey)) this.sendQuest(ws, seat.game, seat.studentKey);
    }

    // A student's typed answer to a chapter question. A wrong one can be tried again after a short wait.
    private answer(ws: WebSocket, seat: Seat, objectiveId: string, typed: string): void {
        const row = this.campaignRow(seat.game);
        const campaign = row && campaignById(row.campaign_id);
        const objective = campaign?.chapters[row?.chapter ?? 0]?.objectives.find(item => item.id === objectiveId);
        if (!row || !campaign || !objective || row.status !== 'active') return;
        const player = this.player(seat.game, seat.studentKey, row.campaign_id);
        if (!player || player.done.includes(objective.id)) return;
        const reply = (correct: boolean, wait = false) => ws.send(JSON.stringify({ t: 'answered', objective: objective.id, correct, wait }));
        const now = Date.now();
        if (now - player.last_wrong < WRONG_ANSWER_WAIT_MS) return reply(false, true);
        if (!answerMatches(objective, typed)) {
            this.sql.exec('UPDATE campaign_players SET last_wrong = ? WHERE game_id = ? AND student_key = ?', now, seat.game, seat.studentKey);
            return reply(false);
        }
        this.sql.exec('UPDATE campaign_players SET done = ? WHERE game_id = ? AND student_key = ?',
            JSON.stringify([...player.done, objective.id]), seat.game, seat.studentKey);
        reply(true);
        const chapter = campaign.chapters[row.chapter];
        if (chapterDone(chapter, this.campaignPlayers(seat.game))) {
            this.sql.exec("UPDATE campaigns SET status = 'chapter_complete' WHERE game_id = ?", seat.game);
            this.sendQuestToAll(seat.game);
        } else for (const socket of this.ctx.getWebSockets(seat.studentKey)) this.sendQuest(socket, seat.game, seat.studentKey);
    }

    // The teacher's controls. Returns what went wrong, or null.
    private campaignAction(action: Extract<TeacherAction, { kind: 'campaign' }>): string | null {
        const game = this.activeGame();
        if (game === null) return 'Open or create a game first.';
        const row = this.campaignRow(game);
        if (action.op === 'start') {
            if (row) return 'This game already has a campaign.';
            const campaign = campaignById(action.campaign ?? '');
            if (!campaign) return 'That campaign does not exist.';
            this.sql.exec("INSERT INTO campaigns (game_id, campaign_id, chapter, status, started) VALUES (?, ?, 0, 'active', ?)", game, campaign.id, Date.now());
            for (const seat of this.seats()) if (seat.game === game) this.player(game, seat.studentKey, campaign.id);
        } else if (!row) {
            return 'This game has no campaign.';
        } else if (action.op === 'next') {
            const campaign = campaignById(row.campaign_id);
            if (!campaign || row.status === 'campaign_complete') return 'The campaign is over.';
            if (row.chapter + 1 < campaign.chapters.length) {
                this.sql.exec("UPDATE campaigns SET chapter = chapter + 1, status = 'active' WHERE game_id = ?", game);
            } else this.sql.exec("UPDATE campaigns SET status = 'campaign_complete' WHERE game_id = ?", game);
        } else if (action.op === 'reset') {
            if (action.confirm !== true) return 'Confirm to erase this game\'s campaign.';
            this.sql.exec('DELETE FROM campaigns WHERE game_id = ?', game);
            this.sql.exec('DELETE FROM campaign_players WHERE game_id = ?', game);
            for (const seat of this.seats()) {
                if (seat.game !== game) continue;
                for (const ws of this.ctx.getWebSockets(seat.studentKey)) { try { ws.send(JSON.stringify({ t: 'quest', quest: null })); } catch { /* closing */ } }
            }
            return null;
        }
        this.sendQuestToAll(game);
        return null;
    }

    private campaignStatus(game: string | null): CampaignStatus | null {
        const row = this.campaignRow(game);
        const campaign = row && campaignById(row.campaign_id);
        if (!game || !row || !campaign) return null;
        const names = this.rosterNames(game);
        return {
            id: campaign.id, title: campaign.title, status: row.status, chapter: row.chapter, chapters: campaign.chapters.length,
            chapterTitle: campaign.chapters[Math.min(row.chapter, campaign.chapters.length - 1)].title,
            players: this.campaignPlayers(game).map(item => ({
                studentKey: item.student_key, name: names.get(item.student_key) ?? 'Student',
                role: campaign.roles.find(role => role.id === item.role_id)?.name ?? item.role_id, clues: item.clues.length, done: item.done
            }))
        };
    }

    // With an OpenAI key, nearby chat that OpenAI cleared posts at once and the teacher reviews afterwards,
    // unless the teacher chose to approve everything first. Without a key every message waits.
    private mode(): ChatMode {
        return this.setting('mode') !== 'approve' && this.env.OPENAI_API_KEY ? 'review' : 'approve';
    }

    private isOpen(): boolean {
        return this.setting('open') === '1';
    }

    // What each student of this game is called: the first name, with the start of the surname
    // when another student of the game shares it.
    private rosterNames(game: string): Map<string, string> {
        if (this.isRandom(game)) {
            return new Map(this.sql.exec<{ student_key: string }>(
                'SELECT student_key FROM game_students WHERE game_id = ? UNION SELECT student_key FROM positions WHERE game_id = ?', game, game).toArray()
                .map(row => [row.student_key, this.alias(game, row.student_key).name]));
        }
        const rows = this.sql.exec<{ student_key: string; full: string }>(
            `SELECT student_key, COALESCE(full_name, name) AS full FROM students WHERE student_key IN
             (SELECT student_key FROM game_students WHERE game_id = ? UNION SELECT student_key FROM positions WHERE game_id = ?)`, game, game).toArray();
        return shownNames(rows.map(row => ({ key: row.student_key, full: row.full })));
    }

    // Anyone online whose shown name has changed (because a namesake arrived) is renamed, on every screen.
    private refreshNames(game: string): void {
        const names = this.rosterNames(game);
        for (const ws of this.ctx.getWebSockets()) {
            const seat = ws.deserializeAttachment() as Seat | null;
            const name = seat && names.get(seat.studentKey);
            if (!seat || seat.left || seat.game !== game || !name || name === seat.name) continue;
            seat.name = name;
            ws.serializeAttachment(seat);
            this.broadcast({ t: 'rename', id: seat.id, name });
        }
    }

    private activeGame(): string | null {
        return this.setting('active_game');
    }

    private game(id: string | null): { id: string; name: string; pin: string } | null {
        return id === null ? null
            : this.sql.exec<{ id: string; name: string; pin: string }>('SELECT id, name, pin FROM games WHERE id = ?', id).toArray()[0] ?? null;
    }

    // A game keeps its PIN for good, so a PIN is never reused.
    private newPin(): string {
        for (;;) {
            const pin = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
            if (this.sql.exec('SELECT 1 FROM games WHERE pin = ?', pin).toArray().length === 0) return pin;
        }
    }

    private createGame(name: string, randomNames: boolean): string {
        const id = crypto.randomUUID().slice(0, 8);
        const now = Date.now();
        this.sql.exec('INSERT INTO games (id, name, pin, created, last_opened, random_names) VALUES (?, ?, ?, ?, ?, ?)',
            id, name, this.newPin(), now, now, randomNames ? 1 : 0);
        return id;
    }

    private isRandom(game: string | null): boolean {
        return game !== null && this.sql.exec<{ random_names: number }>('SELECT random_names FROM games WHERE id = ?', game).toArray()[0]?.random_names === 1;
    }

    // The made-up name a student has in a game with random names, chosen the first time they are seen.
    // `kept` is false until they have chosen to keep it; until then they can ask for another.
    private alias(game: string, studentKey: string): { name: string; kept: boolean } {
        const existing = this.sql.exec<{ name: string; kept: number }>('SELECT name, kept FROM aliases WHERE game_id = ? AND student_key = ?', game, studentKey).toArray()[0];
        if (existing) return { name: existing.name, kept: existing.kept === 1 };
        return { name: this.newAlias(game, studentKey), kept: false };
    }

    // A name nobody else in the game has (and not the one this student has now), saved for them.
    private newAlias(game: string, studentKey: string): string {
        const taken = new Set(this.sql.exec<{ name: string }>('SELECT name FROM aliases WHERE game_id = ?', game).toArray().map(row => row.name.toLowerCase()));
        const name = randomName(taken);
        this.sql.exec(`INSERT INTO aliases (game_id, student_key, name, kept) VALUES (?, ?, ?, 0)
            ON CONFLICT (game_id, student_key) DO UPDATE SET name = excluded.name`, game, studentKey, name);
        return name;
    }

    private sendAlias(target: WebSocket, game: string, studentKey: string): void {
        if (!this.isRandom(game)) return;
        try { target.send(JSON.stringify({ t: 'alias', ...this.alias(game, studentKey) })); } catch { /* closing */ }
    }

    // A student asks for another name, or keeps the one they have, while the game shows made-up names.
    private chooseAlias(ws: WebSocket, seat: Seat, keep: boolean): void {
        if (!this.isRandom(seat.game)) return;
        const current = this.alias(seat.game, seat.studentKey);
        if (current.kept) return this.sendAlias(ws, seat.game, seat.studentKey);
        const now = Date.now();
        if (keep) this.sql.exec('UPDATE aliases SET kept = 1 WHERE game_id = ? AND student_key = ?', seat.game, seat.studentKey);
        else if (now - (seat.lastReroll ?? 0) < REROLL_GAP_MS) return;
        else {
            seat.lastReroll = now;
            const name = this.newAlias(seat.game, seat.studentKey);
            seat.name = name;
            ws.serializeAttachment(seat);
            this.broadcast({ t: 'rename', id: seat.id, name });
        }
        this.sendAlias(ws, seat.game, seat.studentKey);
    }

    // Rooms from before games existed: their one class becomes the first game, with its
    // PIN, chat and where everyone stood.
    private adoptOldClass(): void {
        if (this.sql.exec('SELECT 1 FROM games').toArray().length > 0) return;
        const pin = this.setting('pin');
        if (!pin) return;
        const now = Date.now();
        this.sql.exec('INSERT INTO games (id, name, pin, created, last_opened) VALUES (?, ?, ?, ?, ?)', 'first', 'First class', pin, now, now);
        this.sql.exec("UPDATE chat SET game_id = 'first' WHERE game_id IS NULL");
        this.sql.exec("INSERT OR IGNORE INTO positions (game_id, student_key, x, y) SELECT 'first', student_key, x, y FROM students WHERE x IS NOT NULL AND y IS NOT NULL");
        this.saveSetting('active_game', 'first');
    }

    private laptop(): { url: string | null; lease: string; expires: number } | null {
        const value = this.setting('laptop');
        const laptop = value ? JSON.parse(value) : null;
        return laptop && laptop.expires > Date.now() ? laptop : null;
    }

    private seats(): Seat[] {
        return this.ctx.getWebSockets().flatMap(ws => {
            if (ws.readyState !== WebSocket.READY_STATE_OPEN) return [];
            const seat = ws.deserializeAttachment() as Seat | null;
            return seat && !seat.left ? [seat] : [];
        });
    }

    private broadcast(message: object, except?: WebSocket): void {
        const data = JSON.stringify(message);
        for (const ws of this.ctx.getWebSockets()) {
            if (ws === except || ws.readyState !== WebSocket.READY_STATE_OPEN) continue;
            try { ws.send(data); } catch { /* closing */ }
        }
    }

    private notify(studentKey: string, level: 'info' | 'warning', text: string): void {
        for (const ws of this.ctx.getWebSockets(studentKey)) {
            try { ws.send(JSON.stringify({ t: 'notice', level, text })); } catch { /* closing */ }
        }
    }

    private systemChat(text: string, except?: WebSocket): void {
        this.broadcast({ t: 'chat', sender: 'System', text, ts: Date.now() }, except);
    }

    // Saves where the student stood in this game, so the next lesson starts there.
    private leave(ws: WebSocket, announce: boolean): void {
        const seat = ws.deserializeAttachment() as Seat | null;
        if (!seat || seat.left) return;
        seat.left = true;
        try { ws.serializeAttachment(seat); } catch { /* closed */ }
        this.sql.exec('UPDATE students SET last_seen = ? WHERE student_key = ?', Date.now(), seat.studentKey);
        this.sql.exec(`INSERT INTO positions (game_id, student_key, x, y) VALUES (?, ?, ?, ?)
            ON CONFLICT (game_id, student_key) DO UPDATE SET x = excluded.x, y = excluded.y`, seat.game, seat.studentKey, seat.x, seat.y);
        this.broadcast({ t: 'leave', id: seat.id }, ws);
        if (announce) this.systemChat(`${seat.name} left the Plaza.`, ws);
    }

    // A hint before sending, never a block: whatever goes wrong, the answer is "fine".
    private async grammar(ws: WebSocket, seat: Seat, id: unknown, text: unknown): Promise<void> {
        const now = Date.now();
        let answer: Awaited<ReturnType<typeof checkGrammar>> = { ok: true };
        if (typeof text === 'string' && now - (seat.lastCheck ?? 0) >= CHECK_GAP_MS && this.isOpen()) {
            seat.lastCheck = now;
            ws.serializeAttachment(seat);
            answer = await checkGrammar(text, this.env);
        }
        try { ws.send(JSON.stringify({ t: 'checked', id, ...answer })); } catch { /* closing */ }
    }

    // `cid` is the page's own id for this message: every answer carries it back, so a message that
    // did not go through can be given back to its writer, draft intact.
    private async chat(ws: WebSocket, seat: Seat, value: unknown, to: unknown, note: string | null, cid?: string, better?: string | null): Promise<void> {
        const reply = (level: 'info' | 'warning', text: string) => ws.send(JSON.stringify({ t: 'notice', level, text, cid }));
        const unavailable = () => !this.isOpen() || this.sql.exec('SELECT 1 FROM mutes WHERE student_key = ?', seat.studentKey).toArray().length > 0;
        if (unavailable()) return reply('warning', 'Chat is unavailable right now.');
        if (this.isRandom(seat.game) && !this.alias(seat.game, seat.studentKey).kept) return reply('warning', 'Choose your name first.');

        // On the teacher's laptop every word must be English, whatever the page did.
        if (typeof value === 'string' && this.env.LAN_URL) {
            const { notEnglish } = await import('./english.ts');
            const words = notEnglish(value, this.seats().map(other => other.name));
            if (words.length) return reply('warning', `Use English words only: ${words.map(item => item.word).join(', ')}.`);
        }
        const now = Date.now();
        if (now - seat.lastChat < CHAT_GAP_MS) return reply('warning', 'Please wait before sending another message.');
        seat.lastChat = now;
        ws.serializeAttachment(seat);
        if (typeof value !== 'string') return reply('warning', 'Enter a text message.');

        // `to` is the id of the classmate being whispered to; without it, the message is for whoever is nearby.
        let target: Seat | undefined;
        if (to !== undefined && to !== null) {
            target = this.seats().find(other => other.id === to);
            if (!target || target.studentKey === seat.studentKey) return reply('warning', 'That student is not in the Plaza right now.');
        }

        // Blocked messages are kept too, so the teacher sees what was attempted.
        let problem = chatProblem(value);
        let flag: string | null = null;
        let cleared = false; // OpenAI looked at it and found nothing
        if (!problem) {
            const verdict = await moderate(value.trim(), this.env);
            cleared = verdict.result === 'clean';
            if (verdict.result === 'flagged') { problem = 'That message cannot be sent. Please rewrite it.'; flag = verdict.categories.join(', '); }
            else if (verdict.result === 'unchecked') flag = 'moderation unavailable';
            // The class may have closed or the student been muted while OpenAI answered.
            if (unavailable()) return reply('warning', 'Chat is unavailable right now.');
        }
        // Review mode posts only what OpenAI cleared, and never a whisper.
        const posts = !problem && cleared && !target && this.mode() === 'review';
        const entry = { id: crypto.randomUUID(), student_key: seat.studentKey, sender: seat.name, text: value.trim().slice(0, 200),
            target_key: target?.studentKey ?? null, x: seat.x, y: seat.y, marks: null as string | null };
        // Sent as written although a better version was offered: mark the words that differ, for everyone who reads it.
        const slips = better ? wordDiff(entry.text, better).original : [];
        if (slips.length) entry.marks = JSON.stringify(slips);
        this.sql.exec(`INSERT INTO chat (id, student_key, sender, text, ts, status, target_key, target_name, x, y, flag, note, game_id, marks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            entry.id, entry.student_key, entry.sender, entry.text, now, problem ? 'blocked' : posts ? 'approved' : 'pending',
            entry.target_key, target?.name ?? null, entry.x, entry.y, flag, note, seat.game, entry.marks);
        this.sql.exec('DELETE FROM chat WHERE game_id IS ? AND id NOT IN (SELECT id FROM chat WHERE game_id IS ? ORDER BY ts DESC LIMIT ?)',
            seat.game, seat.game, CHAT_KEEP);
        if (posts) {
            this.deliver(entry);
            if (cid) ws.send(JSON.stringify({ t: 'result', cid })); // posted at once: nothing else to say
        }
        else reply(problem ? 'warning' : 'info', problem ?? 'Sent to your teacher for approval.');
    }

    private review(id: string, approve: boolean): boolean {
        const entry = this.sql.exec<{ id: string; student_key: string; sender: string; text: string; status: string;
            target_key: string | null; x: number | null; y: number | null; marks: string | null }>(
            'SELECT id, student_key, sender, text, status, target_key, x, y, marks FROM chat WHERE id = ?', id).toArray()[0];
        if (!entry) return false;

        // Taking down a message that already posted: it disappears from every screen.
        if (entry.status === 'approved' && !approve) {
            this.sql.exec("UPDATE chat SET status = 'removed' WHERE id = ?", id);
            this.broadcast({ t: 'retract', id });
            this.notify(entry.student_key, 'warning', 'Your teacher removed one of your messages.');
            return true;
        }
        if (entry.status !== 'pending') return false;

        const approved = approve && this.isOpen();
        this.sql.exec('UPDATE chat SET status = ? WHERE id = ?', approved ? 'approved' : 'rejected', id);
        if (!approved) {
            this.notify(entry.student_key, 'info', 'Your message was not posted.');
            return true;
        }
        const delivered = this.deliver(entry);
        this.notify(entry.student_key, delivered ? 'info' : 'warning',
            delivered ? 'Your message was approved.' : 'Your whisper was approved, but that student has left the Plaza.');
        return true;
    }

    // A whisper goes to its two students, nearby chat to whoever stands within
    // earshot of where the sender stood; the sender always sees their own.
    // False when a whisper had nobody to reach.
    private deliver(entry: { id: string; student_key: string; sender: string; text: string; target_key: string | null; x: number | null; y: number | null; marks?: string | null }): boolean {
        const recipients = new Set([entry.student_key]);
        for (const seat of this.seats()) {
            const heard = entry.target_key !== null ? seat.studentKey === entry.target_key
                : entry.x === null || entry.y === null || Math.hypot(seat.x - entry.x, seat.y - entry.y) <= HEARING_RANGE;
            if (heard) recipients.add(seat.studentKey);
        }
        const message = JSON.stringify({ t: 'chat', id: entry.id, sender: entry.sender, text: entry.text, ts: Date.now(),
            ...(entry.marks ? { marks: JSON.parse(entry.marks) } : {}),
            ...(entry.target_key !== null ? { whisper: true, to: this.rosterNames(this.activeGame() ?? '').get(entry.target_key) ?? 'a classmate' } : {}) });
        for (const studentKey of recipients) {
            for (const ws of this.ctx.getWebSockets(studentKey)) {
                try { ws.send(message); } catch { /* closing */ }
            }
        }
        return entry.target_key === null || recipients.size > 1;
    }

    // Opens a saved game (the one last played when none is named, or a first game when there
    // are none), or closes the open one. Closing saves where everyone stood, rejects chat
    // still waiting and sends everyone out; opening another game closes the first.
    private setOpen(open: boolean, game?: string): void {
        if (!open) {
            this.saveSetting('open', '0');
            this.closeRoom();
            return;
        }
        const target = game ?? this.activeGame() ?? this.createGame('Class 1', false);
        const switching = this.isOpen() && this.activeGame() !== target;
        if (switching) this.closeRoom();
        const reopening = !this.isOpen() || switching;
        this.saveSetting('open', '1');
        this.saveSetting('active_game', target);
        if (reopening) this.sql.exec('UPDATE games SET last_opened = ? WHERE id = ?', Date.now(), target);
    }

    private closeRoom(): void {
        const rejected = this.sql.exec<{ student_key: string }>(
            "UPDATE chat SET status = 'rejected' WHERE status = 'pending' RETURNING student_key").toArray();
        for (const studentKey of new Set(rejected.map(row => row.student_key))) {
            this.notify(studentKey, 'info', 'Your message was not posted.');
        }
        for (const ws of this.ctx.getWebSockets()) {
            this.leave(ws, false);
            try { ws.close(CLOSE_CLASS_CLOSED, 'The class is closed.'); } catch { /* already closing */ }
        }
    }
}
