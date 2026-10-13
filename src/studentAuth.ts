import type { AvatarConfig } from './utils/AvatarRenderer';

export type Student = { studentKey: string; displayName: string; className: string };
export type StudentSession = { studentToken: string; expiresAt: number; student: Student };
// The avatar saved in the plaza, or null before the student's first visit.
export type StudentProfile = { student: Student; avatar: AvatarConfig | null };
// Online, laptopUrl is where the teacher's laptop runs the class, if it does.
// On the laptop, signInUrl is the online site where students sign in instead.
export type StudentConfig = {
  loginEnabled: boolean; googleClientId: string; allowedDomains: string[];
  laptopUrl?: string | null; signInUrl?: string;
};

const sessionKey = 'pixelplaza.student.v1';

const handOffKey = 'session';

function usable(session: StudentSession | null): StudentSession | null {
  return session && typeof session.studentToken === 'string' && session.expiresAt > Date.now()
    && typeof session.student?.studentKey === 'string' && typeof session.student?.displayName === 'string'
    ? session : null;
}

// A tester (tester.bat) lives in its own tab's sessionStorage, so several can
// play from one browser; a real student is remembered in localStorage.
export function readStudentSession(): StudentSession | null {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem(sessionKey);
      const session = usable(raw ? JSON.parse(raw) as StudentSession : null);
      if (session) return session;
    } catch { /* storage disabled */ }
  }
  return null;
}

// Browser storage is per address, so the session signed in online travels to
// the teacher's laptop in the URL fragment, which is never sent to a server.
export function handOffTo(laptopUrl: string, session: StudentSession): void {
  const target = new URL(laptopUrl);
  target.hash = new URLSearchParams({ [handOffKey]: JSON.stringify(session) }).toString();
  window.location.assign(target);
}

// On the laptop: keep a handed-over session and take it out of the address bar.
export function receiveHandOff(): void {
  const raw = new URLSearchParams(window.location.hash.slice(1)).get(handOffKey);
  if (raw === null) return;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  try {
    const session = usable(JSON.parse(raw) as StudentSession);
    if (session) saveStudentSession(session);
  } catch { /* not ours */ }
}

export function saveStudentSession(session: StudentSession): void {
  (session.studentToken.startsWith('tester:') ? sessionStorage : localStorage).setItem(sessionKey, JSON.stringify(session));
}

export function clearStudentSession(): void {
  try { localStorage.removeItem(sessionKey); sessionStorage.removeItem(sessionKey); } catch { /* storage disabled */ }
  window.google?.accounts.id.disableAutoSelect?.();
}

async function studentRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/student/${path}`, init);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Student sign-in failed.');
  return result as T;
}

export function fetchStudentConfig(): Promise<StudentConfig> {
  return studentRequest<StudentConfig>('config');
}

export function fetchStudentProfile(token: string): Promise<StudentProfile> {
  return studentRequest<StudentProfile>('me', { headers: { 'x-student-token': token } });
}

export function exchangeGoogleCredential(googleIdToken: string): Promise<StudentSession & StudentProfile> {
  return studentRequest<StudentSession & StudentProfile>('login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ googleIdToken })
  });
}
