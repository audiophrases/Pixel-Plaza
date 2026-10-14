import { PlazaRoom, type TeacherAction } from './plaza.ts';
import { PinPlayAuthError, resolveStudent, studentConfig, studentLogin, testerMode } from './pinplay.ts';
import { laptopOrigin, sanitizeAvatar, secretsMatch, teacherPasswordMatches } from './rules.ts';

export { PlazaRoom };

export interface Env {
    PLAZA: DurableObjectNamespace<PlazaRoom>;
    PINPLAY_AUTH?: Fetcher;
    // Local development and tests only; production uses PINPLAY_AUTH.
    PINPLAY_API_URL?: string;
    // Same value as PinPlay's, so the teacher has one password.
    CREATE_PASSWORD_HASH?: string;
    AUTH_RL?: RateLimit;
    // Optional: with a key, every message is also checked by OpenAI's moderation before it reaches the teacher.
    OPENAI_API_KEY?: string;
    OPENAI_BASE_URL?: string; // tests only
    OPENAI_GRAMMAR_MODEL?: string; // which chat model gives grammar hints; a small, cheap one by default
    MOVEMENT_CHECK?: string; // '0' turns off the check that moves do not go through walls or too fast (tests only)
    OPENAI_GRAMMAR_GATE?: string; // '0' skips the quick Decisions check that decides whether a hint is worth asking for
    // Set only on the teacher's laptop (npm run classroom): its address on the
    // school network, and the online Pixel Plaza where students sign in.
    LAN_URL?: string;
    CLOUD_URL?: string;
    // Set only by tester.bat on a local server: lets "tester:Name" tokens sign in without Google.
    TESTER_MODE?: string;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// One plaza for the class: every student's saved progress lives in it.
const plaza = (env: Env) => env.PLAZA.getByName('plaza');

async function spend(env: Env, key: string, slots: number): Promise<boolean> {
    if (!env.AUTH_RL) return true;
    try {
        const results = await Promise.all(Array.from({ length: slots }, () => env.AUTH_RL!.limit({ key })));
        return results.every(result => result.success);
    } catch {
        return true; // a limiter outage must not lock the class out
    }
}

// Every check costs one slot of the 50-a-minute budget and a wrong guess four
// more, so guessing tops out at about 10 tries a minute. The teacher's polling
// uses a session token instead and never spends any.
async function guarded(env: Env, key: string, check: () => boolean | Promise<boolean>): Promise<'ok' | 'wrong' | 'limited'> {
    if (!(await spend(env, key, 1))) return 'limited';
    if (await check()) return 'ok';
    await spend(env, key, 4);
    return 'wrong';
}

async function checkTeacherPassword(request: Request, env: Env, password: unknown): Promise<Response | null> {
    if (!env.CREATE_PASSWORD_HASH) return json({ error: 'The teacher password has not been set up.' }, 503);
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const result = await guarded(env, `teacher:${ip}`, () => teacherPasswordMatches(password, env.CREATE_PASSWORD_HASH));
    if (result === 'limited') return json({ error: 'Too many tries. Wait a minute, then try again.' }, 429);
    if (result === 'wrong') return json({ error: 'Wrong password.' }, 401);
    return null;
}

const onLaptop = (env: Env) => !!(env.LAN_URL && env.CLOUD_URL);

// On the laptop: tell the online plaza to send signed-in students here, or with
// a null url to stop. The password links it; the lease it returns renews it.
// Returns what the teacher should know, or ''.
async function linkOnline(env: Env, body: { password?: unknown; url: string | null }): Promise<string> {
    if (!onLaptop(env)) return '';
    const lease = body.password === undefined ? await plaza(env).setting('cloud_lease') : null;
    if (body.password === undefined && !lease) return 'Sign out and in again so students are sent to this laptop.';
    try {
        const response = await fetch(new URL('/api/laptop', env.CLOUD_URL), {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(lease ? { lease, url: body.url } : body), signal: AbortSignal.timeout(8000)
        });
        const result: any = await response.json().catch(() => ({}));
        if (!response.ok) return `Students are not being sent to this laptop: ${result.error || 'the online Pixel Plaza refused.'}`;
        if (typeof result.lease === 'string') await plaza(env).saveSetting('cloud_lease', result.lease);
        return '';
    } catch {
        return 'Students are not being sent to this laptop: the online Pixel Plaza is unreachable. Check the internet connection.';
    }
}

function teacherAction(path: string, method: string, body: any): TeacherAction | null {
    if (path === '/api/teacher/status' && method === 'GET') return { kind: 'status' };
    if (method !== 'POST') return null;
    if (path === '/api/teacher/class' && typeof body?.open === 'boolean') {
        return { kind: 'open', open: body.open, ...(typeof body.game === 'string' ? { game: body.game } : {}) };
    }
    if (path === '/api/teacher/game' && typeof body?.name === 'string') return { kind: 'newGame', name: body.name, randomNames: body.randomNames !== false, ...(typeof body.vision === 'number' ? { vision: body.vision } : {}) };
    if (path === '/api/teacher/game/delete' && typeof body?.game === 'string') return { kind: 'deleteGame', game: body.game, confirm: body.confirm === true };
    if (path === '/api/teacher/vision' && typeof body?.radius === 'number') return { kind: 'vision', radius: body.radius };
    if (path === '/api/teacher/warmup' && (body?.op === 'start' || body?.op === 'end')) {
        return { kind: 'warmup', op: body.op, ...(['facts', 'identity', 'pairs'].includes(body.type) ? { type: body.type } : {}) };
    }
    if (path === '/api/teacher/campaign' && ['start', 'next', 'reveal', 'reset'].includes(body?.op)) {
        return { kind: 'campaign', op: body.op, ...(typeof body.campaign === 'string' ? { campaign: body.campaign } : {}), confirm: body.confirm === true };
    }
    if (path === '/api/teacher/review' && typeof body?.id === 'string' && typeof body?.approve === 'boolean') {
        return { kind: 'review', id: body.id, approve: body.approve };
    }
    if (path === '/api/teacher/approve-all') return { kind: 'approveAll' };
    if (path === '/api/teacher/mode' && (body?.mode === 'approve' || body?.mode === 'review')) return { kind: 'mode', mode: body.mode };
    if (path === '/api/teacher/mute' && typeof body?.studentKey === 'string' && typeof body?.muted === 'boolean') {
        return { kind: 'mute', studentKey: body.studentKey, muted: body.muted };
    }
    return null;
}

async function handle(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    const get = request.method === 'GET';
    const post = request.method === 'POST';
    const body: any = post ? await request.json().catch(() => ({})) : {};

    if (path === '/api/health') return json({ ok: true });

    if (path === '/api/student/config' && get) {
        // Google sign-in needs HTTPS, which the laptop does not have: students
        // sign in online and are sent back here.
        if (testerMode(env)) return json({ loginEnabled: false, googleClientId: '', allowedDomains: [] });
        if (onLaptop(env)) return json({ loginEnabled: false, googleClientId: '', allowedDomains: [], signInUrl: env.CLOUD_URL });
        return json({ ...(await studentConfig(env)), laptopUrl: await plaza(env).laptopUrl() });
    }
    if (path === '/api/student/login' && post) {
        const session = await studentLogin(env, body?.googleIdToken);
        const student = await resolveStudent(env, session.studentToken);
        return json({ ...session, student, avatar: await plaza(env).savedAvatar(student.studentKey) });
    }
    if (path === '/api/student/me' && get) {
        const student = await resolveStudent(env, request.headers.get('x-student-token'));
        return json({ student, avatar: await plaza(env).savedAvatar(student.studentKey) });
    }

    if (path === '/api/plaza/join' && post) {
        const student = await resolveStudent(env, request.headers.get('x-student-token'));
        const classPin = await plaza(env).classPin();
        if (!classPin) return json({ error: 'Your teacher has not opened the class yet.' }, 403);
        const pin = await guarded(env, `pin:${student.studentKey}`, () => secretsMatch(body?.pin, classPin));
        if (pin === 'limited') return json({ error: 'Too many tries. Wait a minute, then try again.' }, 429);
        if (pin === 'wrong') return json({ error: 'Check the class PIN.' }, 403);
        const avatar = body?.avatar == null ? null : sanitizeAvatar(body.avatar);
        if (body?.avatar != null && !avatar) return json({ error: 'That avatar is not available.' }, 400);
        const result = await plaza(env).issueTicket(student, avatar);
        return 'error' in result ? json({ error: result.error }, 403) : json(result);
    }
    if (path === '/api/plaza/ws') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'Expected a WebSocket.' }, 426);
        return plaza(env).fetch(request);
    }

    if (path === '/api/teacher/login' && post) {
        const refused = await checkTeacherPassword(request, env, body?.password);
        if (refused) return refused;
        const token = await plaza(env).startTeacherSession();
        return json({ token, notice: await linkOnline(env, { password: body.password, url: env.LAN_URL ?? null }) });
    }
    if (path.startsWith('/api/teacher/')) {
        const action = teacherAction(path, request.method, body);
        if (!action) return json({ error: 'That request is not valid.' }, 400);
        const result = await plaza(env).teacher(request.headers.get('x-teacher-session') || '', action);
        if ('error' in result) return json({ error: result.error }, result.status);
        // Closing the class on the laptop stops sending students to it.
        const notice = action.kind === 'open' || action.kind === 'newGame'
            ? await linkOnline(env, { url: action.kind === 'newGame' || action.open ? env.LAN_URL ?? null : null }) : '';
        return json({ ...result, laptop: onLaptop(env) ? { url: env.LAN_URL, signInUrl: env.CLOUD_URL } : null, notice });
    }

    // Online: the teacher's laptop says where the class is playing.
    if (path === '/api/laptop' && post) {
        const url = body?.url === null ? null : laptopOrigin(body?.url);
        if (body?.url !== null && !url) return json({ error: 'That laptop address is not valid.' }, 400);
        if (typeof body?.lease === 'string') {
            return await plaza(env).updateLaptop(body.lease, url) ? json({ ok: true })
                : json({ error: 'the link expired. Sign out and in again on the laptop.' }, 401);
        }
        if (!url) return json({ error: 'That laptop address is not valid.' }, 400);
        const refused = await checkTeacherPassword(request, env, body?.password);
        if (refused) return refused;
        return json({ lease: await plaza(env).linkLaptop(url) });
    }

    return json({ error: 'Not found.' }, 404);
}

// Only /api/* reaches the Worker; the built app is served as static assets.
export default {
    async fetch(request, env): Promise<Response> {
        try {
            return await handle(request, env);
        } catch (error) {
            if (error instanceof PinPlayAuthError) return json({ error: error.message }, error.status);
            console.error(error);
            return json({ error: 'Something went wrong. Please try again.' }, 500);
        }
    }
} satisfies ExportedHandler<Env>;
