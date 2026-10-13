// PinPlay owns Google sign-in, the roster and the student session keys. In
// production the calls go through the PINPLAY_AUTH service binding (as Dictation
// Time does); PINPLAY_API_URL replaces it for local development and tests.

export type PinPlayStudent = { studentKey: string; displayName: string; className: string };
export type PinPlayEnv = { PINPLAY_AUTH?: { fetch: (request: Request) => Promise<Response> }; PINPLAY_API_URL?: string; TESTER_MODE?: string };

export class PinPlayAuthError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

function publicBase(value: string): string {
    const url = new URL(value);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
        throw new Error('PINPLAY_API_URL must use HTTPS, except for a local test server.');
    }
    return url.toString().replace(/\/$/, '');
}

async function pinPlayRequest(env: PinPlayEnv, path: string, init: RequestInit = {}): Promise<any> {
    let response: Response;
    try {
        const signal = AbortSignal.timeout(8000);
        if (env.PINPLAY_API_URL) response = await fetch(publicBase(env.PINPLAY_API_URL) + path, { ...init, signal });
        else if (env.PINPLAY_AUTH) response = await env.PINPLAY_AUTH.fetch(new Request(`https://pinplay-auth${path}`, { ...init, signal }));
        else throw new Error('No PinPlay connection is configured.');
    } catch {
        throw new PinPlayAuthError('PinPlay sign-in is temporarily unavailable.', 503);
    }
    const data = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'PinPlay sign-in failed.';
        throw new PinPlayAuthError(message, response.status >= 500 ? 503 : response.status);
    }
    return data;
}

// Local testing only (tester.bat sets TESTER_MODE; production never does): a token
// "tester:Name" is a made-up student, so several can play without Google.
export const testerMode = (env: PinPlayEnv) => env.TESTER_MODE === '1';

export async function studentConfig(env: PinPlayEnv) {
    const data = await pinPlayRequest(env, '/api/student/config');
    return {
        loginEnabled: data?.loginEnabled === true && typeof data?.googleClientId === 'string' && !!data.googleClientId,
        googleClientId: typeof data?.googleClientId === 'string' ? data.googleClientId : '',
        allowedDomains: Array.isArray(data?.allowedDomains) ? data.allowedDomains.filter((item: unknown) => typeof item === 'string') : []
    };
}

export async function studentLogin(env: PinPlayEnv, googleIdToken: unknown): Promise<{ studentToken: string; expiresAt: number }> {
    if (typeof googleIdToken !== 'string' || !googleIdToken || googleIdToken.length > 8192) {
        throw new PinPlayAuthError('A Google sign-in credential is required.', 400);
    }
    const data = await pinPlayRequest(env, '/api/student/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ googleIdToken })
    });
    if (typeof data?.studentToken !== 'string' || !Number.isFinite(data?.expiresAt)) {
        throw new PinPlayAuthError('PinPlay returned an invalid student session.', 502);
    }
    return { studentToken: data.studentToken, expiresAt: data.expiresAt };
}

export async function resolveStudent(env: PinPlayEnv, studentToken: unknown): Promise<PinPlayStudent> {
    if (typeof studentToken !== 'string' || !studentToken || studentToken.length > 2048) {
        throw new PinPlayAuthError('Please sign in with Google.', 401);
    }
    if (testerMode(env) && studentToken.startsWith('tester:')) {
        const name = studentToken.slice(7).trim();
        if (!/^[A-Za-z0-9 _-]{1,24}$/.test(name)) throw new PinPlayAuthError('Please sign in with Google.', 401);
        return { studentKey: `tester-${name.toLowerCase()}`, displayName: name, className: 'Tester' };
    }
    const data = await pinPlayRequest(env, '/api/student/me', { headers: { 'X-Student-Token': studentToken } });
    const student = data?.student;
    if (typeof student?.studentKey !== 'string' || !student.studentKey || student.studentKey.length > 128
        || typeof student?.displayName !== 'string') {
        throw new PinPlayAuthError('PinPlay returned an invalid student identity.', 502);
    }
    return {
        studentKey: student.studentKey,
        displayName: student.displayName.trim().slice(0, 48),
        className: typeof student.className === 'string' ? student.className.trim().slice(0, 48) : ''
    };
}
