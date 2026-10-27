import type { Campaign } from '../shared/campaign.ts';
import { MISSION_MAX_BYTES, missionEnvelope, missionId, validateMission, type MissionIssue } from '../shared/missionSchema.ts';
import type { CampaignChoice, MissionCopy, MissionDraft, MissionPushResult, MissionSummary } from '../shared/missionTypes.ts';

export type MissionResult = { library?: MissionSummary[]; draft?: MissionDraft; revision?: string; errors?: MissionIssue[]; warnings?: MissionIssue[] } | { error: string; status: number; errors?: MissionIssue[] };
// Missions are offered in the order they were first made, so editing one does not move it. Before missions were data,
// the first five came with the app; they keep the order teachers met them in: the shortest story first, then its
// longer and stricter versions, then free play. (Used once, when missions got an order.)
const FIRST_MISSIONS = ['castanyada', 'castanyada-side-quests', 'castanyada-complete', 'castanyada-investigations', 'plaza-free-play'];
type DraftRow = { campaign_id: string; content: string; version: number; published_revision: string | null; updated: number; created: number | null; synced: number | null };

// A mission sent by the teacher's laptop: the shape it must have, and content Mission Studio itself would accept.
export function readCopy(value: unknown): MissionCopy | null {
    const v = value as Partial<MissionCopy> | null;
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !missionId(v.id) || typeof v.content !== 'string' || v.content.length > MISSION_MAX_BYTES
        || !Number.isInteger(v.version) || !Number.isInteger(v.updated) || !Number.isInteger(v.created)
        || !(v.publishedRevision === null || (typeof v.publishedRevision === 'string' && v.publishedRevision.length <= 80))) return null;
    const read = (content: string, mode?: 'draft') => { try { return validateMission(missionEnvelope(JSON.parse(content)), mode).campaign; } catch { return null; } };
    if (read(v.content, 'draft')?.id !== v.id) return null;
    const r = v.revision as MissionCopy['revision'] | undefined;
    if (r !== null && (!r || typeof r.content !== 'string' || r.content.length > MISSION_MAX_BYTES || !Number.isInteger(r.published) || read(r.content)?.id !== v.id || !v.publishedRevision)) return null;
    return { id: v.id, content: v.content, version: v.version!, publishedRevision: v.publishedRevision, updated: v.updated!, created: v.created!, revision: r && { content: r.content, published: r.published } };
}

// The teacher's missions: an editable draft each, and every version ever published, which games keep using. On the
// online server this is the one home for missions; on the teacher's laptop it is a copy, kept in step by
// PlazaRoom.syncMissions with the methods at the end.
export class MissionRepository {
    private sql: SqlStorage;
    private revisions = new Map<string, Campaign>();
    constructor(sql: SqlStorage) { this.sql = sql; }

    initialize(): void {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS mission_drafts (
            campaign_id TEXT PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL,
            published_revision TEXT, updated INTEGER NOT NULL, created INTEGER, synced INTEGER);
            CREATE TABLE IF NOT EXISTS mission_revisions (
            revision_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, content TEXT NOT NULL, published INTEGER NOT NULL);`);
        const columns = this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('mission_drafts')").toArray().map(column => column.name);
        if (!columns.includes('created')) {
            this.sql.exec('ALTER TABLE mission_drafts ADD COLUMN created INTEGER');
            for (const row of this.sql.exec<{ id: string; position: number }>('SELECT campaign_id AS id, rowid AS position FROM mission_drafts').toArray()) {
                const first = FIRST_MISSIONS.indexOf(row.id);
                this.sql.exec('UPDATE mission_drafts SET created = ? WHERE campaign_id = ?', first >= 0 ? first + 1 : 100 + row.position, row.id);
            }
        }
        if (!columns.includes('synced')) this.sql.exec('ALTER TABLE mission_drafts ADD COLUMN synced INTEGER');
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('campaigns')").toArray().some(c => c.name === 'revision_id')) {
            this.sql.exec('ALTER TABLE campaigns ADD COLUMN revision_id TEXT');
        }
        this.pinOldGames();
    }
    // Games from before published versions existed play the first version of their mission, once it is here (it may
    // arrive later, from a file or the online server). Never repinned to a later teacher edit.
    private pinOldGames(): void {
        this.sql.exec(`UPDATE campaigns SET revision_id = (SELECT revision_id FROM mission_revisions r WHERE r.campaign_id = campaigns.campaign_id ORDER BY published, rowid LIMIT 1)
            WHERE revision_id IS NULL AND EXISTS (SELECT 1 FROM mission_revisions r WHERE r.campaign_id = campaigns.campaign_id)`);
    }

    list(): MissionSummary[] {
        return this.sql.exec<MissionSummary>(`SELECT campaign_id AS id, json_extract(content, '$.title') AS title,
            version, published_revision AS publishedRevision, updated FROM mission_drafts ORDER BY updated DESC, campaign_id`).toArray();
    }
    draft(id: string): MissionDraft | null {
        const row = this.row(id);
        return row ? { campaign: JSON.parse(row.content), version: row.version, publishedRevision: row.published_revision, updated: row.updated } : null;
    }
    revision(id: string | null): Campaign | undefined {
        if (!id) return undefined;
        const cached = this.revisions.get(id);
        if (cached) return cached;
        const row = this.sql.exec<{ content: string }>('SELECT content FROM mission_revisions WHERE revision_id = ?', id).toArray()[0];
        if (!row) return undefined;
        const campaign: Campaign = JSON.parse(row.content);
        if (this.revisions.size >= 10) this.revisions.delete(this.revisions.keys().next().value!);
        this.revisions.set(id, campaign);
        return campaign;
    }
    published(): CampaignChoice[] {
        return this.sql.exec<{ revision: string }>('SELECT published_revision AS revision FROM mission_drafts WHERE published_revision IS NOT NULL ORDER BY created, campaign_id').toArray()
            .flatMap(({ revision }) => {
                const campaign = this.revision(revision);
                if (!campaign) return [];
                const objectives = campaign.chapters.flatMap(chapter => chapter.objectives);
                return [{ id: campaign.id, title: campaign.title, revision, chapters: campaign.chapters.map(chapter => chapter.title),
                    mystery: objectives.some(objective => objective.answerThief), partnerQuests: objectives.some(objective => objective.board),
                    witnesses: objectives.some(objective => objective.conversation) }];
            });
    }
    latest(id: string): { campaign: Campaign; revision: string } | null {
        const revision = this.sql.exec<{ published_revision: string | null }>('SELECT published_revision FROM mission_drafts WHERE campaign_id = ?', id).toArray()[0]?.published_revision;
        const campaign = this.revision(revision ?? null);
        return campaign && revision ? { campaign, revision } : null;
    }
    execute(op: string, body: unknown): MissionResult {
        const b = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
        if (op === 'list') return { library: this.list() };
        const id = typeof b.id === 'string' ? b.id : '';
        if (!missionId(id)) return { error: 'Choose a valid campaign ID.', status: 400 };
        const existing = this.draft(id);
        if (op === 'get') return existing ? { draft: existing } : { error: 'Campaign not found.', status: 404 };
        if (op === 'create') {
            if (existing) return { error: 'That campaign ID already exists.', status: 409 };
            if (this.list().length >= 100) return { error: 'The library limit is 100 campaigns.', status: 400 };
            const source = typeof b.source === 'string' ? this.draft(b.source)?.campaign : undefined;
            if (b.source !== undefined && !source) return { error: 'Template not found.', status: 404 };
            const campaign: Campaign = source ? { ...source, id, title: `${source.title.slice(0, 110)} (copy)` } : {
                id, title: 'New campaign', finale: 'The adventure ends.', roles: [{ id: 'witness', name: 'Witness', card: 'You know something about the mystery.', clue: 'The missing object is at the hotel.' }],
                chapters: [{ id: 'chapter-1', title: 'Chapter 1', intro: 'Find the missing object.', recap: 'You are investigating a mystery.', ending: 'The object is found.', share: 0.6,
                    objectives: [{ id: 'find-object', text: 'Where is the missing object?', accept: ['hotel'] }], discoveries: [], reveals: [] }]
            };
            this.sql.exec('INSERT INTO mission_drafts (campaign_id, content, version, updated, created) VALUES (?, ?, 1, ?, ?)', id, JSON.stringify(campaign), Date.now(), Date.now());
            return { draft: this.draft(id)!, library: this.list() };
        }
        if (!existing) return { error: 'Campaign not found.', status: 404 };
        if (op !== 'save' && op !== 'publish') return { error: 'Unknown Mission Studio action.', status: 400 };
        if (!Number.isInteger(b.version) || b.version !== existing.version) return { error: 'This draft changed in another tab. Export your edits, then reopen it before saving.', status: 409 };
        if (op === 'save') {
            const checked = validateMission(b.envelope, 'draft');
            if (!checked.campaign) return { error: 'Draft has invalid fields.', errors: checked.errors, status: 400 };
            if (checked.campaign.id !== id) return { error: 'The campaign ID cannot change after creation.', status: 400 };
            this.sql.exec('UPDATE mission_drafts SET content = ?, version = version + 1, updated = ? WHERE campaign_id = ? AND version = ?', JSON.stringify(checked.campaign), Date.now(), id, existing.version);
            return { draft: this.draft(id)!, library: this.list() };
        }
        const checked = validateMission(missionEnvelope(existing.campaign));
        if (!checked.campaign) return { error: 'Fix validation errors before publishing.', errors: checked.errors, status: 400 };
        const revision = crypto.randomUUID();
        this.sql.exec('INSERT INTO mission_revisions (revision_id, campaign_id, content, published) VALUES (?, ?, ?, ?)', revision, id, JSON.stringify(checked.campaign), Date.now());
        this.sql.exec('UPDATE mission_drafts SET published_revision = ?, version = version + 1, updated = ? WHERE campaign_id = ?', revision, Date.now(), id);
        return { draft: this.draft(id)!, revision, warnings: checked.warnings, library: this.list() };
    }

    // Missions loaded from files into a server that lacks them (the tests, a new server's first content), published as
    // they come, in the order given, after the missions already here. Unedited, so a laptop's own copy of one can
    // replace it on first sync. Returns the IDs loaded.
    load(values: unknown): { loaded: string[] } | { error: string } {
        if (!Array.isArray(values) || values.length > 100) return { error: 'Missions come as a list.' };
        const campaigns: Campaign[] = [];
        for (const value of values) {
            const checked = validateMission(missionEnvelope(value as Campaign));
            if (!checked.campaign) return { error: `${(value as Campaign)?.id ?? 'A mission'}: ${checked.errors.map(issue => `${issue.path}: ${issue.message}`).join('; ')}` };
            campaigns.push(checked.campaign);
        }
        let order = this.sql.exec<{ last: number | null }>('SELECT MAX(created) AS last FROM mission_drafts').toArray()[0]?.last ?? 0;
        const loaded = campaigns.filter(campaign => !this.row(campaign.id)).map(campaign => {
            const content = JSON.stringify(campaign); const revision = crypto.randomUUID();
            this.sql.exec('INSERT INTO mission_revisions (revision_id, campaign_id, content, published) VALUES (?, ?, ?, 0)', revision, campaign.id, content);
            this.sql.exec('INSERT INTO mission_drafts (campaign_id, content, version, published_revision, updated, created) VALUES (?, ?, 1, ?, 0, ?)', campaign.id, content, revision, ++order);
            return campaign.id;
        });
        this.pinOldGames();
        return { loaded };
    }

    // ---------- In step with the online server ----------

    private row(id: string): DraftRow | undefined {
        return this.sql.exec<DraftRow>('SELECT * FROM mission_drafts WHERE campaign_id = ?', id).toArray()[0];
    }
    private copyOf(row: DraftRow, withRevision = true): MissionCopy {
        const revision = withRevision && row.published_revision
            ? this.sql.exec<{ content: string; published: number }>('SELECT content, published FROM mission_revisions WHERE revision_id = ?', row.published_revision).toArray()[0] ?? null : null;
        return { id: row.campaign_id, content: row.content, version: row.version, publishedRevision: row.published_revision, updated: row.updated, created: row.created ?? 0, revision };
    }
    private keepRevision(copy: MissionCopy): string | null {
        if (!copy.publishedRevision || !copy.revision) return null;
        const here = this.sql.exec<{ content: string }>('SELECT content FROM mission_revisions WHERE revision_id = ?', copy.publishedRevision).toArray()[0];
        if (here?.content === copy.revision.content) return copy.publishedRevision;
        // A published version never changes: different content under a name already used gets a name of its own.
        const id = here ? crypto.randomUUID() : copy.publishedRevision;
        this.sql.exec('INSERT INTO mission_revisions (revision_id, campaign_id, content, published) VALUES (?, ?, ?, ?)', id, copy.id, copy.revision.content, copy.revision.published);
        return id;
    }

    // Online: a laptop's copy of one mission, edited from the server's version `base` (null: never uploaded). It replaces
    // the server's when nothing changed here since, or when nobody ever edited the server's. When both changed, both are
    // kept: the laptop's becomes a new mission marked "(laptop)", and nothing is lost.
    receive(copy: MissionCopy, base: number | null): MissionPushResult {
        const here = this.row(copy.id);
        const revisionHere = here?.published_revision
            ? this.sql.exec<{ content: string }>('SELECT content FROM mission_revisions WHERE revision_id = ?', here.published_revision).toArray()[0]?.content : undefined;
        if (here && here.content === copy.content && revisionHere === copy.revision?.content) return { outcome: 'saved', version: here.version, publishedRevision: here.published_revision };
        if (!here || (base === null ? here.updated === 0 : base === here.version)) {
            const published = this.keepRevision(copy);
            const version = here ? Math.max(copy.version, here.version + 1) : copy.version;
            this.sql.exec(`INSERT INTO mission_drafts (campaign_id, content, version, published_revision, updated, created) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (campaign_id) DO UPDATE SET content = excluded.content, version = excluded.version, published_revision = excluded.published_revision, updated = excluded.updated`,
                copy.id, copy.content, version, published, copy.updated, copy.created);
            this.pinOldGames();
            return { outcome: 'saved', version, publishedRevision: published };
        }
        let id = `${copy.id.slice(0, 50)}-laptop`;
        for (let n = 2; this.row(id); n++) id = `${copy.id.slice(0, 50)}-laptop-${n}`;
        const campaign: Campaign = { ...JSON.parse(copy.content), id };
        campaign.title = `${campaign.title.slice(0, 110)} (laptop)`;
        const content = JSON.stringify(campaign);
        this.sql.exec('INSERT INTO mission_drafts (campaign_id, content, version, updated, created) VALUES (?, ?, 1, ?, ?)', id, content, Date.now(), Date.now());
        return { outcome: 'kept-both', version: here.version, publishedRevision: here.published_revision, copy: { id, content } };
    }

    // Online: what a laptop is missing. `have` is the version of each mission it holds, `revisions` the published
    // versions it already has, so they are not sent again.
    changes(have: Record<string, number>, revisions: readonly string[]): MissionCopy[] {
        const known = new Set(revisions);
        return this.sql.exec<DraftRow>('SELECT * FROM mission_drafts ORDER BY created, campaign_id').toArray()
            .filter(row => have[row.campaign_id] !== row.version)
            .map(row => this.copyOf(row, !row.published_revision || !known.has(row.published_revision)));
    }

    // On the laptop: the missions to upload: changed here since the last sync, or never uploaded.
    outbox(): { copy: MissionCopy; base: number | null }[] {
        return this.sql.exec<DraftRow>('SELECT * FROM mission_drafts WHERE synced IS NULL OR synced <> version ORDER BY created, campaign_id').toArray()
            .map(row => ({ copy: this.copyOf(row), base: row.synced }));
    }
    waiting(): number {
        return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM mission_drafts WHERE synced IS NULL OR synced <> version').toArray()[0].n;
    }
    // On the laptop: what the online server made of an upload. A draft edited again while it travelled stays waiting.
    uploaded(sent: MissionCopy, result: MissionPushResult): void {
        const here = this.row(sent.id);
        if (!here) return;
        if (result.outcome === 'kept-both' && result.copy) {
            // The server kept its own version under this name; this laptop's lives on as the copy, and the server's
            // version arrives with the next download.
            this.sql.exec('UPDATE mission_drafts SET campaign_id = ?, content = ?, version = 1, synced = 1, published_revision = NULL, updated = ?, created = ? WHERE campaign_id = ? AND version = ?',
                result.copy.id, result.copy.content, Date.now(), Date.now(), sent.id, sent.version);
            return;
        }
        if (result.publishedRevision && result.publishedRevision !== sent.publishedRevision && sent.revision) {
            this.sql.exec('INSERT OR IGNORE INTO mission_revisions (revision_id, campaign_id, content, published) VALUES (?, ?, ?, ?)',
                result.publishedRevision, sent.id, sent.revision.content, sent.revision.published);
        }
        if (here.version === sent.version) {
            this.sql.exec('UPDATE mission_drafts SET version = ?, synced = ?, published_revision = ? WHERE campaign_id = ?', result.version, result.version, result.publishedRevision, sent.id);
        } else if (result.version === sent.version) this.sql.exec('UPDATE mission_drafts SET synced = ? WHERE campaign_id = ?', result.version, sent.id);
    }
    // On the laptop: what it holds, to ask the online server only for what changed.
    known(): { have: Record<string, number>; revisions: string[] } {
        const have = Object.fromEntries(this.sql.exec<{ id: string; synced: number }>('SELECT campaign_id AS id, synced FROM mission_drafts WHERE synced IS NOT NULL').toArray().map(row => [row.id, row.synced]));
        return { have, revisions: this.sql.exec<{ id: string }>('SELECT revision_id AS id FROM mission_revisions').toArray().map(row => row.id) };
    }
    // On the laptop: missions from the online server. One changed here and not uploaded yet waits for its upload.
    downloaded(copies: readonly MissionCopy[]): void {
        for (const copy of copies) {
            const here = this.row(copy.id);
            if (here && (here.synced === null || here.synced !== here.version)) continue;
            if (copy.publishedRevision && copy.revision) {
                this.sql.exec('INSERT OR IGNORE INTO mission_revisions (revision_id, campaign_id, content, published) VALUES (?, ?, ?, ?)',
                    copy.publishedRevision, copy.id, copy.revision.content, copy.revision.published);
            }
            this.sql.exec(`INSERT INTO mission_drafts (campaign_id, content, version, published_revision, updated, created, synced) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (campaign_id) DO UPDATE SET content = excluded.content, version = excluded.version, published_revision = excluded.published_revision,
                updated = excluded.updated, created = excluded.created, synced = excluded.synced`,
                copy.id, copy.content, copy.version, copy.publishedRevision, copy.updated, copy.created, copy.version);
        }
        this.pinOldGames();
    }
}
