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
    evidence: { reason: string; text: string; timestamp: number }[];
};
export type TeacherSupport = { alerts: HelpAlert[]; students: { studentKey: string; name: string }[]; ai?: { used: number; students: number } };
export type StudentSupport = {
    ai?: { session: string; available: boolean; used: boolean; pending: boolean; tip: string | null; resultId: string | null };
    request: { id: string; topic: HelpTopic; status: HelpStatus } | null;
    messages: { id: string; text: string; timestamp: number }[];
};
export type AttemptPage = { attempts: MessageAttempt[]; next: string | null };
