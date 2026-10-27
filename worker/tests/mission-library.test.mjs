import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MissionRepository, readCopy } from '../missions.ts';
import { missionEnvelope } from '../../shared/missionSchema.ts';
import { missionOverview, matchingChapters } from '../../shared/missionOverview.ts';
import { castanyada, castanyadaSideQuests, castanyadaComplete, castanyadaInvestigations, plazaFreePlay } from './fixtures/season-1.mjs';

function repository(t, legacy = false) {
    const db = new DatabaseSync(':memory:'); t.after(() => db.close());
    db.exec('CREATE TABLE campaigns (campaign_id TEXT, revision_id TEXT)');
    if (legacy) db.exec('CREATE TABLE mission_drafts (campaign_id TEXT PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL, published_revision TEXT, updated INTEGER NOT NULL)');
    const sql = { exec(query, ...args) {
        if (!args.length && query.includes(';')) { db.exec(query); return { toArray: () => [] }; }
        const statement = db.prepare(query);
        return { toArray: () => statement.columns().length ? statement.all(...args) : (statement.run(...args), []) };
    } };
    // Production executes mutations immediately, even when their cursor is unused.
    const eager = { exec(query, ...args) { const rows = sql.exec(query, ...args).toArray(); return { toArray: () => rows }; } };
    const repo = new MissionRepository(eager); repo.initialize();
    return repo;
}

test('mission descriptions distinguish stories, overlapping variants and the empty free-play starter', () => {
    const base = missionOverview(castanyada), side = missionOverview(castanyadaSideQuests), full = missionOverview(castanyadaComplete), witness = missionOverview(castanyadaInvestigations), free = missionOverview(plazaFreePlay);
    assert.deepEqual([base.main, base.bonus, base.board], [9, 6, 0]);
    assert.equal(side.board, 2); assert.equal(matchingChapters(base, side), 3);
    assert.equal(full.board, 10); assert.equal(matchingChapters(full, witness), 5);
    assert.equal(witness.witnesses, 17); assert.equal(full.witnesses, 0);
    assert.equal(free.kind, 'Quest session starter'); assert.equal(free.needsQuests, 8); assert.equal(free.board, 0);
    const edited = structuredClone(castanyada); edited.chapters[0].objectives[0].text = 'A different question';
    assert.equal(matchingChapters(missionOverview(edited), base), 0, 'comparison comes from content rather than the original template ID');
});

test('Trash migrates existing storage, preserves pinned revisions, rejects stale writes and supports restore', t => {
    const repo = repository(t, true); repo.load([castanyada]); repo.initialize();
    const initial = repo.draft(castanyada.id);
    const removed = repo.execute('delete', { id: castanyada.id, version: initial.version });
    assert.equal(removed.draft.deleted, true); assert.equal(removed.library.length, 0); assert.equal(removed.trash.length, 1);
    assert.equal(repo.latest(castanyada.id), null); assert.deepEqual(repo.published(), []);
    assert.deepEqual(repo.revision(initial.publishedRevision), castanyada, 'running games can still read their pinned revision');
    assert.equal(repo.execute('restore', { id: castanyada.id, version: initial.version }).status, 409);
    assert.equal(repo.execute('save', { id: castanyada.id, version: removed.draft.version, envelope: missionEnvelope(castanyada) }).status, 409);
    assert.equal(repo.execute('publish', { id: castanyada.id, version: removed.draft.version }).status, 409);
    repo.load([castanyada]); assert.equal(repo.list().length, 0, 'loading built-in files never resurrects a deleted mission');
    const restored = repo.execute('restore', { id: castanyada.id, version: removed.draft.version });
    assert.equal(restored.draft.deleted, false); assert.equal(restored.library.length, 1); assert.equal(restored.trash.length, 0);
    assert.equal(repo.latest(castanyada.id).revision, initial.publishedRevision);
});

test('deletion and restoration propagate both ways between the laptop and online library', t => {
    const online = repository(t), laptop = repository(t); online.load([castanyada]);
    laptop.downloaded(online.changes({}, []));
    const send = () => { for (const { copy, base } of laptop.outbox()) laptop.uploaded(copy, online.receive(readCopy(copy), base)); };
    const pull = () => { const known = laptop.known(); laptop.downloaded(online.changes(known.have, known.revisions)); };
    laptop.execute('delete', { id: castanyada.id, version: laptop.draft(castanyada.id).version });
    assert.equal(laptop.waiting(), 1); send(); pull();
    assert.equal(laptop.waiting(), 0); assert.equal(online.list().length, 0); assert.equal(laptop.list(true).length, 1);
    online.execute('restore', { id: castanyada.id, version: online.draft(castanyada.id).version }); pull();
    assert.equal(laptop.list().length, 1); assert.equal(laptop.list(true).length, 0);
    online.execute('delete', { id: castanyada.id, version: online.draft(castanyada.id).version }); pull();
    assert.equal(laptop.list().length, 0);
    laptop.execute('restore', { id: castanyada.id, version: laptop.draft(castanyada.id).version }); send(); pull();
    assert.equal(online.list().length, 1); assert.equal(laptop.list().length, 1);
    const copy = online.changes({}, [])[0];
    assert.equal(readCopy({ ...copy, deleted: 'false' }), null, 'untrusted deletion flags must be boolean');
});

test('an offline deletion does not overwrite a newer online edit', t => {
    const online = repository(t), laptop = repository(t); online.load([castanyada]); laptop.downloaded(online.changes({}, []));
    laptop.execute('delete', { id: castanyada.id, version: laptop.draft(castanyada.id).version });
    const current = online.draft(castanyada.id);
    online.execute('save', { id: castanyada.id, version: current.version, envelope: missionEnvelope({ ...current.campaign, title: 'Edited online' }) });
    const { copy, base } = laptop.outbox()[0]; const result = online.receive(copy, base); laptop.uploaded(copy, result);
    const known = laptop.known(); laptop.downloaded(online.changes(known.have, known.revisions));
    assert.equal(result.outcome, 'kept-both');
    assert.equal(laptop.list()[0].title, 'Edited online'); assert.equal(online.list()[0].title, 'Edited online');
    assert.equal(laptop.list(true).length, 1); assert.equal(online.list(true).length, 1);
});
