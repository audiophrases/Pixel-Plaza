import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Campaign } from '../../shared/campaign';
import { missionEnvelope, missionId, missionJson, MISSION_MAX_BYTES, validateMission } from '../../shared/missionSchema';
import { importMission, type MissionImport } from '../../shared/missionImport';
import { buildMissionPrompt } from '../../shared/missionPrompt';
import type { MissionDraft, MissionSummary } from '../../shared/missionTypes';
import MissionEditor, { MissionField, MissionPreview } from '../components/MissionEditor';
import LiveMissionPanel from '../components/LiveMissionPanel';
import { readTeacherSession, storeTeacherSession } from '../teacherSession';
import './MissionStudio.css';

async function request<T>(token: string, op: string, body?: object): Promise<T> {
    const response = await fetch(`/api/teacher/missions/${op}`, { method: body ? 'POST' : 'GET', headers: { 'x-teacher-session': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error([result.error, ...(result.errors ?? []).map((e: { path: string; message: string }) => `${e.path}: ${e.message}`)].join('\n')), { status: response.status });
    return result;
}
function download(text: string, filename: string, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function MissionStudio() {
    const [token, setToken] = useState(readTeacherSession); const [password, setPassword] = useState('');
    const [library, setLibrary] = useState<MissionSummary[]>([]); const [draft, setDraft] = useState<MissionDraft | null>(null);
    const [campaign, setCampaign] = useState<Campaign | null>(null); const [chapterIndex, setChapterIndex] = useState(0);
    const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
    const [newId, setNewId] = useState(''); const [source, setSource] = useState('');
    const [importText, setImportText] = useState(''); const [importMode, setImportMode] = useState<'append' | 'replace' | 'extend'>('extend'); const [candidate, setCandidate] = useState<MissionImport | null>(null);
    const [brief, setBrief] = useState(''); const [level, setLevel] = useState('A2'); const [promptMode, setPromptMode] = useState<'create' | 'extend' | 'quests'>('quests'); const [prompt, setPrompt] = useState('');
    const dirty = !!campaign && !!draft && JSON.stringify(campaign) !== JSON.stringify(draft.campaign);
    const checked = campaign ? validateMission(missionEnvelope(campaign)) : null;
    const failed = useCallback((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Connection failed.');
        if ((cause as { status?: number }).status === 401) { storeTeacherSession(''); setToken(''); }
    }, []);
    useEffect(() => {
        if (!token) return;
        let active = true;
        request<{ library: MissionSummary[] }>(token, 'list').then(result => { if (active) setLibrary(result.library); }).catch(cause => { if (active) { setError(cause.message); if (cause.status === 401) { storeTeacherSession(''); setToken(''); } } });
        return () => { active = false; };
    }, [token]);
    useEffect(() => {
        if (!dirty) return;
        const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
    }, [dirty]);
    const applyDraft = (next: MissionDraft) => { setDraft(next); setCampaign(next.campaign); setCandidate(null); setPrompt(''); setChapterIndex(0); };
    const edit = (next: Campaign) => { setCampaign(next); setCandidate(null); setPrompt(''); setNotice(''); };
    const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work(); } catch (cause) { failed(cause); } finally { setBusy(false); } };
    const mayLeave = () => !dirty || window.confirm('Discard unsaved draft changes? Save or export them first to keep them.');
    const save = async (): Promise<MissionDraft> => {
        const result = await request<{ draft: MissionDraft; library: MissionSummary[] }>(token, 'save', { id: campaign!.id, version: draft!.version, envelope: missionEnvelope(campaign!) });
        setDraft(result.draft); setCampaign(result.draft.campaign); setLibrary(result.library); return result.draft;
    };
    const previewImport = (sources: string[]) => {
        if (!campaign) return;
        let working = campaign; const changes: string[] = [];
        for (const [i, text] of sources.entries()) {
            const result = importMission(working, text, i === 0 || importMode === 'extend' ? importMode : 'append', campaign.chapters[chapterIndex]?.id); changes.push(...result.changes);
            if (!result.campaign) { setCandidate({ ...result, changes }); return; }
            working = result.campaign;
        }
        setCandidate({ ...validateMission(missionEnvelope(working)), changes });
    };
    return <main className="mission-page">
        <header className="mission-header"><div><p className="mission-eyebrow">PIXEL PLAZA · TEACHER WORKSPACE</p><h1>Mission Studio</h1><p>Build stories, shape clues, and give every student a mystery to explore.</p></div>
            <Link to="/teacher" onClick={e => { if (!mayLeave()) e.preventDefault(); }}>Teacher controls</Link></header>
        {error && <p className="mission-error" role="alert">{error}</p>}{notice && <p className="mission-notice" role="status">{notice}</p>}
        {!token ? <form className="mission-card mission-login" onSubmit={e => { e.preventDefault(); void run(async () => {
            const response = await fetch('/api/teacher/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
            const result = await response.json(); if (!response.ok) throw new Error(result.error);
            storeTeacherSession(result.token); setToken(result.token); setPassword('');
        }); }}><h2>Teacher sign-in</h2><label className="mission-field"><span>Teacher password</span><input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label><button className="mission-button primary" disabled={busy}>Open Mission Studio</button></form>
        : <fieldset className="mission-workspace" disabled={busy}>
            <aside className="mission-library mission-card"><h2>Campaign library</h2><p className="mission-muted">Edit a draft. Publish when ready. Games already in progress keep their story.</p>
                <nav aria-label="Campaign library">{library.map(item => <button key={item.id} className={campaign?.id === item.id ? 'selected' : ''} onClick={() => {
                    if (!mayLeave()) return; void run(async () => { const result = await request<{ draft: MissionDraft }>(token, `get?id=${encodeURIComponent(item.id)}`); applyDraft(result.draft); setNotice(''); });
                }}><strong>{item.title}</strong><span>{item.publishedRevision ? 'Published · editable draft' : 'Draft only'}</span></button>)}</nav>
                <h3>Create a campaign</h3><MissionField label="Campaign ID" value={newId} maxLength={64} onChange={setNewId} /><p className="mission-muted">Lowercase letters, digits and hyphens, starting with a letter.</p>
                <label className="mission-field"><span>Start from</span><select value={source} onChange={e => setSource(e.target.value)}><option value="">Blank adventure</option>{library.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
                <button className="mission-button primary" disabled={!missionId(newId)} onClick={() => { if (!mayLeave()) return; void run(async () => {
                    const result = await request<{ draft: MissionDraft; library: MissionSummary[] }>(token, 'create', { id: newId, ...(source ? { source } : {}) }); applyDraft(result.draft); setLibrary(result.library); setNewId(''); setNotice('New draft created.');
                }); }}>Create draft</button>
                <button className="mission-button" onClick={() => { if (!mayLeave()) return; storeTeacherSession(''); setToken(''); setCampaign(null); setDraft(null); }}>Sign out</button>
            </aside>
            <div className="mission-main">{campaign && draft ? <>
                <div className="mission-savebar"><div><strong>{campaign.title || 'Untitled campaign'}</strong><span>{dirty ? 'Unsaved changes' : `Draft saved · version ${draft.version}`}</span></div><div className="mission-toolbar">
                    <button className="mission-button" disabled={!dirty} onClick={() => void run(async () => { await save(); setNotice('Draft saved. Existing games keep their revision.'); })}>Save draft</button>
                    <button className="mission-button" onClick={() => download(missionJson(campaign), `${campaign.id}.json`)}>Export JSON</button>
                    <button className="mission-button primary" disabled={!!checked?.errors.length} onClick={() => void run(async () => {
                        const saved = dirty ? await save() : draft;
                        const result = await request<{ draft: MissionDraft; library: MissionSummary[] }>(token, 'publish', { id: campaign.id, version: saved.version });
                        setDraft(result.draft); setCampaign(result.draft.campaign); setLibrary(result.library); setNotice('Published. Start this campaign from Teacher controls in a game with no campaign yet. Existing games keep their revision.');
                    })}>Publish for new games</button></div></div>
                <details className="mission-card mission-validation" open={!!checked?.errors.length}><summary>{checked?.errors.length ? `${checked.errors.length} issues to fix before publishing` : 'Ready to publish · review clue coverage'}</summary>
                    {!!checked?.errors.length && <ul className="mission-error">{checked.errors.map((item, i) => <li key={i}><strong>{item.path}</strong>: {item.message}</li>)}</ul>}
                    <ul className="mission-warning">{checked?.warnings.map((item, i) => <li key={i}>{item.message}</li>)}</ul></details>
                <MissionEditor campaign={campaign} chapterIndex={chapterIndex} setChapterIndex={index => { setChapterIndex(index); setCandidate(null); setPrompt(''); }} onChange={edit} />
                <MissionPreview campaign={campaign} chapter={campaign.chapters[chapterIndex]} />
                <LiveMissionPanel token={token} campaign={campaign} chapter={campaign.chapters[chapterIndex]} version={draft.version} dirty={dirty} onError={failed} />
                <section className="mission-card"><h2>Create with an AI prompt</h2><p>Describe your idea, copy or download the prompt, then import the AI's JSON response below.</p>
                    <div className="mission-two-columns"><label className="mission-field"><span>Language level</span><select value={level} onChange={e => { setLevel(e.target.value); setPrompt(''); }}>{['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map(l => <option key={l}>{l}</option>)}</select></label><label className="mission-field"><span>Task</span><select value={promptMode} onChange={e => { setPromptMode(e.target.value as 'create' | 'extend' | 'quests'); setPrompt(''); }}><option value="quests">Add quests to the selected chapter</option><option value="extend">Extend this campaign with chapters</option><option value="create">Create a new campaign</option></select></label></div>
                    <MissionField label="Your mission brief" value={brief} multiline onChange={text => { setBrief(text); setPrompt(''); }} />
                    <button className="mission-button" disabled={!brief.trim() || (promptMode === 'quests' && !campaign.chapters[chapterIndex])} onClick={() => setPrompt(buildMissionPrompt(campaign, brief, level, promptMode, campaign.chapters[chapterIndex]?.id))}>Build prompt</button>
                    {prompt && <><label className="mission-field"><span>Prompt to give your AI</span><textarea readOnly rows={10} value={prompt} /></label><div className="mission-toolbar"><button className="mission-button" onClick={() => void run(async () => {
                        try { await navigator.clipboard.writeText(prompt); setNotice('Prompt copied.'); } catch { download(prompt, `${campaign.id}-prompt.md`, 'text/markdown'); setNotice('Clipboard unavailable. Prompt downloaded.'); }
                    })}>Copy prompt</button><button className="mission-button" onClick={() => download(prompt, `${campaign.id}-prompt.md`, 'text/markdown')}>Download prompt</button></div></>}
                </section>
                <section className="mission-card"><h2>Import JSON</h2><p>Review the proposed changes before applying them to your draft.</p><label className="mission-field"><span>Import action</span><select value={importMode} onChange={e => { setImportMode(e.target.value as 'append' | 'replace' | 'extend'); setCandidate(null); }}><option value="extend">Extend selected chapter: {campaign.chapters[chapterIndex]?.title ?? 'none selected'}</option><option value="append">Append chapters</option><option value="replace">Replace draft content</option></select></label>
                    <MissionField label="Paste campaign JSON" value={importText} multiline maxLength={MISSION_MAX_BYTES} onChange={text => { setImportText(text); setCandidate(null); }} />
                    <div className="mission-toolbar"><button className="mission-button" disabled={!importText.trim()} onClick={() => previewImport([importText])}>Preview pasted JSON</button>
                        <label className="mission-file">Or choose JSON files<input type="file" accept=".json,.txt,application/json" multiple onChange={e => {
                            const files = [...(e.target.files ?? [])].sort((a, b) => a.name.localeCompare(b.name)); e.target.value = '';
                            if (!files.length) return; setCandidate(null); void run(async () => {
                                if (files.reduce((sum, file) => sum + file.size, 0) > MISSION_MAX_BYTES) throw new Error('Import files exceed 512 KB in total.');
                                previewImport(await Promise.all(files.map(f => f.text())));
                            });
                        }} /></label></div>
                    {candidate && <div className="mission-import-preview"><h3>{candidate.campaign ? 'Review proposed changes' : 'Import needs correction'}</h3><ul>{candidate.changes.map((text, i) => <li key={i}>{text}</li>)}</ul>
                        <ul className="mission-error">{candidate.errors.map((item, i) => <li key={i}>{item.path}: {item.message}</li>)}</ul>
                        {candidate.campaign && <p>{candidate.campaign.roles.length} roles · {candidate.campaign.chapters.length} chapters · {candidate.campaign.chapters.reduce((n, c) => n + c.objectives.length, 0)} objectives</p>}
                        <div className="mission-toolbar"><button className="mission-button primary" disabled={!candidate.campaign} onClick={() => { edit(candidate.campaign!); setChapterIndex(0); setNotice('Import applied to the draft. Save when ready.'); }}>Apply to draft</button><button className="mission-button" onClick={() => setCandidate(null)}>Cancel import</button></div>
                        {candidate.campaign && <details><summary>Inspect the proposed JSON</summary><pre>{missionJson(candidate.campaign)}</pre></details>}
                    </div>}
                </section>
            </> : <section className="mission-card mission-empty"><h2>Your next adventure starts here</h2><p>Open The Haunted Castanyada to inspect its missions and answers, or create a draft from a template.</p></section>}</div>
        </fieldset>}
    </main>;
}
