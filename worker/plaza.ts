import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index.ts';
import type { PinPlayStudent } from './pinplay.ts';
import { checkGrammar } from './grammar.ts';
import { languageHelp } from './aiHelp.ts';
import { moderate } from './moderation.ts';
import { PARTICIPATION, Participation, participationDecision } from './participation.ts';
import { REPORT_MAX_LENGTH, absentRoleClues, acceptedNames, answerMatches, chapterDone, isUnlocked, mainFinished, pickRole, rewardClues, teamProgress, type QuestView } from '../shared/campaign.ts';
import { MissionRepository, type MissionResult } from './missions.ts';
import { QuestBoard, type BoardContext } from './questBoard.ts';
import { Interviews } from './interviews.ts';
import { StudentAssistance } from './support.ts';
import type { AttemptPage, AttemptSource, HelpStatus, HelpTopic, TeacherSupport } from '../shared/support.ts';
import type { ConversationView, Objective, InterviewView } from '../shared/campaign.ts';
import { LiveMissions, type LiveMissionResult } from './liveMissions.ts';
import type { CampaignChoice, LiveMissionTarget } from '../shared/missionTypes.ts';
import { boardWait, type Campaign } from '../shared/campaign.ts';
import { SIDE_QUEST_LIBRARY_VERSION, SIDE_QUEST_SOURCE, questFit, questObjective, sideQuestById } from '../shared/sideQuests.ts';
import { wordDiff } from '../shared/diff.ts';
import { cleanName, shownNames } from '../shared/names.ts';
import { normalizeVoice } from '../shared/voices.ts';
import { fillThiefClue, lookOf, thiefCount } from '../shared/thief.ts';
import { assignLateJoiner, assignWarmup, factById, type WarmupView } from '../shared/warmup.ts';
import { assignIdentities, assignLateIdentity, assignLatePair, assignPairs, identityById, isWarmupKind, type WarmupKind } from '../shared/warmupKinds.ts';
import { randomName } from '../shared/randomNames.ts';
import { legalMove, zoneAt } from '../shared/plazaMap.ts';
import { XP, checkStyle, emotesFor, levelOf, readStyle, type Style } from '../shared/levels.ts';
import { REPORT_LINES_PER_STUDENT, type ClassReportData, type ReportLine } from '../shared/classReport.ts';
import { type Avatar, SPAWN, chatProblem, clampPosition, defaultAvatar, isBlocked, plazaName, sanitizeAvatar, secretsMatch } from './rules.ts';

const TICKET_MS = 60_000;
const TEACHER_SESSION_MS = 12 * 60 * 60 * 1000;
const CHAT_KEEP = 500;
const STATUS_HISTORY = 100;
const CHAT_GAP_MS = 1500;
const DEFAULT_VISION = 450; // map pixels a student sees around themselves in a new game
const MAX_VISION = 2000;
const REROLL_GAP_MS = 300; // between asks for another name
const WRONG_ANSWER_WAIT_MS = 3000; // before a student can try a chapter question again
const MOVE_BATCH_MS = 150; // positions go out together this often: one message a student, not one a step
const CHECK_GAP_MS = 800; // grammar hints cost money: no more than one a student can read
// Nearby chat reaches students within this many map pixels of where the sender stood.
export const HEARING_RANGE = 350;

// Close codes the client acts on.
const CLOSE_JOIN_AGAIN = 4001; // ticket unknown, used or expired
const CLOSE_REPLACED = 4009;   // the same student joined from another window
const CLOSE_CLASS_CLOSED = 4002; // the teacher closed the game

// Per-socket state. It lives in the socket's attachment, so it survives the
// room hibernating between messages.
type Seat = { id: string; game: string; zone?: string | null; studentKey: string; name: string; avatar: Avatar; style?: Style; x: number; y: number; lastChat: number; lastCheck?: number; lastReroll?: number; movedAt?: number; left?: boolean; frozenUntil?: number; downUntil?: number };

// 'approve': every message waits for the teacher. 'review': nearby chat that OpenAI
// cleared posts at once and the teacher reviews afterwards; whispers still wait.
export type ChatMode = 'approve' | 'review';

export type TeacherAction =
    | { kind: 'magic'; power: 'freeze' | 'thaw' | 'lightning' | 'teleport' | 'rain'; studentKey?: string; x?: number; y?: number }
    | { kind: 'status' }
    | { kind: 'open'; open: boolean; game?: string } // a saved game (the last played by default), or close the open one
    | { kind: 'newGame'; name: string; randomNames?: boolean; vision?: number } // a new game with its own PIN, opened at once
    | { kind: 'deleteGame'; game: string; confirm?: boolean } // erases a game and everything saved in it
    | { kind: 'vision'; radius: number }                // how far a student sees, in map pixels; 0 shows everyone
    | { kind: 'warmup'; op: 'start' | 'end'; type?: WarmupKind } // a get-to-know-you warm-up at the start of a lesson
    | { kind: 'campaign'; op: 'start' | 'next' | 'reveal' | 'reset'; campaign?: string; confirm?: boolean }
    | { kind: 'questRelease'; objective: string }
    | { kind: 'review'; id: string; approve: boolean } // approve = false also takes down a message already posted
    | { kind: 'approveAll' }
    | { kind: 'mode'; mode: ChatMode }
    | { kind: 'mute'; studentKey: string; muted: boolean }
    | { kind: 'xp'; chatId?: string; report?: { studentKey: string; objective: string } } // the teacher stars a message or a report
    | { kind: 'helpStatus'; id: string; status: HelpStatus; gameId?: string }
    | { kind: 'helpMessage'; studentKey: string; text: string; gameId?: string };

export type GameSummary = { id: string; name: string; pin: string; lastOpened: number; open: boolean; randomNames: boolean };

// Where this game's campaign stands, and what every student has done in it.
export type CampaignStatus = {
    id: string; title: string; status: QuestView['status']; chapter: number; chapters: number; chapterTitle: string; chapterTitles: string[];
    reveals: { shown: number; total: number; next: string | null }; // prepared news the teacher can release
    players: { studentKey: string; name: string; role: string; clues: number; done: string[]; thief: boolean }[];
    reports: { studentKey: string; objective: string; text: string; partner?: string; starred: boolean }[]; // what students wrote for the written questions
    interviews: (InterviewView & { studentKey: string; witnessKey: string; questionId: string; answerId: string | null })[];
    board?: ReturnType<QuestBoard['summary']>;
};

export type TeacherStatus = {
    support: TeacherSupport;
    warmup: { active: boolean; kind: WarmupKind; players: { studentKey: string; name: string; fact: string; found: number; of: number }[]; team: { done: number; total: number } } | null;
    campaign: CampaignStatus | null; // the open game's campaign, once started
    campaigns: CampaignChoice[]; // those that can be started, in the order to offer them
    open: boolean;
    game: { id: string; name: string; randomNames: boolean; vision: number } | null; // the open game, or the one last played
    realNames: Record<string, string>; // every student's real name, since the plaza may show made-up ones
    games: GameSummary[];                      // every saved game, most recently played first
    pin: string | null; // the open game's PIN, which students type to join
    entries: { id: string; studentKey: string; sender: string; target: string | null; flag: string | null; note: string | null; text: string; timestamp: number; status: string; starred: boolean }[];
    mode: ChatMode;
    moderation: boolean; // an OpenAI key is set, so 'review' mode can post anything
    muted: string[];
    online: { studentKey: string; name: string; x: number; y: number; zone: string | null; level: number }[];
};

const publicSeat = (seat: Seat) => ({ id: seat.id, name: seat.name, x: seat.x, y: seat.y, frozenUntil: seat.frozenUntil ?? 0, downUntil: seat.downUntil ?? 0, ...seat.avatar, ...(seat.style ? { style: seat.style } : {}) });

// The plaza. Everything that must outlast a lesson is a SQLite row: each student's
// looks, the games (a PIN each, kept for good) with where every student stood in
// them, the chat log, mutes, and which game is open. One game is open at a time. Who is online right now is the set of open sockets.
export class PlazaRoom extends DurableObject<Env> {
    private sql: SqlStorage;
    private missions: MissionRepository;
    private questBoard: QuestBoard;
    private interviews: Interviews;
    private assistance: StudentAssistance;
    private participation: Participation;
    private interviewSends = new Set<string>();
    private liveMissions: LiveMissions;
    private moves = new Map<string, [number, number]>(); // player id to latest position, not yet passed on
    private movesTimer: ReturnType<typeof setTimeout> | null = null;

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
            CREATE TABLE IF NOT EXISTS chat_audience (
                chat_id TEXT NOT NULL, game_id TEXT NOT NULL, student_key TEXT NOT NULL, voice TEXT NOT NULL,
                PRIMARY KEY (chat_id, student_key));
            CREATE INDEX IF NOT EXISTS chat_audience_game ON chat_audience (game_id);
            CREATE TABLE IF NOT EXISTS speech_budgets (
                student_key TEXT NOT NULL, kind TEXT NOT NULL, window INTEGER NOT NULL, used INTEGER NOT NULL,
                PRIMARY KEY (student_key, kind));
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
            CREATE TABLE IF NOT EXISTS warmups (game_id TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1, started INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS warmup_players (
                game_id TEXT NOT NULL, student_key TEXT NOT NULL, fact TEXT NOT NULL, targets TEXT NOT NULL,
                step INTEGER NOT NULL DEFAULT 0, last_wrong INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (game_id, student_key));
            CREATE TABLE IF NOT EXISTS campaign_thieves (
                game_id TEXT NOT NULL, chapter INTEGER NOT NULL, student_key TEXT NOT NULL, PRIMARY KEY (game_id, chapter, student_key));
            CREATE TABLE IF NOT EXISTS campaign_reports (
                game_id TEXT NOT NULL, student_key TEXT NOT NULL, objective TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL,
                PRIMARY KEY (game_id, student_key, objective));
            CREATE TABLE IF NOT EXISTS campaign_players (
                game_id TEXT NOT NULL, student_key TEXT NOT NULL, role_id TEXT NOT NULL, clues TEXT NOT NULL DEFAULT '[]',
                done TEXT NOT NULL DEFAULT '[]', last_wrong INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (game_id, student_key));`);
        // Older rooms predate nearby chat and whispers: their messages were for everyone.
        const chatColumns = this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('chat')").toArray().map(row => row.name);
        for (const [column, type] of [['target_key', 'TEXT'], ['target_name', 'TEXT'], ['x', 'REAL'], ['y', 'REAL'], ['flag', 'TEXT'], ['note', 'TEXT'], ['game_id', 'TEXT'], ['marks', 'TEXT'], ['voice', 'TEXT']]) {
            if (!chatColumns.includes(column)) this.sql.exec(`ALTER TABLE chat ADD COLUMN ${column} ${type}`);
        }
        // The whole name as PinPlay gives it, from which each game works out what to show.
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('students')").toArray().some(row => row.name === 'full_name')) {
            this.sql.exec('ALTER TABLE students ADD COLUMN full_name TEXT');
        }
        // Levels: a student's experience, kept for good, and the look they chose with it. Each award is
        // recorded by what earned it, so the same message or answer never counts twice.
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('students')").toArray().some(row => row.name === 'xp')) {
            this.sql.exec('ALTER TABLE students ADD COLUMN xp INTEGER NOT NULL DEFAULT 0');
            this.sql.exec('ALTER TABLE students ADD COLUMN style TEXT');
        }
        this.sql.exec(`CREATE TABLE IF NOT EXISTS xp_awards (student_key TEXT NOT NULL, source TEXT NOT NULL, amount INTEGER NOT NULL,
            reason TEXT NOT NULL, game_id TEXT, ts INTEGER NOT NULL, PRIMARY KEY (student_key, source))`);
        // Games from before made-up names keep showing real first names.
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('games')").toArray().some(row => row.name === 'random_names')) {
            this.sql.exec('ALTER TABLE games ADD COLUMN random_names INTEGER NOT NULL DEFAULT 0');
        }
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('campaigns')").toArray().some(row => row.name === 'revealed')) {
            this.sql.exec('ALTER TABLE campaigns ADD COLUMN revealed INTEGER NOT NULL DEFAULT 0');
        }
        // Games from before limited vision show everyone.
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('games')").toArray().some(row => row.name === 'vision')) {
            this.sql.exec('ALTER TABLE games ADD COLUMN vision INTEGER NOT NULL DEFAULT 0');
        }
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('warmups')").toArray().some(row => row.name === 'kind')) {
            this.sql.exec("ALTER TABLE warmups ADD COLUMN kind TEXT NOT NULL DEFAULT 'facts'");
        }
        this.adoptOldClass();
        this.missions = new MissionRepository(this.sql);
        this.missions.initialize();
        this.questBoard = new QuestBoard(this.sql);
        this.questBoard.initialize();
        this.interviews = new Interviews(this.sql);
        this.interviews.initialize();
        this.assistance = new StudentAssistance(this.sql);
        this.assistance.initialize();
        this.participation = new Participation(this.sql);
        this.participation.initialize();
        this.liveMissions = new LiveMissions(this.sql);
        this.liveMissions.initialize();
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

    missionStudio(token: string, op: string, body: unknown): MissionResult | LiveMissionResult {
        const session = this.sql.exec('SELECT 1 FROM teacher_sessions WHERE token = ? AND expires > ?', token, Date.now()).toArray();
        if (!token || session.length === 0) return { error: 'Please sign in again.', status: 401 };
        const result = this.ctx.storage.transactionSync(() => op.startsWith('live') || op === 'library-preview' ? this.liveMissionAction(token, op, body) : this.missions.execute(op, body));
        if (!('error' in result) && ('released' in result || 'withdrawn' in result)) {
            const game = this.activeGame(); if (game) this.sendQuestToAll(game);
        }
        return result;
    }

    private gameCampaign(game: string | null): Campaign | undefined {
        if (!game) return undefined;
        const base = this.missions.revision(this.campaignRow(game)?.revision_id ?? null);
        return base ? this.liveMissions.apply(game, base) : undefined;
    }
    private liveTarget(): LiveMissionTarget | null {
        const gameId = this.activeGame(); const game = this.game(gameId); const row = this.campaignRow(gameId);
        const campaign = this.gameCampaign(gameId); const chapter = campaign?.chapters[row?.chapter ?? 0];
        return game && row && row.revision_id && campaign && chapter ? {
            game: { id: game.id, name: game.name }, campaign: { id: campaign.id, title: campaign.title, revision: row.revision_id },
            chapter: { id: chapter.id, title: chapter.title, index: row.chapter }, version: row.live_version, epoch: row.live_epoch!, open: this.isOpen(), ended: row.status === 'campaign_complete',
            objectiveIds: campaign.chapters.flatMap(c => c.objectives.map(o => o.id)), additions: this.liveMissions.additions(game.id, chapter.id)
        } : null;
    }
    // How many students could accept each previewed quest right now: a snapshot for the teacher.
    private countEligible(target: LiveMissionTarget, campaign: Campaign, quests: Objective[], preview: { quests: { eligibleNow: number }[] }): void {
        const chapter = { ...campaign.chapters[target.chapter.index], objectives: [...campaign.chapters[target.chapter.index].objectives, ...quests] };
        const players = this.campaignPlayers(target.game.id);
        for (const [i, objective] of quests.entries()) preview.quests[i].eligibleNow = players.filter(p => {
            const ctx = this.boardContext(target.game.id, p.student_key)!;
            return ctx.online.has(p.student_key) && !boardWait(objective, chapter, p.role_id, p.done, true, ctx.online.size)
                && (!objective.activity || this.questBoard.partners({ ...ctx, chapter }, objective).length > 0);
        }).length;
    }

    private liveMissionAction(token: string, op: string, body: unknown): LiveMissionResult {
        const b = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
        const target = this.liveTarget();
        if (op === 'live') return { target };
        if (op === 'live-inspect') {
            const inspection = target && typeof b.id === 'string' ? this.liveMissions.inspect(target.game.id, b.id) : null;
            return inspection ? { target, inspection } : { error: 'Live quest not found in this game.', status: 404 };
        }
        if (op === 'live-cancel') { if (typeof b.previewId === 'string') this.liveMissions.cancel(token, b.previewId); return { target }; }
        if (!target?.open || target.ended) return { error: 'Open a game with a campaign in progress first.', status: 400 };
        const campaign = this.gameCampaign(target.game.id)!;
        if (op === 'live-preview') {
            if (b.gameId !== target.game.id || b.targetVersion !== target.version || b.targetEpoch !== target.epoch || b.chapterId !== target.chapter.id) return { error: 'The running game changed. Refresh the live target before reviewing quests.', status: 409 };
            const source = typeof b.sourceId === 'string' ? this.missions.draft(b.sourceId) : null;
            if (!source || source.version !== b.sourceVersion) return { error: 'The saved draft changed. Reopen it before reviewing a live release.', status: 409 };
            if (!Array.isArray(b.objectiveIds) || b.objectiveIds.some(id => typeof id !== 'string')) return { error: 'Choose valid quest IDs.', status: 400 };
            const result = this.liveMissions.preview(token, target, campaign, source.campaign, source.version, b.objectiveIds as string[]);
            if ('error' in result) return result;
            this.countEligible(target, campaign, result.quests, result.preview);
            return { target, preview: result.preview };
        }
        if (op === 'library-preview') {
            // Quests from the side quest library: the server builds them from its own copy of the library, so a page
            // can only choose which ones, never change what they say or accept.
            if (b.gameId !== target.game.id || b.targetVersion !== target.version || b.targetEpoch !== target.epoch || b.chapterId !== target.chapter.id) return { error: 'The running game changed. Refresh the live target before reviewing quests.', status: 409 };
            if (!Array.isArray(b.questIds) || b.questIds.some(id => typeof id !== 'string')) return { error: 'Choose quests from the library.', status: 400 };
            const ids = b.questIds as string[];
            const quests = ids.map(id => sideQuestById(id));
            if (quests.some(quest => !quest)) return { error: 'Choose quests from the library.', status: 400 };
            for (const quest of quests) {
                const reason = questFit(quest!, campaign, target.chapter.id);
                if (reason) return { error: `${quest!.title}: ${reason}`, status: 400 };
            }
            const source = structuredClone(campaign); source.id = SIDE_QUEST_SOURCE;
            source.chapters[target.chapter.index].objectives.push(...quests.map(quest => questObjective(quest!)).filter(quest => !campaign.chapters[target.chapter.index].objectives.some(o => o.id === quest.id)));
            const result = this.liveMissions.preview(token, target, campaign, source, SIDE_QUEST_LIBRARY_VERSION, ids);
            if ('error' in result) return result;
            this.countEligible(target, campaign, result.quests, result.preview);
            return { target, preview: result.preview };
        }
        if (op === 'live-release') {
            const preview = typeof b.previewId === 'string' ? this.liveMissions.pending(token, b.previewId) : undefined;
            if (!preview) return { error: 'This preview is no longer available. Review the quests again.', status: 409 };
            if (preview.expires <= Date.now() || preview.game_id !== target.game.id || preview.revision_id !== target.campaign.revision || preview.chapter_id !== target.chapter.id || preview.base_version !== target.version
                || (preview.source_id === SIDE_QUEST_SOURCE ? SIDE_QUEST_LIBRARY_VERSION : this.missions.draft(preview.source_id)?.version) !== preview.source_version) return { error: 'The preview expired or the game/draft changed. Review the quests again.', status: 409 };
            const released = this.liveMissions.release(preview);
            for (const id of released) this.questBoard.release(target.game.id, id);
            return { target: this.liveTarget(), released };
        }
        if (op === 'live-withdraw') {
            if (b.gameId !== target.game.id || b.targetVersion !== target.version || b.targetEpoch !== target.epoch) return { error: 'The running game changed. Refresh before withdrawing a quest.', status: 409 };
            if (typeof b.objectiveId !== 'string' || !target.additions.some(a => a.id === b.objectiveId)) return { error: 'Choose a live quest in the current chapter.', status: 400 };
            const error = this.liveMissions.withdraw(target.game.id, b.objectiveId, campaign);
            return error ? { error, status: 409 } : { target: this.liveTarget(), withdrawn: b.objectiveId };
        }
        return { error: 'Unknown live mission action.', status: 400 };
    }

    teacher(token: string, action: TeacherAction): TeacherStatus | { error: string; status: number } {
        const session = this.sql.exec('SELECT 1 FROM teacher_sessions WHERE token = ? AND expires > ?', token, Date.now()).toArray();
        if (!token || session.length === 0) return { error: 'Please sign in again.', status: 401 };
        if (action.kind === 'helpStatus' || action.kind === 'helpMessage') {
            const game = this.activeGame();
            if (!game || (action.gameId && action.gameId !== game)) return { error: 'The selected game changed. Refresh the controls.', status: 409 };
            if (action.kind === 'helpStatus') {
                if (!this.assistance.helpStatus(game, action.id, action.status)) return { error: 'That help request was not found.', status: 404 };
                for (const student of this.rosterNames(game).keys()) this.sendSupport(game, student);
            } else {
                if (!this.rosterNames(game).has(action.studentKey)) return { error: 'That student is not in this game.', status: 404 };
                if (!action.text.trim() || action.text.length > 1000) return { error: 'Write up to 1,000 characters.', status: 400 };
                this.assistance.teacherMessage(game, action.studentKey, action.text.trim());
                this.sendSupport(game, action.studentKey);
            }
        }
        if (action.kind === 'open') {
            if (action.open && action.game !== undefined && !this.game(action.game)) return { error: 'That game does not exist.', status: 400 };
            this.setOpen(action.open, action.game);
        }
        if (action.kind === 'campaign') {
            const failed = this.campaignAction(action);
            if (failed) return { error: failed, status: 400 };
        }
        if (action.kind === 'questRelease') {
            const game = this.activeGame(); const row = this.campaignRow(game);
            const objective = row && this.gameCampaign(game)?.chapters[row.chapter]?.objectives.find(o => o.id === action.objective);
            if (!game || !row || row.status === 'campaign_complete' || !objective?.board?.teacherReleased) return { error: 'That quest cannot be released in this chapter.', status: 400 };
            this.questBoard.release(game, objective.id); this.sendQuestToAll(game);
        }
        if (action.kind === 'warmup') {
            const game = this.activeGame();
            if (game === null) return { error: 'Open a game first.', status: 400 };
            if (action.op === 'start') {
                const failed = this.startWarmup(game, action.type ?? 'facts');
                if (failed) return { error: failed, status: 400 };
            } else {
                this.sql.exec('UPDATE warmups SET active = 0 WHERE game_id = ?', game);
                this.sendWarmupToAll(game);
            }
        }
        if (action.kind === 'deleteGame') {
            if (action.confirm !== true) return { error: 'Confirm to delete the game.', status: 400 };
            if (!this.game(action.game)) return { error: 'That game does not exist.', status: 400 };
            this.deleteGame(action.game);
        }
        if (action.kind === 'vision') {
            const game = this.activeGame();
            if (game === null || !Number.isFinite(action.radius)) return { error: 'Open a game first.', status: 400 };
            this.sql.exec('UPDATE games SET vision = ? WHERE id = ?', Math.max(0, Math.min(MAX_VISION, Math.round(action.radius))), game);
            this.broadcast({ t: 'vision', radius: this.vision(game) });
        }
        if (action.kind === 'newGame') {
            const name = action.name.trim().replace(/\s+/g, ' ').slice(0, 40);
            if (!name) return { error: 'Give the game a name.', status: 400 };
            this.setOpen(true, this.createGame(name, action.randomNames !== false, action.vision ?? DEFAULT_VISION));
        }
        if (action.kind === 'review' && !this.review(action.id, action.approve)) {
            return { error: 'That message is no longer pending.', status: 400 };
        }
        if (action.kind === 'approveAll') {
            const pending = this.sql.exec<{ id: string }>("SELECT id FROM chat WHERE status = 'pending' AND game_id IS ? ORDER BY ts", this.activeGame()).toArray();
            for (const { id } of pending) this.review(id, true);
        }
        if (action.kind === 'xp') {
            const failed = this.teacherStar(action);
            if (failed) return { error: failed, status: 400 };
        }
        if (action.kind === 'mode') this.saveSetting('mode', action.mode);
        if (action.kind === 'magic') {
            if (!this.isOpen()) return { error: 'Open the class first.', status: 400 };
            if (action.power === 'rain') this.broadcast({ t: 'rain', until: Date.now() + 15000 });
            else {
                const socket = this.ctx.getWebSockets().find(ws => {
                    const seat = ws.deserializeAttachment() as Seat | null;
                    return seat && !seat.left && seat.game === this.activeGame() && seat.studentKey === action.studentKey;
                });
                const seat = socket?.deserializeAttachment() as Seat | undefined;
                if (!socket || !seat) return { error: 'Select a student who is online.', status: 400 };
                if (action.power === 'teleport') {
                    const position = clampPosition(action.x, action.y);
                    if (!position || isBlocked(position.x, position.y)) return { error: 'Choose an open path on the map.', status: 400 };
                    seat.x = position.x; seat.y = position.y; seat.movedAt = Date.now();
                    this.discover(seat);
                    this.moves.delete(seat.id);
                    socket.send(JSON.stringify({ t: 'snap', x: seat.x, y: seat.y }));
                    this.broadcast({ t: 'move', id: seat.id, x: seat.x, y: seat.y });
                } else {
                    if (action.power === 'freeze') seat.frozenUntil = Date.now() + 15000;
                    if (action.power === 'thaw') seat.frozenUntil = 0;
                    if (action.power === 'lightning') seat.downUntil = Date.now() + 4000;
                    this.broadcast({ t: 'magic', id: seat.id, power: action.power, frozenUntil: seat.frozenUntil ?? 0, downUntil: seat.downUntil ?? 0 });
                }
                socket.serializeAttachment(seat);
            }
        }
        if (action.kind === 'mute') {
            if (action.muted) this.sql.exec('INSERT OR IGNORE INTO mutes (student_key) VALUES (?)', action.studentKey);
            else this.sql.exec('DELETE FROM mutes WHERE student_key = ?', action.studentKey);
        }
        // The dashboard polls every 2 seconds: send everything still pending plus
        // recent history, read through the indexes, not the whole log each time.
        const current = this.game(this.activeGame());
        return {
            support: { alerts: current ? this.assistance.alerts(current.id, this.rosterNames(current.id)) : [],
                ai: this.assistance.aiCount(this.helpSession()),
                students: current ? [...this.rosterNames(current.id)].map(([studentKey, name]) => ({ studentKey, name })) : [] },
            warmup: this.warmupStatus(current?.id ?? null),
            campaign: this.campaignStatus(current?.id ?? null),
            campaigns: this.missions.published(),
            open: this.isOpen(),
            game: current && { id: current.id, name: current.name, randomNames: this.isRandom(current.id), vision: this.vision(current.id) },
            realNames: Object.fromEntries(this.sql.exec<{ student_key: string; full: string }>(
                'SELECT student_key, COALESCE(full_name, name) AS full FROM students').toArray().map(row => [row.student_key, row.full])),
            games: this.sql.exec<{ id: string; name: string; pin: string; lastOpened: number; randomNames: number }>(
                'SELECT id, name, pin, last_opened AS lastOpened, random_names AS randomNames FROM games ORDER BY last_opened DESC').toArray()
                .map(game => ({ ...game, randomNames: game.randomNames === 1, open: this.isOpen() && game.id === current?.id })),
            pin: this.classPin(),
            entries: this.sql.exec<Omit<TeacherStatus['entries'][number], 'starred'>>(`SELECT id, student_key AS studentKey, sender, target_name AS target, flag, note, text,
                ts AS timestamp, status FROM (
                    SELECT * FROM chat WHERE status = 'pending' AND game_id IS ?
                    UNION SELECT * FROM (SELECT * FROM chat WHERE game_id IS ? ORDER BY ts DESC LIMIT ?))
                ORDER BY ts DESC`, current?.id ?? null, current?.id ?? null, STATUS_HISTORY).toArray()
                .map(entry => ({ ...entry, starred: this.starred(entry.studentKey, `teacher:${entry.id}`) })),
            mode: this.mode(),
            moderation: !!this.env.OPENAI_API_KEY,
            muted: this.sql.exec<{ student_key: string }>('SELECT student_key FROM mutes').toArray().map(row => row.student_key),
            online: this.seats().filter(seat => seat.game === current?.id).map(seat => ({
                studentKey: seat.studentKey, name: seat.name, x: seat.x, y: seat.y, zone: zoneAt(seat.x, seat.y), level: levelOf(this.xpOf(seat.studentKey)).level
            }))
        };
    }

    // ---------- The plaza socket ----------

    teacherAttempts(token: string, studentKey?: string, cursor?: string | null, gameId?: string): AttemptPage | { error: string; status: number } {
        if (!token || !this.sql.exec('SELECT 1 FROM teacher_sessions WHERE token = ? AND expires > ?', token, Date.now()).toArray().length) return { error: 'Please sign in again.', status: 401 };
        const game = this.activeGame();
        if (gameId && gameId !== game) return { error: 'The selected game changed. Refresh the controls.', status: 409 };
        if (!game) return { attempts: [], next: null };
        try { return this.assistance.page(game, studentKey, cursor); }
        catch { return { error: 'That history cursor is no longer valid. Refresh the history.', status: 400 }; }
    }

    // The log of this lesson (since the class was opened) or of the whole game, for the AI report prompt. Every
    // student who took part is in it, those who wrote nothing too: that is part of the picture.
    classReport(token: string, scope: 'lesson' | 'game'): ClassReportData | { error: string; status: number } {
        if (!token || !this.sql.exec('SELECT 1 FROM teacher_sessions WHERE token = ? AND expires > ?', token, Date.now()).toArray().length) return { error: 'Please sign in again.', status: 401 };
        const game = this.activeGame();
        const row = game && this.sql.exec<{ name: string; last_opened: number }>('SELECT name, last_opened FROM games WHERE id = ?', game).toArray()[0];
        if (!game || !row) return { error: 'Open a game first.', status: 400 };
        const from = scope === 'lesson' ? row.last_opened : 0;
        const campaign = this.gameCampaign(game); const campaignRow = this.campaignRow(game);
        const questions = new Map((campaign?.chapters ?? []).flatMap(chapter => chapter.objectives).map(objective => [objective.id, objective.text]));
        const roles = new Map(this.campaignPlayers(game).map(player => [player.student_key, campaign?.roles.find(role => role.id === player.role_id)?.name ?? null]));
        const starred = new Set(this.sql.exec<{ source: string }>("SELECT source FROM xp_awards WHERE game_id = ? AND source LIKE 'teacher:%'", game).toArray().map(award => award.source.slice('teacher:'.length)));
        const gained = new Map(this.sql.exec<{ student_key: string; xp: number }>('SELECT student_key, SUM(amount) AS xp FROM xp_awards WHERE game_id = ? AND ts >= ? GROUP BY student_key', game, from).toArray().map(award => [award.student_key, award.xp]));
        const warmup = new Map((this.warmupStatus(game)?.players ?? []).map(player => [player.studentKey, { found: player.found, of: player.of }]));
        const online = new Set(this.seats().filter(seat => seat.game === game).map(seat => seat.studentKey));
        const lines = new Map<string, ReportLine[]>();
        for (const attempt of this.sql.exec<{ student_key: string; ts: number; source: string; status: string; text: string; target: string | null; objective: string | null; correction: string | null; final_text: string | null; reason: string | null; chat_id: string | null }>(
            'SELECT student_key, ts, source, status, text, target, objective, correction, final_text, reason, chat_id FROM assistance_attempts WHERE game_id = ? AND ts >= ? ORDER BY ts, id', game, from)) {
            const list = lines.get(attempt.student_key) ?? []; lines.set(attempt.student_key, list);
            list.push({ ts: attempt.ts, source: attempt.source as ReportLine['source'], status: attempt.status, text: attempt.text.slice(0, 400), target: attempt.target,
                question: attempt.objective ? questions.get(attempt.objective) ?? null : null, correction: attempt.correction, finalText: attempt.final_text,
                reason: attempt.reason, starred: !!attempt.chat_id && starred.has(attempt.chat_id) });
        }
        // Who was there: everyone who wrote, everyone here now, and everyone who left during the lesson.
        const seen = new Set(this.sql.exec<{ student_key: string }>('SELECT student_key FROM students WHERE last_seen >= ?', from).toArray().map(student => student.student_key));
        const real = new Map(this.sql.exec<{ student_key: string; full: string }>('SELECT student_key, COALESCE(full_name, name) AS full FROM students').toArray().map(student => [student.student_key, student.full]));
        const students = [...this.rosterNames(game)].filter(([key]) => lines.has(key) || online.has(key) || seen.has(key)).map(([key, name]) => {
            const all = lines.get(key) ?? [];
            return { studentKey: key, name, realName: real.get(key) ?? name, online: online.has(key), role: roles.get(key) ?? null,
                level: levelOf(this.xpOf(key)).level, xp: gained.get(key) ?? 0, warmup: warmup.get(key) ?? null,
                lines: all.slice(-REPORT_LINES_PER_STUDENT), earlier: Math.max(0, all.length - REPORT_LINES_PER_STUDENT) };
        });
        return { game: row.name, scope, from, to: Date.now(), students,
            campaign: campaign && campaignRow ? { title: campaign.title, chapter: campaignRow.chapter, chapters: campaign.chapters.length,
                chapterTitle: campaign.chapters[Math.min(campaignRow.chapter, campaign.chapters.length - 1)].title } : null };
    }

    // Audio may only reproduce a message this student actually received in the
    // current game. Stored recipients preserve earshot after players move and
    // fail closed for legacy messages without delivery provenance.
    speechMessage(studentKey: string, id: string): { text: string; voice: string } | null {
        const game = this.activeGame();
        if (!game || !this.isOpen()) return null;
        if (id.startsWith('teacher:')) return null; // Teacher help may mix Catalan and English.
        const row = this.sql.exec<{ text: string; voice: string }>(`SELECT c.text, a.voice FROM chat c
            JOIN chat_audience a ON a.chat_id = c.id AND a.game_id = c.game_id
            WHERE c.id = ? AND c.game_id = ? AND c.status = 'approved' AND a.student_key = ?`, id, game, studentKey).toArray()[0];
        if (row) return { text: row.text, voice: normalizeVoice(row.voice) };
        const privateMessage = this.sql.exec<{ text: string; voice: string }>(`SELECT TRIM(p.final_text) AS text, a.voice
            FROM assistance_attempts p JOIN chat_audience a ON a.chat_id = p.id AND a.game_id = p.game_id
            WHERE p.id = ? AND p.game_id = ? AND p.student_key = ? AND a.student_key = ?
            AND p.status = 'teacher-inbox' AND p.source = 'chat' AND p.target = 'Teacher'`, id, game, studentKey, studentKey).toArray()[0];
        return privateMessage?.text ? { text: privateMessage.text, voice: normalizeVoice(privateMessage.voice) } : null;
    }

    // An independent budget: listening must never consume sign-in/PIN attempts.
    // Durable counters also survive room hibernation and Worker restarts.
    spendSpeech(studentKey: string, preview: boolean): boolean {
        const kind = preview ? 'preview' : 'message'; const window = Math.floor(Date.now() / 60_000);
        this.sql.exec(`INSERT INTO speech_budgets (student_key, kind, window, used) VALUES (?, ?, ?, 1)
            ON CONFLICT(student_key, kind) DO UPDATE SET
                used = CASE WHEN window = excluded.window THEN used + 1 ELSE 1 END, window = excluded.window`, studentKey, kind, window);
        const used = this.sql.exec<{ used: number }>('SELECT used FROM speech_budgets WHERE student_key = ? AND kind = ?', studentKey, kind).one().used;
        return used <= (preview ? 12 : 90);
    }

    private sendSupport(game: string, student: string, history = false): void {
        const support = this.assistance.studentState(game, student);
        support.ai = this.assistance.aiState(this.helpSession(), student, !!this.env.OPENAI_API_KEY);
        for (const ws of this.ctx.getWebSockets(student)) {
            const seat = ws.deserializeAttachment() as Seat | null;
            if (seat?.game === game && !seat.left) try { ws.send(JSON.stringify({ t: 'support', support, ...(history ? { history: true } : {}) })); } catch { /* reconnect will replay */ }
        }
    }

    private helpSession(): string {
        const existing = this.setting('help_session');
        if (existing) return existing;
        const id = crypto.randomUUID(); this.saveSetting('help_session', id); return id;
    }

    private async requestHelp(seat: Seat, data: Record<string, unknown>): Promise<void> {
        const topics: HelpTopic[] = ['writing', 'instructions', 'classmate-message', 'other'];
        if (!topics.includes(data.topic as HelpTopic) || (data.text !== undefined && typeof data.text !== 'string')
            || (typeof data.text === 'string' && data.text.length > 500) || !this.isOpen() || seat.game !== this.activeGame()) return;
        const topic = data.topic as HelpTopic; const note = typeof data.text === 'string' ? data.text : '';
        const audit = this.beginAttempt(seat, note || `Help requested: ${topic}`, 'help', typeof data.attemptId === 'string' ? data.attemptId : undefined, 'teacher', topic);
        const session = this.helpSession();
        this.assistance.joinSession(session, seat.game, seat.studentKey);
        const teacher = (reason: string) => {
            this.attemptStatus(audit, 'help-requested', reason);
            this.assistance.request(seat.game, seat.studentKey, seat.name, topic, note, false);
            this.sendSupport(seat.game, seat.studentKey);
        };
        // Older clients cannot display AI hints, so only an explicit new-UI
        // request opts into AI. All routes still share the same server quota.
        if (data.route !== 'auto' || !this.env.OPENAI_API_KEY || !this.assistance.reserveAi(session, seat.studentKey, audit)) {
            teacher(data.route === 'teacher' ? 'Student requested the teacher directly.' : 'Personal teacher assistance.'); return;
        }
        this.attemptStatus(audit, 'ai-help-pending', 'Preparing one language hint.');
        this.assistance.request(seat.game, seat.studentKey, seat.name, topic, note, false);
        this.sendSupport(seat.game, seat.studentKey);
        const tip = await languageHelp(note, topic, this.env);
        if (!this.isOpen() || this.activeGame() !== seat.game || this.helpSession() !== session) {
            this.assistance.finishAi(session, seat.studentKey, audit, null);
            this.attemptStatus(audit, 'unavailable', 'The classroom session ended before help was ready.'); return;
        }
        if (!this.assistance.finishAi(session, seat.studentKey, audit, tip)) return;
        if (!tip) { teacher('AI help was unavailable; teacher notified. AI allowance remains unused.'); return; }
        this.attemptStatus(audit, 'ai-help', tip);
        this.sendSupport(seat.game, seat.studentKey);
    }

    private beginAttempt(seat: Seat, text: string, source: AttemptSource, id?: string, to?: unknown, objective?: string): string {
        const target = to === 'teacher' ? 'Teacher' : this.seats().find(s => s.game === seat.game && s.id === to)?.name;
        return this.assistance.begin({ game: seat.game, studentKey: seat.studentKey, name: seat.name,
            text, source, id: id && id.length <= 80 ? id : undefined, target, objective });
    }

    private attemptStatus(id: string, status: string, reason?: string, chatId?: string): void {
        this.assistance.update(id, status, reason, this.assistance.get(id)?.correction, chatId);
    }

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
        this.assistance.joinSession(this.helpSession(), game, row.student_key);
        this.refreshNames(game);
        const saved = this.sql.exec<{ name: string; avatar: string | null; x: number | null; y: number | null; xp: number; style: string | null }>(
            `SELECT s.name AS name, s.avatar AS avatar, s.xp AS xp, s.style AS style, p.x AS x, p.y AS y FROM students s
             LEFT JOIN positions p ON p.student_key = s.student_key AND p.game_id = ? WHERE s.student_key = ?`,
            game, row.student_key).one();
        // Where they stood last time in this game, unless the map has changed under them since
        const spot = saved.x != null && saved.y != null && !isBlocked(saved.x, saved.y)
            ? { x: saved.x, y: saved.y }
            : { x: SPAWN.x + Math.round(Math.random() * 100 - 50), y: SPAWN.y + Math.round(Math.random() * 100 - 50) };
        const seat: Seat = {
            id: crypto.randomUUID().slice(0, 8), game, studentKey: row.student_key, name: this.rosterNames(game).get(row.student_key) ?? saved.name,
            avatar: (saved.avatar && sanitizeAvatar(JSON.parse(saved.avatar))) || defaultAvatar(),
            style: readStyle(saved.style, levelOf(saved.xp).level),
            x: spot.x, y: spot.y,
            lastChat: 0, movedAt: Date.now()
        };
        const others = this.seats();
        this.ctx.acceptWebSocket(server, [seat.studentKey]);
        server.serializeAttachment(seat);
        server.send(JSON.stringify({ t: 'welcome', id: seat.id, gameId: seat.game, players: [...others, seat].map(publicSeat) }));
        this.broadcast({ t: 'join', player: publicSeat(seat) }, server);
        if (replaced.length === 0) this.systemChat(`${seat.name} has joined the Plaza.`, server);
        this.sendQuest(server, seat.game, seat.studentKey, true);
        try { server.send(JSON.stringify({ t: 'xp', xp: saved.xp })); } catch { /* closing */ }
        this.sendAlias(server, seat.game, seat.studentKey);
        this.sendVision(server, seat.game);
        // A late arrival's part changes everyone's team total, so all get the warm-up again.
        if (this.lateWarmupPart(seat.game, seat.studentKey)) this.sendWarmupToAll(seat.game);
        else this.sendWarmup(server, seat.game, seat.studentKey);
        this.sendSupport(seat.game, seat.studentKey, true);
        this.refreshBoard(seat.game);
        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
        if (typeof message !== 'string' || message.length > 8192) return;
        const seat = ws.deserializeAttachment() as Seat | null;
        if (!seat || seat.left) return;
        let data: any;
        try { data = JSON.parse(message); } catch { return; }

        if ((data?.t === 'attempt' || data?.t === 'attempt-outcome') && typeof data.id === 'string'
            && typeof data.gameId === 'string' && data.gameId !== seat.game) {
            ws.send(JSON.stringify({ t: 'attempt-recorded', id: data.id, kind: data.t }));
            return;
        }
        if (data?.t === 'attempt' && typeof data.id === 'string' && data.id.length <= 80 && typeof data.text === 'string' && data.text.length <= 1000) {
            const sources: AttemptSource[] = ['chat', 'interview', 'answer', 'warmup', 'help'];
            if (sources.includes(data.source)) this.beginAttempt(seat, data.text, data.source, data.id, data.to, typeof data.objective === 'string' ? data.objective.slice(0, 64) : undefined);
            ws.send(JSON.stringify({ t: 'attempt-recorded', id: data.id, kind: 'attempt' }));
        } else if (data?.t === 'attempt-outcome' && typeof data.id === 'string') {
            const id = this.assistance.owned(seat.game, seat.studentKey, data.id);
            const attempt = id && this.assistance.get(id);
            if (id && attempt && ['submitted', 'hint-offered', 'language-checked'].includes(attempt.status)
                && ['language-blocked', 'not-sent'].includes(data.status) && typeof data.reason === 'string') {
                const reason = data.reason.slice(0, 500);
                this.attemptStatus(id, data.status, reason);
                if (data.status === 'language-blocked') this.assistance.signal(seat.game, seat.studentKey, seat.name, `Word check: ${reason}`, attempt.text);
            }
            ws.send(JSON.stringify({ t: 'attempt-recorded', id: data.id, kind: 'attempt-outcome' }));
        } else if (data?.t === 'help-request') {
            await this.requestHelp(seat, data);
        } else if (data?.t === 'move') {
            const position = clampPosition(data.x, data.y);
            if (!position) return;
            // A move through a wall, or further than anyone can walk, puts the student back where they were.
            const now = Date.now();
            if (Math.max(seat.frozenUntil ?? 0, seat.downUntil ?? 0) > now || this.env.MOVEMENT_CHECK !== '0' && !legalMove(seat.x, seat.y, position.x, position.y, now - (seat.movedAt ?? now))) {
                try { ws.send(JSON.stringify({ t: 'snap', x: seat.x, y: seat.y })); } catch { /* closing */ }
                return;
            }
            seat.movedAt = now;
            seat.x = position.x;
            seat.y = position.y;
            this.discover(seat);
            ws.serializeAttachment(seat);
            this.queueMove(seat.id, position.x, position.y);
        } else if (data?.t === 'warmup-answer' && typeof data.text === 'string') {
            this.warmupAnswer(ws, seat, data.text, typeof data.attemptId === 'string' ? data.attemptId : undefined);
        } else if (data?.t === 'answer' && typeof data.objective === 'string' && typeof data.text === 'string') {
            this.answer(ws, seat, data.objective, data.text, typeof data.attemptId === 'string' ? data.attemptId : undefined);
        } else if (data?.t === 'quest-accept' && typeof data.objective === 'string') {
            this.claimQuest(ws, seat, data.objective, data.changePartner === true);
        } else if (data?.t === 'interview-ask' || data?.t === 'interview-reply') {
            await this.interviewTurn(ws, seat, data);
        } else if (data?.t === 'reroll' || data?.t === 'keep') {
            this.chooseAlias(ws, seat, data.t === 'keep');
        } else if (data?.t === 'emote' && typeof data.emote === 'string' && emotesFor(levelOf(this.xpOf(seat.studentKey)).level).includes(data.emote)) {
            this.broadcast({ t: 'emote', id: seat.id, emote: data.emote });
        } else if (data?.t === 'style') {
            // A name colour and a flair, as far as the student's level allows.
            const style = checkStyle(data, levelOf(this.xpOf(seat.studentKey)).level);
            if (!style) return;
            this.sql.exec('UPDATE students SET style = ? WHERE student_key = ?', JSON.stringify(style), seat.studentKey);
            seat.style = style;
            ws.serializeAttachment(seat);
            this.broadcast({ t: 'style', id: seat.id, style });
        } else if (data?.t === 'check') {
            await this.grammar(ws, seat, data.id, data.text, typeof data.attemptId === 'string' ? data.attemptId : undefined);
        } else if (data?.t === 'chat') {
            // What the student did with a grammar hint, for the teacher to see.
            const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 200) : null);
            const note = text(data.was) ? `Used the suggestion. They wrote: "${text(data.was)}"`
                : text(data.better) ? `Kept their own words. Suggested: "${text(data.better)}"` : null;
            await this.chat(ws, seat, data.text, data.to, note, typeof data.cid === 'string' ? data.cid.slice(0, 64) : undefined, text(data.better), undefined,
                typeof data.attemptId === 'string' ? data.attemptId : typeof data.cid === 'string' ? data.cid : undefined);
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

    private campaignRow(game: string | null): { campaign_id: string; chapter: number; status: QuestView['status']; revealed: number; revision_id: string | null; live_version: number; live_epoch: string | null } | null {
        return game === null ? null : this.sql.exec<{ campaign_id: string; chapter: number; status: QuestView['status']; revealed: number; revision_id: string | null; live_version: number; live_epoch: string | null }>(
            'SELECT campaign_id, chapter, status, revealed, revision_id, live_version, live_epoch FROM campaigns WHERE game_id = ?', game).toArray()[0] ?? null;
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
        const campaign = this.gameCampaign(game);
        if (!campaign || campaign.id !== campaignId) return null;
        const role = pickRole(campaign.roles, this.campaignPlayers(game).map(row => row.role_id), Math.random());
        this.sql.exec('INSERT INTO campaign_players (game_id, student_key, role_id) VALUES (?, ?, ?)', game, studentKey, role.id);
        return { student_key: studentKey, role_id: role.id, clues: [] as string[], done: [] as string[], last_wrong: 0 };
    }

    // The students who took the chestnuts in this chapter, in the order they were chosen.
    private thieves(game: string, chapter: number): string[] {
        return this.sql.exec<{ student_key: string }>('SELECT student_key FROM campaign_thieves WHERE game_id = ? AND chapter = ? ORDER BY rowid', game, chapter)
            .toArray().map(row => row.student_key);
    }

    // At random from those who have joined: one for a class, two above fifteen. Chosen once, and only when
    // at least two students are there to play it. A thief never has to answer who the thief is.
    // The thieves a chapter uses: its own, or for a chapter that carries them on, those of the chapter before.
    private chapterThieves(game: string, campaign: { chapters: { thieves?: { carry?: boolean } }[] }, chapterIndex: number): string[] {
        let index = chapterIndex;
        while (index > 0 && campaign.chapters[index]?.thieves?.carry) index--;
        return this.thieves(game, index);
    }

    // The thieves already know some answers, and are not asked who the thief is: those count as done for them.
    private settleThieves(game: string, campaign: { chapters: { thieves?: { carry?: boolean }; objectives: { id: string; answerThief?: boolean; thiefKnows?: boolean }[] }[] }, chapterIndex: number): void {
        const skipped = campaign.chapters[chapterIndex]?.objectives.filter(objective => objective.answerThief || objective.thiefKnows).map(objective => objective.id) ?? [];
        if (skipped.length === 0 || !campaign.chapters[chapterIndex].thieves) return;
        for (const player of this.campaignPlayers(game)) {
            if (!this.chapterThieves(game, campaign, chapterIndex).includes(player.student_key) || skipped.every(id => player.done.includes(id))) continue;
            this.sql.exec('UPDATE campaign_players SET done = ? WHERE game_id = ? AND student_key = ?',
                JSON.stringify([...new Set([...player.done, ...skipped])]), game, player.student_key);
        }
    }

    private pickThieves(game: string, chapterIndex: number, chapter: { thieves?: { carry?: boolean }; objectives: { id: string; answerThief?: boolean; thiefKnows?: boolean }[] } | undefined): void {
        if (!chapter?.thieves || chapter.thieves.carry || this.thieves(game, chapterIndex).length > 0) return;
        const players = this.campaignPlayers(game);
        // Only from students who are in the plaza now: an absent thief would leave the class chasing nobody.
        const here = new Set(this.seats().filter(seat => seat.game === game).map(seat => seat.studentKey));
        const present = players.filter(player => here.has(player.student_key));
        if (present.length < 2) return;
        // And, where the class is big enough, not from a role nobody else plays, whose clue would be lost with them.
        const sharedRole = present.filter(player => present.filter(other => other.role_id === player.role_id).length > 1);
        const pool = (sharedRole.length >= thiefCount(present.length) ? sharedRole : present).map(player => player.student_key);
        for (let n = thiefCount(present.length); n > 0; n--) {
            const [key] = pool.splice(Math.floor(Math.random() * pool.length), 1);
            this.sql.exec('INSERT INTO campaign_thieves (game_id, chapter, student_key) VALUES (?, ?, ?)', game, chapterIndex, key);
            const player = players.find(item => item.student_key === key)!;
            const skipped = chapter.objectives.filter(objective => objective.answerThief || objective.thiefKnows).map(objective => objective.id);
            this.sql.exec('UPDATE campaign_players SET done = ? WHERE game_id = ? AND student_key = ?',
                JSON.stringify([...new Set([...player.done, ...skipped])]), game, key);
        }
    }

    private avatarOf(studentKey: string): Avatar {
        const row = this.sql.exec<{ avatar: string | null }>('SELECT avatar FROM students WHERE student_key = ?', studentKey).toArray()[0];
        return (row?.avatar && sanitizeAvatar(JSON.parse(row.avatar))) || defaultAvatar();
    }

    private meetingFallback(game: string, studentKey: string, roleId: string, campaign: { roles: { id: string; name: string }[] }): string | null {
        const online = new Set(this.seats().filter(seat => seat.game === game).map(seat => seat.studentKey));
        const peer = this.campaignPlayers(game).some(player => player.role_id === roleId && player.student_key !== studentKey && online.has(player.student_key));
        return peer ? null : campaign.roles.find(role => role.id === roleId)?.name ?? null;
    }

    // What this student may see of the campaign, or null before it starts.
    private questView(game: string, studentKey: string, withRecap = false): QuestView | null {
        const row = this.campaignRow(game);
        const campaign = row && this.gameCampaign(game);
        if (!row || !campaign) return null;
        let player = this.player(game, studentKey, row.campaign_id);
        const role = campaign.roles.find(item => item.id === player?.role_id);
        const chapter = campaign.chapters[Math.min(row.chapter, campaign.chapters.length - 1)];
        if (!player || !role) return null;
        this.pickThieves(game, row.chapter, campaign.chapters[row.chapter]);
        this.settleThieves(game, campaign, row.chapter);
        // Thief selection can mark already-known objectives done in this view.
        player = this.campaignPlayers(game).find(item => item.student_key === studentKey) ?? player;
        const thieves = this.chapterThieves(game, campaign, row.chapter);
        const isThief = thieves.includes(studentKey);
        const looks = thieves.map(key => lookOf(this.avatarOf(key)));
        const names = this.rosterNames(game);
        const found = campaign.chapters.flatMap(item => item.discoveries).filter(discovery => player.clues.includes(discovery.id));
        const online = new Set(this.seats().filter(seat => seat.game === game).map(seat => seat.studentKey));
        const present = this.campaignPlayers(game).filter(item => online.has(item.student_key));
        const fallback = absentRoleClues(campaign, chapter, role.id, player.done,
            present.filter(item => !chapter.thieves || !thieves.includes(item.student_key)).map(item => item.role_id),
            present.map(item => item.role_id));
        const showResolution = row.status === 'campaign_complete' || mainFinished(chapter, player.done);
        return {
            campaign: { id: campaign.id, title: campaign.title },
            status: row.status,
            chapter: { index: row.chapter, of: campaign.chapters.length, title: chapter.title, intro: chapter.intro,
                ending: row.status === 'active' || !showResolution ? null : chapter.ending },
            role: { id: role.id, name: role.name, card: role.card },
            clues: [
                { id: `role-${role.id}`, from: 'job',
                    text: isThief && chapter.thieves ? `${chapter.thieves.label ?? 'Your story'}: ${chapter.thieves.story}` : fillThiefClue(chapter.roleClues?.[role.id] ?? role.clue, looks) },
                ...found.map(item => ({ id: item.id, text: item.text, from: item.zone })),
                ...rewardClues(chapter, role.id, player.done).map(item => ({ ...item, from: 'reward' })),
                ...fallback.map(item => ({ ...item, text: fillThiefClue(item.text, looks) })),
                ...chapter.reveals.slice(0, row.revealed).map(item => ({ id: `news-${item.id}`, text: item.text, from: 'news' })),
            ],
            // Reaching the class threshold does not close questions; the teacher advances the chapter.
            secret: isThief && chapter.thieves ? { title: 'You are the thief', text: chapter.thieves.card } : null,
            thieves: chapter.thieves && row.status !== 'active' && showResolution ? thieves.map(key => names.get(key) ?? 'Student') : null,
            objectives: chapter.objectives.filter(objective => !objective.board && isUnlocked(objective, player.done) && (row.status !== 'campaign_complete' || objective.optional)
                && !(isThief && (objective.answerThief || objective.thiefKnows)))
                .map(objective => {
                    const fallback = objective.answerRole && this.meetingFallback(game, studentKey, objective.answerRole, campaign);
                    return { id: objective.id, text: objective.text + (fallback
                        ? ` No classmate with this role is available. Type the role name (${fallback}) to continue with the town notice.` : ''), done: player.done.includes(objective.id), optional: !!objective.optional,
                        kind: objective.kind === 'report' ? 'report' as const : objective.answerRole ? 'name' as const : 'text' as const,
                        ...(objective.conversation ? { conversation: this.conversation(game, studentKey, objective) } : {}) };
                }),
            ...(chapter.objectives.some(o => o.board) ? { board: this.questBoard.view(this.boardContext(game, studentKey)!).map(item => {
                const objective = chapter.objectives.find(o => o.id === item.id)!;
                return { ...item, ...(objective.activity || objective.conversation ? { conversation: this.conversation(game, studentKey, objective) } : {}) };
            }) } : {}),
            interviews: this.interviews.view(game, row.chapter, studentKey, names, new Map(chapter.objectives.map(o => [o.id, o.text]))),
            team: teamProgress(chapter, this.campaignPlayers(game).map(item => ({ done: item.done, thief: thieves.includes(item.student_key) }))),
            // "Previously", for a student coming back to a story that is already under way
            recap: !withRecap || row.status !== 'active' ? null
                : row.chapter > 0 ? campaign.chapters[row.chapter - 1].ending
                : player.clues.length || player.done.length ? chapter.recap : null,
            finale: row.status === 'campaign_complete' ? campaign.finale : null
        };
    }

    private sendQuest(target: WebSocket, game: string, studentKey: string, withRecap = false): void {
        const quest = this.questView(game, studentKey, withRecap);
        if (quest) try { target.send(JSON.stringify({ t: 'quest', quest })); } catch { /* closing */ }
    }

    private boardContext(game: string, studentKey: string): BoardContext | null {
        const row = this.campaignRow(game); const chapter = row && this.gameCampaign(game)?.chapters[row.chapter];
        const players = this.campaignPlayers(game); const player = players.find(p => p.student_key === studentKey);
        const kept = this.isRandom(game) ? new Set(this.sql.exec<{ student_key: string }>('SELECT student_key FROM aliases WHERE game_id = ? AND kept = 1', game).toArray().map(r => r.student_key)) : null;
        return row && chapter && player ? { game, chapterIndex: row.chapter, chapter, status: row.status, player, players,
            online: new Set(this.seats().filter(s => s.game === game && (!kept || kept.has(s.studentKey))).map(s => s.studentKey)), names: this.rosterNames(game) } : null;
    }
    private claimQuest(ws: WebSocket, seat: Seat, objective: string, changePartner: boolean): void {
        if (!this.isOpen()) return;
        const ctx = this.boardContext(seat.game, seat.studentKey); const quest = ctx?.chapter.objectives.find(o => o.id === objective);
        if (!ctx || ctx.status === 'campaign_complete' || !quest?.board) return;
        if (!ctx.online.has(seat.studentKey)) return;
        const error = this.questBoard.claim(ctx, quest, changePartner);
        if (error) ws.send(JSON.stringify({ t: 'notice', level: 'warning', text: error }));
        for (const socket of this.ctx.getWebSockets(seat.studentKey)) this.sendQuest(socket, seat.game, seat.studentKey);
    }
    private refreshBoard(game: string): void {
        // Presence changes both partner eligibility and absent-role clue notices.
        if (this.campaignRow(game)) this.sendQuestToAll(game);
    }

    private conversation(game: string, student: string, objective: Objective): ConversationView {
        const row = this.campaignRow(game)!;
        const assignment = objective.board ? this.questBoard.assignment(game, objective.id, student) : undefined;
        const completed = this.interviews.completed(game, row.chapter, objective.id, student, assignment?.partner_key);
        const players = this.campaignPlayers(game);
        const role = players.find(p => p.student_key === student)?.role_id;
        const seats = this.seats().filter(s => s.game === game && s.studentKey !== student
            && (!objective.activity || s.studentKey === assignment?.partner_key)
            && (!this.isRandom(game) || this.alias(game, s.studentKey).kept));
        // Put classmates with a different perspective first; do not reveal their clues.
        const peers = seats.sort((a, b) => Number(players.find(p => p.student_key === a.studentKey)?.role_id === role)
            - Number(players.find(p => p.student_key === b.studentKey)?.role_id === role));
        return { required: objective.conversation?.witnesses ?? 1, completed, witnesses: peers.map(s => ({ id: s.id, name: s.name })) };
    }

    private async interviewTurn(ws: WebSocket, seat: Seat, data: Record<string, unknown>): Promise<void> {
        const incoming = data.t === 'interview-reply' && typeof data.id === 'string' ? this.interviews.get(data.id) : undefined;
        const auditTarget = incoming ? this.seats().find(s => s.game === seat.game && s.studentKey === incoming.investigator)?.id : data.witness;
        const audit = typeof data.text === 'string' ? this.beginAttempt(seat, data.text, 'interview', typeof data.attemptId === 'string' ? data.attemptId : undefined, auditTarget, incoming?.objective ?? (typeof data.objective === 'string' ? data.objective : undefined)) : null;
        const warn = (text: string) => { if (audit) this.attemptStatus(audit, 'invalid', text); ws.send(JSON.stringify({ t: 'notice', level: 'warning', text })); };
        if (this.interviewSends.has(seat.studentKey)) return warn('Wait for your current message to be sent.');
        const row = this.campaignRow(seat.game);
        const ctx = this.boardContext(seat.game, seat.studentKey);
        if (!this.isOpen() || !row || !ctx || ctx.status === 'campaign_complete') return warn('That investigation is not available right now.');
        const objective = ctx.chapter.objectives.find(o => o.id === (incoming?.objective ?? data.objective));
        if (!objective || (!objective.activity && !objective.conversation)) return warn('That investigation was not found.');
        const investigator = incoming ? incoming.investigator : seat.studentKey;
        const student = this.campaignPlayers(seat.game).find(p => p.student_key === investigator);
        if (!student || student.done.includes(objective.id) || !isUnlocked(objective, student.done)) return warn('That investigation is no longer available.');
        const assignment = objective.board ? this.questBoard.assignment(seat.game, objective.id, investigator) : undefined;
        if (objective.board && !assignment) return warn('Accept this quest first.');
        const target = this.seats().find(s => s.game === seat.game && (incoming ? s.studentKey === incoming.investigator : s.id === data.witness));
        if (!target || target.studentKey === seat.studentKey) return warn('Choose a classmate who is in the plaza.');
        if (incoming && (incoming.game_id !== seat.game || incoming.chapter !== row.chapter || incoming.witness !== seat.studentKey
            || incoming.question_status !== 'approved' || incoming.answer_status === 'approved' || incoming.answer_status === 'pending')) return warn('That question is not ready for a reply.');
        if (!incoming && data.t !== 'interview-ask') return warn('That question was not found.');
        if (assignment?.partner_key && assignment.partner_key !== (incoming ? seat.studentKey : target.studentKey)) return warn('Exchange evidence with your assigned partner.');
        const existing = !incoming && this.interviews.rows(seat.game, row.chapter).find(i => i.objective === objective.id && i.investigator === investigator && i.witness === target.studentKey);
        if (existing && (existing.question_status === 'approved' || existing.question_status === 'pending')) return warn('You already asked this witness. Wait for their reply.');
        const own = this.questView(seat.game, seat.studentKey);
        const clue = own?.clues.find(c => c.id === data.clue && (c.from === 'job' || c.from === 'reward'));
        if (!clue) return warn('Choose one of your private clues to share.');
        if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 200) return warn('Write up to 200 characters about this investigation.');
        const questionText = data.text.trim();
        const epoch = row.live_epoch;
        const valid = () => {
            const current = this.campaignRow(seat.game);
            const currentPlayer = this.campaignPlayers(seat.game).find(p => p.student_key === investigator);
            const activePartner = objective.board ? this.questBoard.assignment(seat.game, objective.id, investigator)?.partner_key : null;
            return !!current && current.chapter === row.chapter && current.live_epoch === epoch && current.status !== 'campaign_complete'
                && !!currentPlayer && !currentPlayer.done.includes(objective.id) && (!objective.board || activePartner === assignment?.partner_key)
                && (!incoming || this.interviews.get(incoming.id)?.question_status === 'approved');
        };
        this.interviewSends.add(seat.studentKey);
        try {
            const sent = await this.chat(ws, seat, questionText, target.id, `Investigation: ${objective.text}\nShared evidence: ${clue.text}`, undefined, undefined, valid, undefined, audit ?? undefined);
            if (!sent || sent.status === 'blocked' || !valid()) return;
            if (incoming) this.interviews.reply(incoming.id, sent.id, questionText, clue.text, sent.status);
            else this.interviews.ask({ id: crypto.randomUUID(), game_id: seat.game, chapter: row.chapter, objective: objective.id,
                investigator, witness: target.studentKey, question_id: sent.id, question: questionText, question_status: sent.status, shared: clue.text });
            this.sendQuestToAll(seat.game);
        } finally { this.interviewSends.delete(seat.studentKey); }
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
        const campaign = row && this.gameCampaign(seat.game);
        if (!zone || !row || !campaign || row.status === 'campaign_complete') return;
        const player = this.player(seat.game, seat.studentKey, row.campaign_id);
        const fresh = campaign.chapters[row.chapter]?.discoveries.filter(item => item.zone === zone && !player?.clues.includes(item.id)) ?? [];
        if (!player || fresh.length === 0) return;
        this.sql.exec('UPDATE campaign_players SET clues = ? WHERE game_id = ? AND student_key = ?',
            JSON.stringify([...player.clues, ...fresh.map(item => item.id)]), seat.game, seat.studentKey);
        for (const ws of this.ctx.getWebSockets(seat.studentKey)) this.sendQuest(ws, seat.game, seat.studentKey);
    }

    // A student's typed answer to a chapter question. A wrong one can be tried again after a short wait.
    private answer(ws: WebSocket, seat: Seat, objectiveId: string, typed: string, attemptId?: string): void {
        const audit = this.beginAttempt(seat, typed, 'answer', attemptId, undefined, objectiveId);
        const unavailable = (reason: string) => { this.attemptStatus(audit, 'invalid', reason); };
        if (typed.length > REPORT_MAX_LENGTH) return unavailable('The answer exceeds the maximum length.');
        const row = this.campaignRow(seat.game);
        const campaign = row && this.gameCampaign(seat.game);
        const objective = campaign?.chapters[row?.chapter ?? 0]?.objectives.find(item => item.id === objectiveId);
        // Students can keep working after the class threshold, until the teacher moves on.
        if (!row || !campaign || !objective || row.status === 'campaign_complete') return unavailable('That question is not available right now.');
        const player = this.player(seat.game, seat.studentKey, row.campaign_id);
        if (!player || player.done.includes(objective.id) || !isUnlocked(objective, player.done)) return unavailable('That question is finished or not unlocked yet.');
        // Board answers require a persisted assignment; clients cannot skip role or release gates.
        if (objective.board && !this.questBoard.assignment(seat.game, objective.id, seat.studentKey)) return unavailable('Accept this quest before answering.');
        const reply = (correct: boolean, wait = false) => {
            this.attemptStatus(audit, correct ? 'correct' : wait ? 'waiting' : 'incorrect', correct ? undefined : wait ? 'Wait or complete the required witness exchange.' : 'The answer was not accepted.');
            if (!correct && !wait) this.assistance.signal(seat.game, seat.studentKey, seat.name, `Answer not accepted: ${objective.text}`, typed, 'instructions');
            ws.send(JSON.stringify({ t: 'answered', objective: objective.id, correct, wait }));
        };
        if (objective.activity || objective.conversation) {
            const conversation = this.conversation(seat.game, seat.studentKey, objective);
            if (conversation.completed < conversation.required) {
                ws.send(JSON.stringify({ t: 'notice', level: 'warning', text: `Exchange evidence with ${conversation.required} witness${conversation.required === 1 ? '' : 'es'} before submitting this conclusion. Teacher approval is required.` }));
                return reply(false, true);
            }
        }
        const now = Date.now();
        if (now - player.last_wrong < WRONG_ANSWER_WAIT_MS) return reply(false, true);
        if (objective.kind !== 'report' && typed.length > 80) return unavailable('Use up to 80 characters for a short answer.');
        let right: boolean;
        if (objective.kind === 'report') {
            // Any real attempt in a few words counts; the teacher reads what was written.
            right = typed.trim().split(/\s+/).length >= 5;
            if (right) this.sql.exec(`INSERT INTO campaign_reports (game_id, student_key, objective, text, ts) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (game_id, student_key, objective) DO UPDATE SET text = excluded.text, ts = excluded.ts`, seat.game, seat.studentKey, objective.id, typed.trim(), now);
        } else if (objective.answerThief) {
            // The thief's made-up name, as the plaza shows it. The thief never gets this question.
            const names = this.rosterNames(seat.game);
            const culprits = this.chapterThieves(seat.game, campaign, row.chapter).filter(key => key !== seat.studentKey).map(key => names.get(key) ?? '');
            right = this.chapterThieves(seat.game, campaign, row.chapter).includes(seat.studentKey) ? false : answerMatches({ ...objective, accept: acceptedNames(culprits.filter(Boolean), [...names.values()]) }, typed);
        } else if (objective.answerRole) {
            // The name of a classmate who has that role, as the plaza shows it; never one's own.
            const names = this.rosterNames(seat.game);
            const holders = this.campaignPlayers(seat.game).filter(other => other.role_id === objective.answerRole && other.student_key !== seat.studentKey)
                .map(other => names.get(other.student_key) ?? '');
            const fallback = this.meetingFallback(seat.game, seat.studentKey, objective.answerRole, campaign);
            right = answerMatches({ ...objective, accept: [...acceptedNames(holders.filter(Boolean), [...names.values()]), ...(fallback ? [fallback] : [])] }, typed);
        } else right = answerMatches(objective, typed);
        if (!right) {
            this.sql.exec('UPDATE campaign_players SET last_wrong = ? WHERE game_id = ? AND student_key = ?', now, seat.game, seat.studentKey);
            return reply(false);
        }
        this.sql.exec('UPDATE campaign_players SET done = ? WHERE game_id = ? AND student_key = ?',
            JSON.stringify([...player.done, objective.id]), seat.game, seat.studentKey);
        reply(true);
        this.award(seat.studentKey, `answer:${seat.game}:${objective.id}`, objective.board ? XP.quest : XP.answer,
            objective.board ? 'Partner quest completed' : 'Right answer in your journal', seat.game);
        const chapter = campaign.chapters[row.chapter];
        if (row.status === 'active' && chapterDone(chapter, this.campaignPlayers(seat.game))) {
            this.sql.exec("UPDATE campaigns SET status = 'chapter_complete' WHERE game_id = ?", seat.game);
            this.sendQuestToAll(seat.game);
        } else if (chapter.objectives.some(o => o.board)) this.sendQuestToAll(seat.game);
        else for (const socket of this.ctx.getWebSockets(seat.studentKey)) this.sendQuest(socket, seat.game, seat.studentKey);
    }

    // The teacher's controls. Returns what went wrong, or null.
    private campaignAction(action: Extract<TeacherAction, { kind: 'campaign' }>): string | null {
        const game = this.activeGame();
        if (game === null) return 'Open or create a game first.';
        const row = this.campaignRow(game);
        if (action.op === 'start') {
            if (row) return 'This game already has a campaign.';
            const published = this.missions.latest(action.campaign ?? '');
            if (!published) return 'Publish that campaign in Mission Studio first.';
            const { campaign, revision } = published;
            this.sql.exec("INSERT INTO campaigns (game_id, campaign_id, chapter, status, started, revision_id, live_epoch) VALUES (?, ?, 0, 'active', ?, ?, ?)", game, campaign.id, Date.now(), revision, crypto.randomUUID());
            for (const seat of this.seats()) if (seat.game === game) this.player(game, seat.studentKey, campaign.id);
            this.pickThieves(game, 0, campaign.chapters[0]);
        } else if (!row) {
            return 'This game has no campaign.';
        } else if (action.op === 'next') {
            const campaign = this.gameCampaign(game);
            if (!campaign || row.status === 'campaign_complete') return 'The campaign is over.';
            if (row.chapter + 1 < campaign.chapters.length) {
                this.sql.exec("UPDATE campaigns SET chapter = chapter + 1, status = 'active', revealed = 0 WHERE game_id = ?", game);
                this.pickThieves(game, row.chapter + 1, campaign.chapters[row.chapter + 1]);
            } else this.sql.exec("UPDATE campaigns SET status = 'campaign_complete' WHERE game_id = ?", game);
        } else if (action.op === 'reveal') {
            // Prepared news goes to everyone, in the order the story gives it, when the class needs a nudge.
            const chapter = this.gameCampaign(game)?.chapters[row.chapter];
            if (!chapter || row.status === 'campaign_complete') return 'The chapter is not in progress.';
            if (row.revealed >= chapter.reveals.length) return 'There is no more news to reveal.';
            this.sql.exec('UPDATE campaigns SET revealed = revealed + 1 WHERE game_id = ?', game);
        } else if (action.op === 'reset') {
            if (action.confirm !== true) return 'Confirm to erase this game\'s campaign.';
            this.sql.exec('DELETE FROM campaigns WHERE game_id = ?', game);
            this.sql.exec('DELETE FROM campaign_players WHERE game_id = ?', game);
            this.sql.exec('DELETE FROM campaign_reports WHERE game_id = ?', game);
            this.interviews.clear(game);
            this.sql.exec('DELETE FROM campaign_thieves WHERE game_id = ?', game);
            this.sql.exec('DELETE FROM quest_assignments WHERE game_id = ?', game);
            this.sql.exec('DELETE FROM quest_releases WHERE game_id = ?', game);
            this.sql.exec('DELETE FROM mission_live_quests WHERE game_id = ?', game);
            this.sql.exec('DELETE FROM mission_live_previews WHERE game_id = ?', game);
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
        const campaign = row && this.gameCampaign(game);
        if (!game || !row || !campaign) return null;
        const names = this.rosterNames(game);
        return {
            id: campaign.id, title: campaign.title, status: row.status, chapter: row.chapter, chapters: campaign.chapters.length,
            chapterTitle: campaign.chapters[Math.min(row.chapter, campaign.chapters.length - 1)].title,
            chapterTitles: campaign.chapters.map(chapter => chapter.title),
            reveals: (() => {
                const reveals = campaign.chapters[Math.min(row.chapter, campaign.chapters.length - 1)].reveals;
                return { shown: Math.min(row.revealed, reveals.length), total: reveals.length, next: reveals[row.revealed]?.text ?? null };
            })(),
            players: this.campaignPlayers(game).map(item => ({
                studentKey: item.student_key, name: names.get(item.student_key) ?? 'Student',
                role: campaign.roles.find(role => role.id === item.role_id)?.name ?? item.role_id, clues: item.clues.length, done: item.done,
                thief: this.chapterThieves(game, campaign, row.chapter).includes(item.student_key)
            })),
            ...(campaign.chapters[row.chapter].objectives.some(o => o.board) ? { board: this.questBoard.summary(game, campaign.chapters[row.chapter]) } : {}),
            interviews: this.interviews.rows(game, row.chapter).map(i => ({
                id: i.id, objective: i.objective, task: campaign.chapters[row.chapter].objectives.find(o => o.id === i.objective)?.text ?? i.objective,
                incoming: false, studentKey: i.investigator, witnessKey: i.witness, questionId: i.question_id, answerId: i.answer_id, name: names.get(i.witness) ?? 'Classmate',
                question: i.question, questionStatus: i.question_status, answer: i.answer, answerStatus: i.answer_status, evidence: i.evidence, shared: i.shared
            })),
            reports: this.sql.exec<{ student_key: string; objective: string; text: string; partner_key: string | null }>(
                `SELECT r.student_key, r.objective, r.text, a.partner_key FROM campaign_reports r
                LEFT JOIN quest_assignments a ON r.game_id = a.game_id AND r.student_key = a.student_key AND r.objective = a.objective
                WHERE r.game_id = ? ORDER BY r.ts DESC LIMIT 100`, game).toArray()
                .map(report => ({ studentKey: report.student_key, objective: report.objective, text: report.text,
                    starred: this.starred(report.student_key, `report:${game}:${report.objective}`),
                    ...(report.partner_key ? { partner: names.get(report.partner_key) ?? 'Classmate' } : {}) }))
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

    private createGame(name: string, randomNames: boolean, vision: number): string {
        const id = crypto.randomUUID().slice(0, 8);
        const now = Date.now();
        this.sql.exec('INSERT INTO games (id, name, pin, created, last_opened, random_names, vision) VALUES (?, ?, ?, ?, ?, ?, ?)',
            id, name, this.newPin(), now, now, randomNames ? 1 : 0, Math.max(0, Math.min(MAX_VISION, Math.round(vision))));
        return id;
    }

    private vision(game: string | null): number {
        return game === null ? 0 : this.sql.exec<{ vision: number }>('SELECT vision FROM games WHERE id = ?', game).toArray()[0]?.vision ?? 0;
    }

    private sendVision(target: WebSocket, game: string): void {
        try { target.send(JSON.stringify({ t: 'vision', radius: this.vision(game) })); } catch { /* closing */ }
    }

    // Everything saved in a game goes with it: where students stood, chat, made-up names, the story and the warm-up.
    // Students' own avatars are theirs and stay. An open game is closed first, which sends everyone out.
    private deleteGame(game: string): void {
        if (this.activeGame() === game && this.isOpen()) {
            this.saveSetting('open', '0');
            this.closeRoom();
        }
        this.assistance.clear(game);
        this.participation.clear(game);
        for (const table of ['positions', 'chat', 'chat_audience', 'aliases', 'game_students', 'campaigns', 'campaign_players', 'campaign_reports', 'campaign_thieves', 'quest_assignments', 'quest_releases', 'interviews', 'mission_live_quests', 'mission_live_previews', 'warmups', 'warmup_players']) {
            this.sql.exec(`DELETE FROM ${table} WHERE game_id = ?`, game);
        }
        this.sql.exec('DELETE FROM games WHERE id = ?', game);
        // The teacher page then shows the game played most recently, if any are left.
        const latest = this.sql.exec<{ id: string }>('SELECT id FROM games ORDER BY last_opened DESC LIMIT 1').toArray()[0];
        if (latest) this.saveSetting('active_game', latest.id);
        else this.sql.exec("DELETE FROM settings WHERE key = 'active_game'");
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

    // ---------- The warm-up ----------
    // A few minutes at the start of a lesson: each student has a made-up fact about themselves and looks for
    // classmates who have other facts, typing their names. It is separate from the campaign.

    private warmupActive(game: string | null): boolean {
        return game !== null && this.sql.exec<{ active: number }>('SELECT active FROM warmups WHERE game_id = ?', game).toArray()[0]?.active === 1;
    }

    private warmupPlayers(game: string): { student_key: string; fact: string; targets: string[]; step: number; last_wrong: number }[] {
        return this.sql.exec<{ student_key: string; fact: string; targets: string; step: number; last_wrong: number }>(
            'SELECT student_key, fact, targets, step, last_wrong FROM warmup_players WHERE game_id = ?', game).toArray()
            .map(row => ({ ...row, targets: JSON.parse(row.targets) }));
    }

    private warmupKind(game: string): WarmupKind {
        const kind = this.sql.exec<{ kind: string }>('SELECT kind FROM warmups WHERE game_id = ?', game).toArray()[0]?.kind;
        return isWarmupKind(kind) ? kind : 'facts';
    }

    // Starts afresh for the students who are here; anyone who arrives later is given a part when they do.
    private startWarmup(game: string, kind: WarmupKind): string | null {
        const here = this.seats().filter(seat => seat.game === game).map(seat => seat.studentKey);
        if (here.length < 2) return 'At least two students need to be in the plaza.';
        this.sql.exec('DELETE FROM warmup_players WHERE game_id = ?', game);
        this.sql.exec('INSERT INTO warmups (game_id, active, started, kind) VALUES (?, 1, ?, ?) ON CONFLICT (game_id) DO UPDATE SET active = 1, started = excluded.started, kind = excluded.kind', game, Date.now(), kind);
        for (const [key, assignment] of (kind === 'identity' ? assignIdentities(here) : kind === 'pairs' ? assignPairs(here) : assignWarmup(here))) {
            this.sql.exec('INSERT INTO warmup_players (game_id, student_key, fact, targets) VALUES (?, ?, ?, ?)', game, key, assignment.fact, JSON.stringify(assignment.targets));
        }
        this.sendWarmupToAll(game);
        return null;
    }

    // Arrived after the start: a part that fits with those already in play, so there is someone to find. Only
    // classmates in the plaza now count, so the part never sends them looking for someone who has left.
    // True when a part was given.
    private lateWarmupPart(game: string, studentKey: string): boolean {
        if (!this.warmupActive(game)) return false;
        const players = this.warmupPlayers(game);
        if (players.some(player => player.student_key === studentKey)) return false;
        const online = new Set(this.seats().filter(seat => seat.game === game).map(seat => seat.studentKey));
        const here = players.filter(player => online.has(player.student_key));
        const kind = this.warmupKind(game);
        const late = kind === 'identity' ? assignLateIdentity(players.map(player => player.fact), here.map(player => player.student_key))
            : kind === 'pairs' ? assignLatePair(here.map(player => player.fact)) : assignLateJoiner(here.map(player => player.fact));
        if (!late) return false;
        this.sql.exec('INSERT INTO warmup_players (game_id, student_key, fact, targets) VALUES (?, ?, ?, ?)', game, studentKey, late.fact, JSON.stringify(late.targets));
        return true;
    }

    private warmupView(game: string, studentKey: string): WarmupView | null {
        if (!this.warmupActive(game)) return null;
        const kind = this.warmupKind(game);
        this.lateWarmupPart(game, studentKey);
        const players = this.warmupPlayers(game);
        const me = players.find(player => player.student_key === studentKey);
        if (!me) return null;
        const open = me.step < me.targets.length;
        const classmate = this.rosterNames(game).get(me.targets[0]) ?? 'a classmate';
        const card = kind === 'identity' ? { fact: `You are ${identityById(me.fact)?.name ?? '?'}. Do not say your name! Answer yes or no.`,
            task: `Find out who ${classmate} is. Ask yes or no questions. Then type their secret name.` }
            : kind === 'pairs' ? { fact: `Your word is ${me.fact}.`, task: `Find the person with the word that goes with ${me.fact}. Then type their name.` }
            : { fact: factById(me.fact)?.mine ?? '', task: `Find someone who ${factById(me.targets[me.step])?.find ?? ''}.` };
        return {
            kind,
            fact: card.fact,
            task: open ? card.task : null,
            step: me.step, of: me.targets.length,
            team: { done: players.reduce((sum, player) => sum + player.step, 0), total: players.reduce((sum, player) => sum + player.targets.length, 0) },
        };
    }

    private sendWarmup(target: WebSocket, game: string, studentKey: string): void {
        if (!this.warmupActive(game) && this.warmupPlayers(game).length === 0) return;
        try { target.send(JSON.stringify({ t: 'warmup', warmup: this.warmupView(game, studentKey) })); } catch { /* closing */ }
    }

    private sendWarmupToAll(game: string): void {
        for (const seat of this.seats()) {
            if (seat.game !== game) continue;
            for (const ws of this.ctx.getWebSockets(seat.studentKey)) this.sendWarmup(ws, game, seat.studentKey);
        }
    }

    // The name of a classmate who has the fact being looked for; never one's own.
    private warmupAnswer(ws: WebSocket, seat: Seat, typed: string, attemptId?: string): void {
        const audit = this.beginAttempt(seat, typed, 'warmup', attemptId);
        if (typed.length > 80) { this.attemptStatus(audit, 'invalid', 'Use up to 80 characters.'); return; }
        const view = this.warmupView(seat.game, seat.studentKey);
        const players = this.warmupPlayers(seat.game);
        const me = players.find(player => player.student_key === seat.studentKey);
        if (!view || !me || me.step >= me.targets.length) { this.attemptStatus(audit, 'invalid', 'The warm-up is not available.'); return; }
        const reply = (correct: boolean, wait = false) => {
            this.attemptStatus(audit, correct ? 'correct' : wait ? 'waiting' : 'incorrect', correct ? undefined : wait ? 'Wait before trying again.' : 'The warm-up answer was not accepted.');
            if (!correct && !wait) this.assistance.signal(seat.game, seat.studentKey, seat.name, 'The warm-up answer was not accepted.', typed, 'instructions');
            ws.send(JSON.stringify({ t: 'warmup-answered', correct, wait }));
        };
        const now = Date.now();
        if (now - me.last_wrong < WRONG_ANSWER_WAIT_MS) return reply(false, true);
        const names = this.rosterNames(seat.game);
        let right: boolean;
        if (view.kind === 'identity') {
            // The secret identity of the classmate they were asked about
            const partner = players.find(player => player.student_key === me.targets[me.step]);
            const identity = partner && identityById(partner.fact);
            right = !!identity && answerMatches({ id: 'warmup', text: '', accept: identity.accept }, typed);
        } else {
            // The name of a classmate who has the fact (or word) being looked for; never one's own.
            const holders = players.filter(player => player.fact === me.targets[me.step] && player.student_key !== seat.studentKey)
                .map(player => names.get(player.student_key) ?? '').filter(Boolean);
            right = answerMatches({ id: 'warmup', text: '', accept: acceptedNames(holders, [...names.values()]) }, typed);
        }
        if (!right) {
            this.sql.exec('UPDATE warmup_players SET last_wrong = ? WHERE game_id = ? AND student_key = ?', now, seat.game, seat.studentKey);
            return reply(false);
        }
        this.sql.exec('UPDATE warmup_players SET step = step + 1 WHERE game_id = ? AND student_key = ?', seat.game, seat.studentKey);
        reply(true);
        if (me.step + 1 >= me.targets.length) {
            const started = this.sql.exec<{ started: number }>('SELECT started FROM warmups WHERE game_id = ?', seat.game).toArray()[0]?.started ?? 0;
            this.award(seat.studentKey, `warmup:${seat.game}:${started}`, XP.warmup, 'Warm-up finished', seat.game);
        }
        // Everyone's progress bar moves
        this.sendWarmupToAll(seat.game);
    }

    private warmupStatus(game: string | null): TeacherStatus['warmup'] {
        if (game === null) return null;
        const players = this.warmupPlayers(game);
        if (players.length === 0 && !this.warmupActive(game)) return null;
        const names = this.rosterNames(game);
        return {
            active: this.warmupActive(game),
            kind: this.warmupKind(game),
            players: players.map(player => ({ studentKey: player.student_key, name: names.get(player.student_key) ?? 'Student',
                fact: this.warmupKind(game) === 'identity' ? `${identityById(player.fact)?.name ?? '?'} (finds out about ${names.get(player.targets[0]) ?? '?'})`
                    : this.warmupKind(game) === 'pairs' ? `word: ${player.fact} (looks for ${player.targets[0]})`
                    : factById(player.fact)?.mine ?? '', found: player.step, of: player.targets.length })),
            team: { done: players.reduce((sum, player) => sum + player.step, 0), total: players.reduce((sum, player) => sum + player.targets.length, 0) },
        };
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
        this.refreshBoard(seat.game);
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

    // Walking is most of the traffic, and a phone hotspot handles many small messages badly. So
    // instead of each step going to everyone at once, everyone gets one message every
    // MOVE_BATCH_MS with the latest position of whoever moved. The mover's own entry is ignored.
    private queueMove(id: string, x: number, y: number): void {
        this.moves.set(id, [x, y]);
        this.movesTimer ??= setTimeout(() => {
            this.movesTimer = null;
            const moves = [...this.moves].map(([id, [x, y]]) => [id, x, y]);
            this.moves.clear();
            if (moves.length) this.broadcast({ t: 'moves', moves });
        }, MOVE_BATCH_MS);
    }

    // ---------- Levels ----------

    private xpOf(studentKey: string): number {
        return this.sql.exec<{ xp: number }>('SELECT xp FROM students WHERE student_key = ?', studentKey).toArray()[0]?.xp ?? 0;
    }

    private starred(studentKey: string, source: string): boolean {
        return this.sql.exec('SELECT 1 FROM xp_awards WHERE student_key = ? AND source = ?', studentKey, source).toArray().length > 0;
    }

    // Experience for one thing, once: `source` names what earned it. The student sees it arrive, with why.
    private award(studentKey: string, source: string, amount: number, reason: string, game: string | null): boolean {
        const added = this.sql.exec('INSERT OR IGNORE INTO xp_awards (student_key, source, amount, reason, game_id, ts) VALUES (?, ?, ?, ?, ?, ?) RETURNING 1',
            studentKey, source, amount, reason, game, Date.now()).toArray().length > 0;
        if (!added) return false;
        this.sql.exec('UPDATE students SET xp = xp + ? WHERE student_key = ?', amount, studentKey);
        const message = JSON.stringify({ t: 'xp', xp: this.xpOf(studentKey), gained: amount, reason });
        for (const ws of this.ctx.getWebSockets(studentKey)) { try { ws.send(message); } catch { /* reconnect sends the total */ } }
        return true;
    }

    // The teacher's star on an approved message or a written report from the open game. Returns what went wrong, or null.
    private teacherStar(action: Extract<TeacherAction, { kind: 'xp' }>): string | null {
        const game = this.activeGame();
        if (!game) return 'Open a game first.';
        if (action.chatId) {
            const entry = this.sql.exec<{ student_key: string; text: string }>("SELECT student_key, text FROM chat WHERE id = ? AND game_id = ? AND status = 'approved'", action.chatId, game).toArray()[0];
            if (!entry) return 'Only an approved message from this game can earn a star.';
            return this.award(entry.student_key, `teacher:${action.chatId}`, XP.teacher, `Your teacher liked: "${entry.text.slice(0, 80)}"`, game) ? null : 'That message already has a star.';
        }
        if (action.report) {
            const { studentKey, objective } = action.report;
            if (!this.sql.exec('SELECT 1 FROM campaign_reports WHERE game_id = ? AND student_key = ? AND objective = ?', game, studentKey, objective).toArray().length) return 'That report was not found.';
            return this.award(studentKey, `report:${game}:${objective}`, XP.teacher, 'Your teacher liked your report', game) ? null : 'That report already has a star.';
        }
        return 'Choose a message or a report.';
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
        this.moves.delete(seat.id);
        this.broadcast({ t: 'leave', id: seat.id }, ws);
        if (announce) this.systemChat(`${seat.name} left the Plaza.`, ws);
        this.refreshBoard(seat.game);
    }

    // A hint before sending, never a block: whatever goes wrong, the answer is "fine".
    private async grammar(ws: WebSocket, seat: Seat, id: unknown, text: unknown, attemptId?: string): Promise<void> {
        const audit = typeof text === 'string' ? this.beginAttempt(seat, text, 'chat', attemptId) : null;
        const now = Date.now();
        let answer: Awaited<ReturnType<typeof checkGrammar>> = { ok: true };
        if (typeof text === 'string' && now - (seat.lastCheck ?? 0) >= CHECK_GAP_MS && this.isOpen()) {
            seat.lastCheck = now;
            ws.serializeAttachment(seat);
            answer = await checkGrammar(text, this.env);
        }
        if (audit) {
            const existing = this.assistance.get(audit);
            if (existing && ['submitted', 'language-checked', 'hint-offered'].includes(existing.status)) {
                this.assistance.update(audit, answer.ok ? 'language-checked' : 'hint-offered', answer.ok ? undefined : answer.why, answer.ok ? existing.correction : answer.corrected);
                if (!answer.ok && !existing.correction) this.assistance.signal(seat.game, seat.studentKey, seat.name, `Grammar hint: ${answer.why}`, String(text));
            }
        }
        try { ws.send(JSON.stringify({ t: 'checked', id, ...answer })); } catch { /* closing */ }
    }

    // `cid` is the page's own id for this message: every answer carries it back, so a message that
    // did not go through can be given back to its writer, draft intact.
    private async chat(ws: WebSocket, seat: Seat, value: unknown, to: unknown, note: string | null, cid?: string, better?: string | null, valid?: () => boolean, attemptId?: string, linkedAudit?: string): Promise<{ id: string; status: string } | void> {
        let audit = linkedAudit ?? (typeof value === 'string' ? this.beginAttempt(seat, value, 'chat', attemptId, to) : null);
        if (audit && !linkedAudit) {
            const existing = this.assistance.get(audit);
            if (existing && !['submitted', 'language-checked', 'hint-offered'].includes(existing.status)) audit = this.beginAttempt(seat, String(value), 'chat', undefined, to);
        }
        if (audit && typeof value === 'string') this.assistance.submitted(audit, value);
        const refused = (reason: string, status = 'invalid') => { if (audit) this.attemptStatus(audit, status, reason); };
        const reply = (level: 'info' | 'warning', text: string) => { try { ws.send(JSON.stringify({ t: 'notice', level, text, cid })); } catch { /* the class changed while checking */ } };
        if (to === 'teacher' && typeof value === 'string') {
            if (!value.trim() || value.length > 200) { refused('Write up to 200 characters.'); return reply('warning', 'Write up to 200 characters.'); }
            if (!this.isOpen() || this.activeGame() !== seat.game || (ws.deserializeAttachment() as Seat | null)?.left) { refused('The class is closed.', 'unavailable'); return reply('warning', 'The class is closed.'); }
            if (audit) this.attemptStatus(audit, 'teacher-inbox', 'Private message to your teacher.');
            this.assistance.request(seat.game, seat.studentKey, seat.name, 'writing', value.trim(), false);
            this.sendSupport(seat.game, seat.studentKey);
            for (const socket of this.ctx.getWebSockets(seat.studentKey)) {
                const recipient = socket.deserializeAttachment() as Seat | null;
                if (!recipient || recipient.left || recipient.game !== seat.game) continue;
                try {
                    socket.send(JSON.stringify({ t: 'chat', id: audit, sender: seat.name, text: value.trim(), voice: normalizeVoice(seat.avatar.voice), ts: Date.now(), whisper: true, to: 'Teacher' }));
                    if (audit) this.sql.exec('INSERT OR IGNORE INTO chat_audience (chat_id, game_id, student_key, voice) VALUES (?, ?, ?, ?)', audit, seat.game, seat.studentKey, normalizeVoice(seat.avatar.voice));
                } catch { /* reconnect */ }
            }
            if (cid) ws.send(JSON.stringify({ t: 'result', cid }));
            return;
        }
        const unavailable = () => !this.isOpen() || this.activeGame() !== seat.game || (ws.deserializeAttachment() as Seat | null)?.left
            || (valid && !valid()) || this.sql.exec('SELECT 1 FROM mutes WHERE student_key = ?', seat.studentKey).toArray().length > 0;
        if (unavailable()) { refused('Chat is unavailable right now.', 'unavailable'); return reply('warning', 'Chat is unavailable right now.'); }
        if (this.isRandom(seat.game) && !this.alias(seat.game, seat.studentKey).kept) { refused('Choose your name first.'); return reply('warning', 'Choose your name first.'); }

        // On the teacher's laptop every word must be English, whatever the page did.
        if (typeof value === 'string' && this.env.LAN_URL) {
            const { notEnglish } = await import('./english.ts');
            const words = notEnglish(value, this.seats().map(other => other.name));
            if (unavailable()) { refused('Chat is unavailable right now.', 'unavailable'); return reply('warning', 'Chat is unavailable right now.'); }
            if (words.length) {
                const reason = `Use English words only: ${words.map(item => item.word).join(', ')}.`;
                refused(reason, 'language-blocked'); this.assistance.signal(seat.game, seat.studentKey, seat.name, reason, value);
                return reply('warning', reason);
            }
        }
        const now = Date.now();
        if (now - seat.lastChat < CHAT_GAP_MS) { refused('Please wait before sending another message.', 'rate-limited'); return reply('warning', 'Please wait before sending another message.'); }
        seat.lastChat = now;
        ws.serializeAttachment(seat);
        if (typeof value !== 'string') return reply('warning', 'Enter a text message.');

        // `to` is the id of the classmate being whispered to; without it, the message is for whoever is nearby.
        let target: Seat | undefined;
        if (to !== undefined && to !== null) {
            target = this.seats().find(other => other.game === seat.game && other.id === to);
            if (!target || target.studentKey === seat.studentKey) { refused('That student is not in the Plaza right now.'); return reply('warning', 'That student is not in the Plaza right now.'); }
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
            if (unavailable()) { refused('Chat is unavailable right now.', 'unavailable'); return reply('warning', 'Chat is unavailable right now.'); }
        }
        // Review mode posts what OpenAI cleared, nearby or whisper. A witness exchange (the only caller
        // that passes `valid`) always waits: the teacher's approval is part of that activity.
        const posts = !problem && cleared && !valid && this.mode() === 'review';
        const entry = { id: crypto.randomUUID(), game_id: seat.game, student_key: seat.studentKey, sender: seat.name, text: value.trim().slice(0, 200),
            target_key: target?.studentKey ?? null, x: seat.x, y: seat.y, marks: null as string | null, voice: normalizeVoice(seat.avatar.voice) };
        // Sent as written although a better version was offered: mark the words that differ, for everyone who reads it.
        const slips = better ? wordDiff(entry.text, better).original : [];
        if (slips.length) entry.marks = JSON.stringify(slips);
        this.sql.exec(`INSERT INTO chat (id, student_key, sender, text, ts, status, target_key, target_name, x, y, flag, note, game_id, marks, voice)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            entry.id, entry.student_key, entry.sender, entry.text, now, problem ? 'blocked' : posts ? 'approved' : 'pending',
            entry.target_key, target?.name ?? null, entry.x, entry.y, flag, note, seat.game, entry.marks, entry.voice);
        if (audit) this.attemptStatus(audit, problem ? 'blocked' : posts ? 'approved' : 'pending', problem ?? note ?? flag ?? undefined, entry.id);
        if (problem) this.assistance.signal(seat.game, seat.studentKey, seat.name, `Message filter: ${problem}`, String(value), 'other');
        this.sql.exec(`DELETE FROM chat WHERE game_id IS ? AND id NOT IN (SELECT id FROM chat WHERE game_id IS ? ORDER BY ts DESC LIMIT ?)
            AND id NOT IN (SELECT question_id FROM interviews UNION SELECT answer_id FROM interviews WHERE answer_id IS NOT NULL)`,
            seat.game, seat.game, CHAT_KEEP);
        this.sql.exec(`DELETE FROM chat_audience WHERE game_id = ?
            AND chat_id NOT IN (SELECT id FROM chat) AND chat_id NOT IN (SELECT id FROM assistance_attempts WHERE status = 'teacher-inbox')`, seat.game);
        if (posts) {
            this.deliver(entry);
            if (cid) ws.send(JSON.stringify({ t: 'result', cid })); // posted at once: nothing else to say
        }
        else reply(problem ? 'warning' : 'info', problem ?? 'Sent to your teacher for approval.');
        return { id: entry.id, status: problem ? 'blocked' : posts ? 'approved' : 'pending' };
    }

    private review(id: string, approve: boolean): boolean {
        const entry = this.sql.exec<{ id: string; student_key: string; sender: string; text: string; status: string;
            target_key: string | null; x: number | null; y: number | null; marks: string | null; game_id: string | null; voice: string | null }>(
            'SELECT id, student_key, sender, text, status, target_key, x, y, marks, game_id, voice FROM chat WHERE id = ?', id).toArray()[0];
        if (!entry) return false;

        // Taking down a message that already posted: it disappears from every screen.
        if (entry.status === 'approved' && !approve) {
            this.sql.exec("UPDATE chat SET status = 'removed' WHERE id = ?", id);
            this.assistance.chatStatus(id, 'removed');
            if (this.interviews.review(id, 'removed')) {
                const game = this.activeGame(); if (game) this.sendQuestToAll(game);
            }
            this.broadcast({ t: 'retract', id });
            this.notify(entry.student_key, 'warning', 'Your teacher removed one of your messages.');
            return true;
        }
        if (entry.status !== 'pending') return false;

        const approved = approve && this.isOpen();
        this.sql.exec('UPDATE chat SET status = ? WHERE id = ?', approved ? 'approved' : 'rejected', id);
        this.assistance.chatStatus(id, approved ? 'approved' : 'rejected');
        if (this.interviews.review(id, approved ? 'approved' : 'rejected')) {
            const game = this.activeGame(); if (game) this.sendQuestToAll(game);
        }
        if (!approved) {
            this.notify(entry.student_key, 'info', 'Your message was not posted.');
            return true;
        }
        const delivered = this.deliver(entry);
        this.notify(entry.student_key, delivered ? 'info' : 'warning',
            delivered ? 'Your message was approved.' : 'Your message was approved, but that student has left the Plaza.');
        return true;
    }

    // A whisper goes to its two students, nearby chat to whoever stands within
    // earshot of where the sender stood; the sender always sees their own.
    // False when a whisper had nobody to reach.
    private deliver(entry: { id: string; student_key: string; sender: string; text: string; target_key: string | null; x: number | null; y: number | null; marks?: string | null; game_id?: string | null; voice?: string | null }): boolean {
        const game = entry.game_id ?? this.activeGame();
        const recipients = new Set([entry.student_key]);
        for (const seat of this.seats()) {
            if (seat.game !== game) continue;
            const heard = entry.target_key !== null ? seat.studentKey === entry.target_key
                : entry.x === null || entry.y === null || Math.hypot(seat.x - entry.x, seat.y - entry.y) <= HEARING_RANGE;
            if (heard) recipients.add(seat.studentKey);
        }
        const message = JSON.stringify({ t: 'chat', id: entry.id, sender: entry.sender, text: entry.text, voice: normalizeVoice(entry.voice), ts: Date.now(),
            ...(entry.marks ? { marks: JSON.parse(entry.marks) } : {}),
            ...(entry.target_key !== null ? { whisper: true, to: this.rosterNames(this.activeGame() ?? '').get(entry.target_key) ?? 'a classmate' } : {}) });
        for (const studentKey of recipients) {
            for (const ws of this.ctx.getWebSockets(studentKey)) {
                const seat = ws.deserializeAttachment() as Seat | null;
                if (!seat || seat.left || seat.game !== game) continue;
                try {
                    ws.send(message);
                    if (game) this.sql.exec('INSERT OR IGNORE INTO chat_audience (chat_id, game_id, student_key, voice) VALUES (?, ?, ?, ?)', entry.id, game, studentKey, normalizeVoice(entry.voice));
                } catch { /* closing */ }
            }
        }
        if (game && this.sql.exec('SELECT 1 FROM chat_audience WHERE chat_id = ? AND student_key != ? LIMIT 1', entry.id, entry.student_key).toArray().length) {
            // A first greeting deserves encouragement too. A fixed source keeps this
            // once per student across lessons, games, reconnects and history pruning.
            const firstMessage = this.award(entry.student_key, 'onboarding:first-message', XP.firstMessage, 'Your first message to a classmate!', game);
            if (!firstMessage) this.ctx.waitUntil(this.rewardParticipation(entry.id, game, entry.student_key).catch(() => {
                console.log('Participation reward unavailable');
            }));
        }
        return entry.target_key === null || recipients.size > 1;
    }

    private async rewardParticipation(id: string, game: string, student: string): Promise<void> {
        if (!this.env.OPENAI_API_KEY || this.env.OPENAI_PARTICIPATION === '0' || !this.isOpen() || this.activeGame() !== game) return;
        const session = this.helpSession();
        const entry = this.sql.exec<{ text: string; ts: number }>("SELECT text, ts FROM chat WHERE id = ? AND game_id = ? AND student_key = ? AND status = 'approved'", id, game, student).toArray()[0];
        if (!entry) return;
        // Across nearby and direct messages: changing recipient never resets the history.
        const previous = this.sql.exec<{ text: string }>(`SELECT text FROM chat WHERE game_id = ? AND student_key = ?
            AND id != ? AND status IN ('approved', 'removed') AND ts <= ? ORDER BY ts DESC, rowid DESC LIMIT 40`, game, student, id, entry.ts).toArray().reverse().map(row => row.text);
        if (!this.participation.reserve(session, game, student, id, entry.text, previous)) return;
        const conversation = this.sql.exec<{ student_key: string; text: string }>(`SELECT c.student_key, c.text FROM chat c
            JOIN chat_audience a ON a.chat_id = c.id AND a.student_key = ?
            WHERE c.game_id = ? AND c.id != ? AND c.status = 'approved' AND c.ts <= ?
            ORDER BY c.ts DESC, c.rowid DESC LIMIT ?`, student, game, id, entry.ts, PARTICIPATION.peers).toArray().reverse()
            .map(row => ({ self: row.student_key === student, text: row.text }));
        const useful = await participationDecision({ message: entry.text, previous, conversation }, this.env);
        // A teacher may have removed it, muted the student, switched games or ended the lesson during the call.
        if (!useful || !this.isOpen() || this.activeGame() !== game || this.helpSession() !== session
            || this.sql.exec('SELECT 1 FROM mutes WHERE student_key = ?', student).toArray().length
            || !this.sql.exec("SELECT 1 FROM chat WHERE id = ? AND game_id = ? AND status = 'approved'", id, game).toArray().length) return;
        this.ctx.storage.transactionSync(() => {
            if (this.participation.reward(id)) this.award(student, `participation:${id}`, XP.participation, 'A useful contribution to the conversation', game);
        });
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
        const target = game ?? this.activeGame() ?? this.createGame('Class 1', false, 0);
        const switching = this.isOpen() && this.activeGame() !== target;
        if (switching) this.closeRoom();
        const reopening = !this.isOpen() || switching;
        this.saveSetting('open', '1');
        this.saveSetting('active_game', target);
        if (reopening) {
            this.sql.exec('UPDATE games SET last_opened = ? WHERE id = ?', Date.now(), target);
            this.saveSetting('help_session', crypto.randomUUID());
        }
    }

    private closeRoom(): void {
        this.sql.exec("UPDATE interviews SET question_status = 'rejected' WHERE question_status = 'pending'");
        this.sql.exec("UPDATE interviews SET answer_status = 'rejected' WHERE answer_status = 'pending'");
        const rejected = this.sql.exec<{ id: string; student_key: string }>(
            "UPDATE chat SET status = 'rejected' WHERE status = 'pending' RETURNING id, student_key").toArray();
        for (const row of rejected) this.assistance.chatStatus(row.id, 'rejected');
        for (const studentKey of new Set(rejected.map(row => row.student_key))) {
            this.notify(studentKey, 'info', 'Your message was not posted.');
        }
        for (const ws of this.ctx.getWebSockets()) {
            this.leave(ws, false);
            try { ws.close(CLOSE_CLASS_CLOSED, 'The class is closed.'); } catch { /* already closing */ }
        }
    }
}
