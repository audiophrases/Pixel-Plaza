export type HelpTopic = 'writing' | 'instructions' | 'classmate-message' | 'other';
export type AttemptSource = 'chat' | 'interview' | 'answer' | 'warmup' | 'teacher' | 'help';
export type HelpStatus = 'open' | 'acknowledged' | 'resolved';
export type MessageAttempt = {
    id: string; studentKey: string; sender: string; text: string; timestamp: number;
    source: AttemptSource; status: string; reason: string | null; target: string | null;
    objective: string | null; chatId: string | null; correction: string | null; finalText: string | null;
};
export type HelpAlert = {
    id: string; studentKey: string; name: string; topic: HelpTopic; kind: 'requested' | 'suggested';
    status: HelpStatus; note: string; timestamp: number; updated: number;
    ai?: { pending: boolean; tip: string | null };
    evidence: { reason: string; text: string; timestamp: number; count?: number }[]; // count: the same text tried again
    since?: number; // messages posted or answers right since the last attempt in the evidence
};
export type TeacherSupport = { alerts: HelpAlert[]; students: { studentKey: string; name: string; tabSwitches?: number; tabAwayAt?: number | null }[]; ai?: { used: number; students: number } };
export type StudentSupport = {
    ai?: { session: string; available: boolean; used: boolean; pending: boolean; tip: string | null; resultId: string | null };
    request: { id: string; topic: HelpTopic; status: HelpStatus } | null;
    messages: { id: string; text: string; timestamp: number }[];
};
// One student's conversations, for the teacher: what they wrote (sent, waiting, stopped), what classmates wrote to
// them privately, and their private exchange with the teacher. `thread` is 'nearby', 'everyone', 'teacher' or
// 'p:<classmate key>'; `mine` is true for the student's own lines.
export type ConversationLine = { id: string; at: number; thread: string; mine: boolean; text: string; status: string; reason: string | null };
export type Conversations = { studentKey: string; lines: ConversationLine[]; names: Record<string, string> };

export type AttemptPage = { attempts: MessageAttempt[]; next: string | null };
