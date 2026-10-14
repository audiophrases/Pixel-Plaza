import { boardWait, mainFinished, type BoardQuestView, type Chapter, type Objective, type QuestView } from '../shared/campaign.ts';

export type BoardPlayer = { student_key: string; role_id: string; done: string[] };
export type BoardContext = { game: string; chapterIndex: number; chapter: Chapter; status: QuestView['status']; player: BoardPlayer; players: BoardPlayer[]; online: Set<string>; names: Map<string, string> };
type Assignment = { objective: string; student_key: string; partner_key: string | null; accepted: number };

export class QuestBoard {
    private sql: SqlStorage;
    constructor(sql: SqlStorage) { this.sql = sql; }
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
            && (!objective.board?.afterMain || mainFinished(ctx.chapter, p.done)));
    }
    wait(ctx: BoardContext, objective: Objective): string | null {
        if (ctx.status === 'campaign_complete') return 'The campaign has ended.';
        const reason = boardWait(objective, ctx.chapter, ctx.player.role_id, ctx.player.done, this.released(ctx.game, objective.id), ctx.online.size);
        if (reason) return reason;
        if (objective.activity && !this.partners(ctx, objective).length) return objective.board?.afterMain ? 'Wait for another investigator who has finished the main mystery.' : 'Wait for a classmate with the right role.';
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
        return null;
    }
    view(ctx: BoardContext): BoardQuestView[] {
        return ctx.chapter.objectives.filter(o => o.board && (!o.board.roles?.length || o.board.roles.includes(ctx.player.role_id))).flatMap(o => {
            const assignment = this.assignment(ctx.game, o.id, ctx.player.student_key);
            if (o.board?.teacherReleased && !this.released(ctx.game, o.id) && !assignment) return [];
            const done = ctx.player.done.includes(o.id);
            const reason = !assignment && !done ? this.wait(ctx, o) : null;
            return [{ id: o.id, text: o.text, kind: o.kind === 'report' ? 'report' as const : o.answerRole ? 'name' as const : 'text' as const, activity: o.activity ?? null,
                state: done ? 'done' as const : assignment ? 'active' as const : reason ? 'waiting' as const : 'available' as const, reason,
                partner: assignment?.partner_key ? { name: ctx.names.get(assignment.partner_key) ?? 'Classmate', online: ctx.online.has(assignment.partner_key) } : null }];
        });
    }
    summary(game: string, chapter: Chapter): { id: string; text: string; released: boolean; teacherReleased: boolean; accepted: number; completed: number }[] {
        const players = this.sql.exec<{ done: string }>('SELECT done FROM campaign_players WHERE game_id = ?', game).toArray().map(p => JSON.parse(p.done) as string[]);
        return chapter.objectives.filter(o => o.board).map(o => ({ id: o.id, text: o.text, released: this.released(game, o.id), teacherReleased: !!o.board?.teacherReleased,
            accepted: this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM quest_assignments WHERE game_id = ? AND objective = ?', game, o.id).one().n,
            completed: players.filter(done => done.includes(o.id)).length }));
    }
}
