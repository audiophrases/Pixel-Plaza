// Only the outcome and one useful next step travel to the student's Journal.
export type ReportVerdict = { status: 'pass' | 'revise' | 'uncertain'; feedback: string };
export type ReportCheck = { status: ReportVerdict['status'] | 'checking' | 'unavailable'; feedback: string };
export type ReportLevel = 'A1' | 'A2' | 'B1' | 'B2';
export const REPORT_CRITERIA_MAX = 600;
