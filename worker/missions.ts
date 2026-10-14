import { campaigns, type Campaign } from '../shared/campaign.ts';
import { missionEnvelope, missionId, validateMission, type MissionIssue } from '../shared/missionSchema.ts';
import type { MissionDraft, MissionSummary } from '../shared/missionTypes.ts';

export type MissionResult = { library?: MissionSummary[]; draft?: MissionDraft; revision?: string; errors?: MissionIssue[]; warnings?: MissionIssue[] } | { error: string; status: number; errors?: MissionIssue[] };
type DraftRow = { campaign_id: string; content: string; version: number; published_revision: string | null; updated: number };

export class MissionRepository {
    private sql: SqlStorage;
    private revisions = new Map<string, Campaign>();
    constructor(sql: SqlStorage) { this.sql = sql; }

    initialize(): void {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS mission_drafts (
            campaign_id TEXT PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL,
            published_revision TEXT, updated INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS mission_revisions (
            revision_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, content TEXT NOT NULL, published INTEGER NOT NULL);`);
        for (const campaign of campaigns) {
            const revision = `builtin-${campaign.id}-v1`;
            const content = JSON.stringify(campaign);
            this.sql.exec('INSERT OR IGNORE INTO mission_revisions (revision_id, campaign_id, content, published) VALUES (?, ?, ?, 0)', revision, campaign.id, content);
            this.sql.exec('INSERT OR IGNORE INTO mission_drafts (campaign_id, content, version, published_revision, updated) VALUES (?, ?, 1, ?, 0)', campaign.id, content, revision);
        }
        if (!this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('campaigns')").toArray().some(c => c.name === 'revision_id')) {
            this.sql.exec('ALTER TABLE campaigns ADD COLUMN revision_id TEXT');
        }
        // Snapshot existing built-in games once. Never repin them to a later teacher edit.
        for (const campaign of campaigns) this.sql.exec('UPDATE campaigns SET revision_id = ? WHERE campaign_id = ? AND revision_id IS NULL', `builtin-${campaign.id}-v1`, campaign.id);
    }

    list(): MissionSummary[] {
        return this.sql.exec<MissionSummary>(`SELECT campaign_id AS id, json_extract(content, '$.title') AS title,
            version, published_revision AS publishedRevision, updated FROM mission_drafts ORDER BY updated DESC, campaign_id`).toArray();
    }
    draft(id: string): MissionDraft | null {
        const row = this.sql.exec<DraftRow>('SELECT * FROM mission_drafts WHERE campaign_id = ?', id).toArray()[0];
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
    published(): { id: string; title: string }[] {
        return this.sql.exec<{ id: string; title: string }>(`SELECT d.campaign_id AS id, json_extract(r.content, '$.title') AS title
            FROM mission_drafts d JOIN mission_revisions r ON d.published_revision = r.revision_id ORDER BY d.updated DESC, d.campaign_id`).toArray();
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
            this.sql.exec('INSERT INTO mission_drafts (campaign_id, content, version, updated) VALUES (?, ?, 1, ?)', id, JSON.stringify(campaign), Date.now());
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
}
