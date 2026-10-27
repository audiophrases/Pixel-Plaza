import { PlazaRoom, type TeacherAction } from './plaza.ts';
import { PinPlayAuthError, resolveStudent, studentConfig, studentLogin, testerMode } from './pinplay.ts';
import { laptopOrigin, sanitizeAvatar, secretsMatch, teacherPasswordMatches } from './rules.ts';
import { MISSION_MAX_BYTES } from '../shared/missionSchema.ts';
import { isEnglishVoice } from '../shared/voices.ts';
import { synthesize, VOICE_SAMPLE } from './speech.ts';

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
    OPENAI_PARTICIPATION?: string; // '0' disables small automatic conversation XP rewards
    MOVEMENT_CHECK?: string; // '0' turns off the check that moves do not go through walls or too fast (tests only)
    OPENAI_GRAMMAR_GATE?: string; // '0' skips the quick Decisions check that decides whether a hint is worth asking for
    // Set only on the teacher's laptop (npm run classroom): its address on the
    // school network, and the online Pixel Plaza where students sign in.
    LAN_URL?: string;
    CLOUD_URL?: string;
    // Set only for the tests and a new server's first content: lets /api/content load missions and the side quest
    // library from files. The online site never sets it.
    CONTENT_TOKEN?: string;
    // Set only by tester.bat on a local server: lets "tester:Name" tokens sign in without Google.
    TESTER_MODE?: string;
    // Optional override for PinPlay's existing Render speech bridge.
    EDGE_TTS_URL?: string;
    EDGE_TTS_SECRET?: string;
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
    if (path === '/api/teacher/help-status' && ['acknowledged', 'resolved'].includes(body?.status) && typeof body?.id === 'string') return { kind: 'helpStatus', id: body.id, status: body.status, gameId: typeof body.gameId === 'string' ? body.gameId : undefined };
    if (path === '/api/teacher/help-message' && typeof body?.studentKey === 'string' && typeof body?.text === 'string') return { kind: 'helpMessage', studentKey: body.studentKey, text: body.text, gameId: typeof body.gameId === 'string' ? body.gameId : undefined };
    if (path === '/api/teacher/class' && typeof body?.open === 'boolean') {
        return { kind: 'open', open: body.open, ...(typeof body.game === 'string' ? { game: body.game } : {}) };
    }
    if (path === '/api/teacher/game' && typeof body?.name === 'string') return { kind: 'newGame', name: body.name, randomNames: body.randomNames !== false, ...(typeof body.vision === 'number' ? { vision: body.vision } : {}), ...(body.themeId !== undefined ? { themeId: body.themeId } : {}) };
    if (path === '/api/teacher/game/delete' && typeof body?.game === 'string') return { kind: 'deleteGame', game: body.game, confirm: body.confirm === true };
    if (path === '/api/teacher/magic' && method === 'POST' && ['freeze', 'thaw', 'lightning', 'teleport', 'rain'].includes(body?.power)) return { kind: 'magic', power: body.power, studentKey: body.studentKey, x: body.x, y: body.y };
    if (path === '/api/teacher/vision' && typeof body?.radius === 'number') return { kind: 'vision', radius: body.radius };
    if (path === '/api/teacher/warmup' && (body?.op === 'start' || body?.op === 'end')) {
        return { kind: 'warmup', op: body.op, ...(['facts', 'identity', 'pairs'].includes(body.type) ? { type: body.type } : {}) };
    }
    if (path === '/api/teacher/campaign' && ['start', 'next', 'reveal', 'reset'].includes(body?.op)) {
        return { kind: 'campaign', op: body.op, ...(typeof body.campaign === 'string' ? { campaign: body.campaign } : {}), confirm: body.confirm === true };
    }
    if (path === '/api/teacher/quest-release' && typeof body?.objective === 'string') return { kind: 'questRelease', objective: body.objective };
    if (path === '/api/teacher/review' && typeof body?.id === 'string' && typeof body?.approve === 'boolean') {
        return { kind: 'review', id: body.id, approve: body.approve };
    }
    if (path === '/api/teacher/approve-all') return { kind: 'approveAll' };
    if (path === '/api/teacher/xp' && (typeof body?.chatId === 'string' || (typeof body?.report?.studentKey === 'string' && typeof body?.report?.objective === 'string'))) {
        return { kind: 'xp', ...(typeof body.chatId === 'string' ? { chatId: body.chatId } : { report: { studentKey: body.report.studentKey, objective: body.report.objective } }) };
    }
    if (path === '/api/teacher/incident' && typeof body?.id === 'string') return { kind: 'incident', id: body.id };
    if (path === '/api/teacher/block' && Array.isArray(body?.words) && body.words.length <= 50 && body.words.every((word: unknown) => typeof word === 'string')) {
        return { kind: 'block', words: body.words };
    }
    if (path === '/api/teacher/unblock' && typeof body?.key === 'string' && body.key.length <= 200) return { kind: 'unblock', key: body.key };
    if (path === '/api/teacher/let-through' && typeof body?.key === 'string' && body.key.length <= 200 && typeof body?.words === 'string') {
        return { kind: 'letThrough', key: body.key, words: body.words };
    }
    if (path === '/api/teacher/mode' && (body?.mode === 'approve' || body?.mode === 'review')) return { kind: 'mode', mode: body.mode };
    if (path === '/api/teacher/mute' && typeof body?.studentKey === 'string' && typeof body?.muted === 'boolean') {
        return { kind: 'mute', studentKey: body.studentKey, muted: body.muted };
    }
    if (path === '/api/teacher/sound' && typeof body?.studentKey === 'string' && typeof body?.off === 'boolean') {
        return { kind: 'sound', studentKey: body.studentKey, off: body.off };
    }
    if (path === '/api/teacher/sound-all' && typeof body?.off === 'boolean') return { kind: 'soundAll', off: body.off };
    return null;
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    const get = request.method === 'GET';
    const post = request.method === 'POST';
    const studio = path.startsWith('/api/teacher/missions/');
    const speech = path === '/api/plaza/speech' || path === '/api/plaza/voice-preview';
    const warmupEditor = path === '/api/teacher/warmup-editor';
    // A mission (draft and published version) or the side quest library from the laptop; missions and the library from files.
    const content = path === '/api/missions/sync' ? 3_000_000 : path === '/api/content' ? 8_000_000 : 0;
    if (path === '/api/content' && (!env.CONTENT_TOKEN || !secretsMatch(request.headers.get('x-content-token'), env.CONTENT_TOKEN))) return json({ error: 'Not found.' }, 404);
    let body: any = {};
    if (post && (studio || speech || warmupEditor || content)) {
        // Bound authoring input before buffering or parsing JSON, even without Content-Length.
        const reader = request.body?.getReader();
        if (!reader) return json({ error: 'Expected JSON.' }, 400);
        let size = 0; const chunks: Uint8Array[] = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > (content || (warmupEditor ? 68_096 : studio ? MISSION_MAX_BYTES + 4096 : 1024))) {
                await reader.cancel();
                return json({ error: content ? 'Request is too large.' : warmupEditor ? 'Warm-up request exceeds 64 KB.' : studio ? 'Mission request exceeds 512 KB.' : 'Speech request is too large.' }, 413);
            }
            chunks.push(value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: 'Invalid JSON.' }, 400); }
    } else if (post) body = await request.json().catch(() => ({}));

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

    if (speech && post) {
        const student = await resolveStudent(env, request.headers.get('x-student-token'));
        const preview = path === '/api/plaza/voice-preview';
        if (preview ? !isEnglishVoice(body?.voice) : typeof body?.id !== 'string' || !body.id || body.id.length > 100) {
            return json({ error: 'Choose a valid voice or chat message.' }, 400);
        }
        const room = plaza(env);
        if (await room.soundOff(student.studentKey)) return json({ error: 'Your teacher turned your sound off.' }, 403);
        const message = preview ? { text: VOICE_SAMPLE, voice: body.voice as string } : await room.speechMessage(student.studentKey, body.id);
        if (!message) return json({ error: 'That message is not available.' }, 404);
        if (!(await room.spendSpeech(student.studentKey, preview))) return json({ error: 'Wait a moment before playing more sounds.' }, 429);
        const audio = await synthesize(env, message, request.signal);
        if (!audio) return json({ error: 'Speech is temporarily unavailable. You can keep reading.' }, 503);
        if (await room.soundOff(student.studentKey)) {
            await audio.body?.cancel();
            return json({ error: 'Your teacher turned your sound off.' }, 403);
        }
        // A teacher may retract a message or switch games during synthesis.
        const current = preview ? message : await room.speechMessage(student.studentKey, body.id);
        if (!current || current.text !== message.text || current.voice !== message.voice) {
            await audio.body?.cancel();
            return json({ error: 'That message is no longer available.' }, 404);
        }
        await room.heard(student.studentKey, preview ? null : body.id);
        return audio;
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
        const notice = await linkOnline(env, { password: body.password, url: env.LAN_URL ?? null });
        // Linked: the laptop's missions go up and the online ones come down while the teacher page opens.
        if (onLaptop(env)) ctx.waitUntil(plaza(env).syncMissions());
        return json({ token, notice });
    }
    if (studio) {
        const op = path.slice('/api/teacher/missions/'.length);
        if (!(get && ['list', 'get', 'live', 'live-inspect'].includes(op)) && !(post && ['create', 'save', 'publish', 'live-preview', 'library-preview', 'live-release', 'live-withdraw', 'live-cancel'].includes(op))) return json({ error: 'That request is not valid.' }, 400);
        const args = get ? { id: new URL(request.url).searchParams.get('id') } : body;
        const result = await plaza(env).missionStudioSynced(request.headers.get('x-teacher-session') || '', op, args);
        return 'error' in result ? json(result, result.status) : json(result);
    }
    if (path === '/api/teacher/report' && get) {
        const scope = new URL(request.url).searchParams.get('scope') === 'game' ? 'game' : 'lesson';
        const result = await plaza(env).classReport(request.headers.get('x-teacher-session') || '', scope);
        return 'error' in result ? json({ error: result.error }, result.status) : json(result);
    }
    if (warmupEditor && (get || post)) {
        const result = await plaza(env).warmupEditor(request.headers.get('x-teacher-session') || '', new URL(request.url).searchParams.get('kind'), post ? body : undefined);
        return json(result, 'error' in result ? result.status : 200);
    }
    if (path === '/api/teacher/campaign-guide' && get) {
        const query = new URL(request.url).searchParams;
        const result = await plaza(env).campaignGuide(request.headers.get('x-teacher-session') || '', query.get('campaign') ?? undefined, query.get('game') ?? undefined);
        return 'error' in result ? json({ error: result.error }, result.status) : json(result);
    }
    if (path === '/api/teacher/quest-library' && get) {
        const result = await plaza(env).questLibraryFor(request.headers.get('x-teacher-session') || '');
        return 'error' in result ? json({ error: result.error }, result.status) : json(result);
    }
    if (path === '/api/teacher/conversations' && get) {
        const studentKey = new URL(request.url).searchParams.get('studentKey') || '';
        if (!studentKey) return json({ error: 'Choose a student.' }, 400);
        const result = await plaza(env).conversations(request.headers.get('x-teacher-session') || '', studentKey);
        return 'error' in result ? json({ error: result.error }, result.status) : json(result);
    }
    if (path === '/api/teacher/attempts' && get) {
        const query = new URL(request.url).searchParams;
        const result = await plaza(env).teacherAttempts(request.headers.get('x-teacher-session') || '', query.get('studentKey') || undefined, query.get('cursor'), query.get('gameId') || undefined);
        return 'error' in result ? json({ error: result.error }, result.status) : json(result);
    }
    if (path.startsWith('/api/teacher/')) {
        const action = teacherAction(path, request.method, body);
        if (!action) return json({ error: 'That request is not valid.' }, 400);
        const result = await plaza(env).teacher(request.headers.get('x-teacher-session') || '', action);
        if ('error' in result) return json({ error: result.error }, result.status);
        if (onLaptop(env) && action.kind === 'status') ctx.waitUntil(plaza(env).syncMissionsSometimes());
        // Closing the class on the laptop stops sending students to it.
        const notice = action.kind === 'open' || action.kind === 'newGame'
            ? await linkOnline(env, { url: action.kind === 'newGame' || action.open ? env.LAN_URL ?? null : null }) : '';
        return json({ ...result, laptop: onLaptop(env) ? { url: env.LAN_URL, signInUrl: env.CLOUD_URL } : null, notice });
    }

    // Online: the teacher's laptop keeps its missions in step with this server (PlazaRoom, "One home for missions").
    if (path === '/api/missions/sync' && post) {
        const result = await plaza(env).missionSyncServe(body && typeof body === 'object' ? body : {});
        return 'error' in result ? json({ error: result.error }, result.status) : json(result);
    }
    // Missions and the side quest library loaded from files, when CONTENT_TOKEN allows it (checked above).
    if (path === '/api/content' && post) {
        const result = await plaza(env).loadContent(body?.missions, body?.library);
        return 'error' in result ? json({ error: result.error }, result.status) : json(result);
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
    async fetch(request, env, ctx): Promise<Response> {
        try {
            return await handle(request, env, ctx);
        } catch (error) {
            if (error instanceof PinPlayAuthError) return json({ error: error.message }, error.status);
            console.error(error);
            return json({ error: 'Something went wrong. Please try again.' }, 500);
        }
    }
} satisfies ExportedHandler<Env>;
