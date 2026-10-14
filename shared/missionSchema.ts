import { isUnlocked, prerequisiteIds, type Campaign, type Chapter, type Objective, type Role } from './campaign.ts';
import { plazaMap } from './plazaMap.ts';

export const MISSION_MAX_BYTES = 512_000;
export type MissionEnvelope = { format: 'pixel-plaza-campaign'; schemaVersion: 1 | 2; campaign: Campaign };
export type MissionIssue = { path: string; message: string };
export type MissionValidation = { campaign: Campaign | null; errors: MissionIssue[]; warnings: MissionIssue[] };
export const missionEnvelope = (campaign: Campaign): MissionEnvelope => ({ format: 'pixel-plaza-campaign', schemaVersion: campaign.chapters.some(c => c.objectives.some(o => o.requires || o.board || o.activity)) ? 2 : 1, campaign });
export const missionJson = (campaign: Campaign) => JSON.stringify(missionEnvelope(campaign), null, 2);
export const missionId = (value: string) => /^[a-z][a-z0-9-]{0,63}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

// Build a canonical object from unknown input. Drafts may be incomplete, but never malformed.
export function validateMission(input: unknown, mode: 'draft' | 'publish' = 'publish'): MissionValidation {
    const errors: MissionIssue[] = [];
    const warnings: MissionIssue[] = [];
    const fail = (path: string, message: string) => { errors.push({ path, message }); };
    const content = (path: string, message: string) => { if (mode === 'publish') fail(path, message); };
    const obj = (value: unknown, path: string, keys: string[]): Record<string, unknown> => {
        if (!record(value)) { fail(path, 'Expected an object.'); return {}; }
        for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, 'Unsupported field.');
        return value;
    };
    const str = (value: unknown, path: string, max = 6000, required = true): string => {
        if (typeof value !== 'string') { fail(path, 'Expected text.'); return ''; }
        if (value.length > max) fail(path, `Use at most ${max} characters.`);
        if (required && !value.trim()) content(path, 'Text is required.');
        return value;
    };
    const id = (value: unknown, path: string) => {
        const result = str(value, path, 64);
        if (!missionId(result)) fail(path, 'Use a lowercase ID starting with a letter, with letters, digits or hyphens.');
        return result;
    };
    const list = (value: unknown, path: string, max: number): unknown[] => {
        if (!Array.isArray(value)) { fail(path, 'Expected a list.'); return []; }
        if (value.length > max) { fail(path, `Use at most ${max} items.`); return value.slice(0, max); }
        return value;
    };
    const boolean = (value: unknown, path: string) => {
        if (typeof value !== 'boolean') fail(path, 'Expected true or false.');
        return value === true;
    };
    const clues = (value: unknown, path: string): Record<string, string> => {
        if (!record(value)) { fail(path, 'Expected role IDs mapped to clue text.'); return {}; }
        if (Object.keys(value).length > 20) fail(path, 'Use at most 20 role clues.');
        return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, text]) => [id(key, `${path}.${key}`), str(text, `${path}.${key}`)]));
    };
    try {
        if (new TextEncoder().encode(JSON.stringify(input)).length > MISSION_MAX_BYTES) {
            fail('file', 'Campaign exceeds the 512 KB limit.'); return { campaign: null, errors, warnings };
        }
    } catch { fail('file', 'Campaign must be JSON data.'); return { campaign: null, errors, warnings }; }
    const envelope = obj(input, 'file', ['format', 'schemaVersion', 'campaign']);
    if (envelope.format !== 'pixel-plaza-campaign') fail('format', 'Expected pixel-plaza-campaign.');
    if (envelope.schemaVersion !== 1 && envelope.schemaVersion !== 2) fail('schemaVersion', 'Only schema versions 1 and 2 are supported.');
    const raw = obj(envelope.campaign, 'campaign', ['id', 'title', 'roles', 'chapters', 'finale']);
    const roles: Role[] = list(raw.roles, 'roles', 20).map((value, i) => {
        const path = `roles[${i}]`;
        const r = obj(value, path, ['id', 'name', 'card', 'clue']);
        return { id: id(r.id, `${path}.id`), name: str(r.name, `${path}.name`, 120), card: str(r.card, `${path}.card`), clue: str(r.clue, `${path}.clue`) };
    });
    const chapters: Chapter[] = list(raw.chapters, 'chapters', 20).map((value, i) => {
        const path = `chapters[${i}]`;
        const c = obj(value, path, ['id', 'title', 'intro', 'recap', 'ending', 'share', 'objectives', 'discoveries', 'reveals', 'roleClues', 'thieves']);
        const objectives: Objective[] = list(c.objectives, `${path}.objectives`, 100).map((value, j) => {
            const p = `${path}.objectives[${j}]`;
            const o = obj(value, p, ['id', 'text', 'accept', 'answerThief', 'thiefKnows', 'answerRole', 'kind', 'after', 'optional', 'rewards', 'requires', 'board', 'activity']);
            const result: Objective = { id: id(o.id, `${p}.id`), text: str(o.text, `${p}.text`), accept: list(o.accept, `${p}.accept`, 30).map((v, k) => str(v, `${p}.accept[${k}]`, 120)) };
            for (const key of ['answerThief', 'thiefKnows', 'optional'] as const) if (o[key] !== undefined) result[key] = boolean(o[key], `${p}.${key}`);
            for (const key of ['after', 'answerRole'] as const) if (o[key] !== undefined) result[key] = id(o[key], `${p}.${key}`);
            if (o.kind !== undefined) { if (o.kind !== 'report') fail(`${p}.kind`, 'Only report is supported; omit kind for typed or name answers.'); else result.kind = 'report'; }
            if (o.rewards !== undefined) result.rewards = clues(o.rewards, `${p}.rewards`);
            if (o.requires !== undefined || o.board !== undefined || o.activity !== undefined) {
                if (envelope.schemaVersion !== 2) fail(p, 'Graph prerequisites and board quests require schema version 2.');
            }
            if (o.requires !== undefined) {
                const r = obj(o.requires, `${p}.requires`, ['mode', 'objectives']);
                if (r.mode !== 'all' && r.mode !== 'any') fail(`${p}.requires.mode`, 'Choose all or any.');
                const ids = list(r.objectives, `${p}.requires.objectives`, 100).map((v, k) => id(v, `${p}.requires.objectives[${k}]`));
                if (!ids.length || new Set(ids).size !== ids.length) content(`${p}.requires.objectives`, 'Choose distinct prerequisite objectives.');
                result.requires = { mode: r.mode === 'any' ? 'any' : 'all', objectives: ids };
                if (result.after) content(p, 'Use after or requires, not both.');
            }
            if (o.activity !== undefined) {
                if (o.activity !== 'interview' && o.activity !== 'exchange') fail(`${p}.activity`, 'Choose interview or exchange.');
                else result.activity = o.activity;
            }
            if (o.board !== undefined) {
                const b = obj(o.board, `${p}.board`, ['roles', 'afterMain', 'minPlayers', 'teacherReleased', 'partnerRole', 'differentRole']);
                result.board = {};
                if (b.roles !== undefined) result.board.roles = list(b.roles, `${p}.board.roles`, 20).map((v, k) => id(v, `${p}.board.roles[${k}]`));
                for (const key of ['afterMain', 'teacherReleased', 'differentRole'] as const) if (b[key] !== undefined) result.board[key] = boolean(b[key], `${p}.board.${key}`);
                if (b.partnerRole !== undefined) result.board.partnerRole = id(b.partnerRole, `${p}.board.partnerRole`);
                if (b.minPlayers !== undefined) {
                    if (typeof b.minPlayers !== 'number' || !Number.isInteger(b.minPlayers) || b.minPlayers < 1 || b.minPlayers > 40) fail(`${p}.board.minPlayers`, 'Choose between 1 and 40 online students.');
                    else result.board.minPlayers = b.minPlayers;
                }
            }
            return result;
        });
        const share = typeof c.share === 'number' ? c.share : NaN;
        if (!Number.isFinite(share) || share <= 0 || share > 1) fail(`${path}.share`, 'Readiness share must be greater than zero and at most 1.');
        const chapter: Chapter = { id: id(c.id, `${path}.id`), title: str(c.title, `${path}.title`, 120), intro: str(c.intro, `${path}.intro`), recap: str(c.recap, `${path}.recap`), ending: str(c.ending, `${path}.ending`), share, objectives,
            discoveries: list(c.discoveries, `${path}.discoveries`, 100).map((value, j) => {
                const p = `${path}.discoveries[${j}]`; const d = obj(value, p, ['id', 'zone', 'text']);
                return { id: id(d.id, `${p}.id`), zone: id(d.zone, `${p}.zone`), text: str(d.text, `${p}.text`) };
            }),
            reveals: list(c.reveals, `${path}.reveals`, 100).map((value, j) => {
                const p = `${path}.reveals[${j}]`; const r = obj(value, p, ['id', 'text']);
                return { id: id(r.id, `${p}.id`), text: str(r.text, `${p}.text`) };
            }) };
        if (c.roleClues !== undefined) chapter.roleClues = clues(c.roleClues, `${path}.roleClues`);
        if (c.thieves !== undefined) {
            const t = obj(c.thieves, `${path}.thieves`, ['card', 'story', 'label', 'carry']);
            chapter.thieves = { card: str(t.card, `${path}.thieves.card`), story: str(t.story, `${path}.thieves.story`) };
            if (t.label !== undefined) chapter.thieves.label = str(t.label, `${path}.thieves.label`, 120);
            if (t.carry !== undefined) chapter.thieves.carry = boolean(t.carry, `${path}.thieves.carry`);
        }
        return chapter;
    });
    const campaign: Campaign = { id: id(raw.id, 'campaign.id'), title: str(raw.title, 'campaign.title', 120), finale: str(raw.finale, 'campaign.finale'), roles, chapters };
    const unique = (ids: string[], path: string) => { if (new Set(ids).size !== ids.length) fail(path, 'IDs must be unique.'); };
    unique(roles.map(r => r.id), 'roles'); unique(chapters.map(c => c.id), 'chapters');
    // Progress arrays and report rows are campaign-wide, not scoped to a chapter.
    unique(chapters.flatMap(c => [...c.objectives, ...c.discoveries, ...c.reveals].map(o => o.id)), 'chapters.items');
    if (!roles.length) content('roles', 'Add at least one role.');
    if (!chapters.length) content('chapters', 'Add at least one chapter.');
    const roleIds = new Set(roles.map(r => r.id));
    const zones = new Set(plazaMap.zones.map(z => z.id));
    chapters.forEach((c, i) => {
        const path = `chapters[${i}]`; const byId = new Map(c.objectives.map(o => [o.id, o]));
        if (!c.objectives.some(o => !o.optional)) content(`${path}.objectives`, 'Add at least one main objective.');
        if (!c.objectives.some(o => !o.optional && isUnlocked(o, []))) content(`${path}.objectives`, 'A main objective must be available at the start.');
        for (const [j, o] of c.objectives.entries()) {
            const p = `${path}.objectives[${j}]`;
            for (const id of prerequisiteIds(o)) {
                const prerequisite = byId.get(id);
                if (!prerequisite) content(`${p}.requires`, 'Prerequisite must be an objective in this chapter.');
                if (!o.optional && prerequisite?.optional) content(`${p}.requires`, 'Optional quests cannot gate the main story.');
            }
            const visiting = new Set<string>(); const visited = new Set<string>();
            const cycle = (id: string): boolean => {
                if (visiting.has(id)) return true;
                if (visited.has(id)) return false;
                visiting.add(id);
                if (prerequisiteIds(byId.get(id) ?? { id, text: '', accept: [] }).some(cycle)) return true;
                visiting.delete(id); visited.add(id); return false;
            };
            if (cycle(o.id)) content(`${p}.requires`, 'Prerequisites contain a cycle.');
            if (o.answerRole && !roleIds.has(o.answerRole)) content(`${p}.answerRole`, 'Role does not exist.');
            if ([!!o.answerRole, !!o.answerThief, o.kind === 'report'].filter(Boolean).length > 1) content(p, 'Choose one answer mode.');
            if (!o.answerRole && !o.answerThief && !o.kind && !o.accept.some(a => a.trim())) content(`${p}.accept`, 'Add an accepted answer.');
            if ((o.kind || o.answerRole || o.answerThief) && o.accept.length) content(`${p}.accept`, 'Dynamic names and reports must have an empty accepted-answer list.');
            if ((o.answerThief || o.thiefKnows) && !c.thieves) content(p, 'This objective requires a thief chapter.');
            if (o.board) {
                if (!o.optional) content(`${p}.board`, 'Board quests must be optional.');
                if (o.answerThief || o.thiefKnows) content(`${p}.board`, 'Board quests cannot use thief-specific answer exclusions.');
                for (const role of o.board.roles ?? []) if (!roleIds.has(role)) content(`${p}.board.roles`, 'Audience role does not exist.');
                if (o.board.partnerRole && !roleIds.has(o.board.partnerRole)) content(`${p}.board.partnerRole`, 'Partner role does not exist.');
                if (o.board.partnerRole && !o.activity) content(`${p}.board.partnerRole`, 'Partner roles require a social activity.');
                if (o.board.differentRole && !o.activity) content(`${p}.board.differentRole`, 'Different-role partners require a social activity.');
                if (o.board.differentRole && roles.length < 2) content(`${p}.board.differentRole`, 'Different-role partners require at least two campaign roles.');
                if (o.board.differentRole && o.board.partnerRole && o.board.roles?.length && o.board.roles.every(role => role === o.board?.partnerRole)) content(`${p}.board`, 'The partner role must differ from the audience role.');
            }
            if (o.activity && (!o.board || o.kind !== 'report' || o.answerRole || o.answerThief)) content(`${p}.activity`, 'Social activities require an optional board quest with report answers.');
            for (const role of Object.keys(o.rewards ?? {})) if (!roleIds.has(role)) content(`${p}.rewards.${role}`, 'Role does not exist.');
        }
        for (const role of Object.keys(c.roleClues ?? {})) if (!roleIds.has(role)) content(`${path}.roleClues.${role}`, 'Role does not exist.');
        c.discoveries.forEach((d, j) => { if (!zones.has(d.zone)) content(`${path}.discoveries[${j}].zone`, 'Choose a zone on the current map.'); });
        if (c.thieves?.carry && (i === 0 || !chapters[i - 1].thieves)) content(`${path}.thieves.carry`, 'Carry requires a preceding thief chapter.');
    });
    warnings.push({ path: 'roles', message: `This campaign uses ${roles.length} roles. Check clue coverage for small groups and absences; prose clues cannot be verified automatically.` });
    return { campaign: errors.length ? null : campaign, errors, warnings };
}

export function parseMission(text: string, mode: 'draft' | 'publish' = 'publish'): MissionValidation {
    if (new TextEncoder().encode(text).length > MISSION_MAX_BYTES) return { campaign: null, errors: [{ path: 'file', message: 'File exceeds the 512 KB limit.' }], warnings: [] };
    try { return validateMission(JSON.parse(text), mode); }
    catch { return { campaign: null, errors: [{ path: 'file', message: 'Invalid JSON. Paste or upload the campaign JSON object.' }], warnings: [] }; }
}
