// Only the outcome and one useful next step travel to the student's Journal.
export type ReportVerdict = { status: 'pass' | 'revise' | 'uncertain'; feedback: string };
// "sent": the checker asked for a revision, and the student sent the same writing anyway after confirming. It counts as
// a pass; `feedback` keeps the checker's hint, so the teacher can see what the checker wanted.
export type ReportCheck = { status: ReportVerdict['status'] | 'checking' | 'unavailable' | 'sent'; feedback: string };
export type ReportLevel = 'A1' | 'A2' | 'B1' | 'B2';
export const REPORT_CRITERIA_MAX = 600;
