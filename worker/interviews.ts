import type { InterviewView } from '../shared/campaign.ts';

export type Interview = {
    id: string; game_id: string; chapter: number; objective: string; investigator: string; witness: string;
    question_id: string; question: string; question_status: string; shared: string | null;
    answer_id: string | null; answer: string | null; answer_status: string | null; evidence: string | null;
};

// Transcript status is saved separately from the bounded chat history, so a busy lesson
// and a server restart cannot erase participation. Only turns that posted count; one the teacher takes down stops counting.
export class Interviews {
    private sql: SqlStorage;
    constructor(sql: SqlStorage) { this.sql = sql; }
    initialize(): void {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS interviews (
            id TEXT PRIMARY KEY, game_id TEXT NOT NULL, chapter INTEGER NOT NULL, objective TEXT NOT NULL,
            investigator TEXT NOT NULL, witness TEXT NOT NULL, question_id TEXT NOT NULL,
            question TEXT NOT NULL, question_status TEXT NOT NULL, shared TEXT,
            answer_id TEXT, answer TEXT, answer_status TEXT, evidence TEXT,
            UNIQUE(game_id, chapter, objective, investigator, witness));
            CREATE INDEX IF NOT EXISTS interviews_game ON interviews(game_id, chapter);
            CREATE INDEX IF NOT EXISTS interviews_question ON interviews(question_id);
            CREATE INDEX IF NOT EXISTS interviews_answer ON interviews(answer_id);`);
    }
    get(id: string): Interview | undefined { return this.sql.exec<Interview>('SELECT * FROM interviews WHERE id = ?', id).toArray()[0]; }
    rows(game: string, chapter: number): Interview[] { return this.sql.exec<Interview>('SELECT * FROM interviews WHERE game_id = ? AND chapter = ?', game, chapter).toArray(); }
    ask(row: Pick<Interview, 'id' | 'game_id' | 'chapter' | 'objective' | 'investigator' | 'witness' | 'question_id' | 'question' | 'question_status' | 'shared'>): void {
        this.sql.exec(`INSERT INTO interviews (id, game_id, chapter, objective, investigator, witness, question_id, question, question_status, shared)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, chapter, objective, investigator, witness)
            DO UPDATE SET id = excluded.id, question_id = excluded.question_id, question = excluded.question,
            question_status = excluded.question_status, shared = excluded.shared, answer_id = NULL, answer = NULL, answer_status = NULL, evidence = NULL`,
            row.id, row.game_id, row.chapter, row.objective, row.investigator, row.witness, row.question_id, row.question, row.question_status, row.shared);
    }
    reply(id: string, chat: string, text: string, evidence: string, status: string): void {
        this.sql.exec('UPDATE interviews SET answer_id = ?, answer = ?, evidence = ?, answer_status = ? WHERE id = ?', chat, text, evidence, status, id);
    }
    review(chat: string, status: string): boolean {
        const questions = this.sql.exec('UPDATE interviews SET question_status = ? WHERE question_id = ? RETURNING id', status, chat).toArray();
        const answers = this.sql.exec('UPDATE interviews SET answer_status = ? WHERE answer_id = ? RETURNING id', status, chat).toArray();
        return questions.length + answers.length > 0;
    }
    completed(game: string, chapter: number, objective: string, student: string, partner?: string | null): number {
        return this.rows(game, chapter).filter(row => row.objective === objective && row.investigator === student
            && (!partner || row.witness === partner) && row.question_status === 'approved' && row.answer_status === 'approved').length;
    }
    view(game: string, chapter: number, student: string, names: Map<string, string>, tasks: Map<string, string>): InterviewView[] {
        return this.rows(game, chapter).filter(row => row.investigator === student || (row.witness === student && row.question_status === 'approved')).map(row => {
            const incoming = row.witness === student;
            return { id: row.id, objective: row.objective, task: tasks.get(row.objective) ?? row.objective, incoming,
                name: names.get(incoming ? row.investigator : row.witness) ?? 'Classmate', question: row.question,
                questionStatus: row.question_status, answer: incoming || row.answer_status === 'approved' ? row.answer : null,
                answerStatus: row.answer_status, evidence: incoming || row.answer_status === 'approved' ? row.evidence : null,
                shared: incoming || row.question_status === 'approved' ? row.shared : null };
        });
    }
    clear(game: string): void { this.sql.exec('DELETE FROM interviews WHERE game_id = ?', game); }
}
