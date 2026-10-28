import { boardWait, mainFinished, sideQuestWait, type BoardQuestView, type Chapter, type Objective, type QuestView, type SideQuestsView } from '../shared/campaign.ts';
import { GROUP_START_MS, groupSize } from '../shared/sideQuests.ts';
import type { SideQuestGroups } from './sideQuestGroups.ts';

export type BoardPlayer = { student_key: string; role_id: string; done: string[] };
// `sideQuests`: the board quests that came from the side quest library, and `closed` those of them that take nobody
// new. `warmupLeft`: this student still has a warm-up task.
export type BoardContext = { game: string; chapterIndex: number; chapter: Chapter; status: QuestView['status']; player: BoardPlayer; players: BoardPlayer[]; online: Set<string>; names: Map<string, string>;
    sideQuests: ReadonlySet<string>; closed: ReadonlySet<string>; warmupLeft: boolean };
type Assignment = { objective: string; student_key: string; partner_key: string | null; accepted: number };

export class QuestBoard {
    private sql: SqlStorage;
    private groups: SideQuestGroups;
    private groupStartMs: number; // how long a group waits before its members may start with who is there
    constructor(sql: SqlStorage, groups: SideQuestGroups, groupStartMs = GROUP_START_MS) { this.sql = sql; this.groups = groups; this.groupStartMs = groupStartMs; }
    initialize(): void {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS quest_assignments (
            game_id TEXT NOT NULL, chapter INTEGER NOT NULL, objective TEXT NOT NULL, student_key TEXT NOT NULL,
            partner_key TEXT, accepted INTEGER NOT NULL, PRIMARY KEY (game_id, objective, student_key));
            CREATE TABLE IF NOT EXISTS quest_releases (
            game_id TEXT NOT NULL, objective TEXT NOT NULL, released INTEGER NOT NULL, PRIMARY KEY (game_id, objective));`);
    }
    assignment(game: string, objective: string, student: string): Assignment | undefined {
        return this.sql.exec<Assignment>('SELECT objective, student_key, partner_key, accepted FROM quest_assignments WHERE game_id = ? AND objective = ? AND student_key = ?', game, objective, student).toArray()[0];
    }
    released(game: string, objective: string): boolean { return this.sql.exec('SELECT 1 FROM quest_releases WHERE game_id = ? AND objective = ?', game, objective).toArray().length > 0; }
    release(game: string, objective: string): void { this.sql.exec('INSERT OR IGNORE INTO quest_releases (game_id, objective, released) VALUES (?, ?, ?)', game, objective, Date.now()); }
    partners(ctx: BoardContext, objective: Objective): BoardPlayer[] {
        return ctx.players.filter(p => p.student_key !== ctx.player.student_key && ctx.online.has(p.student_key)
            && (!objective.board?.partnerRole || p.role_id === objective.board.partnerRole)
            && (!objective.board?.differentRole || p.role_id !== ctx.player.role_id)
            && (!objective.board?.afterMain || mainFinished(ctx.chapter, p.done)));
    }
    // The side quest this student is doing: accepted and not finished. A student does one at a time.
    activeSideQuest(ctx: BoardContext): Objective | undefined {
        const accepted = new Set(this.sql.exec<{ objective: string }>('SELECT objective FROM quest_assignments WHERE game_id = ? AND chapter = ? AND student_key = ?', ctx.game, ctx.chapterIndex, ctx.player.student_key).toArray().map(row => row.objective));
        return ctx.chapter.objectives.find(o => ctx.sideQuests.has(o.id) && accepted.has(o.id) && !ctx.player.done.includes(o.id));
    }
    wait(ctx: BoardContext, objective: Objective): string | null {
        if (ctx.status === 'campaign_complete') return 'The campaign has ended.';
        if (ctx.sideQuests.has(objective.id)) {
            if (ctx.closed.has(objective.id)) return 'Your teacher closed this side quest.';
            const free = sideQuestWait(ctx.chapter, ctx.player.done, ctx.warmupLeft);
            if (free) return free;
            const active = this.activeSideQuest(ctx);
            if (active && active.id !== objective.id) return 'Finish your side quest first, or leave it to choose another.';
        }
        const reason = boardWait(objective, ctx.chapter, ctx.player.role_id, ctx.player.done, this.released(ctx.game, objective.id), ctx.online.size);
        if (reason) return reason;
        if (objective.activity && !this.partners(ctx, objective).length) return objective.board?.differentRole
            ? 'Wait for an investigator with a different role' + (objective.board.afterMain ? ' who has finished the main mystery.' : '.')
            : objective.board?.afterMain ? 'Wait for another investigator who has finished the main mystery.' : 'Wait for a classmate with the right role.';
        return null;
    }
    claim(ctx: BoardContext, objective: Objective, changePartner = false): string | null {
        const existing = this.assignment(ctx.game, objective.id, ctx.player.student_key);
        if (ctx.player.done.includes(objective.id)) return 'You have already finished this quest.';
        if (existing && !changePartner) return null; // idempotent: one quest per student per game
        if (changePartner && (!existing || !objective.activity)) return 'Accept this social quest first.';
        if (changePartner && existing?.partner_key && ctx.online.has(existing.partner_key)) return 'Your partner is still in the plaza.';
        const reason = this.wait(ctx, objective); if (reason) return reason;
        let partner: string | null = null;
        if (objective.activity) {
            const assignments = this.sql.exec<{ partner_key: string }>('SELECT partner_key FROM quest_assignments WHERE game_id = ? AND chapter = ? AND partner_key IS NOT NULL', ctx.game, ctx.chapterIndex).toArray();
            const load = (key: string) => assignments.filter(a => a.partner_key === key).length;
            partner = this.partners(ctx, objective).sort((a, b) => load(a.student_key) - load(b.student_key) || a.student_key.localeCompare(b.student_key))[0]?.student_key ?? null;
            if (!partner) return 'Wait for a classmate to join.';
        }
        this.sql.exec(`INSERT INTO quest_assignments (game_id, chapter, objective, student_key, partner_key, accepted) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (game_id, objective, student_key) DO UPDATE SET partner_key = excluded.partner_key`, ctx.game, ctx.chapterIndex, objective.id, ctx.player.student_key, partner, Date.now());
        // A pair or group side quest: into the group that has waited longest, or a new one.
        if (ctx.sideQuests.has(objective.id) && groupSize(objective) > 1) this.groups.join(ctx.game, ctx.chapterIndex, objective.id, groupSize(objective), ctx.player.student_key);
        return null;
    }
    // A student can leave the side quest they are doing, to choose another; their group carries on without them.
    leave(ctx: BoardContext, objective: Objective): string | null {
        if (!ctx.sideQuests.has(objective.id)) return 'Only side quests can be left.';
        if (ctx.player.done.includes(objective.id)) return 'You have already finished this quest.';
        this.sql.exec('DELETE FROM quest_assignments WHERE game_id = ? AND objective = ? AND student_key = ?', ctx.game, objective.id, ctx.player.student_key);
        this.groups.leave(ctx.game, objective.id, ctx.player.student_key);
        return null;
    }
    // A group that has waited long enough starts with the members it has, if there are two.
    start(ctx: BoardContext, objective: Objective): string | null {
        const group = this.groups.of(ctx.game, objective.id, ctx.player.student_key);
        if (!group || group.state !== 'open') return 'Your group is not waiting.';
        if (this.groups.members(group.group_id).length < 2) return 'Wait for at least one more classmate.';
        if (Date.now() < group.created + this.groupStartMs) return 'Wait a little longer for more classmates.';
        this.groups.setState(group.group_id, 'playing');
        return null;
    }
    // A free student who has not chosen is placed: in the pair or group that has waited longest, or else in a quest of
    // their own (a new group when there is nothing else). Returns the quest, or why there was none.
    autoPick(ctx: BoardContext): Objective | string {
        const open = ctx.chapter.objectives.filter(o => ctx.sideQuests.has(o.id) && !ctx.player.done.includes(o.id) && (!o.board?.roles?.length || o.board.roles.includes(ctx.player.role_id)) && !this.wait(ctx, o));
        if (!open.length) return 'There is no side quest to choose now.';
        const waiting = this.groups.open(ctx.game, ctx.chapterIndex).find(group => open.some(o => o.id === group.objective));
        const alone = open.filter(o => groupSize(o) === 1);
        const pick = waiting ? open.find(o => o.id === waiting.objective)! : (alone.length ? alone : open)[Math.floor(Math.random() * (alone.length || open.length))];
        return this.claim(ctx, pick) ?? pick;
    }
    // The members of a student's group, when the quest has one.
    groupOf(game: string, objective: string, student: string) {
        const group = this.groups.of(game, objective, student);
        return group ? { ...group, members: this.groups.members(group.group_id) } : undefined;
    }
    finishGroup(group: string): void { this.groups.setState(group, 'done'); }
    view(ctx: BoardContext): BoardQuestView[] {
        // Side quests the student cannot take yet stay out of sight: the main work comes first, then one at a time.
        const busy = !!sideQuestWait(ctx.chapter, ctx.player.done, ctx.warmupLeft) || !!this.activeSideQuest(ctx);
        return ctx.chapter.objectives.filter(o => o.board && (!o.board.roles?.length || o.board.roles.includes(ctx.player.role_id))).flatMap(o => {
            const assignment = this.assignment(ctx.game, o.id, ctx.player.student_key);
            if (o.board?.teacherReleased && !this.released(ctx.game, o.id) && !assignment) return [];
            const done = ctx.player.done.includes(o.id);
            const sideQuest = ctx.sideQuests.has(o.id);
            if (sideQuest && (busy || ctx.closed.has(o.id)) && !assignment && !done) return [];
            const reason = !assignment && !done ? this.wait(ctx, o) : null;
            const name = (key: string) => ctx.names.get(key) ?? 'Classmate';
            const group = sideQuest && groupSize(o) > 1 ? this.groupOf(ctx.game, o.id, ctx.player.student_key) : undefined;
            const joining = sideQuest && groupSize(o) > 1 && !assignment && !done ? this.groups.open(ctx.game, ctx.chapterIndex, o.id)[0] : undefined;
            return [{ id: o.id, text: o.text, kind: o.kind === 'report' ? 'report' as const : o.answerRole ? 'name' as const : 'text' as const, activity: o.activity ?? null,
                state: done ? 'done' as const : assignment ? 'active' as const : reason ? 'waiting' as const : 'available' as const, reason,
                partner: assignment?.partner_key ? { name: name(assignment.partner_key), online: ctx.online.has(assignment.partner_key) } : null,
                ...(sideQuest ? { sideQuest: true } : {}),
                ...(group ? { group: { members: group.members.map(name), size: group.size, state: group.state,
                    startAt: group.state === 'open' && group.members.length >= 2 ? group.created + this.groupStartMs : null } } : {}),
                ...(joining ? { joining: this.groups.members(joining.group_id).map(name) } : {}) }];
        });
    }
    // Where the student stands with the side quests of this chapter.
    sideQuestsView(ctx: BoardContext): SideQuestsView {
        const left = ctx.chapter.objectives.filter(o => ctx.sideQuests.has(o.id) && (!o.board?.roles?.length || o.board.roles.includes(ctx.player.role_id)) && !ctx.player.done.includes(o.id));
        const reason = sideQuestWait(ctx.chapter, ctx.player.done, ctx.warmupLeft);
        if (reason) return { state: 'locked', reason, waiting: left.length };
        if (this.activeSideQuest(ctx)) return { state: 'active', reason: null, waiting: left.length - 1 };
        const open = left.filter(o => !this.wait(ctx, o)).length;
        return open ? { state: 'choose', reason: null, waiting: open }
            : { state: 'empty', reason: left.length ? 'The side quests here wait for more classmates or for a later question.' : 'Your teacher will add side quests soon.', waiting: 0 };
    }
    summary(game: string, chapter: Chapter): { id: string; text: string; released: boolean; teacherReleased: boolean; accepted: number; completed: number }[] {
        const players = this.sql.exec<{ done: string }>('SELECT done FROM campaign_players WHERE game_id = ?', game).toArray().map(p => JSON.parse(p.done) as string[]);
        return chapter.objectives.filter(o => o.board).map(o => ({ id: o.id, text: o.text, released: this.released(game, o.id), teacherReleased: !!o.board?.teacherReleased,
            accepted: this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM quest_assignments WHERE game_id = ? AND objective = ?', game, o.id).one().n,
            completed: players.filter(done => done.includes(o.id)).length }));
    }
}
