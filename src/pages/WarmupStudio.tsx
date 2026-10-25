import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { WARMUP_KINDS, isWarmupKind, type WarmupKind } from '../../shared/warmupKinds';
import { defaultWarmup, validateWarmup, WARMUP_LEVELS, WARMUP_MAX_BYTES, type SavedWarmup, type WarmupDefinition } from '../../shared/warmupConfig';
import { readTeacherSession, storeTeacherSession } from '../teacherSession';
import { downloadFile } from '../themeFiles';
import '../components/Warmup.css';
import './MissionStudio.css';
import './WarmupStudio.css';

async function request(token: string, kind: WarmupKind, body?: object, signal?: AbortSignal): Promise<SavedWarmup> {
    const response = await fetch(`/api/teacher/warmup-editor?kind=${kind}`, { method: body ? 'POST' : 'GET',
        headers: { 'x-teacher-session': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'Could not load the warm-up.'), { status: response.status });
    return result;
}
const freshId = () => `entry-${crypto.randomUUID().slice(0, 8)}`;

export default function WarmupStudio() {
    const [params, setParams] = useSearchParams();
    const kind = isWarmupKind(params.get('kind')) ? params.get('kind') as WarmupKind : 'identity';
    const [token, setToken] = useState(readTeacherSession), [password, setPassword] = useState('');
    const [editor, setEditor] = useState<{ saved: SavedWarmup; draft: WarmupDefinition } | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [reload, setReload] = useState(0);
    const current = editor?.draft.kind === kind ? editor : null, draft = current?.draft;
    const dirty = !!current && JSON.stringify(current.draft) !== JSON.stringify(current.saved.definition);
    const problems = draft ? validateWarmup(draft).errors : [];
    const failed = (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Connection failed.');
        if ((cause as { status?: number }).status === 401) { storeTeacherSession(''); setToken(''); }
    };
    useEffect(() => {
        if (!token) return;
        const controller = new AbortController();
        void request(token, kind, undefined, controller.signal).then(saved => {
            if (!controller.signal.aborted) setEditor({ saved, draft: structuredClone(saved.definition) });
        }).catch(cause => { if (!controller.signal.aborted) { setError(cause.message); if (cause.status === 401) { storeTeacherSession(''); setToken(''); } } });
        return () => controller.abort();
    }, [token, kind, reload]);
    useEffect(() => {
        if (!dirty) return;
        const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
    }, [dirty]);
    const mayLeave = () => !dirty || window.confirm('Discard unsaved warm-up edits? Save or export them first to keep them.');
    const edit = (next: WarmupDefinition) => { if (current) setEditor({ ...current, draft: next }); setNotice(''); };
    const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work(); } catch (cause) { failed(cause); } finally { setBusy(false); } };
    const input = (label: string, value: string, onChange: (value: string) => void, maxLength = 80) => <label className="mission-field"><span>{label}</span><input value={value} maxLength={maxLength} onChange={e => onChange(e.target.value)} /></label>;
    return <main className="mission-page warmup-studio">
        <header className="mission-header"><div><p className="mission-eyebrow">PIXEL PLAZA · TEACHER WORKSPACE</p><h1>Warm-up editor</h1><p>Change the content while keeping each activity's assignments and rules.</p></div>
            <Link to="/teacher" onClick={event => { if (!mayLeave()) event.preventDefault(); }}>Teacher controls</Link></header>
        {error && <p className="mission-error" role="alert">{error}</p>}{notice && <p className="mission-notice" role="status">{notice}</p>}
        {!token ? <form className="mission-card" onSubmit={event => { event.preventDefault(); void run(async () => {
            const response = await fetch('/api/teacher/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
            const result = await response.json(); if (!response.ok) throw new Error(result.error);
            storeTeacherSession(result.token); setToken(result.token); setPassword('');
        }); }}><h2>Teacher sign-in</h2><label className="mission-field"><span>Teacher password</span><input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label><button className="mission-button primary" disabled={busy}>Open editor</button></form>
        : <fieldset className="warmup-editor-content" disabled={busy}>
            <section className="mission-card"><label className="mission-field"><span>Warm-up type</span><select aria-label="Warm-up type" value={kind} onChange={event => {
                if (!mayLeave()) return; setParams({ kind: event.target.value }); setError(''); setNotice('');
            }}>{WARMUP_KINDS.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
                <p>Saved changes apply to the next start or restart of this warm-up. A round already running keeps its original content.</p>
                <button className="mission-button" onClick={() => { if (mayLeave()) { setEditor(null); setError(''); setReload(n => n + 1); } }}>Reload saved version</button>
            </section>
            {!draft || !current ? !error && <p role="status">Loading the warm-up…</p> : <>
                <section className="mission-card">
                    <div className="mission-savebar"><strong>{dirty ? 'Unsaved changes' : `Saved · version ${current.saved.version}`}</strong><button className="mission-button primary" disabled={!dirty || problems.length > 0} onClick={() => void run(async () => {
                        const saved = await request(token, kind, { version: current.saved.version, definition: draft });
                        setEditor({ saved, draft: structuredClone(saved.definition) }); setNotice('Warm-up saved. Start or restart this type in Teacher controls to use it.');
                    })}>Save warm-up</button></div>
                    {input('Title', draft.title, value => edit({ ...draft, title: value }), 120)}
                    <label className="mission-field"><span>Language level</span><select value={draft.level} onChange={e => edit({ ...draft, level: e.target.value as WarmupDefinition['level'] })}>{WARMUP_LEVELS.map(level => <option key={level}>{level}</option>)}</select></label>
                    <label className="mission-field"><span>Student instructions</span><textarea rows={4} maxLength={2000} value={draft.instructions} onChange={e => edit({ ...draft, instructions: e.target.value })} /></label>
                    <p className="mission-muted">The level labels your activity. Write instructions suitable for your class. Automatic assignments, answer checks and identity protection stay enabled.</p>
                </section>
                <section className="mission-card">
                    {draft.kind === 'identity' && <><h2>Secret identities ({draft.identities.length})</h2><p>Include at least one identity per student, plus a few for late joiners. Accepted aliases work both for answers and secret-name protection.</p>
                        {draft.identities.map((identity, i) => <div className="warmup-editor-row" key={identity.id}>
                            {input(`Identity ${i + 1}`, identity.name, value => edit({ ...draft, identities: draft.identities.map((row, n) => n === i ? { ...row, name: value } : row) }))}
                            {input(`Aliases ${i + 1} (comma separated)`, identity.accept.join(','), value => edit({ ...draft, identities: draft.identities.map((row, n) => n === i ? { ...row, accept: value ? value.split(',') : [] } : row) }), 1600)}
                            <button className="mission-button danger" aria-label={`Remove identity ${i + 1}`} onClick={() => edit({ ...draft, identities: draft.identities.filter((_, n) => n !== i) })}>Remove</button>
                        </div>)}
                        <button className="mission-button" disabled={draft.identities.length >= 80} onClick={() => edit({ ...draft, identities: [...draft.identities, { id: freshId(), name: '', accept: [] }] })}>Add identity</button>
                    </>}
                    {draft.kind === 'facts' && <><h2>Facts ({draft.facts.length})</h2><label className="mission-field"><span>Facts to find per student (up to)</span><input aria-label="Facts to find" type="number" min={1} max={10} value={draft.rounds} onChange={e => edit({ ...draft, rounds: Number(e.target.value) })} /></label>
                        <p>Write a made-up fact for the student's card and its matching “Find someone who…” phrase. Only facts held by classmates will be assigned.</p>
                        {draft.facts.map((fact, i) => <div className="warmup-editor-row" key={fact.id}>
                            {input(`Your fact ${i + 1}`, fact.mine, value => edit({ ...draft, facts: draft.facts.map((row, n) => n === i ? { ...row, mine: value } : row) }), 300)}
                            {input(`Find someone who… ${i + 1}`, fact.find, value => edit({ ...draft, facts: draft.facts.map((row, n) => n === i ? { ...row, find: value } : row) }), 300)}
                            <button className="mission-button danger" aria-label={`Remove fact ${i + 1}`} onClick={() => edit({ ...draft, facts: draft.facts.filter((_, n) => n !== i) })}>Remove</button>
                        </div>)}<button className="mission-button" disabled={draft.facts.length >= 80} onClick={() => edit({ ...draft, facts: [...draft.facts, { id: freshId(), mine: '', find: '' }] })}>Add fact</button>
                    </>}
                    {draft.kind === 'pairs' && <><h2>Word pairs ({draft.pairs.length})</h2><p>Each word belongs to one pair, for example salt ↔ pepper. Students find the classmate holding the matching word.</p>
                        {draft.pairs.map((pair, i) => <div className="warmup-editor-row" key={i}>
                            {input(`First word ${i + 1}`, pair[0], value => edit({ ...draft, pairs: draft.pairs.map((row, n) => n === i ? [value, row[1]] : row) }))}
                            {input(`Matching word ${i + 1}`, pair[1], value => edit({ ...draft, pairs: draft.pairs.map((row, n) => n === i ? [row[0], value] : row) }))}
                            <button className="mission-button danger" aria-label={`Remove pair ${i + 1}`} onClick={() => edit({ ...draft, pairs: draft.pairs.filter((_, n) => n !== i) })}>Remove</button>
                        </div>)}<button className="mission-button" disabled={draft.pairs.length >= 40} onClick={() => edit({ ...draft, pairs: [...draft.pairs, ['', '']] })}>Add pair</button>
                    </>}
                    {problems.length > 0 && <ul className="mission-error" aria-label="Warm-up issues">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
                </section>
                <section className="mission-card"><h2>Preview</h2><strong>{draft.title} · {draft.level}</strong><p>{draft.instructions}</p>
                    <p>{draft.kind === 'identity' ? `Your secret: You are ${draft.identities[0]?.name || '…'}. Do not say your name! Answer yes or no.`
                        : draft.kind === 'facts' ? `Your fact: ${draft.facts[0]?.mine || '…'}` : `Your word: ${draft.pairs[0]?.[0] || '…'}`}</p>
                    <p className="mission-muted">Each student gets their own assignment when you start the activity.</p>
                </section>
                <section className="mission-card"><h2>Backup and restore</h2><div className="mission-toolbar">
                    <button className="mission-button" onClick={() => downloadFile(`${kind}-warmup.json`, JSON.stringify({ format: 'pixel-plaza-warmup', schemaVersion: 1, definition: draft }, null, 2), 'application/json')}>Export JSON</button>
                    <label className="mission-file">Import JSON<input type="file" accept=".json,application/json" onChange={event => {
                        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
                        void run(async () => {
                            if (file.size > WARMUP_MAX_BYTES) throw new Error('Warm-up files must be smaller than 64 KB.');
                            const value = JSON.parse(await file.text());
                            if (!value || value.format !== 'pixel-plaza-warmup' || value.schemaVersion !== 1) throw new Error('Choose an exported Pixel Plaza warm-up file.');
                            const checked = validateWarmup(value.definition); if (!checked.definition) throw new Error(checked.errors.join(' '));
                            if (checked.definition.kind !== kind) throw new Error('Select the matching warm-up type before importing this file.');
                            edit(checked.definition); setNotice('Imported into your draft. Review it, then save.');
                        });
                    }} /></label>
                    <button className="mission-button" onClick={() => edit(defaultWarmup(kind))}>Use built-in content</button>
                </div><p className="mission-muted">Importing and restoring change your draft. Save when ready.</p></section>
            </>}
        </fieldset>}
    </main>;
}
