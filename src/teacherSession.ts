const KEY = 'pixel-plaza-teacher-session';
export function readTeacherSession(): string { try { return sessionStorage.getItem(KEY) ?? ''; } catch { return ''; } }
export function storeTeacherSession(token: string): void { try { if (token) sessionStorage.setItem(KEY, token); else sessionStorage.removeItem(KEY); } catch { /* sign-in still works without storage */ } }
