import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index.ts';
import type { PinPlayStudent } from './pinplay.ts';
import { MIN_WORDS, checkGrammar } from './grammar.ts';
import { languageHelp } from './aiHelp.ts';
import { ReportChecks, checkReport, reportCacheKey, type ReportInput } from './reportFeedback.ts';
import { ActivityHistory } from './activityHistory.ts';
import type { ActivityHistoryView } from '../shared/activityHistory.ts';
import type { ReportCheck } from '../shared/reportFeedback.ts';
import { moderate, type Moderation } from './moderation.ts';
import { SafetyIncidents, type Incident } from './incidents.ts';
import { harmFrom, localHarm, type Harm } from '../shared/safety.ts';
import { BlockedWords } from './blockedWords.ts';
import { blockedIn, repeated, taskWordSet, type BlockedStatus, type Term } from '../shared/blockedWords.ts';
import { isGlitch } from '../shared/tidy.ts';
import { PARTICIPATION, Participation, participationDecision } from './participation.ts';
import { REPORT_MAX_LENGTH, absentRoleClues, acceptedNames, answerMatches, chapterDone, isUnlocked, mainFinished, nothingElseToDo, pickRole, prerequisiteIds, rewardClues, teamProgress, type BoardView, type QuestView } from '../shared/campaign.ts';
import { MissionRepository, readCopy, type MissionResult } from './missions.ts';
import { SideQuestStore, readQuestCopy, type SideQuestResult } from './sideQuestStore.ts';
import { QuestBoard, type BoardContext } from './questBoard.ts';
import { SideQuestGroups } from './sideQuestGroups.ts';
import { GAME_CHAPTER, GameSideQuests } from './gameSideQuests.ts';
import { Interviews } from './interviews.ts';
import { StudentAssistance } from './support.ts';
import type { AttemptPage, AttemptSource, Conversations, ConversationLine, HelpStatus, HelpTopic, TeacherSupport } from '../shared/support.ts';
import type { ConversationView, Objective, InterviewView } from '../shared/campaign.ts';
import { LiveMissions, type LiveMissionResult } from './liveMissions.ts';
import type { CampaignChoice, LiveMissionTarget, MissionCopy, MissionPushResult, MissionSync } from '../shared/missionTypes.ts';
import type { Campaign } from '../shared/campaign.ts';
import { checkQuestFile, groupSize, libraryVersion, questFit, questObjective, storyChapters, type SideQuest, type SideQuestBoardResult, type SideQuestCopy, type SideQuestPushResult, type SideQuestTarget, type StoryChapter } from '../shared/sideQuests.ts';
import { wordDiff } from '../shared/diff.ts';
import { cleanName, shownNames } from '../shared/names.ts';
import { isEnglishVoice, normalizeVoice, voiceFor } from '../shared/voices.ts';
import { fillThiefClue, lookOf, thiefCount } from '../shared/thief.ts';
import { assignLateJoiner, assignWarmup, factById, type WarmupView } from '../shared/warmup.ts';
import { IDENTITY_NAMES, assignIdentities, assignLateIdentity, assignLatePair, assignPairs, identityById, isWarmupKind, type WarmupKind } from '../shared/warmupKinds.ts';
import { randomName } from '../shared/randomNames.ts';
import { ThemeStore, copyPictures, type MapCopy, type MapPushResult, type StudioMap, type ThemeResult } from './themeStore.ts';
import { ThemeAssets } from './themeAssets.ts';
import type { Theme } from '../shared/theme.ts';
import { XP, checkStyle, emotesFor, levelOf, readStyle, type Style } from '../shared/levels.ts';
import { REPORT_LINES_PER_STUDENT, type ClassReportData, type ReportLine } from '../shared/classReport.ts';
import { type Avatar, chatProblem, clampPosition, defaultAvatar, plazaName, sanitizeAvatar, secretsMatch } from './rules.ts';
import { HEARING_RANGE, TYPING_EVERY_MS } from '../shared/chat.ts';
import { identityRevealProblem } from '../shared/activityChat.ts';
import { defaultWarmup, validateWarmup, warmupVocabulary, type SavedWarmup, type WarmupDefinition } from '../shared/warmupConfig.ts';
import { VOICE_SAMPLE } from './speech.ts';
import { buildGuide, type TeacherGuide } from '../shared/teacherGuide.ts';
import { clueZones, missionId } from '../shared/missionSchema.ts';

const TICKET_MS = 60_000;
const TEACHER_SESSION_MS = 12 * 60 * 60 * 1000;
const MISSION_SYNC_EVERY_MS = 5 * 60 * 1000; // how often the laptop checks with the online server while the teacher page is open
const QUEST_PUSH_BATCH = 100; // side quests the laptop uploads in one request
const MAP_PUSH_BATCH = 5; // maps the laptop uploads in one request: each up to 200 KB, and its draft as much again
const PICTURE_ASK_LIMIT = 200; // pictures the laptop asks about in one request
const CHAT_KEEP = 500;
const STATUS_HISTORY = 100;
const CHAT_GAP_MS = 1500;
const DEFAULT_VISION = 450; // map pixels a student sees around themselves in a new game
const MAX_VISION = 2000;
const REROLL_GAP_MS = 300; // between asks for another name
const WRONG_ANSWER_WAIT_MS = 3000; // before a student can try a chapter question again
const MOVE_BATCH_MS = 150; // positions go out together this often: one message a student, not one a step
const CHECK_GAP_MS = 800; // grammar hints cost money: no more than one a student can read
const TYPING_GAP_MS = TYPING_EVERY_MS / 2; // "is writing" passed on no more often than a page sends it
const CHAT_HISTORY = 120; // messages of this lesson a returning page gets back
const PLAYS_KEEP_MS = 60 * 60 * 1000; // what each device read aloud, kept for an hour
const PLAYS_SHOWN_MS = 15 * 60 * 1000; // and shown to the teacher for the last 15 minutes
const PLAYS_SHOWN = 300;
const REPEAT_WINDOW_MS = 5 * 60 * 1000; // what the whole plaza wrote lately, to find what everyone is repeating
const REPEAT_SHARE = 0.2; // of the students here (three at least) writing the same thing to everyone
const BLOCKED_NOTICE = 'Not sent: your teacher blocked that for this lesson.';

// Why an exchange with the online server stopped, as the laptop reports it.
class SyncStopped extends Error {
    state: MissionSync['state']; status: number;
    constructor(state: MissionSync['state'], status = 0) { super(state); this.state = state; this.status = status; }
}

// Close codes the client acts on.
const CLOSE_JOIN_AGAIN = 4001; // ticket unknown, used or expired
const CLOSE_REPLACED = 4009;   // the same student joined from another window
const CLOSE_CLASS_CLOSED = 4002; // the teacher closed the game

// Per-socket state. It lives in the socket's attachment, so it survives the
// room hibernating between messages.
type Seat = { id: string; game: string; themeId?: string; zone?: string | null; studentKey: string; name: string; avatar: Avatar; style?: Style; x: number; y: number; lastChat: number; lastCheck?: number; lastTyping?: number; lastReroll?: number; movedAt?: number; left?: boolean; frozenUntil?: number; downUntil?: number; inTab?: boolean; tabSwitches?: number; tabAwayAt?: number | null };
type AnswerSeat = Pick<Seat, 'game' | 'studentKey' | 'name'>;

export type TeacherAction =
    | { kind: 'magic'; power: 'freeze' | 'thaw' | 'lightning' | 'teleport' | 'rain'; studentKey?: string; x?: number; y?: number }
    | { kind: 'status' }
    | { kind: 'open'; open: boolean; game?: string } // a saved game (the last played by default), or close the open one
    | { kind: 'newGame'; name: string; randomNames?: boolean; vision?: number; themeId?: string } // a new game with its own PIN, opened at once
    | { kind: 'realNames'; gameId: string } // switch the current live game to real first names
    | { kind: 'student'; gameId: string; studentKey: string; name?: unknown; avatar?: unknown }
    | { kind: 'deleteGame'; game: string; confirm?: boolean } // erases a game and everything saved in it
    | { kind: 'vision'; radius: number }                // how far a student sees, in map pixels; 0 shows everyone
    | { kind: 'warmup'; op: 'start' | 'end'; type?: WarmupKind } // a get-to-know-you warm-up at the start of a lesson
    | { kind: 'campaign'; op: 'start' | 'next' | 'reveal' | 'reset'; campaign?: string; confirm?: boolean }
    | { kind: 'questRelease'; objective: string }
    | { kind: 'questPlace'; objective: string; studentKey: string }
    | { kind: 'reportAccept'; gameId: string; studentKey: string; objective: string; version: number }
    | { kind: 'remove'; id: string } // takes down a message that posted
    | { kind: 'mute'; studentKey: string; muted: boolean }
    | { kind: 'incident'; id: string } // the teacher has seen a safety incident
    | { kind: 'block'; words: string[] } // words or phrases no message may say this lesson; what already says them comes down
    | { kind: 'unblock'; key: string }
    | { kind: 'letThrough'; key: string; words: string } // a repeat the teacher leaves alone: not offered again this lesson
    | { kind: 'sound'; studentKey: string; off: boolean } // silences one student's device (no headphones) until turned back on
    | { kind: 'soundAll'; off: boolean } // a persistent class-wide sound lock, including late arrivals
    | { kind: 'xp'; chatId?: string; report?: { studentKey: string; objective: string } } // the teacher stars a message or a report
    | { kind: 'helpStatus'; id: string; status: HelpStatus; gameId?: string }
    | { kind: 'helpMessage'; studentKey: string; text: string; gameId?: string };

export type GameSummary = { id: string; name: string; pin: string; lastOpened: number; open: boolean; randomNames: boolean; themeId: string };

// Where this game's campaign stands, and what every student has done in it.
export type CampaignStatus = {
    guideVersion: string;
    id: string; title: string; status: QuestView['status']; chapter: number; chapters: number; chapterTitle: string; chapterTitles: string[];
    zones: string[]; // where the map clues are, to tell the teacher when the game's map lacks one
    reveals: { shown: number; total: number; next: string | null }; // prepared news the teacher can release
    players: { studentKey: string; name: string; role: string; clues: number; done: string[]; thief: boolean }[];
    reports: { studentKey: string; objective: string; text: string; partner?: string; starred: boolean; version: number; check?: ReportCheck }[];
    interviews: (InterviewView & { studentKey: string; witnessKey: string; questionId: string; answerId: string | null })[];
    board?: ReturnType<QuestBoard['summary']>;
};
// The open game's side quests, with or without a mission: students free to choose one (nothing else to do), those
// doing one, how many are still on a warm-up or mission, and how many side quests the board has. `groups`: pairs and
// groups waiting for members or playing; `open`: the side quests a student can be placed in; `reports`: what students
// wrote for them.
export type SideQuestStatus = { free: { studentKey: string; name: string }[]; doing: { studentKey: string; name: string; quest: string }[]; busy: number; quests: number;
    groups: { id: string; quest: string; members: string[]; size: number; state: 'open' | 'playing' }[]; open: { id: string; title: string }[];
    reports: { studentKey: string; objective: string; quest: string; text: string; partner?: string; starred: boolean; version: number; check?: ReportCheck }[] };

export type TeacherStatus = {
    warmupPlays: ActivityHistoryView['warmups'];
    support: TeacherSupport;
    incidents: Incident[]; // harmful things students tried to send, open until the teacher has seen them
    blocked: BlockedStatus; // words blocked for this lesson, and what the whole plaza is repeating
    warmup: { active: boolean; kind: WarmupKind; title?: string; players: { studentKey: string; name: string; fact: string; found: number; of: number }[]; team: { done: number; total: number } } | null;
    campaign: CampaignStatus | null; // the open game's campaign, once started
    sideQuests: SideQuestStatus | null; // the open game's side quests, with or without a campaign
    campaigns: CampaignChoice[]; // those that can be started, in the order to offer them
    open: boolean;
    game: { id: string; name: string; randomNames: boolean; vision: number; themeId: string } | null; // the open game, or the one last played
    realNames: Record<string, string>; // every student's real name, since the plaza may show made-up ones
    themesVersion: string; // changes when a map is added, changed or deleted, or new games start on another: the page then fetches /api/themes again
    games: GameSummary[];                      // every saved game, most recently played first
    pin: string | null; // the open game's PIN, which students type to join
    // `target` is the classmate a whisper is for; `everyone` marks a message for the whole plaza.
    entries: { id: string; studentKey: string; sender: string; target: string | null; everyone: boolean; flag: string | null; note: string | null; text: string; timestamp: number; status: string; starred: boolean }[];
    moderation: boolean; // an OpenAI key is set, so OpenAI checks every message before it posts
    muted: string[];
    // Every clip a device read aloud lately, newest first, so a phrase heard in the room leads to the speakers
    // it came from. `id` is the chat message (null for a voice sample); `now` is the server's clock, to age them by.
    sound: { allOff: boolean; off: string[]; now: number; plays: { at: number; studentKey: string; id: string | null; senderKey: string; text: string }[] };
    online: { studentKey: string; name: string; x: number; y: number; zone: string | null; level: number; look: Avatar }[]; // look: the avatar, for the teacher to recognise them by
};

const publicSeat = (seat: Seat) => ({ id: seat.id, name: seat.name, x: seat.x, y: seat.y, frozenUntil: seat.frozenUntil ?? 0, downUntil: seat.downUntil ?? 0, ...seat.avatar, ...(seat.style ? { style: seat.style } : {}) });

// The plaza. Everything that must outlast a lesson is a SQLite row: each student's
// looks, the games (a PIN each, kept for good) with where every student stood in
// them, the chat log, mutes, and which game is open. One game is open at a time. Who is online right now is the set of open sockets.
export class PlazaRoom extends DurableObject<Env> {
    private sql: SqlStorage;
    private missions: MissionRepository;
    private sideQuests: SideQuestStore;
    private themes: ThemeStore;
    private themeAssets: ThemeAssets;
    private missionSync: Promise<MissionSync> = Promise.resolve({ state: 'home', waiting: 0, keptBoth: [] });
    private missionSyncAt = 0;
    private questBoard: QuestBoard;
    private groups: SideQuestGroups;
    private gameSideQuests: GameSideQuests;
    private interviews: Interviews;
    private assistance: StudentAssistance;
    private incidents: SafetyIncidents;
    private blockedWords: BlockedWords;
    private taskWords: { game: string; at: number; words: Set<string> } | null = null; // the open story's words, for a minute
    // OpenAI's verdict on a message, for a couple of minutes: the hint and the sending check ask about the same words.
    private moderations = new Map<string, { verdict: Moderation; at: number }>();
    private participation: Participation;
    private reportChecks: ReportChecks;
    private activityHistory: ActivityHistory;
    private interviewSends = new Set<string>();
    private liveMissions: LiveMissions;
    private moves = new Map<string, [number, number]>(); // player id to latest position, not yet passed on
    private sideQuestWrong = new Map<string, number>(); // "game:student" to their last wrong side quest answer, for the short wait
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
            CREATE TABLE IF NOT EXISTS sound_off (student_key TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS speech_plays (
                ts INTEGER NOT NULL, game_id TEXT NOT NULL, student_key TEXT NOT NULL, chat_id TEXT, sender_key TEXT NOT NULL, text TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS speech_plays_game ON speech_plays (game_id, ts);
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
            CREATE TABLE IF NOT EXISTS warmup_templates (kind TEXT PRIMARY KEY, version INTEGER NOT NULL, definition TEXT NOT NULL);
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
                done TEXT NOT NULL DEFAULT '[]', last_wrong INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (game_id, student_key));
            CREATE TABLE IF NOT EXISTS student_tab_stats (
                game_id TEXT NOT NULL, student_key TEXT NOT NULL, tab_switches INTEGER NOT NULL DEFAULT 0, last_away INTEGER,
                PRIMARY KEY (game_id, student_key));`);
        // Older rooms predate nearby chat and whispers: their messages were for everyone.
        const chatColumns = this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('chat')").toArray().map(row => row.name);
        for (const [column, type] of [['target_key', 'TEXT'], ['target_name', 'TEXT'], ['x', 'REAL'], ['y', 'REAL'], ['flag', 'TEXT'], ['note', 'TEXT'], ['game_id', 'TEXT'], ['marks', 'TEXT'], ['voice', 'TEXT']]) {
            if (!chatColumns.includes(column)) this.sql.exec(`ALTER TABLE chat ADD COLUMN ${column} ${type}`);
        }
        // The whole name as PinPlay gives it, from which each game works out what to show.
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('students')").toArray().some(row => row.name === 'full_name')) {
            this.sql.exec('ALTER TABLE students ADD COLUMN full_name TEXT');
        }
        // A teacher's chosen display name belongs to the game, independent of the student's sign-in identity.
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('game_students')").toArray().some(row => row.name === 'display_name')) {
            this.sql.exec('ALTER TABLE game_students ADD COLUMN display_name TEXT');
        }
        // Undo keeps the writing as a draft while taking it out of the teacher's submitted reports.
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('campaign_reports')").toArray().some(row => row.name === 'submitted')) {
            this.sql.exec('ALTER TABLE campaign_reports ADD COLUMN submitted INTEGER NOT NULL DEFAULT 1');
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
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('warmups')").toArray().some(row => row.name === 'definition')) this.sql.exec('ALTER TABLE warmups ADD COLUMN definition TEXT');
        this.adoptOldClass();
        // Existing games retain Season 1, including saved positions and campaign progress.
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('games')").toArray().some(row => row.name === 'theme_id')) {
            this.sql.exec("ALTER TABLE games ADD COLUMN theme_id TEXT NOT NULL DEFAULT 'plaza'");
        }
        // A mission is published only when its map clues are in places some map has.
        this.missions = new MissionRepository(this.sql, () => this.themes.zones());
        this.missions.initialize();
        this.sideQuests = new SideQuestStore(this.sql);
        this.sideQuests.initialize();
        this.themes = new ThemeStore(this.sql, hash => this.themeAssets.has(hash));
        this.themes.initialize();
        this.themeAssets = new ThemeAssets(this.sql);
        this.themeAssets.initialize();
        this.groups = new SideQuestGroups(this.sql);
        this.groups.initialize();
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('campaign_reports')").toArray().some(row => row.name === 'group_id')) {
            this.sql.exec('ALTER TABLE campaign_reports ADD COLUMN group_id TEXT');
            this.sql.exec(`UPDATE campaign_reports SET group_id = (SELECT g.group_id FROM side_quest_groups g
                JOIN side_quest_members m ON m.group_id = g.group_id WHERE g.game_id = campaign_reports.game_id
                AND g.objective = campaign_reports.objective AND m.student_key = campaign_reports.student_key LIMIT 1)`);
        }
        this.sql.exec('CREATE INDEX IF NOT EXISTS campaign_reports_group ON campaign_reports (game_id, objective, group_id)');
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('campaign_reports')").toArray().some(row => row.name === 'check_id')) this.sql.exec('ALTER TABLE campaign_reports ADD COLUMN check_id TEXT');
        this.reportChecks = new ReportChecks(this.sql);
        this.reportChecks.initialize();
        this.activityHistory = new ActivityHistory(this.sql);
        this.activityHistory.initialize();
        this.questBoard = new QuestBoard(this.sql, this.groups, this.env.GROUP_START_MS !== undefined ? Number(this.env.GROUP_START_MS) : undefined,
            (board, objective) => this.activityHistory.record(board.game, 'quest', objective.id, this.helpSession(), objective.text));
        this.questBoard.initialize();
        this.interviews = new Interviews(this.sql);
        this.interviews.initialize();
        this.assistance = new StudentAssistance(this.sql);
        this.assistance.initialize();
        this.incidents = new SafetyIncidents(this.sql);
        this.incidents.initialize();
        this.blockedWords = new BlockedWords(this.sql);
        this.blockedWords.initialize();
        this.participation = new Participation(this.sql);
        this.participation.initialize();
        this.liveMissions = new LiveMissions(this.sql);
        this.liveMissions.initialize();
        // Side quests belong to the game; those once added to a mission chapter move to it.
        this.gameSideQuests = new GameSideQuests(this.sql);
        this.gameSideQuests.initialize();
        this.gameSideQuests.adoptMissionReleases(id => this.sideQuests.chapterOf(id));
        // Messages once waited for the teacher's approval; nothing does now. Any still waiting from then are not posted.
        this.sql.exec("UPDATE interviews SET question_status = 'rejected' WHERE question_status = 'pending'");
        this.sql.exec("UPDATE interviews SET answer_status = 'rejected' WHERE answer_status = 'pending'");
        for (const row of this.sql.exec<{ id: string }>("UPDATE chat SET status = 'rejected' WHERE status = 'pending' RETURNING id").toArray()) this.assistance.chatStatus(row.id, 'rejected');
        // Keepalive pings are answered without waking the room.
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
        this.ctx.storage.transactionSync(() => {
            const game = this.activeGame();
            const row = game ? this.sql.exec<{ last_opened: number }>('SELECT last_opened FROM games WHERE id = ?', game).toArray()[0] : undefined;
            this.activityHistory.recover(game && row && this.isOpen() ? { game, session: this.helpSession(), opened: row.last_opened } : undefined);
        });
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

    // The maps a game can be played on, for any page: pages fetch them instead of carrying their own copies. Maps in
    // Trash are listed apart, for the games still on them.
    themeList(): { themes: Theme[]; trash: Theme[]; default: string; version: string } {
        return { themes: this.themes.list(), trash: this.themes.trash(), default: this.themes.defaultId(), version: this.themes.version() };
    }

    // The theme studio: the maps with their drafts, and saving, publishing, discarding, deleting and restoring them. On
    // the laptop, like Mission Studio, they are brought up to date before they are read, and every change goes online at once.
    async themeStudio(token: string, op: string, body: unknown): Promise<ThemeResult & { sync?: MissionSync }> {
        if (!this.teacherSignedIn(token)) return { error: 'Please sign in again.', status: 401 };
        if (op === 'list') {
            const sync = await this.syncMissions();
            return { ...this.themes.execute('list', {}), sync };
        }
        const result = this.ctx.storage.transactionSync(() => this.themes.execute(op, body));
        if ('error' in result) return result;
        if (result.published) this.mapPublished(result.published);
        const sync = await this.syncMissions();
        // The upload may have kept the map as a copy, when it had changed online too: the page goes on with the
        // teacher's own version.
        const id = result.map && (sync.mapsKeptBoth?.find(item => item.id === result.map!.id)?.copy ?? result.map.id);
        const listing = this.themes.execute('list', {}) as { maps: StudioMap[]; default: string };
        const map = listing.maps.find(item => item.id === id);
        return { ...listing, ...(map ? { map } : {}), ...(result.published ? { published: result.published } : {}), sync };
    }
    async themeAsset(token: string, bytes: Uint8Array): Promise<{ url: string; hash: string } | { error: string; status: number }> {
        if (!this.teacherSignedIn(token)) return { error: 'Please sign in again.', status: 401 };
        return this.themeAssets.put(bytes);
    }
    // Online: a picture of one of the laptop's maps, sent before the map.
    async syncPictureServe(lease: string, bytes: Uint8Array): Promise<{ url: string; hash: string } | { error: string; status: number }> {
        const laptop = this.laptop();
        if (!laptop || !secretsMatch(lease, laptop.lease)) return { error: 'Sign in again on the laptop.', status: 401 };
        return this.themeAssets.put(bytes);
    }
    themeAssetFile(hash: string): { type: string; bytes: Uint8Array } | null {
        return /^[0-9a-f]{64}$/.test(hash) ? this.themeAssets.get(hash) : null;
    }
    // A published map is live at once in every game on it: students standing where there is now a wall go back to
    // the start, and every page draws the new map.
    private mapPublished(id: string): void {
        const theme = this.themes.theme(id); const world = this.themes.world(id);
        for (const ws of this.ctx.getWebSockets()) {
            const seat = ws.deserializeAttachment() as Seat | null;
            if (!seat || seat.left || seat.themeId !== id) continue;
            if (world.isBlocked(seat.x, seat.y)) {
                const tries = Array.from({ length: 12 }, () => ({ x: world.SPAWN.x + Math.round(Math.random() * 100 - 50), y: world.SPAWN.y + Math.round(Math.random() * 100 - 50) }));
                const spot = tries.find(point => !world.isBlocked(point.x, point.y)) ?? world.SPAWN;
                seat.x = spot.x; seat.y = spot.y; seat.movedAt = Date.now();
                this.moves.delete(seat.id);
                ws.serializeAttachment(seat);
                try { ws.send(JSON.stringify({ t: 'snap', x: seat.x, y: seat.y })); } catch { /* closing */ }
                this.broadcast({ t: 'move', id: seat.id, x: seat.x, y: seat.y });
            }
            try { ws.send(JSON.stringify({ t: 'theme', theme })); } catch { /* closing */ }
        }
    }

    // On the laptop, this keeps the online plaza's lease.
    setting(key: string): string | null {
        return this.sql.exec<{ value: string }>('SELECT value FROM settings WHERE key = ?', key).toArray()[0]?.value ?? null;
    }

    saveSetting(key: string, value: string): void {
        this.sql.exec('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
    }

    // On the teacher's laptop, Mission Studio works on the laptop's copy: brought up to date before it is read, and every
    // change sent to the online server at once (README, "Missions live online"). The answer says how that went.
    async missionStudioSynced(token: string, op: string, body: unknown): Promise<(MissionResult | LiveMissionResult) & { sync?: MissionSync }> {
        if (!this.teacherSignedIn(token)) return { error: 'Please sign in again.', status: 401 };
        if (op === 'list' || op === 'get') {
            const sync = await this.syncMissions();
            return { ...this.missionStudio(token, op, body), sync };
        }
        const result = this.missionStudio(token, op, body);
        if ('error' in result || !['create', 'save', 'publish', 'delete', 'restore'].includes(op) || !('draft' in result) || !result.draft) return result;
        const sync = await this.syncMissions();
        // The upload may have renumbered the draft, or kept it as a copy when it had changed online too: the page
        // gets what is here now, and goes on with the teacher's own version.
        const id = result.draft.campaign.id;
        const draft = this.missions.draft(sync.keptBoth.find(item => item.id === id)?.copy ?? id) ?? result.draft;
        return { ...result, draft, library: this.missions.list(), trash: this.missions.list(true), sync };
    }

    missionStudio(token: string, op: string, body: unknown): MissionResult | LiveMissionResult {
        const session = this.sql.exec('SELECT 1 FROM teacher_sessions WHERE token = ? AND expires > ?', token, Date.now()).toArray();
        if (!token || session.length === 0) return { error: 'Please sign in again.', status: 401 };
        const result = this.ctx.storage.transactionSync(() => op.startsWith('live') || op === 'library-preview' ? this.liveMissionAction(token, op, body) : this.missions.execute(op, body));
        if (!('error' in result) && ('released' in result || 'withdrawn' in result || 'closed' in result)) {
            const game = this.activeGame(); if (game) this.sendQuestToAll(game);
        }
        return result;
    }

    campaignGuide(token: string, campaignId?: string, gameId?: string): TeacherGuide | { error: string; status: number } {
        if (!token || !this.sql.exec('SELECT 1 FROM teacher_sessions WHERE token = ? AND expires > ?', token, Date.now()).toArray().length) {
            return { error: 'Please sign in again.', status: 401 };
        }
        if (campaignId !== undefined) {
            if (gameId !== undefined || !missionId(campaignId)) return { error: 'Choose one campaign or the current game.', status: 400 };
            const published = this.missions.latest(campaignId);
            if (!published) return { error: 'Published campaign not found.', status: 404 };
            return { campaign: { id: published.campaign.id, title: published.campaign.title, revision: published.revision },
                game: null, currentChapter: 0, ...buildGuide(published.campaign) };
        }
        const game = this.game(this.activeGame());
        if (gameId !== undefined && game?.id !== gameId) return { error: 'The active game changed. Reopen its teacher guide.', status: 409 };
        const row = game && this.campaignRow(game.id);
        const campaign = game && this.gameCampaign(game.id);
        if (!game || !row || !campaign) return { error: 'Start a campaign to see its teacher guide.', status: 404 };
        const names = this.rosterNames(game.id);
        const players = this.campaignPlayers(game.id);
        const thieves = campaign.chapters.map((_, index) => this.chapterThieves(game.id, campaign, index));
        return { campaign: { id: campaign.id, title: campaign.title, revision: row.revision_id ?? '' },
            game: { id: game.id, name: game.name }, currentChapter: row.chapter, ...buildGuide(campaign, {
                roleNames: Object.fromEntries(campaign.roles.map(role => [role.id, players.filter(p => p.role_id === role.id).map(p => names.get(p.student_key) ?? 'Student')])),
                thiefNames: thieves.map(keys => keys.map(key => names.get(key) ?? 'Student')),
                clueText: (text, chapter) => thieves[chapter].length ? fillThiefClue(text, thieves[chapter].map(key => lookOf(this.avatarOf(key))))
                    : text.replace(/\{(?:hat|coat|glasses|hair)\}/g, '(an avatar detail revealed when the thief is chosen)'),
            }) };
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
    // How many students in the plaza could take a quest right now, were it on the board (and released, if the teacher
    // releases it): a snapshot for the teacher. `given`: one of the game's side quests, not an addition to the mission.
    private eligibleNow(game: string, objective: Objective, given: boolean): number {
        const quest = objective.board?.teacherReleased ? { ...objective, board: { ...objective.board, teacherReleased: false } } : objective;
        return [...new Set(this.seats().filter(seat => seat.game === game).map(seat => seat.studentKey))].filter(key => {
            const ctx = this.boardContext(game, key);
            if (!ctx?.online.has(key)) return false;
            const added: BoardContext = { ...ctx, quests: [...ctx.quests, quest], sideQuests: new Set([...ctx.sideQuests, quest.id]),
                gameQuests: given ? new Set([...ctx.gameQuests, quest.id]) : ctx.gameQuests };
            return !this.questBoard.wait(added, quest);
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
            result.quests.forEach((objective, i) => { result.preview.quests[i].eligibleNow = this.eligibleNow(target.game.id, objective, false); });
            return { target, preview: result.preview };
        }
        if (op === 'live-release') {
            const preview = typeof b.previewId === 'string' ? this.liveMissions.pending(token, b.previewId) : undefined;
            if (!preview) return { error: 'This preview is no longer available. Review the quests again.', status: 409 };
            if (preview.expires <= Date.now() || preview.game_id !== target.game.id || preview.revision_id !== target.campaign.revision || preview.chapter_id !== target.chapter.id || preview.base_version !== target.version
                || this.missions.draft(preview.source_id)?.version !== preview.source_version) return { error: 'The preview expired or the game/draft changed. Review the quests again.', status: 409 };
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
        if (op === 'live-close') {
            // A started side quest takes nobody new; those doing it can finish.
            if (b.gameId !== target.game.id || b.targetEpoch !== target.epoch) return { error: 'The running game changed. Refresh before closing a quest.', status: 409 };
            if (typeof b.objectiveId !== 'string' || !target.additions.some(a => a.id === b.objectiveId)) return { error: 'Choose a side quest in the current chapter.', status: 400 };
            const error = this.liveMissions.close(target.game.id, b.objectiveId);
            return error ? { error, status: 409 } : { target: this.liveTarget(), closed: b.objectiveId };
        }
        return { error: 'Unknown live mission action.', status: 400 };
    }

    // The open game's side quest board, for the library page.
    private boardTarget(): SideQuestTarget | null {
        const game = this.game(this.activeGame());
        if (!game) return null;
        const row = this.campaignRow(game.id); const campaign = row ? this.gameCampaign(game.id) : undefined;
        const chapter = row && campaign && row.status !== 'campaign_complete' ? campaign.chapters[row.chapter] : undefined;
        return { game: { id: game.id, name: game.name }, open: this.isOpen(), version: this.gameSideQuests.version(game.id),
            mission: chapter ? { title: campaign!.title, chapter: { id: chapter.id, title: chapter.title, index: row!.chapter }, questionIds: campaign!.chapters.flatMap(c => c.objectives.map(o => o.id)) } : null,
            quests: this.gameSideQuests.added(game.id) };
    }
    // The library page adds side quests to the open game, after a review, and closes or withdraws them. A mission is not
    // needed; a story quest, written for one mission chapter, only goes in while that chapter runs.
    sideQuestBoard(token: string, op: string, body: unknown): SideQuestBoardResult {
        if (!this.teacherSignedIn(token)) return { error: 'Please sign in again.', status: 401 };
        const b = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
        const result = this.ctx.storage.transactionSync((): SideQuestBoardResult => {
            const target = this.boardTarget();
            if (op === 'board') return { target };
            if (op === 'board-cancel') { if (typeof b.previewId === 'string') this.gameSideQuests.cancel(token, b.previewId); return { target }; }
            if (!target?.open) return { error: 'Open a game in Teacher controls first.', status: 400 };
            const game = target.game.id;
            if (op === 'board-preview') {
                // The server builds the quests from its own copy of the library: a page only chooses which ones.
                if (b.gameId !== game || b.version !== target.version) return { error: 'The game changed. Refresh it before reviewing quests.', status: 409 };
                if (!Array.isArray(b.questIds) || !b.questIds.length || b.questIds.length > 10 || b.questIds.some(id => typeof id !== 'string')) return { error: 'Choose up to 10 quests from the library.', status: 400 };
                const library = this.sideQuests.quests();
                const chosen = (b.questIds as string[]).map(id => library.find(quest => quest.id === id));
                if (chosen.some(quest => !quest)) return { error: 'Choose quests from the library.', status: 400 };
                const campaign = target.mission ? this.gameCampaign(game) : undefined;
                for (const quest of chosen as SideQuest[]) {
                    if (!quest.chapter) continue;
                    const reason = target.mission && campaign ? questFit(quest, campaign, target.mission.chapter.id, this.storyChapters()) : 'This story quest belongs to a mission chapter: start that mission first.';
                    if (reason) return { error: `${quest.title}: ${reason}`, status: 400 };
                }
                const quests = (chosen as SideQuest[]).map(quest => ({ objective: questObjective(quest), chapterId: quest.chapter ? target.mission!.chapter.id : null }));
                const held = this.gameSideQuests.preview(token, game, quests, libraryVersion(library));
                if ('error' in held) return held;
                const audience = (objective: Objective) => objective.board?.roles?.length ? objective.board.roles.map(id => campaign?.roles.find(role => role.id === id)?.name ?? id).join(', ') : 'Everyone';
                return { target, preview: { id: held.id, game: target.game, expires: held.expires,
                    quests: quests.map(({ objective }) => ({ id: objective.id, audience: audience(objective), eligibleNow: this.eligibleNow(game, objective, true) })) } };
            }
            if (op === 'board-release') {
                const preview = typeof b.previewId === 'string' ? this.gameSideQuests.pending(token, b.previewId) : undefined;
                if (!preview || preview.expires <= Date.now() || preview.game_id !== game || preview.base_version !== target.version || preview.source_version !== this.libraryVersionNow())
                    return { error: 'The review expired, or the game or the library changed. Review the quests again.', status: 409 };
                const released = this.gameSideQuests.release(preview, preview.source_version);
                return { target: this.boardTarget(), released };
            }
            if (op === 'board-close' || op === 'board-withdraw') {
                if (b.gameId !== game || typeof b.questId !== 'string') return { error: 'The game changed. Refresh it first.', status: 409 };
                const error = op === 'board-close' ? this.gameSideQuests.close(game, b.questId) : this.gameSideQuests.withdraw(game, b.questId);
                return error ? { error, status: 409 } : { target: this.boardTarget(), ...(op === 'board-close' ? { closed: b.questId } : { withdrawn: b.questId }) };
            }
            return { error: 'Unknown side quest board action.', status: 400 };
        });
        if (!('error' in result) && result.target && (result.released || result.closed || result.withdrawn)) this.sendQuestToAll(result.target.game.id);
        return result;
    }

    async teacher(token: string, action: TeacherAction): Promise<TeacherStatus | { error: string; status: number }> {
        const session = this.sql.exec('SELECT 1 FROM teacher_sessions WHERE token = ? AND expires > ?', token, Date.now()).toArray();
        if (!token || session.length === 0) return { error: 'Please sign in again.', status: 401 };
        if (action.kind === 'student') {
            const problem = this.editStudent(action);
            if (problem) return problem;
        }
        if (action.kind === 'reportAccept') {
            const problem = await this.acceptReport(action);
            if (problem) return { error: problem, status: 409 };
        }
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
        if (action.kind === 'questPlace') {
            // The teacher puts a free student into a side quest (a group for it, when it has one), as if they chose it.
            const game = this.activeGame(); const ctx = game ? this.boardContext(game, action.studentKey) : null;
            const quest = ctx?.quests.find(o => o.id === action.objective);
            if (!game || !ctx || !quest || !ctx.sideQuests.has(quest.id)) return { error: 'Choose a side quest on this game\'s board.', status: 400 };
            if (!ctx.online.has(action.studentKey)) return { error: 'That student is not in the plaza.', status: 400 };
            const error = this.questBoard.assignment(game, quest.id, action.studentKey) ? 'That student already has this quest.' : this.questBoard.claim(ctx, quest);
            if (error) return { error, status: 409 };
            this.notify(action.studentKey, 'info', 'Your teacher chose a side quest for you. It is in your Journal.');
            this.sendQuestToAll(game);
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
            // A student with a warm-up part left is not asked to choose a side quest.
            this.sendQuestToAll(game);
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
        if (action.kind === 'realNames') {
            const game = this.activeGame();
            if (!this.isOpen() || !game || action.gameId !== game) return { error: 'The open game has changed. Refresh and try again.', status: 409 };
            this.useRealNames(game);
        }
        if (action.kind === 'newGame') {
            const name = action.name.trim().replace(/\s+/g, ' ').slice(0, 40);
            if (!name) return { error: 'Give the game a name.', status: 400 };
            if (action.themeId !== undefined && !this.themes.has(action.themeId)) return { error: 'Choose an available map.', status: 400 };
            this.setOpen(true, this.createGame(name, action.randomNames !== false, action.vision ?? DEFAULT_VISION, action.themeId));
        }
        if (action.kind === 'remove' && !this.remove(action.id)) return { error: 'Only a message that posted can be taken down.', status: 400 };
        if (action.kind === 'xp') {
            const failed = this.teacherStar(action);
            if (failed) return { error: failed, status: 400 };
        }
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
                    const position = clampPosition(action.x, action.y, this.themes.theme(seat.themeId).world);
                    if (!position || this.themes.world(seat.themeId).isBlocked(position.x, position.y)) return { error: 'Choose an open path on the map.', status: 400 };
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
        if (action.kind === 'incident') {
            const game = this.activeGame();
            if (!game || !this.incidents.seen(game, action.id)) return { error: 'That incident is no longer open.', status: 400 };
        }
        if (action.kind === 'block' || action.kind === 'unblock' || action.kind === 'letThrough') {
            const accepted = action.kind === 'block' ? await this.englishAccepts(this.activeGame()) : undefined;
            const game = this.activeGame();
            if (!game || !this.isOpen()) return { error: 'Open the class first: blocked words last for one lesson.', status: 400 };
            if (action.kind === 'block') {
                const blocked = this.blockedWords.block(game, this.helpSession(), action.words);
                if (typeof blocked === 'string') return { error: blocked, status: 400 };
                this.takeDownBlocked(game, blocked, accepted);
            }
            if (action.kind === 'unblock' && !this.blockedWords.unblock(game, this.helpSession(), action.key)) return { error: 'That is not blocked.', status: 400 };
            if (action.kind === 'letThrough') this.blockedWords.letThrough(game, this.helpSession(), action.key, action.words);
        }
        if (action.kind === 'mute') {
            if (action.muted) this.sql.exec('INSERT OR IGNORE INTO mutes (student_key) VALUES (?)', action.studentKey);
            else this.sql.exec('DELETE FROM mutes WHERE student_key = ?', action.studentKey);
        }
        if (action.kind === 'sound') {
            if (action.off) this.sql.exec('INSERT OR IGNORE INTO sound_off (student_key) VALUES (?)', action.studentKey);
            else this.sql.exec('DELETE FROM sound_off WHERE student_key = ?', action.studentKey);
            for (const ws of this.ctx.getWebSockets(action.studentKey)) this.sendSound(ws, action.studentKey);
        }
        if (action.kind === 'soundAll') {
            this.saveSetting('sound_all_off', action.off ? '1' : '0');
            for (const ws of this.ctx.getWebSockets()) {
                const seat = ws.deserializeAttachment() as Seat | null;
                if (seat && !seat.left && ws.readyState === WebSocket.READY_STATE_OPEN) this.sendSound(ws, seat.studentKey);
            }
        }
        // The dashboard polls every 2 seconds: send everything still pending plus
        // recent history, read through the indexes, not the whole log each time.
        const blocked = await this.blockedStatus(this.activeGame());
        const current = this.game(this.activeGame());
        const tabStats = new Map(current ? this.sql.exec<{ student_key: string; tab_switches: number; last_away: number | null }>(
            'SELECT student_key, tab_switches, last_away FROM student_tab_stats WHERE game_id = ?', current.id).toArray()
            .map(row => [row.student_key, row] as const) : []);
        return {
            incidents: current ? this.incidents.open(current.id, this.rosterNames(current.id)) : [],
            warmupPlays: current ? this.activityHistory.warmupCounts(current.id) : {},
            blocked,
            support: { alerts: current ? this.assistance.alerts(current.id, this.rosterNames(current.id)) : [],
                ai: this.assistance.aiCount(this.helpSession()),
                students: current ? [...this.rosterNames(current.id)].map(([studentKey, name]) => ({ studentKey, name,
                    tabSwitches: tabStats.get(studentKey)?.tab_switches ?? 0, tabAwayAt: tabStats.get(studentKey)?.last_away ?? null })) : [] },
            warmup: this.warmupStatus(current?.id ?? null),
            campaign: this.campaignStatus(current?.id ?? null),
            sideQuests: this.sideQuestStatus(current?.id ?? null),
            campaigns: this.missions.published(),
            open: this.isOpen(),
            game: current && { id: current.id, name: current.name, randomNames: this.isRandom(current.id), vision: this.vision(current.id), themeId: current.themeId },
            themesVersion: this.themes.version(),
            realNames: Object.fromEntries(this.sql.exec<{ student_key: string; full: string }>(
                'SELECT student_key, COALESCE(full_name, name) AS full FROM students').toArray().map(row => [row.student_key, row.full])),
            games: this.sql.exec<{ id: string; name: string; pin: string; lastOpened: number; randomNames: number; themeId: string }>(
                'SELECT id, name, pin, last_opened AS lastOpened, random_names AS randomNames, theme_id AS themeId FROM games ORDER BY last_opened DESC').toArray()
                .map(game => ({ ...game, randomNames: game.randomNames === 1, open: this.isOpen() && game.id === current?.id })),
            pin: this.classPin(),
            entries: this.sql.exec<Omit<TeacherStatus['entries'][number], 'starred' | 'everyone'> & { everyone: number }>(`SELECT id, student_key AS studentKey, sender, target_name AS target,
                (target_key IS NULL AND x IS NULL) AS everyone, flag, note, text, ts AS timestamp, status FROM chat
                WHERE game_id IS ? ORDER BY ts DESC LIMIT ?`, current?.id ?? null, STATUS_HISTORY).toArray()
                .map(entry => ({ ...entry, everyone: entry.everyone === 1, starred: this.starred(entry.studentKey, `teacher:${entry.id}`) })),
            moderation: !!this.env.OPENAI_API_KEY,
            muted: this.sql.exec<{ student_key: string }>('SELECT student_key FROM mutes').toArray().map(row => row.student_key),
            sound: {
                allOff: this.setting('sound_all_off') === '1',
                off: this.sql.exec<{ student_key: string }>('SELECT student_key FROM sound_off').toArray().map(row => row.student_key),
                now: Date.now(),
                plays: current ? this.sql.exec<TeacherStatus['sound']['plays'][number]>(`SELECT ts AS at, student_key AS studentKey, chat_id AS id,
                    sender_key AS senderKey, text FROM speech_plays WHERE game_id = ? AND ts > ? ORDER BY ts DESC LIMIT ?`,
                    current.id, Date.now() - PLAYS_SHOWN_MS, PLAYS_SHOWN).toArray() : []
            },
            online: this.seats().filter(seat => seat.game === current?.id).map(seat => ({
                studentKey: seat.studentKey, name: seat.name, x: seat.x, y: seat.y, zone: this.themes.world(seat.themeId).zoneAt(seat.x, seat.y), level: levelOf(this.xpOf(seat.studentKey)).level, look: seat.avatar,
                inTab: seat.inTab !== false, tabSwitches: seat.tabSwitches ?? 0, tabAwayAt: seat.tabAwayAt ?? null
            }))
        };
    }

    studentProfile(token: string, gameId: string, studentKey: string) {
        if (!token || !this.sql.exec('SELECT 1 FROM teacher_sessions WHERE token = ? AND expires > ?', token, Date.now()).toArray().length) return { error: 'Please sign in again.', status: 401 };
        if (!gameId || gameId !== this.activeGame()) return { error: 'The selected game changed. Refresh the controls.', status: 409 };
        const name = this.rosterNames(gameId).get(studentKey);
        if (!name) return { error: 'That student is not in this game.', status: 404 };
        const avatar = this.avatarOf(studentKey);
        avatar.voice ??= voiceFor(studentKey);
        const tabStat = this.sql.exec<{ tab_switches: number; last_away: number | null }>(
            'SELECT tab_switches, last_away FROM student_tab_stats WHERE game_id = ? AND student_key = ?',
            gameId, studentKey).toArray()[0];
        const seat = this.seats().find(s => s.game === gameId && s.studentKey === studentKey);
        return {
            studentKey, name, avatar,
            inTab: seat ? seat.inTab !== false : false,
            tabSwitches: Math.max(seat?.tabSwitches ?? 0, tabStat?.tab_switches ?? 0),
            tabAwayAt: seat ? seat.tabAwayAt ?? null : tabStat?.last_away ?? null
        };
    }

    private editStudent(action: Extract<TeacherAction, { kind: 'student' }>): { error: string; status: number } | null {
        const game = this.activeGame();
        if (!game || action.gameId !== game) return { error: 'The selected game changed. Refresh the controls.', status: 409 };
        const before = this.rosterNames(game);
        if (!before.has(action.studentKey)) return { error: 'That student is not in this game.', status: 404 };
        if (action.name === undefined && action.avatar === undefined) return { error: 'Choose a name or character to change.', status: 400 };
        let name: string | undefined;
        if (action.name !== undefined) {
            if (typeof action.name !== 'string') return { error: 'Enter a display name.', status: 400 };
            name = action.name.normalize('NFC').trim().replace(/\s+/g, ' ');
            if (!/^[\p{L}\p{N} '_-]{2,24}$/u.test(name) || !/[\p{L}\p{N}]/u.test(name)) return { error: 'Use 2–24 letters, numbers, spaces, apostrophes, hyphens or underscores.', status: 400 };
            if (chatProblem(name) || ['teacher', 'system', 'everyone', 'nearby'].includes(name.toLowerCase())) return { error: 'Choose a different display name.', status: 400 };
            if ([...before].some(([key, other]) => key !== action.studentKey && other.toLowerCase() === name!.toLowerCase())) return { error: 'Another student in this game already has that name.', status: 409 };
        }
        const avatar = action.avatar === undefined ? undefined : sanitizeAvatar(action.avatar);
        if (avatar === null) return { error: 'That character is not available.', status: 400 };
        if (avatar) avatar.voice ??= this.avatarOf(action.studentKey).voice ?? voiceFor(action.studentKey);
        this.ctx.storage.transactionSync(() => {
            if (name !== undefined && name !== before.get(action.studentKey)) {
                this.sql.exec(`INSERT INTO game_students (game_id, student_key, display_name) VALUES (?, ?, ?)
                    ON CONFLICT (game_id, student_key) DO UPDATE SET display_name = excluded.display_name`, game, action.studentKey, name);
            }
            if (avatar) this.sql.exec('UPDATE students SET avatar = ? WHERE student_key = ?', JSON.stringify(avatar), action.studentKey);
        });
        const names = this.rosterNames(game);
        const changes = [...names].flatMap(([key, current]) => before.get(key) !== current ? [{ key, from: before.get(key)!, name: current }] : []);
        const ids = new Map<string, string>();
        for (const ws of this.ctx.getWebSockets()) {
            const seat = ws.deserializeAttachment() as Seat | null;
            if (!seat || seat.left || seat.game !== game) continue;
            ids.set(seat.studentKey, seat.id);
            seat.name = names.get(seat.studentKey) ?? seat.name;
            if (avatar && seat.studentKey === action.studentKey) seat.avatar = avatar;
            ws.serializeAttachment(seat);
            if (seat.studentKey === action.studentKey) this.sendAlias(ws, game, seat.studentKey);
        }
        for (const change of changes) {
            this.sql.exec('UPDATE chat SET sender = ? WHERE game_id = ? AND student_key = ?', change.name, game, change.key);
            this.sql.exec('UPDATE chat SET target_name = ? WHERE game_id = ? AND target_key = ?', change.name, game, change.key);
        }
        if (changes.length) this.broadcast({ t: 'names', randomNames: this.isRandom(game), names: [...names.values()], changes: changes.map(change => ({ id: ids.get(change.key), from: change.from, name: change.name })) });
        if (avatar) {
            const id = ids.get(action.studentKey);
            if (id) this.broadcast({ t: 'avatar', id, avatar });
        }
        this.sendWarmupToAll(game);
        this.sendQuestToAll(game);
        return null;
    }

    // One student's conversations for the teacher's drawer: a thread for each person or place they wrote to, what they
    // wrote (sent or not), what classmates whispered to them, and the teacher's private messages.
    conversations(token: string, studentKey: string): Conversations | { error: string; status: number } {
        if (!token || !this.sql.exec('SELECT 1 FROM teacher_sessions WHERE token = ? AND expires > ?', token, Date.now()).toArray().length) return { error: 'Please sign in again.', status: 401 };
        const game = this.activeGame();
        if (!game) return { studentKey, lines: [], names: {} };
        const names = this.rosterNames(game);
        const keyOf = new Map([...names].map(([key, name]) => [name, key]));
        // Whether a posted message went to everyone: it keeps no place on the map.
        const toEveryone = new Set(this.sql.exec<{ id: string }>('SELECT id FROM chat WHERE game_id = ? AND student_key = ? AND target_key IS NULL AND x IS NULL', game, studentKey).toArray().map(row => row.id));
        const lines: ConversationLine[] = [];
        // What the student wrote, sent or not, and the teacher's private messages to them.
        for (const row of this.sql.exec<{ id: string; ts: number; source: string; status: string; text: string; target: string | null; reason: string | null; chat_id: string | null }>(
            `SELECT id, ts, source, status, text, target, reason, chat_id FROM assistance_attempts WHERE game_id = ? AND student_key = ?
             AND source IN ('chat', 'interview', 'help', 'teacher') ORDER BY ts DESC, id DESC LIMIT 300`, game, studentKey).toArray()) {
            const teacher = row.source === 'teacher' || row.source === 'help' || row.target === 'Teacher';
            const everyone = row.target === 'Everyone' || (!row.target && !!row.chat_id && toEveryone.has(row.chat_id));
            const thread = teacher ? 'teacher' : everyone ? 'everyone' : row.target ? `p:${keyOf.get(row.target) ?? row.target}` : 'nearby';
            lines.push({ id: row.id, at: row.ts, thread, mine: row.source !== 'teacher', text: row.text, status: row.status, reason: row.reason });
        }
        // What classmates wrote to them privately, posted or waiting.
        for (const row of this.sql.exec<{ id: string; ts: number; student_key: string; text: string; status: string }>(
            `SELECT id, ts, student_key, text, status FROM chat WHERE game_id = ? AND target_key = ? AND status IN ('approved', 'pending') ORDER BY ts DESC LIMIT 200`,
            game, studentKey).toArray()) {
            lines.push({ id: row.id, at: row.ts, thread: `p:${row.student_key}`, mine: false, text: row.text, status: row.status, reason: null });
        }
        lines.sort((a, b) => a.at - b.at);
        return { studentKey, lines, names: Object.fromEntries(names) };
    }

    // ---------- One home for missions ----------
    // The online server keeps every mission and side quest. A teacher's laptop keeps a copy to play and edit, sends
    // every change there at once and fetches what changed online. Without internet the laptop carries on and sends its
    // changes later; a mission or quest changed in both places is kept twice, never overwritten.

    private teacherSignedIn(token: string): boolean {
        return !!token && this.sql.exec('SELECT 1 FROM teacher_sessions WHERE token = ? AND expires > ?', token, Date.now()).toArray().length > 0;
    }
    private libraryVersionNow(): number {
        return libraryVersion(this.sideQuests.quests());
    }
    // The chapters of the published missions, for story quests.
    private storyChapters(): StoryChapter[] {
        return storyChapters(this.missions.published().flatMap(choice => { const campaign = this.missions.revision(choice.revision ?? null); return campaign ? [campaign] : []; }));
    }

    // On the laptop: send what changed here, then fetch what changed online. One exchange at a time, each after the last.
    syncMissions(): Promise<MissionSync> {
        if (!this.env.LAN_URL || !this.env.CLOUD_URL) return Promise.resolve({ state: 'home', waiting: 0, keptBoth: [] });
        this.missionSyncAt = Date.now();
        this.missionSync = this.missionSync.catch(() => undefined).then(() => this.exchangeMissions());
        return this.missionSync;
    }
    // While the teacher page is open on the laptop, now and then: what changed online arrives, and what waits goes up.
    async syncMissionsSometimes(): Promise<void> {
        if (Date.now() - this.missionSyncAt >= MISSION_SYNC_EVERY_MS) await this.syncMissions();
    }

    private async exchangeMissions(): Promise<MissionSync> {
        const keptBoth: MissionSync['keptBoth'] = []; const questsKeptBoth: MissionSync['keptBoth'] = [];
        const mapsKeptBoth: MissionSync['keptBoth'] = []; let mapsOutdated = false;
        const status = (state: MissionSync['state']): MissionSync => ({ state, waiting: this.missions.waiting() + this.sideQuests.waiting() + this.themes.waiting(), keptBoth,
            ...(questsKeptBoth.length ? { questsKeptBoth } : {}), ...(mapsKeptBoth.length ? { mapsKeptBoth } : {}), ...(mapsOutdated ? { maps: 'outdated' as const } : {}) });
        const lease = this.setting('cloud_lease');
        if (!lease) return status('signin');
        const call = async <T>(body: object): Promise<T> => {
            const response = await fetch(new URL('/api/missions/sync', this.env.CLOUD_URL!), {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lease, ...body }), signal: AbortSignal.timeout(10_000)
            });
            if (!response.ok) throw new SyncStopped(response.status === 401 ? 'signin' : response.status === 404 ? 'outdated' : 'offline', response.status);
            return await response.json() as T;
        };
        // A picture of a map, before the map: the online server refuses a map whose pictures it does not have.
        const sendPicture = async (hash: string) => {
            const file = this.themeAssets.get(hash);
            if (!file) return;
            const response = await fetch(new URL('/api/missions/sync-picture', this.env.CLOUD_URL!), {
                method: 'POST', headers: { 'x-laptop-lease': lease, 'content-type': file.type }, body: file.bytes, signal: AbortSignal.timeout(30_000)
            });
            if (!response.ok) throw new SyncStopped(response.status === 401 ? 'signin' : 'offline', response.status);
        };
        try {
            for (const { copy, base } of this.missions.outbox()) {
                const { result } = await call<{ result: MissionPushResult }>({ op: 'push', copy, base });
                this.ctx.storage.transactionSync(() => this.missions.uploaded(copy, result));
                if (result.outcome === 'kept-both' && result.copy) keptBoth.push({ id: copy.id, copy: result.copy.id, title: (JSON.parse(result.copy.content) as Campaign).title });
            }
            const quests = this.sideQuests.outbox();
            for (let start = 0; start < quests.length; start += QUEST_PUSH_BATCH) {
                const pushes = quests.slice(start, start + QUEST_PUSH_BATCH);
                const { results } = await call<{ results: SideQuestPushResult[] }>({ op: 'push-quests', pushes });
                this.ctx.storage.transactionSync(() => pushes.forEach(({ copy }, n) => { if (results[n]) this.sideQuests.uploaded(copy, results[n]); }));
                pushes.forEach(({ copy }, n) => {
                    const copied = results[n]?.outcome === 'kept-both' ? results[n].copy : undefined;
                    if (copied) questsKeptBoth.push({ id: copy.id, copy: copied.id, title: (JSON.parse(copied.content) as SideQuest).title });
                });
            }
            // Maps, each after its pictures. An online server that does not keep maps yet refuses them; missions and
            // side quests still sync, and the maps wait.
            try {
                const maps = this.themes.outbox();
                for (let start = 0; start < maps.length; start += MAP_PUSH_BATCH) {
                    const pushes = maps.slice(start, start + MAP_PUSH_BATCH);
                    const pictures = [...new Set(pushes.flatMap(({ copy }) => copyPictures(copy)))];
                    for (let first = 0; first < pictures.length; first += PICTURE_ASK_LIMIT) {
                        const asked = pictures.slice(first, first + PICTURE_ASK_LIMIT);
                        const { missing } = await call<{ missing: string[] }>({ op: 'missing-pictures', hashes: asked });
                        for (const hash of missing.filter(hash => asked.includes(hash))) await sendPicture(hash);
                    }
                    const { results } = await call<{ results: MapPushResult[] }>({ op: 'push-maps', pushes });
                    this.ctx.storage.transactionSync(() => pushes.forEach(({ copy }, n) => { if (results[n]) this.themes.uploaded(copy, results[n]); }));
                    pushes.forEach(({ copy }, n) => {
                        const result = results[n];
                        if (result?.outcome === 'kept-both' && result.copy) mapsKeptBoth.push({ id: copy.id, copy: result.copy.id, title: (JSON.parse(result.copy.draft ?? result.copy.content) as Theme).name });
                    });
                }
            } catch (cause) {
                if (!(cause instanceof SyncStopped && cause.status === 400)) throw cause;
                mapsOutdated = true;
            }
            const changes = await call<{ missions: MissionCopy[]; quests?: SideQuestCopy[]; maps?: MapCopy[] }>({ op: 'pull', ...this.missions.known(), quests: this.sideQuests.known(), maps: this.themes.known() });
            this.ctx.storage.transactionSync(() => {
                this.missions.downloaded(changes.missions);
                if (changes.quests) this.sideQuests.downloaded(changes.quests);
            });
            if (changes.maps) await this.mapsDownloaded(changes.maps);
            return status('synced');
        } catch (cause) {
            return status(cause instanceof SyncStopped ? cause.state : 'offline');
        }
    }

    // On the laptop: maps from the online server, after the pictures they need. A map whose pictures did not arrive
    // stays out, and comes with the next download. Games on a map that changed draw it again.
    private async mapsDownloaded(copies: MapCopy[]): Promise<void> {
        for (const hash of [...new Set(copies.flatMap(copy => { try { return copyPictures(copy); } catch { return []; } }))].filter(hash => !this.themeAssets.has(hash))) {
            try {
                const response = await fetch(new URL(`/api/theme-assets/${hash}`, this.env.CLOUD_URL!), { signal: AbortSignal.timeout(30_000) });
                if (response.ok) await this.themeAssets.put(new Uint8Array(await response.arrayBuffer()));
            } catch { /* the map waits for the next download */ }
        }
        const checked = copies.map(copy => this.themes.readCopy(copy)).filter((copy): copy is MapCopy => !('error' in copy));
        const before = new Map(checked.map(copy => [copy.id, this.themes.published(copy.id)]));
        this.ctx.storage.transactionSync(() => this.themes.downloaded(checked));
        for (const [id, was] of before) if (this.themes.published(id) && this.themes.published(id) !== was) this.mapPublished(id);
    }

    // Online: a request from the teacher's laptop, which proves itself with the lease it got when the teacher signed in
    // there (linkLaptop).
    missionSyncServe(body: Record<string, unknown>): object | { error: string; status: number } {
        const laptop = this.laptop();
        if (!laptop || !secretsMatch(body.lease, laptop.lease)) return { error: 'Sign in again on the laptop.', status: 401 };
        const base = body.base === null || Number.isInteger(body.base) ? body.base as number | null : undefined;
        if (body.op === 'push') {
            const copy = readCopy(body.copy);
            if (!copy || base === undefined) return { error: 'That mission is not valid.', status: 400 };
            return { result: this.ctx.storage.transactionSync(() => this.missions.receive(copy, base)) };
        }
        if (body.op === 'push-quests') {
            const pushes = Array.isArray(body.pushes) && body.pushes.length <= QUEST_PUSH_BATCH ? (body.pushes as { copy?: unknown; base?: unknown }[]).map(push => ({
                copy: readQuestCopy(push?.copy), base: push?.base === null || Number.isInteger(push?.base) ? push.base as number | null : undefined })) : null;
            if (!pushes || pushes.some(push => !push.copy || push.base === undefined)) return { error: 'Those quests are not valid.', status: 400 };
            return { results: this.ctx.storage.transactionSync(() => pushes.map(push => this.sideQuests.receive(push.copy!, push.base!))) };
        }
        if (body.op === 'missing-pictures') {
            const hashes = Array.isArray(body.hashes) && body.hashes.length <= PICTURE_ASK_LIMIT ? body.hashes.filter((hash): hash is string => typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)) : null;
            if (!hashes) return { error: 'That request is not valid.', status: 400 };
            return { missing: hashes.filter(hash => !this.themeAssets.has(hash)) };
        }
        if (body.op === 'push-maps') {
            const pushes = Array.isArray(body.pushes) && body.pushes.length <= MAP_PUSH_BATCH ? (body.pushes as { copy?: unknown; base?: unknown }[]).map(push => ({
                copy: this.themes.readCopy(push?.copy), base: push?.base === null || Number.isInteger(push?.base) ? push.base as number | null : undefined })) : null;
            if (!pushes || pushes.some(push => push.base === undefined)) return { error: 'Those maps are not valid.', status: 400 };
            const before = new Map(pushes.flatMap(({ copy }) => 'error' in copy ? [] : [[copy.id, this.themes.published(copy.id)] as const]));
            const results = this.ctx.storage.transactionSync(() => pushes.map(({ copy, base }): MapPushResult => 'error' in copy ? { outcome: 'refused', error: copy.error } : this.themes.receive(copy, base!)));
            for (const [id, was] of before) if (this.themes.published(id) && this.themes.published(id) !== was) this.mapPublished(id);
            return { results };
        }
        // A laptop from before quests had a record each sends its whole library. It is not taken: the laptop keeps its
        // copy, and sends the quests one by one once it is updated.
        if (body.op === 'push-library') return { version: null };
        if (body.op === 'pull') {
            const versions = (value: unknown) => value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, version]) => Number.isInteger(version))) as Record<string, number> : {};
            const revisions = Array.isArray(body.revisions) ? body.revisions.filter((id): id is string => typeof id === 'string') : [];
            return { missions: this.missions.changes(versions(body.have), revisions), ...(body.quests && typeof body.quests === 'object' ? { quests: this.sideQuests.changes(versions(body.quests)) } : {}),
                ...(body.maps && typeof body.maps === 'object' ? { maps: this.themes.changes(versions(body.maps)) } : {}) };
        }
        return { error: 'That request is not valid.', status: 400 };
    }

    // The side quest library page: the quests with the chapters story quests can belong to, and what the teacher writes,
    // changes, deletes, restores and imports. On the laptop, like Mission Studio, it is brought up to date before it is
    // read, and every change is sent online at once.
    async sideQuestStudio(token: string, op: string, body: unknown): Promise<(SideQuestResult & { chapters?: StoryChapter[]; sync?: MissionSync }) | { error: string; status: number }> {
        if (!this.teacherSignedIn(token)) return { error: 'Please sign in again.', status: 401 };
        if (op === 'list') {
            const sync = await this.syncMissions();
            return { ...this.sideQuests.execute('list', body), chapters: this.storyChapters(), sync };
        }
        const result = this.ctx.storage.transactionSync(() => this.sideQuests.execute(op, body));
        if ('error' in result) return result;
        const sync = await this.syncMissions();
        // The upload may have kept the quest as a copy, when it had changed online too: the page goes on with the
        // teacher's own version.
        const copy = result.quest && sync.questsKeptBoth?.find(item => item.id === result.quest!.id)?.copy;
        const quest = copy ? this.sideQuests.quests().find(item => item.id === copy) : result.quest;
        return { ...this.sideQuests.execute('list', {}), ...(quest ? { quest } : {}), ...(result.imported ? { imported: result.imported } : {}), chapters: this.storyChapters(), sync };
    }

    // Missions and side quests loaded from files (/api/content): the tests, or a new server's first content.
    loadContent(missions: unknown, library: unknown): { missions: string[]; library: boolean } | { error: string; status: number } {
        const checked = library === undefined ? undefined : checkQuestFile(library);
        if (checked && 'error' in checked) return { error: checked.error, status: 400 };
        return this.ctx.storage.transactionSync(() => {
            const loaded = missions === undefined ? { loaded: [] } : this.missions.load(missions);
            if ('error' in loaded) return { error: loaded.error, status: 400 };
            return { missions: loaded.loaded, library: checked ? this.sideQuests.load(checked.quests) > 0 : false };
        });
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
        if (!game || !this.isOpen() || this.soundOff(studentKey)) return null;
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

    // The teacher turned this student's sound off: their device gets no speech until it is turned back on.
    soundOff(studentKey: string): boolean {
        return this.setting('sound_all_off') === '1' || this.sql.exec('SELECT 1 FROM sound_off WHERE student_key = ?', studentKey).toArray().length > 0;
    }

    // A clip this student's device is about to play, so a teacher who hears a phrase in the room can find
    // whose speakers it came from. Chat has its sender; a voice sample or a note to the teacher is the student's own.
    heard(studentKey: string, id: string | null): void {
        const game = this.activeGame();
        if (!game) return;
        const message = id ? this.sql.exec<{ student_key: string; text: string }>('SELECT student_key, text FROM chat WHERE id = ? AND game_id = ?', id, game).toArray()[0]
            ?? this.sql.exec<{ student_key: string; text: string }>('SELECT student_key, TRIM(final_text) AS text FROM assistance_attempts WHERE id = ? AND game_id = ?', id, game).toArray()[0]
            : { student_key: studentKey, text: VOICE_SAMPLE };
        if (!message) return;
        const now = Date.now();
        this.sql.exec('DELETE FROM speech_plays WHERE ts < ?', now - PLAYS_KEEP_MS);
        this.sql.exec('INSERT INTO speech_plays (ts, game_id, student_key, chat_id, sender_key, text) VALUES (?, ?, ?, ?, ?, ?)',
            now, game, studentKey, id, message.student_key, message.text);
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

    private beginAttempt(seat: AnswerSeat, text: string, source: AttemptSource, id?: string, to?: unknown, objective?: string): string {
        const target = to === 'teacher' ? 'Teacher' : to === 'everyone' ? 'Everyone' : this.seats().find(s => s.game === seat.game && s.id === to)?.name;
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
        const themeId = this.game(game)?.themeId ?? this.themes.defaultId();
        const { isBlocked, SPAWN } = this.themes.world(themeId);
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
        const tabStat = this.sql.exec<{ tab_switches: number; last_away: number | null }>(
            'SELECT tab_switches, last_away FROM student_tab_stats WHERE game_id = ? AND student_key = ?',
            game, row.student_key).toArray()[0];
        const seat: Seat = {
            id: crypto.randomUUID().slice(0, 8), game, themeId, studentKey: row.student_key, name: this.rosterNames(game).get(row.student_key) ?? saved.name,
            avatar: (saved.avatar && sanitizeAvatar(JSON.parse(saved.avatar))) || defaultAvatar(),
            style: readStyle(saved.style, levelOf(saved.xp).level),
            x: spot.x, y: spot.y,
            lastChat: 0, movedAt: Date.now(),
            inTab: true, tabSwitches: tabStat?.tab_switches ?? 0, tabAwayAt: null
        };
        // Never chosen a voice: one of their own, not the same default as everyone else.
        if (!isEnglishVoice(seat.avatar.voice)) seat.avatar.voice = voiceFor(row.student_key);
        const others = this.seats();
        this.ctx.acceptWebSocket(server, [seat.studentKey]);
        server.serializeAttachment(seat);
        // Every classmate in this game, here or not, so naming one who is absent is still English.
        // The map itself comes with the welcome: the page has none of its own.
        server.send(JSON.stringify({ t: 'welcome', id: seat.id, gameId: seat.game, themeId, theme: this.themes.theme(themeId), players: [...others, seat].map(publicSeat),
            names: [...this.rosterNames(seat.game).values()], tabSwitches: seat.tabSwitches ?? 0 }));
        this.broadcast({ t: 'join', player: publicSeat(seat) }, server);
        if (replaced.length === 0) this.systemChat(`${seat.name} has joined the Plaza.`, server);
        this.sendQuest(server, seat.game, seat.studentKey, true);
        try { server.send(JSON.stringify({ t: 'xp', xp: saved.xp })); } catch { /* closing */ }
        this.sendAlias(server, seat.game, seat.studentKey);
        this.sendVision(server, seat.game);
        this.sendSound(server, seat.studentKey);
        // A late arrival's part changes everyone's team total, so all get the warm-up again.
        if (this.lateWarmupPart(seat.game, seat.studentKey)) this.sendWarmupToAll(seat.game);
        else this.sendWarmup(server, seat.game, seat.studentKey);
        this.sendSupport(seat.game, seat.studentKey, true);
        this.sendChatHistory(server, seat);
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
                if (data.status === 'language-blocked') {
                    // Stopped by the word check, so no other check saw it: anything harmful in it goes to the teacher as an
                    // incident, not as a language problem to help with.
                    const harm = await this.harmOf(attempt.text);
                    if (harm) this.flagHarm(seat, harm, attempt.text, id);
                    else if (!isGlitch(attempt.text)) this.assistance.signal(seat.game, seat.studentKey, seat.name, `Word check: ${reason}`, attempt.text); // glitch text is spam, not a language problem
                }
            }
            ws.send(JSON.stringify({ t: 'attempt-recorded', id: data.id, kind: 'attempt-outcome' }));
        } else if (data?.t === 'tab-focus') {
            if (typeof data.inTab !== 'boolean' || !Number.isSafeInteger(data.count) || data.count < 0 || data.count > 9999) return;
            const inTab = data.inTab;
            const count = data.count;
            seat.inTab = inTab;
            if (count > (seat.tabSwitches ?? 0)) seat.tabSwitches = count;
            seat.tabAwayAt = inTab ? null : (seat.tabAwayAt ?? Date.now());
            ws.serializeAttachment(seat);
            if ((seat.tabSwitches ?? 0) > 0 || !inTab) {
                this.sql.exec(
                    `INSERT INTO student_tab_stats (game_id, student_key, tab_switches, last_away)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT (game_id, student_key) DO UPDATE SET tab_switches = MAX(student_tab_stats.tab_switches, excluded.tab_switches), last_away = COALESCE(excluded.last_away, student_tab_stats.last_away)`,
                    seat.game, seat.studentKey, seat.tabSwitches ?? 0, seat.tabAwayAt
                );
            }
        } else if (data?.t === 'help-request') {
            await this.requestHelp(seat, data);
        } else if (data?.t === 'move') {
            const position = clampPosition(data.x, data.y, this.themes.theme(seat.themeId).world);
            if (!position) return;
            // A move through a wall, or further than anyone can walk, puts the student back where they were.
            const now = Date.now();
            if (Math.max(seat.frozenUntil ?? 0, seat.downUntil ?? 0) > now || this.env.MOVEMENT_CHECK !== '0' && !this.themes.world(seat.themeId).legalMove(seat.x, seat.y, position.x, position.y, now - (seat.movedAt ?? now))) {
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
            await this.answer(ws, seat, data.objective, data.text, typeof data.attemptId === 'string' ? data.attemptId : undefined);
        } else if (data?.t === 'quest-accept' && typeof data.objective === 'string') {
            this.claimQuest(ws, seat, data.objective, data.changePartner === true);
        } else if (data?.t === 'quest-leave' && typeof data.objective === 'string') {
            this.leaveQuest(ws, seat, data.objective);
        } else if (data?.t === 'report-undo' && typeof data.objective === 'string' && typeof data.gameId === 'string' && Number.isSafeInteger(data.version)) {
            this.undoReport(ws, seat, data.objective, data.version, data.gameId);
        } else if ((data?.t === 'quest-start' && typeof data.objective === 'string') || data?.t === 'quest-auto') {
            this.groupOrPick(ws, seat, data);
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
        } else if (data?.t === 'typing') {
            this.typing(ws, seat, data.to);
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
            runId: `${game}:${row.live_epoch ?? row.revision_id ?? campaign.id}`,
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
                        ? ` ${role.id === objective.answerRole ? 'You have this role, and no other student with it is online.' : 'No classmate with this role is available.'} Type the role name (${fallback}) to continue with the town notice.`
                        : objective.answerRole && role.id === objective.answerRole ? ' You have this role. Find another student with the same role and enter their displayed name.' : ''), done: player.done.includes(objective.id), optional: !!objective.optional,
                        kind: objective.kind === 'report' ? 'report' as const : objective.answerRole ? 'name' as const : 'text' as const,
                        ...(objective.kind === 'report' ? { report: this.reportView(game, objective, studentKey) } : {}),
                        ...(objective.conversation ? { conversation: this.conversation(game, studentKey, objective) } : {}) };
                }),
            interviews: this.interviews.view(game, row.chapter, studentKey, names, new Map(chapter.objectives.map(o => [o.id, o.text]))),
            team: teamProgress(chapter, this.campaignPlayers(game).map(item => ({ done: item.done, thief: thieves.includes(item.student_key) }))),
            // "Previously", for a student coming back to a story that is already under way
            recap: !withRecap || row.status !== 'active' ? null
                : row.chapter > 0 ? campaign.chapters[row.chapter - 1].ending
                : player.clues.length || player.done.length ? chapter.recap : null,
            finale: row.status === 'campaign_complete' ? campaign.finale : null
        };
    }

    // The student's mission view, when a mission is running, and their quest board, with or without one.
    private sendQuest(target: WebSocket, game: string, studentKey: string, withRecap = false): void {
        if (withRecap) this.resumePassedReports(target, game, studentKey);
        const quest = this.questView(game, studentKey, withRecap);
        const board = this.boardView(game, studentKey);
        try {
            if (quest) target.send(JSON.stringify({ t: 'quest', quest }));
            if (board) target.send(JSON.stringify({ t: 'board', ...board }));
        } catch { /* closing */ }
    }

    // A student's quest board in this game: its side quests, with or without a mission, and the mission chapter's own
    // board quests. Done is the mission's progress and the game's side quests together.
    private boardContext(game: string, studentKey: string): BoardContext | null {
        if (!this.game(game)) return null;
        const row = this.campaignRow(game); const campaign = row ? this.gameCampaign(game) : undefined;
        const chapter = row && campaign ? campaign.chapters[Math.min(row.chapter, campaign.chapters.length - 1)] ?? null : null;
        const mission = this.campaignPlayers(game); const names = this.rosterNames(game);
        const player = (key: string) => {
            const own = mission.find(p => p.student_key === key);
            return { student_key: key, role_id: own?.role_id ?? '', done: [...(own?.done ?? []), ...this.gameSideQuests.done(game, key)] };
        };
        const players = [...new Set([...names.keys(), ...mission.map(p => p.student_key)])].map(player);
        const own = chapter?.objectives.filter(o => o.board) ?? [];
        const given = this.gameSideQuests.objectives(game, chapter?.id ?? null).filter(o => !own.some(item => item.id === o.id));
        const me = players.find(p => p.student_key === studentKey) ?? player(studentKey);
        const kept = this.isRandom(game) ? new Set(this.sql.exec<{ student_key: string }>('SELECT student_key FROM aliases WHERE game_id = ? AND kept = 1', game).toArray().map(r => r.student_key)) : null;
        return { game, chapterIndex: row && chapter ? row.chapter : GAME_CHAPTER, chapter, status: row && chapter ? row.status : null, quests: [...own, ...given], player: me, players,
            online: new Set(this.seats().filter(s => s.game === game && (!kept || kept.has(s.studentKey))).map(s => s.studentKey)), names,
            // Every quest on the board follows the side quest rules: the game's and the mission's own.
            sideQuests: new Set([...own, ...given].map(o => o.id)), gameQuests: new Set(given.map(o => o.id)),
            closed: new Set([...this.liveMissions.closedIds(game), ...this.gameSideQuests.closedIds(game)]),
            idle: nothingElseToDo(row?.status === 'campaign_complete' ? null : chapter, me.done, this.warmupLeft(game, studentKey)) };
    }
    // What the student's quest board shows, with or without a mission.
    private boardView(game: string, studentKey: string): BoardView | null {
        const ctx = this.boardContext(game, studentKey);
        if (!ctx) return null;
        return { board: this.questBoard.view(ctx).map(item => {
            const objective = ctx.quests.find(o => o.id === item.id)!;
            return { ...item, ...(objective.kind === 'report' && (item.state === 'active' || item.state === 'done') ? { report: this.reportView(game, objective, studentKey) } : {}),
                ...(objective.activity || objective.conversation ? { conversation: this.conversation(game, studentKey, objective) } : {}) };
        }), sideQuests: this.questBoard.sideQuestsView(ctx) };
    }
    // True while the student still has a warm-up task: side quests wait until it is done.
    private warmupLeft(game: string, studentKey: string): boolean {
        if (!this.warmupActive(game)) return false;
        const me = this.sql.exec<{ step: number; targets: string }>('SELECT step, targets FROM warmup_players WHERE game_id = ? AND student_key = ?', game, studentKey).toArray()[0];
        return !!me && me.step < (JSON.parse(me.targets) as string[]).length;
    }
    private leaveQuest(ws: WebSocket, seat: Seat, objective: string): void {
        if (!this.isOpen()) return;
        const ctx = this.boardContext(seat.game, seat.studentKey); const quest = ctx?.quests.find(o => o.id === objective);
        if (!ctx || !quest || (!ctx.gameQuests.has(quest.id) && ctx.status === 'campaign_complete')) return;
        const group = quest.kind === 'report' ? this.questBoard.groupOf(seat.game, objective, seat.studentKey) : undefined;
        const report = group ? this.savedReport(seat.game, quest, seat.studentKey) : undefined;
        const error = this.ctx.storage.transactionSync(() => {
            const problem = this.questBoard.leave(ctx, quest);
            // A shared draft belongs to the remaining group even if its original writer gives up the quest.
            const keeper = !problem && group && report?.student_key === seat.studentKey ? this.groups.members(group.group_id)[0] : undefined;
            if (keeper && report && group) {
                this.sql.exec(`INSERT INTO campaign_reports (game_id, student_key, objective, text, ts, submitted, group_id, check_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (game_id, student_key, objective) DO UPDATE SET text = excluded.text, ts = excluded.ts, submitted = excluded.submitted, group_id = excluded.group_id, check_id = excluded.check_id`, seat.game, keeper, objective, report.text, report.ts, report.submitted, group.group_id, report.check_id);
                this.sql.exec('DELETE FROM campaign_reports WHERE game_id = ? AND objective = ? AND student_key = ?', seat.game, objective, seat.studentKey);
            }
            return problem;
        });
        if (error) ws.send(JSON.stringify({ t: 'notice', level: 'warning', text: error }));
        this.sendBoardChange(seat.game, seat.studentKey, quest);
    }
    private claimQuest(ws: WebSocket, seat: Seat, objective: string, changePartner: boolean): void {
        if (!this.isOpen()) return;
        const ctx = this.boardContext(seat.game, seat.studentKey); const quest = ctx?.quests.find(o => o.id === objective);
        if (!ctx || !quest?.board) return;
        if (!ctx.online.has(seat.studentKey)) return;
        const error = this.questBoard.claim(ctx, quest, changePartner);
        if (error) ws.send(JSON.stringify({ t: 'notice', level: 'warning', text: error }));
        this.sendBoardChange(seat.game, seat.studentKey, quest);
    }
    // After a student joins or leaves a side quest: everyone, when a pair or group changed; otherwise only them.
    private sendBoardChange(game: string, studentKey: string, quest: Objective): void {
        if (quest.board && (groupSize(quest) > 1 || quest.activity)) this.sendQuestToAll(game);
        else for (const socket of this.ctx.getWebSockets(studentKey)) this.sendQuest(socket, game, studentKey);
    }
    // A group's member starts it with who is there, or a free student who has not chosen asks to be placed.
    private groupOrPick(ws: WebSocket, seat: Seat, data: Record<string, unknown>): void {
        if (!this.isOpen()) return;
        const ctx = this.boardContext(seat.game, seat.studentKey);
        if (!ctx || !ctx.online.has(seat.studentKey)) return;
        const warn = (text: string) => ws.send(JSON.stringify({ t: 'notice', level: 'warning', text }));
        if (data.t === 'quest-start') {
            const quest = ctx.quests.find(o => o.id === data.objective);
            const error = quest ? this.questBoard.start(ctx, quest) : 'That quest was not found.';
            if (error) return warn(error);
            return this.sendQuestToAll(seat.game);
        }
        if (this.questBoard.sideQuestsView(ctx).state !== 'choose') return;
        const picked = this.questBoard.autoPick(ctx);
        if (typeof picked === 'string') return warn(picked);
        ws.send(JSON.stringify({ t: 'notice', level: 'info', text: 'The game chose a side quest for you. You can leave it in the Journal and choose another.' }));
        this.sendBoardChange(seat.game, seat.studentKey, picked);
    }
    private refreshBoard(game: string): void {
        // Presence changes partner eligibility, group places and absent-role clue notices, with or without a mission.
        this.sendQuestToAll(game);
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
        if (!this.isOpen() || !row || !ctx?.chapter || ctx.status === 'campaign_complete') return warn('That investigation is not available right now.');
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
        const board = objective.board && this.boardContext(seat.game, seat.studentKey);
        if (board) this.questBoard.markPlayed(board, objective);
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
            const quest = this.questView(game, seat.studentKey); const board = this.boardView(game, seat.studentKey);
            for (const ws of this.ctx.getWebSockets(seat.studentKey)) {
                try {
                    ws.send(JSON.stringify({ t: 'quest', quest }));
                    if (board) ws.send(JSON.stringify({ t: 'board', ...board }));
                } catch { /* closing */ }
            }
        }
    }

    // Stepping into a named place can reveal a clue, once.
    private discover(seat: Seat): void {
        const zone = this.themes.world(seat.themeId).zoneAt(seat.x, seat.y);
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

    private savedReport(game: string, objective: Objective, student: string) {
        const shared = !!objective.board && groupSize(objective) > 1;
        const group = shared ? this.questBoard.groupOf(game, objective.id, student) : undefined;
        if (shared && !group) return undefined;
        return this.sql.exec<{ student_key: string; text: string; ts: number; submitted: number; check_id: string | null }>(
            `SELECT student_key, text, ts, submitted, check_id FROM campaign_reports WHERE game_id = ? AND objective = ?
             AND ${group ? 'group_id = ?' : 'group_id IS NULL AND student_key = ?'} ORDER BY ts DESC LIMIT 1`, game, objective.id, group?.group_id ?? student).toArray()[0];
    }

    private reportView(game: string, objective: Objective, student: string) {
        const report = this.savedReport(game, objective, student);
        const check = report?.check_id ? this.reportChecks.get(report.check_id) : undefined;
        return report ? { text: report.text, version: report.ts, submitted: report.submitted === 1,
            ...(check ? { check: { status: check.status, feedback: check.feedback } } : {}) } : undefined;
    }

    private saveReport(game: string, objective: Objective, student: string, text: string, checkId: string | null = null): number {
        const previous = this.savedReport(game, objective, student);
        const version = Math.max(Date.now(), (previous?.ts ?? 0) + 1);
        const group = objective.board && groupSize(objective) > 1 ? this.questBoard.groupOf(game, objective.id, student) : undefined;
        // A teammate may resubmit the reopened report: replace the previous author's copy for this group only.
        this.ctx.storage.transactionSync(() => {
            if (previous && previous.student_key !== student) this.sql.exec('DELETE FROM campaign_reports WHERE game_id = ? AND objective = ? AND student_key = ?', game, objective.id, previous.student_key);
            this.sql.exec(`INSERT INTO campaign_reports (game_id, student_key, objective, text, ts, submitted, group_id, check_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT (game_id, student_key, objective) DO UPDATE SET text = excluded.text, ts = excluded.ts, submitted = 1, group_id = excluded.group_id, check_id = excluded.check_id`, game, student, objective.id, text.trim(), version, group?.group_id ?? null, checkId);
        });
        return version;
    }

    private reportEpoch(game: string, objective: string): string {
        if (this.sql.exec('SELECT 1 FROM game_side_quests WHERE game_id = ? AND quest_id = ?', game, objective).toArray().length) return 'library';
        const row = this.campaignRow(game);
        return JSON.stringify([row?.live_epoch, row?.chapter]);
    }
    private reportObjective(game: string, student: string, id: string): Objective | undefined {
        const ctx = this.boardContext(game, student), row = this.campaignRow(game);
        return ctx?.quests.find(o => o.id === id) ?? (row && this.gameCampaign(game)?.chapters[row.chapter]?.objectives.find(o => o.id === id)) ?? undefined;
    }
    private reportApproved(game: string, objective: Objective, student: string, version: number): boolean {
        const report = this.savedReport(game, objective, student);
        return !!report && report.ts === version && report.submitted === 1 && !!report.check_id && this.reportChecks.get(report.check_id)?.status === 'pass';
    }
    // A check may finish while its game is closed. Apply its saved pass when a member returns, without another call.
    private resumePassedReports(ws: WebSocket, game: string, student: string): void {
        if (!this.isOpen() || this.activeGame() !== game) return;
        const done = this.boardContext(game, student)?.player.done ?? [];
        const reports = this.sql.exec<{ student_key: string; objective: string; text: string; ts: number }>(
            `SELECT DISTINCT r.student_key, r.objective, r.text, r.ts FROM campaign_reports r JOIN report_checks c ON c.id = r.check_id
             LEFT JOIN side_quest_members m ON m.group_id = r.group_id AND m.student_key = ?
             WHERE r.game_id = ? AND r.submitted = 1 AND c.status = 'pass'
             AND ((r.group_id IS NULL AND r.student_key = ?) OR m.student_key IS NOT NULL)`, student, game, student).toArray();
        for (const report of reports) {
            if (done.includes(report.objective) || !this.reportObjective(game, report.student_key, report.objective)) continue;
            const seat: AnswerSeat = { game, studentKey: report.student_key, name: this.rosterNames(game).get(report.student_key) ?? 'Student' };
            this.ctx.waitUntil(this.answer(ws, seat, report.objective, report.text, undefined,
                { version: report.ts, audit: this.beginAttempt(seat, report.text, 'answer', undefined, undefined, report.objective) }));
        }
    }
    private async submitReport(ws: WebSocket | undefined, seat: AnswerSeat, objective: Objective, text: string, audit: string): Promise<void> {
        const pending = this.savedReport(seat.game, objective, seat.studentKey);
        if (pending?.submitted === 1 && pending.check_id && this.reportChecks.get(pending.check_id)?.status === 'checking') {
            this.attemptStatus(audit, 'waiting', 'This report is already being checked.');
            this.sendBoardChange(seat.game, seat.studentKey, objective);
            return;
        }
        const input: ReportInput = { task: objective.text, criteria: objective.successCriteria, level: objective.level, answer: text };
        const epoch = this.reportEpoch(seat.game, objective.id);
        const group = objective.board && groupSize(objective) > 1 ? this.questBoard.groupOf(seat.game, objective.id, seat.studentKey) : undefined;
        const owner = group ? `group:${group.group_id}` : `student:${seat.studentKey}`;
        const { check, fresh } = this.reportChecks.reserve(seat.game, objective.id, owner, JSON.stringify([epoch, reportCacheKey(input, this.env)]));
        const previous = this.savedReport(seat.game, objective, seat.studentKey);
        // A second click/teammate/reconnect attaches to the same saved check, without replacing its author or version.
        if (!(previous?.submitted === 1 && previous.check_id === check.id)) this.saveReport(seat.game, objective, seat.studentKey, text, check.id);
        this.attemptStatus(audit, 'waiting', check.feedback);
        this.sendBoardChange(seat.game, seat.studentKey, objective);
        if (fresh) this.reportChecks.finish(check.id, await checkReport(input, this.env));
        const result = this.reportChecks.get(check.id);
        if (!result || result.status === 'checking') return;
        // Never apply an answer after undo, a new report, a changed quest, campaign reset, or game switch.
        const current = this.sql.exec<{ student_key: string; text: string; ts: number }>('SELECT student_key, text, ts FROM campaign_reports WHERE game_id = ? AND objective = ? AND check_id = ? AND submitted = 1', seat.game, objective.id, check.id).toArray()[0];
        if (!current || this.reportEpoch(seat.game, objective.id) !== epoch) return;
        const latest = this.reportObjective(seat.game, current.student_key, objective.id);
        if (!latest || JSON.stringify(latest) !== JSON.stringify(objective)) return;
        const author = { ...seat, studentKey: current.student_key, name: this.rosterNames(seat.game).get(current.student_key) ?? seat.name };
        const socket = this.ctx.getWebSockets(current.student_key).find(socket => (socket.deserializeAttachment() as Seat | null)?.game === seat.game) ?? ws;
        const active = this.isOpen() && this.activeGame() === seat.game;
        if (result.status === 'pass') {
            if (active) await this.answer(socket, author, objective.id, current.text, undefined, { version: current.ts, audit });
        }
        else {
            const revise = result.status === 'revise';
            if (revise) this.sql.exec('UPDATE campaign_reports SET submitted = 0 WHERE game_id = ? AND objective = ? AND check_id = ?', seat.game, objective.id, check.id);
            this.attemptStatus(audit, revise ? 'incorrect' : 'waiting', result.feedback);
            if (revise) this.assistance.signal(seat.game, current.student_key, author.name, `Revise report: ${objective.text}`, current.text, 'instructions');
        }
        if (active) this.sendBoardChange(seat.game, current.student_key, objective);
    }

    // Exception path only: uncertainty/outages need a human decision, never an automatic incorrect grade.
    private async acceptReport(action: Extract<TeacherAction, { kind: 'reportAccept' }>): Promise<string | null> {
        if (!this.isOpen() || action.gameId !== this.activeGame()) return 'The selected game changed.';
        const objective = this.reportObjective(action.gameId, action.studentKey, action.objective);
        const report = objective && this.savedReport(action.gameId, objective, action.studentKey);
        const check = report?.check_id && this.reportChecks.get(report.check_id);
        if (!objective || !report || report.ts !== action.version || report.submitted !== 1 || !check || !['uncertain', 'unavailable'].includes(check.status)) return 'This report changed or is not waiting for review.';
        const socket = this.ctx.getWebSockets(action.studentKey).find(socket => (socket.deserializeAttachment() as Seat | null)?.game === action.gameId);
        // Offline students still receive the result on reconnect. Only game/student/name are used when finishing answers.
        const seat = socket?.deserializeAttachment() as Seat | undefined;
        const fallback: AnswerSeat = { game: action.gameId, studentKey: action.studentKey, name: this.rosterNames(action.gameId).get(action.studentKey) ?? 'Student' };
        this.reportChecks.approve(check.id);
        await this.answer(socket, seat ?? fallback, objective.id, report.text, undefined, { version: report.ts, audit: this.beginAttempt(seat ?? fallback, report.text, 'answer', undefined, undefined, objective.id) });
        return null;
    }

    // Undo reopens a shared report for its original group, or an individual report for its author. Writing and XP
    // awards stay saved; resubmission replaces the report and cannot earn the same completion reward twice.
    private undoReport(ws: WebSocket, seat: Seat, objectiveId: string, version: number, gameId: string): void {
        if (!this.isOpen() || gameId !== seat.game || seat.game !== this.activeGame()) return;
        const warn = (text: string) => ws.send(JSON.stringify({ t: 'notice', level: 'warning', text }));
        const ctx = this.boardContext(seat.game, seat.studentKey);
        const row = this.campaignRow(seat.game), campaign = row && this.gameCampaign(seat.game);
        const chapter = row && campaign ? campaign.chapters[row.chapter] : undefined;
        const objective = ctx?.quests.find(o => o.id === objectiveId) ?? chapter?.objectives.find(o => o.id === objectiveId);
        if (!ctx || objective?.kind !== 'report') return warn('That report cannot be reopened.');
        if (!ctx.gameQuests.has(objective.id) && row?.status === 'campaign_complete') return warn('Your teacher ended this campaign.');
        const finished = ctx.player.done.includes(objective.id);
        if (objective.board && !this.questBoard.assignment(seat.game, objective.id, seat.studentKey)) return warn('That report is not yours to reopen.');
        const group = objective.board && groupSize(objective) > 1 ? this.questBoard.groupOf(seat.game, objective.id, seat.studentKey) : undefined;
        if (objective.board && groupSize(objective) > 1 && group?.state !== (finished ? 'done' : 'playing')) return warn('That group report cannot be reopened.');
        const report = this.savedReport(seat.game, objective, seat.studentKey);
        if (!report || report.submitted !== 1 || report.ts !== version) {
            this.sendQuest(ws, seat.game, seat.studentKey);
            return warn('This report has changed. Check the latest submission before undoing it.');
        }
        const members = group?.members ?? [seat.studentKey];
        const dependsOnReport = (candidate: Objective, seen = new Set<string>()): boolean => {
            if (seen.has(candidate.id)) return false;
            seen.add(candidate.id);
            return prerequisiteIds(candidate).some(id => id === objective.id || !!chapter?.objectives.some(o => o.id === id && dependsOnReport(o, seen)));
        };
        for (const member of members) {
            const player = ctx.players.find(p => p.student_key === member);
            if (!player) return warn('A group member is no longer in this game.');
            const active = this.questBoard.activeSideQuest({ ...ctx, player });
            if (objective.board && active && active.id !== objective.id) return warn(member === seat.studentKey
                ? 'Leave your current side quest before reopening this report.'
                : `${ctx.names.get(member) ?? 'A group member'} has started another side quest. They need to leave it before this report can reopen.`);
            if (chapter?.objectives.some(o => dependsOnReport(o) && (player.done.includes(o.id) || !!this.questBoard.assignment(seat.game, o.id, member)))) {
                return warn('A later task already uses this report. It cannot be reopened.');
            }
        }
        this.ctx.storage.transactionSync(() => {
            this.sql.exec('UPDATE campaign_reports SET submitted = 0 WHERE game_id = ? AND objective = ? AND student_key = ?', seat.game, objective.id, report.student_key);
            for (const member of members) {
                if (ctx.gameQuests.has(objective.id)) this.sql.exec('DELETE FROM side_quest_done WHERE game_id = ? AND student_key = ? AND quest_id = ?', seat.game, member, objective.id);
                else {
                    const player = this.campaignPlayers(seat.game).find(p => p.student_key === member);
                    if (player) this.sql.exec('UPDATE campaign_players SET done = ? WHERE game_id = ? AND student_key = ?', JSON.stringify(player.done.filter(id => id !== objective.id)), seat.game, member);
                }
            }
            if (group) this.groups.setState(group.group_id, 'playing');
            if (!ctx.gameQuests.has(objective.id) && row?.status === 'chapter_complete' && chapter && !chapterDone(chapter, this.campaignPlayers(seat.game))) {
                this.sql.exec("UPDATE campaigns SET status = 'active' WHERE game_id = ?", seat.game);
            }
        });
        this.sendQuestToAll(seat.game);
        for (const member of members) this.notify(member, 'info', group
            ? `${seat.name} undid the group report submission. Your writing is back in the Journal.`
            : 'Submission undone. Your writing is back in the Journal.');
    }

    // A student's typed answer to a chapter question. A wrong one can be tried again after a short wait.
    private async answer(ws: WebSocket | undefined, seat: AnswerSeat, objectiveId: string, typed: string, attemptId?: string, checked?: { version: number; audit: string }): Promise<void> {
        const audit = checked?.audit ?? this.beginAttempt(seat, typed, 'answer', attemptId, undefined, objectiveId);
        const unavailable = (reason: string) => { this.attemptStatus(audit, 'invalid', reason); };
        if (typed.length > REPORT_MAX_LENGTH) return unavailable('The answer exceeds the maximum length.');
        // One of the game's side quests: answered with or without a mission.
        const board = this.boardContext(seat.game, seat.studentKey);
        const given = board?.gameQuests.has(objectiveId) ? board.quests.find(o => o.id === objectiveId) : undefined;
        if (board && given) return this.answerSideQuest(ws, seat, board, given, typed, audit, checked);
        const row = this.campaignRow(seat.game);
        const campaign = row && this.gameCampaign(seat.game);
        const objective = campaign?.chapters[row?.chapter ?? 0]?.objectives.find(item => item.id === objectiveId);
        // Students can keep working after the class threshold, until the teacher moves on.
        if (!row || !campaign || !objective || row.status === 'campaign_complete') return unavailable('That question is not available right now.');
        const player = this.player(seat.game, seat.studentKey, row.campaign_id);
        if (!player || player.done.includes(objective.id) || !isUnlocked(objective, player.done)) return unavailable('That question is finished or not unlocked yet.');
        // Board answers require a persisted assignment; clients cannot skip role or release gates.
        if (objective.board && !this.questBoard.assignment(seat.game, objective.id, seat.studentKey)) return unavailable('Accept this quest before answering.');
        const group = objective.board && groupSize(objective) > 1 ? this.questBoard.groupOf(seat.game, objective.id, seat.studentKey) : undefined;
        if (objective.board && groupSize(objective) > 1 && group?.state !== 'playing') return unavailable('Wait until your group is complete.');
        if (board && objective.board && !checked) this.questBoard.markPlayed(board, objective);
        const reply = (correct: boolean, wait = false, message?: string) => {
            this.attemptStatus(audit, correct ? 'correct' : wait ? 'waiting' : 'incorrect', correct ? undefined : message ?? 'The answer was not accepted.');
            if (!correct && !wait) this.assistance.signal(seat.game, seat.studentKey, seat.name, `Answer not accepted: ${objective.text}`, typed, 'instructions');
            try { ws?.send(JSON.stringify({ t: 'answered', objective: objective.id, correct, wait, ...(!correct && message ? { message } : {}) })); } catch { /* saved result reaches reconnects */ }
        };
        if (objective.activity || objective.conversation) {
            const conversation = this.conversation(seat.game, seat.studentKey, objective);
            if (conversation.completed < conversation.required) {
                const message = `Exchange evidence with ${conversation.required} witness${conversation.required === 1 ? '' : 'es'} before submitting this conclusion.`;
                try { ws?.send(JSON.stringify({ t: 'notice', level: 'warning', text: message })); } catch { /* disconnected */ }
                return reply(false, true, message);
            }
        }
        const now = Date.now();
        if (!checked && now - player.last_wrong < WRONG_ANSWER_WAIT_MS) return reply(false, true, 'Please wait a few seconds before trying again.');
        if (objective.kind !== 'report' && typed.length > 80) return unavailable('Use up to 80 characters for a short answer.');
        let right: boolean;
        let rejection = 'That answer was not accepted. Check the question and try again.';
        if (objective.kind === 'report') {
            right = typed.trim().split(/\s+/).length >= 5;
            rejection = 'Write at least 5 words, then send your report again.';
            if (right && this.env.REPORT_CHECKS !== '0') {
                if (!checked) return this.submitReport(ws, seat, objective, typed, audit);
                if (!this.reportApproved(seat.game, objective, seat.studentKey, checked.version)) return;
            } else if (right) this.saveReport(seat.game, objective, seat.studentKey, typed);
        } else if (objective.answerThief) {
            // The thief's made-up name, as the plaza shows it. The thief never gets this question.
            const names = this.rosterNames(seat.game);
            const culprits = this.chapterThieves(seat.game, campaign, row.chapter).filter(key => key !== seat.studentKey).map(key => names.get(key) ?? '');
            right = this.chapterThieves(seat.game, campaign, row.chapter).includes(seat.studentKey) ? false : answerMatches({ ...objective, accept: acceptedNames(culprits.filter(Boolean), [...names.values()]) }, typed);
            rejection = 'That name was not accepted. Check your clues and enter the name shown above the student\'s avatar.';
        } else if (objective.answerRole) {
            // The name of a classmate who has that role, as the plaza shows it; never one's own.
            const names = this.rosterNames(seat.game);
            const holders = this.campaignPlayers(seat.game).filter(other => other.role_id === objective.answerRole && other.student_key !== seat.studentKey)
                .map(other => names.get(other.student_key) ?? '');
            const fallback = this.meetingFallback(seat.game, seat.studentKey, objective.answerRole, campaign);
            right = answerMatches({ ...objective, accept: [...acceptedNames(holders.filter(Boolean), [...names.values()]), ...(fallback ? [fallback] : [])] }, typed);
            const roleName = campaign.roles.find(role => role.id === objective.answerRole)?.name ?? 'this role';
            const ownRole = player.role_id === objective.answerRole;
            rejection = fallback
                ? `${ownRole ? 'You have this role, and no other student with it is online.' : 'No classmate with this role is available.'} Type the role name (${fallback}) to continue.`
                : `${ownRole ? `You have the role “${roleName}”. This task asks for another student with that role.` : `Find a student with the role “${roleName}”.`} Enter their displayed name.`;
        } else right = answerMatches(objective, typed);
        if (!right) {
            this.sql.exec('UPDATE campaign_players SET last_wrong = ? WHERE game_id = ? AND student_key = ?', now, seat.game, seat.studentKey);
            return reply(false, false, rejection);
        }
        this.sql.exec('UPDATE campaign_players SET done = ? WHERE game_id = ? AND student_key = ?',
            JSON.stringify([...player.done, objective.id]), seat.game, seat.studentKey);
        reply(true);
        this.award(seat.studentKey, `answer:${seat.game}:${objective.id}`, objective.board ? XP.quest : XP.answer,
            !objective.board ? 'Right answer in your journal' : objective.activity ? 'Partner quest completed' : 'Side quest completed', seat.game);
        // One answer finishes a group's quest for every member, with XP for each.
        if (group) {
            for (const member of group.members.filter(key => key !== seat.studentKey)) {
                const other = this.player(seat.game, member, row.campaign_id);
                if (!other || other.done.includes(objective.id)) continue;
                this.sql.exec('UPDATE campaign_players SET done = ? WHERE game_id = ? AND student_key = ?', JSON.stringify([...other.done, objective.id]), seat.game, member);
                this.award(member, `answer:${seat.game}:${objective.id}`, XP.quest, 'Group side quest completed', seat.game);
            }
            this.questBoard.finishGroup(group.group_id);
        }
        const chapter = campaign.chapters[row.chapter];
        if (row.status === 'active' && chapterDone(chapter, this.campaignPlayers(seat.game))) {
            this.sql.exec("UPDATE campaigns SET status = 'chapter_complete' WHERE game_id = ?", seat.game);
            this.sendQuestToAll(seat.game);
        } else if (chapter.objectives.some(o => o.board)) this.sendQuestToAll(seat.game);
        else for (const socket of this.ctx.getWebSockets(seat.studentKey)) this.sendQuest(socket, seat.game, seat.studentKey);
    }

    // A student's answer to one of the game's side quests: checked as a mission's would be, and kept with the game. One
    // answer finishes a group's quest for every member, with XP for each.
    private async answerSideQuest(ws: WebSocket | undefined, seat: AnswerSeat, ctx: BoardContext, objective: Objective, typed: string, audit: string, checked?: { version: number; audit: string }): Promise<void> {
        const unavailable = (reason: string) => { this.attemptStatus(audit, 'invalid', reason); };
        if (ctx.player.done.includes(objective.id)) return unavailable('That side quest is finished.');
        if (!this.questBoard.assignment(seat.game, objective.id, seat.studentKey)) return unavailable('Accept this quest before answering.');
        const group = groupSize(objective) > 1 ? this.questBoard.groupOf(seat.game, objective.id, seat.studentKey) : undefined;
        if (groupSize(objective) > 1 && group?.state !== 'playing') return unavailable('Wait until your group is complete.');
        if (!checked) this.questBoard.markPlayed(ctx, objective);
        const reply = (correct: boolean, wait = false, message?: string) => {
            this.attemptStatus(audit, correct ? 'correct' : wait ? 'waiting' : 'incorrect', correct ? undefined : message ?? 'The answer was not accepted.');
            if (!correct && !wait) this.assistance.signal(seat.game, seat.studentKey, seat.name, `Answer not accepted: ${objective.text}`, typed, 'instructions');
            try { ws?.send(JSON.stringify({ t: 'answered', objective: objective.id, correct, wait, ...(!correct && message ? { message } : {}) })); } catch { /* saved result reaches reconnects */ }
        };
        const now = Date.now(); const key = `${seat.game}:${seat.studentKey}`;
        if (!checked && now - (this.sideQuestWrong.get(key) ?? 0) < WRONG_ANSWER_WAIT_MS) return reply(false, true, 'Please wait a few seconds before trying again.');
        const report = objective.kind === 'report';
        if (!report && typed.length > 80) return unavailable('Use up to 80 characters for a short answer.');
        if (!(report ? typed.trim().split(/\s+/).length >= 5 : answerMatches(objective, typed))) {
            this.sideQuestWrong.set(key, now);
            return reply(false, false, report ? 'Write at least 5 words, then send your report again.' : 'That answer was not accepted. Check the question and try again.');
        }
        if (report && this.env.REPORT_CHECKS !== '0') {
            if (!checked) return this.submitReport(ws, seat, objective, typed, audit);
            if (!this.reportApproved(seat.game, objective, seat.studentKey, checked.version)) return;
        } else if (report) this.saveReport(seat.game, objective, seat.studentKey, typed);
        this.gameSideQuests.finish(seat.game, seat.studentKey, objective.id);
        reply(true);
        this.award(seat.studentKey, `answer:${seat.game}:${objective.id}`, XP.quest, 'Side quest completed', seat.game);
        if (group) {
            for (const member of group.members.filter(member => member !== seat.studentKey && !ctx.players.find(p => p.student_key === member)?.done.includes(objective.id))) {
                this.gameSideQuests.finish(seat.game, member, objective.id);
                this.award(member, `answer:${seat.game}:${objective.id}`, XP.quest, 'Group side quest completed', seat.game);
            }
            this.questBoard.finishGroup(group.group_id);
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
            // The game's side quests stay, with who did them and what they wrote: they belong to the game, not the mission.
            this.sql.exec('DELETE FROM campaign_players WHERE game_id = ?', game);
            this.sql.exec('DELETE FROM campaign_reports WHERE game_id = ? AND objective NOT IN (SELECT quest_id FROM game_side_quests WHERE game_id = ?)', game, game);
            this.sql.exec('DELETE FROM report_checks WHERE game_id = ? AND objective NOT IN (SELECT quest_id FROM game_side_quests WHERE game_id = ?)', game, game);
            this.interviews.clear(game);
            this.sql.exec('DELETE FROM campaign_thieves WHERE game_id = ?', game);
            this.sql.exec('DELETE FROM quest_assignments WHERE game_id = ? AND chapter <> ?', game, GAME_CHAPTER);
            this.groups.clear(game, true);
            this.sql.exec('DELETE FROM quest_releases WHERE game_id = ?', game);
            this.sql.exec('DELETE FROM mission_live_quests WHERE game_id = ?', game);
            this.sql.exec('DELETE FROM mission_live_previews WHERE game_id = ?', game);
            this.sendQuestToAll(game);
            return null;
        }
        this.sendQuestToAll(game);
        return null;
    }

    // Every student's place with the open game's side quests, for the teacher, with or without a mission: free to choose
    // one (nothing else to do), doing one, or still on a warm-up or mission; and what they wrote for them.
    private sideQuestStatus(game: string | null): SideQuestStatus | null {
        const base = game ? this.boardContext(game, '') : null;
        if (!game || !base) return null;
        const sideQuests = base.quests.filter(o => base.sideQuests.has(o.id));
        const title = (id: string) => this.sideQuests.quests().find(quest => quest.id === id)?.title ?? base.quests.find(o => o.id === id)?.text ?? id;
        const name = (key: string) => base.names.get(key) ?? 'Student';
        const chapters = base.chapterIndex === GAME_CHAPTER ? [GAME_CHAPTER] : [GAME_CHAPTER, base.chapterIndex];
        const given = new Set(this.gameSideQuests.added(game).map(quest => quest.id));
        const status: SideQuestStatus = { free: [], doing: [], busy: 0, quests: sideQuests.length,
            groups: chapters.flatMap(chapter => this.groups.current(game, chapter)).flatMap(group => sideQuests.some(o => o.id === group.objective) && group.state !== 'done'
                ? [{ id: group.group_id, quest: title(group.objective), members: this.groups.members(group.group_id).map(name), size: group.size, state: group.state }] : []),
            open: sideQuests.filter(o => !base.closed.has(o.id)).map(o => ({ id: o.id, title: title(o.id) })),
            reports: this.sql.exec<{ student_key: string; objective: string; text: string; ts: number; check_id: string | null }>('SELECT student_key, objective, text, ts, check_id FROM campaign_reports WHERE game_id = ? AND submitted = 1 ORDER BY ts DESC LIMIT 100', game).toArray()
                .filter(report => given.has(report.objective)).map(report => {
                    // A group's report was written for every member: the teacher sees who else was in it.
                    const others = this.questBoard.groupOf(game, report.objective, report.student_key)?.members.filter(key => key !== report.student_key) ?? [];
                    const check = report.check_id ? this.reportChecks.get(report.check_id) : undefined;
                    return { studentKey: report.student_key, objective: report.objective, quest: title(report.objective), text: report.text, version: report.ts, ...(check ? { check: { status: check.status, feedback: check.feedback } } : {}), starred: this.starred(report.student_key, `report:${game}:${report.objective}`),
                        ...(others.length ? { partner: others.map(name).join(', ') } : {}) };
                }) };
        for (const player of base.players) {
            const ctx = this.boardContext(game, player.student_key)!;
            const active = this.questBoard.activeSideQuest(ctx);
            if (active) status.doing.push({ studentKey: player.student_key, name: name(player.student_key), quest: title(active.id) });
            else if (!ctx.idle) status.busy++;
            else status.free.push({ studentKey: player.student_key, name: name(player.student_key) });
        }
        return status;
    }

    private campaignStatus(game: string | null): CampaignStatus | null {
        const row = this.campaignRow(game);
        const campaign = row && this.gameCampaign(game);
        if (!game || !row || !campaign) return null;
        const names = this.rosterNames(game);
        const players = this.campaignPlayers(game);
        const thieves = this.chapterThieves(game, campaign, row.chapter);
        return {
            guideVersion: JSON.stringify([row.revision_id, row.live_epoch, row.live_version, row.chapter, [...names], players.map(player => [player.student_key, player.role_id]), thieves.map(key => [key, this.avatarOf(key)])]),
            id: campaign.id, title: campaign.title, status: row.status, chapter: row.chapter, chapters: campaign.chapters.length, zones: clueZones(campaign),
            chapterTitle: campaign.chapters[Math.min(row.chapter, campaign.chapters.length - 1)].title,
            chapterTitles: campaign.chapters.map(chapter => chapter.title),
            reveals: (() => {
                const reveals = campaign.chapters[Math.min(row.chapter, campaign.chapters.length - 1)].reveals;
                return { shown: Math.min(row.revealed, reveals.length), total: reveals.length, next: reveals[row.revealed]?.text ?? null };
            })(),
            players: players.map(item => ({
                studentKey: item.student_key, name: names.get(item.student_key) ?? 'Student',
                role: campaign.roles.find(role => role.id === item.role_id)?.name ?? item.role_id, clues: item.clues.length, done: item.done,
                thief: thieves.includes(item.student_key)
            })),
            ...(campaign.chapters[row.chapter].objectives.some(o => o.board) ? { board: this.questBoard.summary(game, campaign.chapters[row.chapter]) } : {}),
            interviews: this.interviews.rows(game, row.chapter).map(i => ({
                id: i.id, objective: i.objective, task: campaign.chapters[row.chapter].objectives.find(o => o.id === i.objective)?.text ?? i.objective,
                incoming: false, studentKey: i.investigator, witnessKey: i.witness, questionId: i.question_id, answerId: i.answer_id, name: names.get(i.witness) ?? 'Classmate',
                question: i.question, questionStatus: i.question_status, answer: i.answer, answerStatus: i.answer_status, evidence: i.evidence, shared: i.shared
            })),
            reports: this.sql.exec<{ student_key: string; objective: string; text: string; partner_key: string | null; ts: number; check_id: string | null }>(
                `SELECT r.student_key, r.objective, r.text, r.ts, r.check_id, a.partner_key FROM campaign_reports r
                LEFT JOIN quest_assignments a ON r.game_id = a.game_id AND r.student_key = a.student_key AND r.objective = a.objective
                WHERE r.game_id = ? AND r.submitted = 1 AND r.objective NOT IN (SELECT quest_id FROM game_side_quests WHERE game_id = ?) ORDER BY r.ts DESC LIMIT 100`, game, game).toArray()
                .map(report => {
                    // A group's report was written for every member: the teacher sees who else was in it.
                    const others = this.questBoard.groupOf(game, report.objective, report.student_key)?.members.filter(key => key !== report.student_key) ?? [];
                    const check = report.check_id ? this.reportChecks.get(report.check_id) : undefined;
                    return { studentKey: report.student_key, objective: report.objective, text: report.text, version: report.ts, ...(check ? { check: { status: check.status, feedback: check.feedback } } : {}),
                        starred: this.starred(report.student_key, `report:${game}:${report.objective}`),
                        ...(report.partner_key ? { partner: names.get(report.partner_key) ?? 'Classmate' } : others.length ? { partner: others.map(key => names.get(key) ?? 'Classmate').join(', ') } : {}) };
                })
        };
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
        const rows = this.sql.exec<{ student_key: string; full: string; display_name: string | null }>(
            `SELECT s.student_key, COALESCE(s.full_name, s.name) AS full, g.display_name FROM students s
             LEFT JOIN game_students g ON g.student_key = s.student_key AND g.game_id = ? WHERE s.student_key IN
             (SELECT student_key FROM game_students WHERE game_id = ? UNION SELECT student_key FROM positions WHERE game_id = ?)`, game, game, game).toArray();
        const names = shownNames(rows.filter(row => !row.display_name).map(row => ({ key: row.student_key, full: row.full })));
        const taken = new Set(rows.flatMap(row => row.display_name ? [row.display_name.toLowerCase()] : []));
        for (const row of rows) {
            if (row.display_name) { names.set(row.student_key, row.display_name); continue; }
            const base = names.get(row.student_key)!;
            let name = base;
            for (let suffix = 2; taken.has(name.toLowerCase()); suffix++) name = `${base} ${suffix}`;
            names.set(row.student_key, name);
            taken.add(name.toLowerCase());
        }
        return names;
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

    private useRealNames(game: string): void {
        if (!this.isRandom(game)) return;
        this.sql.exec('UPDATE games SET random_names = 0 WHERE id = ?', game);
        const names = this.rosterNames(game);
        // Keep displayed chat labels consistent, including for classmates who are offline. Student IDs and activity state stay intact.
        for (const [studentKey, name] of names) {
            this.sql.exec('UPDATE chat SET sender = ? WHERE game_id = ? AND student_key = ?', name, game, studentKey);
            this.sql.exec('UPDATE chat SET target_name = ? WHERE game_id = ? AND target_key = ?', name, game, studentKey);
        }
        for (const ws of this.ctx.getWebSockets()) {
            const seat = ws.deserializeAttachment() as Seat | null;
            if (!seat || seat.left || seat.game !== game) continue;
            seat.name = names.get(seat.studentKey) ?? seat.name;
            ws.serializeAttachment(seat);
        }
        // One event also renames offline conversations and avoids sequential name collisions.
        this.broadcast(this.realNameUpdate(game, names));
        this.sendWarmupToAll(game);
        this.sendQuestToAll(game);
    }

    private realNameUpdate(game: string, names = this.rosterNames(game)) {
        const ids = new Map(this.seats().filter(seat => seat.game === game).map(seat => [seat.studentKey, seat.id]));
        const aliases = this.sql.exec<{ student_key: string; name: string }>('SELECT student_key, name FROM aliases WHERE game_id = ?', game).toArray();
        return { t: 'names', names: [...names.values()], changes: aliases.flatMap(alias => {
            const name = names.get(alias.student_key);
            return name && name !== alias.name ? [{ id: ids.get(alias.student_key), from: alias.name, name }] : [];
        }) };
    }

    private activeGame(): string | null {
        return this.setting('active_game');
    }

    private game(id: string | null): { id: string; name: string; pin: string; themeId: string } | null {
        return id === null ? null
            : this.sql.exec<{ id: string; name: string; pin: string; themeId: string }>('SELECT id, name, pin, theme_id AS themeId FROM games WHERE id = ?', id).toArray()[0] ?? null;
    }

    // A game keeps its PIN for good, so a PIN is never reused.
    private newPin(): string {
        for (;;) {
            const pin = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
            if (this.sql.exec('SELECT 1 FROM games WHERE pin = ?', pin).toArray().length === 0) return pin;
        }
    }

    private createGame(name: string, randomNames: boolean, vision: number, themeId = this.themes.defaultId()): string {
        const id = crypto.randomUUID().slice(0, 8);
        const now = Date.now();
        this.sql.exec('INSERT INTO games (id, name, pin, created, last_opened, random_names, vision, theme_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            id, name, this.newPin(), now, now, randomNames ? 1 : 0, Math.max(0, Math.min(MAX_VISION, Math.round(vision))), themeId);
        return id;
    }

    private vision(game: string | null): number {
        return game === null ? 0 : this.sql.exec<{ vision: number }>('SELECT vision FROM games WHERE id = ?', game).toArray()[0]?.vision ?? 0;
    }

    private sendVision(target: WebSocket, game: string): void {
        try { target.send(JSON.stringify({ t: 'vision', radius: this.vision(game) })); } catch { /* closing */ }
    }

    private sendSound(target: WebSocket, studentKey: string): void {
        try { target.send(JSON.stringify({ t: 'sound', off: this.soundOff(studentKey) })); } catch { /* closing */ }
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
        this.reportChecks.clear(game);
        this.activityHistory.clear(game);
        this.incidents.forget(game);
        this.blockedWords.forget(game);
        for (const table of ['positions', 'chat', 'chat_audience', 'aliases', 'game_students', 'campaigns', 'campaign_players', 'campaign_reports', 'campaign_thieves', 'quest_assignments', 'side_quest_groups', 'side_quest_members', 'quest_releases', 'interviews', 'mission_live_quests', 'mission_live_previews', 'game_side_quests', 'side_quest_done', 'game_side_quest_previews', 'warmups', 'warmup_players', 'speech_plays', 'student_tab_stats']) {
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
        const chosen = this.sql.exec<{ display_name: string | null }>('SELECT display_name FROM game_students WHERE game_id = ? AND student_key = ?', game, studentKey).toArray()[0]?.display_name;
        if (chosen) return { name: chosen, kept: true };
        const existing = this.sql.exec<{ name: string; kept: number }>('SELECT name, kept FROM aliases WHERE game_id = ? AND student_key = ?', game, studentKey).toArray()[0];
        if (existing) return { name: existing.name, kept: existing.kept === 1 };
        return { name: this.newAlias(game, studentKey), kept: false };
    }

    // A name nobody else in the game has (and not the one this student has now), saved for them.
    private newAlias(game: string, studentKey: string): string {
        const taken = new Set(this.sql.exec<{ name: string }>('SELECT name FROM aliases WHERE game_id = ? UNION SELECT display_name AS name FROM game_students WHERE game_id = ? AND display_name IS NOT NULL', game, game).toArray().map(row => row.name.toLowerCase()));
        const name = randomName(taken);
        this.sql.exec(`INSERT INTO aliases (game_id, student_key, name, kept) VALUES (?, ?, ?, 0)
            ON CONFLICT (game_id, student_key) DO UPDATE SET name = excluded.name`, game, studentKey, name);
        return name;
    }

    // ---------- The warm-up ----------
    // A few minutes at the start of a lesson: each student has a made-up fact about themselves and looks for
    // classmates who have other facts, typing their names. It is separate from the campaign.

    playedActivities(token: string, gameId?: string): ActivityHistoryView | { error: string; status: number } {
        if (!token || !this.sql.exec('SELECT 1 FROM teacher_sessions WHERE token = ? AND expires > ?', token, Date.now()).toArray().length) return { error: 'Please sign in again.', status: 401 };
        const games = this.sql.exec<{ id: string; name: string }>('SELECT id, name FROM games ORDER BY last_opened DESC, id').toArray();
        const selected = gameId && gameId !== 'current' ? gameId : this.activeGame();
        const game = games.find(game => game.id === selected) ?? null;
        if (selected && !game) return { error: 'That saved game no longer exists.', status: 404 };
        return this.activityHistory.view(game, games);
    }

    warmupEditor(token: string, kind: unknown, input?: unknown): SavedWarmup | { error: string; status: number } {
        if (!token || !this.sql.exec('SELECT 1 FROM teacher_sessions WHERE token = ? AND expires > ?', token, Date.now()).toArray().length) return { error: 'Please sign in again.', status: 401 };
        if (!isWarmupKind(kind)) return { error: 'Choose a warm-up type.', status: 400 };
        return this.ctx.storage.transactionSync(() => {
            const current = this.savedWarmup(kind);
            if (input === undefined) return current;
            const body = input as { definition?: unknown; version?: unknown } | null;
            if (!body || body.version !== current.version) return { error: 'This warm-up was changed in another tab. Export your edits, then reload the saved version.', status: 409 };
            const checked = validateWarmup(body.definition);
            if (!checked.definition || checked.definition.kind !== kind) return { error: checked.errors.join(' ') || 'The warm-up type does not match.', status: 400 };
            const next = { definition: checked.definition, version: current.version + 1 };
            this.sql.exec('INSERT INTO warmup_templates (kind, version, definition) VALUES (?, ?, ?) ON CONFLICT(kind) DO UPDATE SET version = excluded.version, definition = excluded.definition', kind, next.version, JSON.stringify(next.definition));
            return next;
        });
    }

    private savedWarmup(kind: WarmupKind): SavedWarmup {
        const row = this.sql.exec<{ version: number; definition: string }>('SELECT version, definition FROM warmup_templates WHERE kind = ?', kind).toArray()[0];
        return row ? { version: row.version, definition: JSON.parse(row.definition) } : { version: 0, definition: defaultWarmup(kind) };
    }

    private warmupDefinition(game: string): WarmupDefinition {
        const row = this.sql.exec<{ definition: string | null }>('SELECT definition FROM warmups WHERE game_id = ?', game).toArray()[0];
        return row?.definition ? JSON.parse(row.definition) : defaultWarmup(this.warmupKind(game));
    }

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

    private identityChatProblem(game: string | null, studentKey: string, text: string): string | null {
        if (!game || !this.warmupActive(game) || this.warmupKind(game) !== 'identity') return null;
        const player = this.sql.exec<{ fact: string }>('SELECT fact FROM warmup_players WHERE game_id = ? AND student_key = ?', game, studentKey).toArray()[0];
        const definition = this.warmupDefinition(game);
        return player && definition.kind === 'identity' ? identityRevealProblem(text, player.fact, definition.identities) : null;
    }

    // Starts afresh for the students who are here; anyone who arrives later is given a part when they do.
    private startWarmup(game: string, kind: WarmupKind): string | null {
        const here = this.seats().filter(seat => seat.game === game).map(seat => seat.studentKey);
        if (here.length < 2) return 'At least two students need to be in the plaza.';
        const definition = this.savedWarmup(kind).definition;
        if (definition.kind === 'identity' && definition.identities.length < here.length) return `Add at least ${here.length} identities in the warm-up editor so every student has a different one.`;
        const previous = this.sql.exec<{ started: number }>('SELECT started FROM warmups WHERE game_id = ?', game).toArray()[0];
        const started = Math.max(Date.now(), (previous?.started ?? 0) + 1);
        this.ctx.storage.transactionSync(() => {
            this.sql.exec('DELETE FROM warmup_players WHERE game_id = ?', game);
            this.sql.exec('INSERT INTO warmups (game_id, active, started, kind, definition) VALUES (?, 1, ?, ?, ?) ON CONFLICT (game_id) DO UPDATE SET active = 1, started = excluded.started, kind = excluded.kind, definition = excluded.definition', game, started, kind, JSON.stringify(definition));
            for (const [key, assignment] of (definition.kind === 'identity' ? assignIdentities(here, Math.random, definition.identities)
                : definition.kind === 'pairs' ? assignPairs(here, Math.random, definition.pairs) : assignWarmup(here, Math.random, definition.facts, definition.rounds))) {
                this.sql.exec('INSERT INTO warmup_players (game_id, student_key, fact, targets) VALUES (?, ?, ?, ?)', game, key, assignment.fact, JSON.stringify(assignment.targets));
            }
            this.activityHistory.warmup(game, started, definition, this.warmupPlayers(game));
        });
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
        const definition = this.warmupDefinition(game);
        const late = definition.kind === 'identity' ? assignLateIdentity(players.map(player => player.fact), here.map(player => player.student_key), Math.random, definition.identities)
            : definition.kind === 'pairs' ? assignLatePair(here.map(player => player.fact), Math.random, definition.pairs) : assignLateJoiner(here.map(player => player.fact), Math.random, definition.rounds);
        if (!late) return false;
        if (definition.kind === 'identity') {
            let different = here.filter(player => player.fact !== late.fact);
            if (!different.length) {
                late.fact = definition.identities.find(identity => identity.id !== here[0]?.fact)?.id ?? late.fact;
                different = here.filter(player => player.fact !== late.fact);
            }
            if (!different.length) return false;
            late.targets = [different[Math.floor(Math.random() * different.length)].student_key];
        }
        this.sql.exec('INSERT INTO warmup_players (game_id, student_key, fact, targets) VALUES (?, ?, ?, ?)', game, studentKey, late.fact, JSON.stringify(late.targets));
        const round = this.sql.exec<{ started: number }>('SELECT started FROM warmups WHERE game_id = ?', game).one();
        this.activityHistory.warmup(game, round.started, definition, this.warmupPlayers(game));
        return true;
    }

    private warmupView(game: string, studentKey: string): WarmupView | null {
        if (!this.warmupActive(game)) return null;
        const kind = this.warmupKind(game);
        const definition = this.warmupDefinition(game);
        this.lateWarmupPart(game, studentKey);
        const players = this.warmupPlayers(game);
        const me = players.find(player => player.student_key === studentKey);
        if (!me) return null;
        const open = me.step < me.targets.length;
        const classmate = this.rosterNames(game).get(me.targets[0]) ?? 'a classmate';
        const card = definition.kind === 'identity' ? { fact: `You are ${identityById(me.fact, definition.identities)?.name ?? '?'}. Do not say your name! Answer yes or no.`,
            task: `Find out who ${classmate} is. Ask yes or no questions. Then type their secret name.` }
            : kind === 'pairs' ? { fact: `Your word is ${me.fact}.`, task: `Find the person with the word that goes with ${me.fact}. Then type their name.` }
            : { fact: factById(me.fact, definition.kind === 'facts' ? definition.facts : [])?.mine ?? '', task: `Find someone who ${factById(me.targets[me.step], definition.kind === 'facts' ? definition.facts : [])?.find ?? ''}.` };
        return {
            kind,
            runId: `${game}:${this.sql.exec<{ started: number }>('SELECT started FROM warmups WHERE game_id = ?', game).toArray()[0]?.started ?? 0}`,
            title: definition.title, instructions: definition.instructions, level: definition.level, vocabulary: warmupVocabulary(definition),
            fact: card.fact,
            task: open ? card.task : null,
            step: me.step, of: me.targets.length,
            team: { done: players.reduce((sum, player) => sum + player.step, 0), total: players.reduce((sum, player) => sum + player.targets.length, 0) },
        };
    }

    private sendWarmup(target: WebSocket, game: string, studentKey: string): void {
        if (!this.warmupActive(game) && this.warmupPlayers(game).length === 0) return;
        try { target.send(JSON.stringify({ t: 'warmup', warmup: this.warmupView(game, studentKey),
            vocabulary: [...new Set([...warmupVocabulary(this.warmupDefinition(game)), ...warmupVocabulary(this.savedWarmup('identity').definition)])] })); } catch { /* closing */ }
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
            // A wrong guess is how a guessing game goes, not a sign the student needs help.
            ws.send(JSON.stringify({ t: 'warmup-answered', correct, wait }));
        };
        const now = Date.now();
        if (now - me.last_wrong < WRONG_ANSWER_WAIT_MS) return reply(false, true);
        const names = this.rosterNames(seat.game);
        let right: boolean;
        if (view.kind === 'identity') {
            // The secret identity of the classmate they were asked about
            const partner = players.find(player => player.student_key === me.targets[me.step]);
            const definition = this.warmupDefinition(seat.game);
            const identity = partner && definition.kind === 'identity' && identityById(partner.fact, definition.identities);
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
            // Done with the warm-up: the student may be asked to choose a side quest.
            for (const socket of this.ctx.getWebSockets(seat.studentKey)) this.sendQuest(socket, seat.game, seat.studentKey);
        }
        // Everyone's progress bar moves
        this.sendWarmupToAll(seat.game);
    }

    private warmupStatus(game: string | null): TeacherStatus['warmup'] {
        if (game === null) return null;
        const players = this.warmupPlayers(game);
        if (players.length === 0 && !this.warmupActive(game)) return null;
        const names = this.rosterNames(game);
        const definition = this.warmupDefinition(game);
        return {
            active: this.warmupActive(game),
            title: definition.title,
            kind: this.warmupKind(game),
            players: players.map(player => ({ studentKey: player.student_key, name: names.get(player.student_key) ?? 'Student',
                fact: definition.kind === 'identity' ? `${identityById(player.fact, definition.identities)?.name ?? '?'} (finds out about ${names.get(player.targets[0]) ?? '?'})`
                    : this.warmupKind(game) === 'pairs' ? `word: ${player.fact} (looks for ${player.targets[0]})`
                    : factById(player.fact, definition.kind === 'facts' ? definition.facts : [])?.mine ?? '', found: player.step, of: player.targets.length })),
            team: { done: players.reduce((sum, player) => sum + player.step, 0), total: players.reduce((sum, player) => sum + player.targets.length, 0) },
        };
    }

    private sendAlias(target: WebSocket, game: string, studentKey: string): void {
        // A reconnect may have missed the live switch. Clear its name picker and
        // relabel old conversations before sending chat history with current names.
        try { target.send(JSON.stringify(this.isRandom(game) ? { t: 'alias', ...this.alias(game, studentKey) } : this.realNameUpdate(game))); } catch { /* closing */ }
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
            if (!this.sql.exec('SELECT 1 FROM campaign_reports WHERE game_id = ? AND student_key = ? AND objective = ? AND submitted = 1', game, studentKey, objective).toArray().length) return 'That report was not found.';
            return this.award(studentKey, `report:${game}:${objective}`, XP.teacher, 'Your teacher liked your report', game) ? null : 'That report already has a star.';
        }
        return 'Choose a message or a report.';
    }

    // `id` names the chat message the notice is about, so the page can show it on that message.
    private notify(studentKey: string, level: 'info' | 'warning', text: string, id?: string): void {
        for (const ws of this.ctx.getWebSockets(studentKey)) {
            try { ws.send(JSON.stringify({ t: 'notice', level, text, ...(id ? { id } : {}) })); } catch { /* closing */ }
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

    // A hint before sending. Only a positive safety clearance may reach the
    // grammar model; skipped help is not permission to post the message.
    private async grammar(ws: WebSocket, seat: Seat, id: unknown, text: unknown, attemptId?: string): Promise<void> {
        const audit = typeof text === 'string' ? this.beginAttempt(seat, text, 'chat', attemptId) : null;
        const now = Date.now();
        let answer: Awaited<ReturnType<typeof checkGrammar>> = { ok: true };
        let safetyReason: string | undefined;
        if (typeof text === 'string' && now - (seat.lastCheck ?? 0) >= CHECK_GAP_MS && this.isOpen()) {
            seat.lastCheck = now;
            ws.serializeAttachment(seat);
            // Never a hint for something harmful: the AI would rewrite it into better English. It is reported instead.
            // A short message gets no hint anyway, and is checked when it is sent.
            const harm = localHarm(text);
            if (harm) {
                this.flagHarm(seat, harm, text, audit);
                safetyReason = `Safety filter: ${harm}; grammar skipped.`;
            } else if (chatProblem(text) || await this.blockedTerm(seat.game, text)) {
                safetyReason = 'Message filter: grammar skipped.';
            } else if (text.trim().split(/\s+/).length >= MIN_WORDS && text.length <= 200) {
                const verdict = await this.moderated(text);
                if (verdict.result === 'flagged') {
                    this.flagHarm(seat, harmFrom(verdict.categories), text, audit);
                    safetyReason = `Safety filter: ${verdict.categories.join(', ')}; grammar skipped.`;
                } else if (verdict.result === 'clean') {
                    answer = await checkGrammar(text, this.env);
                    safetyReason = 'Safety check: clean; no grammar hint.';
                } else {
                    safetyReason = `Safety check unavailable (${verdict.result === 'unchecked' ? verdict.reason : 'not configured'}); grammar skipped.`;
                }
            }
        }
        if (audit) {
            const existing = this.assistance.get(audit);
            if (existing && ['submitted', 'language-checked', 'hint-offered'].includes(existing.status)) {
                this.assistance.update(audit, answer.ok ? 'language-checked' : 'hint-offered', answer.ok ? safetyReason : `Safety check: clean. ${answer.why}`, answer.ok ? existing.correction : answer.corrected);
                if (!answer.ok && !existing.correction) this.assistance.signal(seat.game, seat.studentKey, seat.name, `Grammar hint: ${answer.why} Try: “${answer.corrected}”`, String(text));
            }
        }
        try { ws.send(JSON.stringify({ t: 'checked', id, ...answer })); } catch { /* closing */ }
    }

    // ---------- Safety ----------

    private async moderated(text: string): Promise<Moderation> {
        const key = text.trim();
        const known = this.moderations.get(key);
        if (known && Date.now() - known.at < 120_000) return known.verdict;
        const verdict = await moderate(key, this.env);
        if (verdict.result === 'clean' || verdict.result === 'flagged') {
            this.moderations.set(key, { verdict, at: Date.now() });
            if (this.moderations.size > 300) this.moderations.delete(this.moderations.keys().next().value!);
        }
        return verdict;
    }

    // Local classroom rules or the harm OpenAI positively identified. This
    // incident helper does not grant safety clearance for grammar or delivery.
    private async harmOf(text: string): Promise<Harm | null> {
        const harm = localHarm(text);
        if (harm) return harm;
        const verdict = await this.moderated(text);
        return verdict.result === 'flagged' ? harmFrom(verdict.categories) : null;
    }

    // Tells the teacher, once per attempt. Nothing else happens to the student.
    private flagHarm(seat: Seat, harm: Harm, text: string, attempt: string | null | undefined): void {
        this.incidents.record(seat.game, seat.studentKey, seat.name, harm, text, attempt);
    }

    // ---------- Blocked words ----------
    // Words and phrases the teacher blocks for one lesson, until the class closes: no student message may say them,
    // what already said them comes down, and what the whole plaza suddenly repeats is offered for blocking.

    // Names and other words the English check takes besides the dictionary's.
    private englishNames(game: string): string[] {
        return [...this.rosterNames(game).values(), ...IDENTITY_NAMES, ...warmupVocabulary(this.warmupDefinition(game)), ...warmupVocabulary(this.savedWarmup('identity').definition)];
    }

    // On the teacher's laptop, whether the English check takes a word. A blocked word is then also found inside
    // longer words and one letter off, which are not English anyway, but never in an English word or a name.
    private async englishAccepts(game: string | null): Promise<((word: string) => boolean) | undefined> {
        if (!this.env.LAN_URL || !game) return undefined;
        const { notEnglish } = await import('./english.ts');
        const names = this.englishNames(game);
        return word => !notEnglish(word, names).length || !notEnglish(word[0].toUpperCase() + word.slice(1), names).length;
    }

    // The word or phrase blocked for this lesson that a message says, if any.
    private async blockedTerm(game: string, text: string): Promise<Term | null> {
        const terms = this.blockedWords.terms(game, this.helpSession());
        return terms.length ? blockedIn(text, terms, await this.englishAccepts(game)) : null;
    }

    private lessonStart(game: string): number {
        return this.sql.exec<{ last_opened: number }>('SELECT last_opened FROM games WHERE id = ?', game).toArray()[0]?.last_opened ?? 0;
    }

    // Blocking takes down this lesson's messages that already say it: those waiting are not posted, those posted
    // come off every screen, and each student hears once how many of theirs came down.
    private takeDownBlocked(game: string, terms: Term[], accepted?: (word: string) => boolean): void {
        if (!terms.length) return;
        const lesson = this.helpSession();
        const perTerm = new Map<string, number>();
        const perStudent = new Map<string, number>();
        for (const row of this.sql.exec<{ id: string; student_key: string; text: string; status: string }>(
            "SELECT id, student_key, text, status FROM chat WHERE game_id = ? AND ts >= ? AND status = 'approved' ORDER BY ts", game, this.lessonStart(game)).toArray()) {
            const term = blockedIn(row.text, terms, accepted);
            if (!term) continue;
            perTerm.set(term.key, (perTerm.get(term.key) ?? 0) + 1);
            this.retract(row.id);
            perStudent.set(row.student_key, (perStudent.get(row.student_key) ?? 0) + 1);
        }
        for (const [key, count] of perTerm) this.blockedWords.removed(game, lesson, key, count);
        for (const [student, count] of perStudent) {
            this.notify(student, 'warning', count === 1 ? 'Your teacher removed one of your messages.' : `Your teacher removed ${count} of your messages.`);
        }
    }

    // The task's own words: the game's story, and its warm-up while one runs. Everyone using them is the lesson working.
    private storyWords(game: string): Set<string> {
        if (this.taskWords?.game === game && Date.now() - this.taskWords.at < 60_000) return this.taskWords.words;
        const texts = (value: unknown): string[] => typeof value === 'string' ? [value]
            : Array.isArray(value) ? value.flatMap(texts) : value && typeof value === 'object' ? Object.values(value).flatMap(texts) : [];
        const words = taskWordSet([...texts(this.gameCampaign(game)), ...(this.warmupActive(game) ? texts(this.warmupDefinition(game)) : [])]);
        this.taskWords = { game, at: Date.now(), words };
        return words;
    }

    // For the teacher page: what is blocked this lesson and what it stopped, the last lesson's to block again, and,
    // while the class is open, what many students are all writing to everyone that no blocked word covers yet.
    private async blockedStatus(game: string | null): Promise<BlockedStatus> {
        if (!game) return { words: [], before: [], repeats: [] };
        const lesson = this.helpSession();
        const terms = this.blockedWords.terms(game, lesson);
        const accepted = terms.length ? await this.englishAccepts(game) : undefined;
        const names = this.rosterNames(game);
        const nameOf = (studentKey: string) => names.get(studentKey) ?? 'Student';
        const words = this.blockedWords.view(game, lesson).map(word => ({ ...word, by: word.by.map(item => ({ ...item, name: nameOf(item.studentKey) })) }));
        const before = this.blockedWords.before(game, lesson);
        if (!this.isOpen() || this.activeGame() !== game) return { words, before, repeats: [] };
        const said = this.sql.exec<{ student_key: string; text: string }>(`SELECT student_key, text FROM chat
            WHERE game_id = ? AND ts >= ? AND target_key IS NULL AND x IS NULL ORDER BY ts DESC LIMIT 300`,
            game, Math.max(this.lessonStart(game), Date.now() - REPEAT_WINDOW_MS)).toArray()
            .filter(row => !blockedIn(row.text, terms, accepted)).map(row => ({ studentKey: row.student_key, text: row.text }));
        const least = Math.max(3, Math.ceil(this.seats().filter(seat => seat.game === game).length * REPEAT_SHARE));
        const letThrough = this.blockedWords.letThroughKeys(game, lesson);
        const repeats = said.length < least ? [] : repeated(said, least, this.storyWords(game), key => letThrough.has(key))
            .map(repeat => ({ ...repeat, students: repeat.students.map(studentKey => ({ studentKey, name: nameOf(studentKey) })) }));
        return { words, before, repeats };
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
        const reply = (level: 'info' | 'warning', text: string, id?: string) => {
            try { ws.send(JSON.stringify({ t: 'notice', level, text, cid, ...(id ? { id } : {}) })); } catch { /* the class changed while checking */ }
        };
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
            if (cid) ws.send(JSON.stringify({ t: 'result', cid, ...(audit ? { id: audit } : {}) }));
            return;
        }
        const unavailable = () => !this.isOpen() || this.activeGame() !== seat.game || (ws.deserializeAttachment() as Seat | null)?.left
            || (valid && !valid()) || this.sql.exec('SELECT 1 FROM mutes WHERE student_key = ?', seat.studentKey).toArray().length > 0;
        if (unavailable()) { refused('Chat is unavailable right now.', 'unavailable'); return reply('warning', 'Chat is unavailable right now.'); }
        if (this.isRandom(seat.game) && !this.alias(seat.game, seat.studentKey).kept) { refused('Choose your name first.'); return reply('warning', 'Choose your name first.'); }

        // A word the teacher blocked for this lesson is looked for first, however disguised, so "fr33 4ndr3i" is told
        // as blocked rather than as misspelt.
        let term = typeof value === 'string' ? await this.blockedTerm(seat.game, value) : null;
        if (term && unavailable()) { refused('Chat is unavailable right now.', 'unavailable'); return reply('warning', 'Chat is unavailable right now.'); }
        // On the teacher's laptop every word must be English, whatever the page did.
        if (typeof value === 'string' && this.env.LAN_URL && !localHarm(value) && !term) {
            const { notEnglish } = await import('./english.ts');
            const words = notEnglish(value, this.englishNames(seat.game));
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

        // `to` is the id of the classmate being whispered to, or 'everyone' for the whole plaza; without it,
        // the message is for whoever is nearby.
        const everyone = to === 'everyone';
        let target: Seat | undefined;
        if (to !== undefined && to !== null && !everyone) {
            target = this.seats().find(other => other.game === seat.game && other.id === to);
            if (!target || target.studentKey === seat.studentKey) { refused('That student is not in the Plaza right now.'); return reply('warning', 'That student is not in the Plaza right now.'); }
        }

        // Blocked messages are kept too, so the teacher sees what was attempted.
        let activityProblem = this.identityChatProblem(seat.game, seat.studentKey, value);
        let problem = term ? BLOCKED_NOTICE : chatProblem(value) ?? activityProblem;
        let flag: string | null = null;
        let harm: Harm | null = localHarm(value);
        if (!problem) {
            const verdict = await this.moderated(value);
            if (verdict.result === 'flagged') { problem = 'That message cannot be sent. Please rewrite it.'; flag = verdict.categories.join(', '); harm = harmFrom(verdict.categories); }
            else if (verdict.result === 'unchecked') flag = 'moderation unavailable';
            // The teacher may have blocked a word it says while OpenAI looked at it.
            term = await this.blockedTerm(seat.game, value);
            if (term) problem = BLOCKED_NOTICE;
            // The class may have closed or the student been muted while OpenAI answered.
            if (unavailable()) { refused('Chat is unavailable right now.', 'unavailable'); return reply('warning', 'Chat is unavailable right now.'); }
        }
        const blockedReason = term && `Blocked for this lesson: “${term.words}”`;
        if (blockedReason) note = [note, blockedReason].filter(Boolean).join('\n');
        // Assignments can change while moderation is in flight. Check durable state
        // again before the message posts.
        activityProblem = this.identityChatProblem(seat.game, seat.studentKey, value);
        if (activityProblem && !term) {
            problem = activityProblem;
            note = [note, `Activity rule — Who am I?: ${activityProblem}`].filter(Boolean).join('\n');
        }
        // Nothing waits for the teacher: a message the checks did not stop posts at once, a witness exchange too, and
        // the teacher can take it down afterwards. Without OpenAI the blocked words and the local harm check still apply;
        // when OpenAI is down, the message is marked "moderation unavailable" for the teacher.
        const posts = !problem;
        // A message for everyone keeps no place: where the sender stood decides nothing.
        const currentNames = this.rosterNames(seat.game); // Names may change while moderation is in flight.
        const entry = { id: crypto.randomUUID(), game_id: seat.game, student_key: seat.studentKey, sender: currentNames.get(seat.studentKey) ?? seat.name, text: value.trim().slice(0, 200),
            target_key: target?.studentKey ?? null, x: everyone ? null : seat.x, y: everyone ? null : seat.y, marks: null as string | null, voice: normalizeVoice(seat.avatar.voice) };
        // Sent as written although a better version was offered: mark the words that differ, for everyone who reads it.
        const slips = better ? wordDiff(entry.text, better).original : [];
        if (slips.length) entry.marks = JSON.stringify(slips);
        this.sql.exec(`INSERT INTO chat (id, student_key, sender, text, ts, status, target_key, target_name, x, y, flag, note, game_id, marks, voice)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            entry.id, entry.student_key, entry.sender, entry.text, now, problem ? 'blocked' : posts ? 'approved' : 'pending',
            entry.target_key, target ? currentNames.get(target.studentKey) ?? target.name : null, entry.x, entry.y, flag, note, seat.game, entry.marks, entry.voice);
        if (audit) this.attemptStatus(audit, problem ? 'blocked' : posts ? 'approved' : 'pending', blockedReason || (problem ?? note ?? flag ?? undefined), entry.id);
        if (term) this.blockedWords.tried(seat.game, this.helpSession(), term.key, seat.studentKey);
        if (harm) this.flagHarm(seat, harm, String(value), audit);
        // The warm-up's own rule ("keep your identity hidden") is explained to the student; it is not a language problem.
        // A blocked word is counted under that word for the teacher, not as a student who may be stuck.
        else if (problem && problem !== activityProblem && !term) this.assistance.signal(seat.game, seat.studentKey, seat.name, `Message filter: ${problem}`, String(value), 'other');
        this.sql.exec(`DELETE FROM chat WHERE game_id IS ? AND id NOT IN (SELECT id FROM chat WHERE game_id IS ? ORDER BY ts DESC LIMIT ?)
            AND id NOT IN (SELECT question_id FROM interviews UNION SELECT answer_id FROM interviews WHERE answer_id IS NOT NULL)`,
            seat.game, seat.game, CHAT_KEEP);
        this.sql.exec(`DELETE FROM chat_audience WHERE game_id = ?
            AND chat_id NOT IN (SELECT id FROM chat) AND chat_id NOT IN (SELECT id FROM assistance_attempts WHERE status = 'teacher-inbox')`, seat.game);
        if (posts) {
            this.deliver(entry);
            if (cid) ws.send(JSON.stringify({ t: 'result', cid, id: entry.id })); // posted at once: nothing else to say
        }
        // A blocked word empties the box: the student is told, not handed the words back to try another spelling.
        else reply(term ? 'info' : 'warning', problem!);
        return { id: entry.id, status: problem ? 'blocked' : posts ? 'approved' : 'pending' };
    }

    // The teacher takes down a message that posted. A witness exchange it belonged to no longer counts.
    private remove(id: string): boolean {
        const entry = this.sql.exec<{ student_key: string; status: string }>('SELECT student_key, status FROM chat WHERE id = ?', id).toArray()[0];
        if (entry?.status !== 'approved') return false;
        this.retract(id);
        this.notify(entry.student_key, 'warning', 'Your teacher removed one of your messages.', id);
        return true;
    }

    // Taking down a message that already posted: it disappears from every screen.
    private retract(id: string): void {
        this.sql.exec("UPDATE chat SET status = 'removed' WHERE id = ?", id);
        this.assistance.chatStatus(id, 'removed');
        if (this.interviews.review(id, 'removed')) {
            const game = this.activeGame(); if (game) this.sendQuestToAll(game);
        }
        this.broadcast({ t: 'retract', id });
    }

    // A whisper goes to its two students, a message for everyone to the whole plaza,
    // and nearby chat to whoever stands within earshot of where the sender stood;
    // the sender always sees their own. False when a whisper had nobody to reach.
    private deliver(entry: { id: string; student_key: string; sender: string; text: string; target_key: string | null; x: number | null; y: number | null; marks?: string | null; game_id?: string | null; voice?: string | null }): boolean {
        const game = entry.game_id ?? this.activeGame();
        const recipients = new Set([entry.student_key]);
        for (const seat of this.seats()) {
            if (seat.game !== game) continue;
            const heard = entry.target_key !== null ? seat.studentKey === entry.target_key
                : entry.x === null || entry.y === null || Math.hypot(seat.x - entry.x, seat.y - entry.y) <= HEARING_RANGE;
            if (heard) recipients.add(seat.studentKey);
        }
        const names = this.rosterNames(game ?? '');
        const body = { t: 'chat', id: entry.id, sender: names.get(entry.student_key) ?? entry.sender, text: entry.text, voice: normalizeVoice(entry.voice), ts: Date.now(),
            ...(entry.marks ? { marks: JSON.parse(entry.marks) } : {}),
            ...(entry.target_key !== null ? { whisper: true, to: names.get(entry.target_key) ?? 'a classmate' }
                : entry.x === null || entry.y === null ? { all: true } : {}) };
        const message = JSON.stringify(body);
        // The sender's copy says how many classmates it reached: none means nobody was near enough to hear.
        const own = JSON.stringify({ ...body, heard: recipients.size - 1 });
        for (const studentKey of recipients) {
            for (const ws of this.ctx.getWebSockets(studentKey)) {
                const seat = ws.deserializeAttachment() as Seat | null;
                if (!seat || seat.left || seat.game !== game) continue;
                try {
                    ws.send(studentKey === entry.student_key ? own : message);
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

    // "Is writing": no words, only who, so a slow writer's classmates wait for the reply instead of giving up.
    // It reaches whoever the message being written would reach, and nobody else.
    private typing(ws: WebSocket, seat: Seat, to: unknown): void {
        const now = Date.now();
        if (to === 'teacher' || now - (seat.lastTyping ?? 0) < TYPING_GAP_MS || !this.isOpen() || this.activeGame() !== seat.game) return;
        if (this.sql.exec('SELECT 1 FROM mutes WHERE student_key = ?', seat.studentKey).toArray().length) return;
        if (this.isRandom(seat.game) && !this.alias(seat.game, seat.studentKey).kept) return;
        seat.lastTyping = now;
        ws.serializeAttachment(seat);
        const scope = to === 'everyone' ? 'all' : typeof to === 'string' ? 'private' : 'nearby';
        const message = JSON.stringify({ t: 'typing', id: seat.id, scope });
        for (const socket of this.ctx.getWebSockets()) {
            const other = socket.deserializeAttachment() as Seat | null;
            if (!other || other.left || other.game !== seat.game || other.studentKey === seat.studentKey) continue;
            const reached = scope === 'private' ? other.id === to : scope === 'all' || Math.hypot(other.x - seat.x, other.y - seat.y) <= HEARING_RANGE;
            if (reached) try { socket.send(message); } catch { /* closing */ }
        }
    }

    // This lesson's chat that reached the student, or was meant for them while they were away (a page reloaded,
    // a connection dropped), so no reply is lost. What they had already received comes as history: shown, not read
    // aloud or counted as new. A whisper that arrived while they were away is new.
    private sendChatHistory(ws: WebSocket, seat: Seat): void {
        const me = seat.studentKey;
        const from = this.sql.exec<{ last_opened: number }>('SELECT last_opened FROM games WHERE id = ?', seat.game).toArray()[0]?.last_opened ?? 0;
        const names = this.rosterNames(seat.game);
        const rows = this.sql.exec<{ id: string; student_key: string; sender: string; text: string; ts: number; target_key: string | null; x: number | null;
            marks: string | null; voice: string | null; heard: number; received: number }>(
            `SELECT c.id, c.student_key, c.sender, c.text, c.ts, c.target_key, c.x, c.marks, c.voice,
                (SELECT COUNT(*) FROM chat_audience a WHERE a.chat_id = c.id AND a.student_key != c.student_key) AS heard,
                EXISTS (SELECT 1 FROM chat_audience a WHERE a.chat_id = c.id AND a.student_key = ?) AS received
             FROM chat c WHERE c.game_id = ? AND c.status = 'approved' AND c.ts >= ?
                AND (c.student_key = ? OR c.target_key = ? OR (c.target_key IS NULL AND c.x IS NULL)
                    OR EXISTS (SELECT 1 FROM chat_audience a WHERE a.chat_id = c.id AND a.student_key = ?))
             ORDER BY c.ts DESC LIMIT ?`, me, seat.game, from, me, me, me, CHAT_HISTORY).toArray().reverse();
        // Their own private messages to the teacher, which the teacher's replies (sent with the help state) answer.
        const toTeacher = this.sql.exec<{ id: string; text: string; ts: number }>(`SELECT id, TRIM(COALESCE(final_text, text)) AS text, ts FROM assistance_attempts
            WHERE game_id = ? AND student_key = ? AND source = 'chat' AND target = 'Teacher' AND status = 'teacher-inbox'
            ORDER BY ts DESC LIMIT 50`, seat.game, me).toArray().reverse();
        try {
            for (const row of rows) {
                // Listening to it later needs proof it reached them.
                this.sql.exec('INSERT OR IGNORE INTO chat_audience (chat_id, game_id, student_key, voice) VALUES (?, ?, ?, ?)', row.id, seat.game, me, normalizeVoice(row.voice));
                ws.send(JSON.stringify({ t: 'chat', id: row.id, sender: names.get(row.student_key) ?? row.sender, text: row.text, voice: normalizeVoice(row.voice), ts: row.ts,
                    ...(row.target_key === me && !row.received ? {} : { history: true }),
                    ...(row.marks ? { marks: JSON.parse(row.marks) } : {}),
                    ...(row.target_key !== null ? { whisper: true, to: names.get(row.target_key) ?? 'a classmate' } : row.x === null ? { all: true } : {}),
                    ...(row.student_key === me ? { heard: row.heard } : {}) }));
            }
            for (const row of toTeacher) {
                ws.send(JSON.stringify({ t: 'chat', id: row.id, sender: seat.name, text: row.text, voice: normalizeVoice(seat.avatar.voice), ts: row.ts, history: true, whisper: true, to: 'Teacher' }));
            }
        } catch { /* closing */ }
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
        for (const ws of this.ctx.getWebSockets()) {
            this.leave(ws, false);
            try { ws.close(CLOSE_CLASS_CLOSED, 'The class is closed.'); } catch { /* already closing */ }
        }
    }
}
