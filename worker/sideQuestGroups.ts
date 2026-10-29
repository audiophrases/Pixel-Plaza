import { GAME_CHAPTER } from './gameSideQuests.ts';

// Pairs and small groups for side quests. The game forms them: a student who accepts a pair or group quest joins the
// group for it that has waited longest, or opens a new one. A group plays once it is full (or when its members start
// with who is there), and one answer finishes the quest for every member. Each member also has a quest assignment, so
// the board's "one at a time" and the teacher's counts see them like anyone doing a quest.
export type QuestGroup = { group_id: string; game_id: string; chapter: number; objective: string; size: number; state: 'open' | 'playing' | 'done'; created: number };

export class SideQuestGroups {
    private sql: SqlStorage;
    constructor(sql: SqlStorage) { this.sql = sql; }
    initialize(): void {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS side_quest_groups (
            group_id TEXT PRIMARY KEY, game_id TEXT NOT NULL, chapter INTEGER NOT NULL, objective TEXT NOT NULL,
            size INTEGER NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS side_quest_members (
            game_id TEXT NOT NULL, group_id TEXT NOT NULL, student_key TEXT NOT NULL, joined INTEGER NOT NULL,
            PRIMARY KEY (group_id, student_key));
            CREATE INDEX IF NOT EXISTS side_quest_groups_game ON side_quest_groups(game_id, chapter, objective);`);
    }
    members(group: string): string[] {
        return this.sql.exec<{ student_key: string }>('SELECT student_key FROM side_quest_members WHERE group_id = ? ORDER BY joined, student_key', group).toArray().map(row => row.student_key);
    }
    // The student's group for this quest, if any.
    of(game: string, objective: string, student: string): QuestGroup | undefined {
        return this.sql.exec<QuestGroup>(`SELECT g.* FROM side_quest_groups g JOIN side_quest_members m ON m.group_id = g.group_id
            WHERE g.game_id = ? AND g.objective = ? AND m.student_key = ?`, game, objective, student).toArray()[0];
    }
    // Groups still looking for members, the longest waiting first.
    open(game: string, chapter: number, objective?: string): QuestGroup[] {
        return this.sql.exec<QuestGroup>(`SELECT * FROM side_quest_groups WHERE game_id = ? AND chapter = ? AND state = 'open' ${objective ? 'AND objective = ?' : ''} ORDER BY created, group_id`,
            ...(objective ? [game, chapter, objective] : [game, chapter])).toArray().filter(group => this.members(group.group_id).length < group.size);
    }
    // Every group of this chapter that is waiting or playing, for the teacher.
    current(game: string, chapter: number): QuestGroup[] {
        return this.sql.exec<QuestGroup>("SELECT * FROM side_quest_groups WHERE game_id = ? AND chapter = ? AND state <> 'done' ORDER BY created, group_id", game, chapter).toArray();
    }
    // Into the group that has waited longest, or a new one. It plays once it is full.
    join(game: string, chapter: number, objective: string, size: number, student: string): QuestGroup {
        const now = Date.now();
        let group = this.open(game, chapter, objective)[0];
        if (!group) {
            group = { group_id: crypto.randomUUID(), game_id: game, chapter, objective, size, state: 'open', created: now };
            this.sql.exec('INSERT INTO side_quest_groups (group_id, game_id, chapter, objective, size, state, created) VALUES (?, ?, ?, ?, ?, ?, ?)', group.group_id, game, chapter, objective, size, 'open', now);
        }
        this.sql.exec('INSERT OR IGNORE INTO side_quest_members (game_id, group_id, student_key, joined) VALUES (?, ?, ?, ?)', game, group.group_id, student, now);
        if (this.members(group.group_id).length >= group.size) this.setState(group.group_id, 'playing');
        return this.sql.exec<QuestGroup>('SELECT * FROM side_quest_groups WHERE group_id = ?', group.group_id).one();
    }
    // Out of a group. A group nobody is left in goes; one still waiting stays open for others.
    leave(game: string, objective: string, student: string): void {
        const group = this.of(game, objective, student);
        if (!group) return;
        this.sql.exec('DELETE FROM side_quest_members WHERE group_id = ? AND student_key = ?', group.group_id, student);
        if (!this.members(group.group_id).length) this.sql.exec('DELETE FROM side_quest_groups WHERE group_id = ?', group.group_id);
    }
    setState(group: string, state: QuestGroup['state']): void { this.sql.exec('UPDATE side_quest_groups SET state = ? WHERE group_id = ?', state, group); }
    // A game's groups, or with `keepGame` only those of a mission's chapters: the game's own side quests keep theirs.
    clear(game: string, keepGame = false): void {
        const chapter = keepGame ? ` AND chapter <> ${GAME_CHAPTER}` : '';
        this.sql.exec(`DELETE FROM side_quest_members WHERE group_id IN (SELECT group_id FROM side_quest_groups WHERE game_id = ?${chapter})`, game);
        this.sql.exec(`DELETE FROM side_quest_groups WHERE game_id = ?${chapter}`, game);
    }
}
