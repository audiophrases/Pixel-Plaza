import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getTheme, themes } from '../../shared/themeCatalog';
import type { Campaign } from '../../shared/campaign';
import { missionEnvelope, missionJson, MISSION_MAX_BYTES, validateMission } from '../../shared/missionSchema';
import { importMission, type MissionImport } from '../../shared/missionImport';
import { buildMissionPrompt } from '../../shared/missionPrompt';
import type { MissionDraft, MissionSummary, MissionSync } from '../../shared/missionTypes';
import MissionEditor, { ClueReview, MissionPreview } from '../components/MissionEditor';
import MissionField from '../components/MissionField';
import { focusMissionIssue, issueLocation, missionIssueText } from '../components/missionEditing';
import LiveMissionPanel from '../components/LiveMissionPanel';
import { readTeacherSession, storeTeacherSession } from '../teacherSession';
import './MissionStudio.css';

async function request<T>(token: string, op: string, body?: object): Promise<T> {
    const response = await fetch(`/api/teacher/missions/${op}`, { method: body ? 'POST' : 'GET', headers: { 'x-teacher-session': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error([result.error, ...(result.errors ?? []).map((e: { path: string; message: string }) => `${e.path}: ${e.message}`)].join('\n')), { status: response.status });
    return result;
}
// How this laptop's missions stand with the online Pixel Plaza, where missions live (nothing to say on the online site).
function syncText(sync: MissionSync): string {
    const waiting = sync.waiting === 1 ? '1 change waits' : `${sync.waiting} changes wait`;
    if (sync.state === 'synced') return '✓ Saved online: this laptop has the same missions as the online Pixel Plaza.';
    if (sync.state === 'signin') return `Not linked to the online Pixel Plaza: sign in to Teacher controls again on this laptop.${sync.waiting ? ` ${waiting} on this laptop to upload.` : ''}`;
    if (sync.state === 'outdated') return `The online Pixel Plaza does not keep missions yet: it needs updating.${sync.waiting ? ` ${waiting} on this laptop until then.` : ''}`;
    return sync.waiting ? `No internet: ${waiting} on this laptop and go online when the connection is back.` : 'No internet: showing the missions this laptop has.';
}
function download(text: string, filename: string, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function MissionStudio() {
    const [params] = useSearchParams();
    const [promptThemeId, setPromptThemeId] = useState(() => getTheme(params.get('theme') ?? undefined).id);
    const [token, setToken] = useState(readTeacherSession); const [password, setPassword] = useState('');
    const [library, setLibrary] = useState<MissionSummary[]>([]); const [draft, setDraft] = useState<MissionDraft | null>(null);
    const [campaign, setCampaign] = useState<Campaign | null>(null); const [chapterIndex, setChapterIndex] = useState(0);
    const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
    const [newName, setNewName] = useState(''); const [source, setSource] = useState(''); const [creating, setCreating] = useState(false);
    const [view, setView] = useState<'setup' | 'build' | 'review' | 'tools' | 'live'>('build');
    const [sync, setSync] = useState<MissionSync | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [issueTarget, setIssueTarget] = useState<{ path: string } | null>(null);
    const [importText, setImportText] = useState(''); const [importMode, setImportMode] = useState<'append' | 'replace' | 'extend'>('extend'); const [candidate, setCandidate] = useState<MissionImport | null>(null);
    const [brief, setBrief] = useState(''); const [level, setLevel] = useState('A2'); const [promptMode, setPromptMode] = useState<'create' | 'extend' | 'quests'>('quests'); const [prompt, setPrompt] = useState('');
    const dirty = !!campaign && !!draft && JSON.stringify(campaign) !== JSON.stringify(draft.campaign);
    const checked = campaign ? validateMission(missionEnvelope(campaign)) : null;
    const failed = useCallback((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Connection failed.');
        if ((cause as { status?: number }).status === 401) { storeTeacherSession(''); setToken(''); }
    }, []);
    // Every answer says how the missions stand with the online server; a mission that had changed there too was kept twice.
    const noteSync = (next?: MissionSync) => {
        if (!next) return;
        setSync(next);
        if (next.keptBoth.length) setNotice(`Changed online too, so both versions are kept. Yours is now “${next.keptBoth.map(item => item.title).join('”, “')}”.`);
    };
    const call = async <T,>(op: string, body?: object): Promise<T> => {
        const result = await request<T & { sync?: MissionSync }>(token, op, body);
        noteSync(result.sync);
        return result;
    };
    useEffect(() => {
        if (!token) return;
        let active = true;
        request<{ library: MissionSummary[]; sync?: MissionSync }>(token, 'list').then(result => { if (active) { setLibrary(result.library); if (result.sync) setSync(result.sync); } }).catch(cause => { if (active) { setError(cause.message); if (cause.status === 401) { storeTeacherSession(''); setToken(''); } } });
        return () => { active = false; };
    }, [token]);
    useEffect(() => {
        if (!dirty) return;
        const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
    }, [dirty]);
    useEffect(() => { if (issueTarget) focusMissionIssue(issueTarget.path); }, [issueTarget]);
    const applyDraft = (next: MissionDraft) => { setDraft(next); setCampaign(next.campaign); setCandidate(null); setPrompt(''); setChapterIndex(0); setSelectedId(null); setView('build'); setCreating(false); };
    const edit = (next: Campaign) => { setCampaign(next); setCandidate(null); setPrompt(''); setNotice(''); };
    const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work(); } catch (cause) { failed(cause); } finally { setBusy(false); } };
    const mayLeave = () => !dirty || window.confirm('Discard unsaved draft changes? Save or export them first to keep them.');
    const save = async (): Promise<MissionDraft> => {
        const result = await call<{ draft: MissionDraft; library: MissionSummary[] }>('save', { id: campaign!.id, version: draft!.version, envelope: missionEnvelope(campaign!) });
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
    const openMission = (id: string) => { if (!id || !mayLeave()) return; void run(async () => { const result = await call<{ draft: MissionDraft }>(`get?id=${encodeURIComponent(id)}`); applyDraft(result.draft); setNotice(''); }); };
    const selectChapter = (index: number) => { setChapterIndex(index); setSelectedId(null); setCandidate(null); setPrompt(''); };
    return <main className="mission-page mission-studio-page">
        <header className="mission-header"><div><p className="mission-eyebrow">PIXEL PLAZA · TEACHER WORKSPACE</p><h1>Mission Studio</h1><p>A great lesson starts with a few simple steps.</p>{sync && sync.state !== 'home' && <p className={`mission-sync mission-sync-${sync.state}`} role="status">{syncText(sync)}</p>}</div>
            <Link to="/teacher" onClick={e => { if (!mayLeave()) e.preventDefault(); }}>Teacher controls</Link></header>
        {(error || notice) && <div className="mission-feedback"><div className={error ? 'mission-error' : 'mission-notice'} role={error ? 'alert' : 'status'}><span>{error || notice}</span><button type="button" className="mission-button" aria-label="Dismiss message" onClick={() => { setError(''); setNotice(''); }}>×</button></div></div>}
        {!token ? <form className="mission-card mission-login" onSubmit={e => { e.preventDefault(); void run(async () => {
            const response = await fetch('/api/teacher/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
            const result = await response.json(); if (!response.ok) throw new Error(result.error);
            storeTeacherSession(result.token); setToken(result.token); setPassword('');
        }); }}><h2>Teacher sign-in</h2><label className="mission-field"><span>Teacher password</span><input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label><button className="mission-button primary" disabled={busy}>Open Mission Studio</button></form>
        : <fieldset className="mission-workspace" disabled={busy} aria-busy={busy}>
            <section className="mission-library mission-card"><div className="mission-library-bar"><label className="mission-field"><span>Your missions</span><select value={campaign?.id ?? ''} onChange={e => openMission(e.target.value)}><option value="" disabled>Choose a mission to edit…</option>{library.map(item => <option key={item.id} value={item.id}>{item.title || 'Untitled mission'}{item.publishedRevision ? ' · Published' : ' · Draft'}</option>)}</select></label>
                <button className="mission-button" aria-expanded={creating} onClick={() => setCreating(!creating)}>+ New mission</button><button className="mission-button mission-signout" onClick={() => { if (!mayLeave()) return; storeTeacherSession(''); setToken(''); setCampaign(null); setDraft(null); }}>Sign out</button></div>
                {creating && <div className="mission-create"><h2>Create your mission</h2><p className="mission-muted">Give it a name, then start with an example you can change or adapt an existing mission.</p><div className="mission-two-columns"><MissionField label="New mission name" value={newName} maxLength={120} placeholder="For example: The missing festival lights" onChange={setNewName} /><label className="mission-field"><span>Start from</span><select value={source} onChange={e => setSource(e.target.value)}><option value="">Simple starter · one question to adapt</option>{library.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div>
                    <div className="mission-toolbar"><button className="mission-button primary" disabled={!newName.trim()} onClick={() => { if (!mayLeave()) return; void run(async () => {
                        const base = newName.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                        const id = `${/^[a-z]/.test(base) ? base.slice(0, 45) : 'mission'}-${crypto.randomUUID().slice(0, 8)}`;
                        const created = await call<{ draft: MissionDraft; library: MissionSummary[] }>('create', { id, ...(source ? { source } : {}) });
                        applyDraft(created.draft); setLibrary(created.library); setCampaign({ ...created.draft.campaign, title: newName.trim() }); setView('setup');
                        const named = await call<{ draft: MissionDraft; library: MissionSummary[] }>('save', { id, version: created.draft.version, envelope: missionEnvelope({ ...created.draft.campaign, title: newName.trim() }) });
                        applyDraft(named.draft); setLibrary(named.library); setView('setup'); setNewName(''); setNotice('Mission created. Start with the title and roles, then build your steps.');
                    }); }}>Create mission</button><button className="mission-button" onClick={() => setCreating(false)}>Cancel</button></div>
                </div>}
            </section>
            <div className="mission-main">{campaign && draft ? <>
                <div className="mission-savebar"><div><strong>{campaign.title || 'Untitled mission'}</strong><span>{dirty ? 'Unsaved changes' : 'All changes saved'}</span></div><div className="mission-toolbar">
                    <button className="mission-button primary" disabled={!dirty} onClick={() => void run(async () => { await save(); setNotice('Draft saved. Publish when you are ready to use it in a new game.'); })}>{busy ? 'Working…' : 'Save draft'}</button>
                    <button className="mission-button" onClick={() => setView('review')}>Review &amp; publish{checked?.errors.length ? ` (${checked.errors.length})` : ''}</button></div></div>
                <nav className="mission-workflow" aria-label="Mission workflow">{([{ id: 'setup', title: 'Mission setup', description: 'Title & student roles' }, { id: 'build', title: 'Build steps', description: 'Chapters, tasks & answers' }, { id: 'review', title: 'Preview & publish', description: 'Check the student experience' }] as const).map((item, i) => <button key={item.id} aria-current={view === item.id ? 'step' : undefined} className={view === item.id ? 'selected' : ''} onClick={() => setView(item.id)}><span>{i + 1}</span><div><strong>{item.title}</strong><small>{item.description}</small></div></button>)}</nav>
                <div className="mission-utility-nav"><button className="mission-button" aria-pressed={view === 'tools'} onClick={() => setView('tools')}>AI help &amp; files</button><button className="mission-button" aria-pressed={view === 'live'} onClick={() => setView('live')}>Add to a running game</button></div>
                <div hidden={view !== 'setup' && view !== 'build'}><MissionEditor key={campaign.id} view={view === 'setup' ? 'setup' : 'build'} campaign={campaign} theme={getTheme(promptThemeId)} chapterIndex={chapterIndex} selectedId={selectedId} setSelectedId={setSelectedId} setChapterIndex={selectChapter} onChange={edit} /></div>
                {view === 'review' && <><section className="mission-card mission-validation"><p className="mission-eyebrow">CHECK BEFORE YOU SHARE</p><h2>{checked?.errors.length ? `${checked.errors.length} things to finish` : 'Your mission is ready to publish'}</h2><p className="mission-muted">{campaign.chapters.length} chapters · {campaign.chapters.reduce((n, c) => n + c.objectives.length, 0)} steps · {campaign.roles.length} roles. You can save an unfinished draft at any time.</p>
                    {!!checked?.errors.length && <ul className="mission-issue-list">{checked.errors.map((item, i) => { const location = issueLocation(campaign, item); return <li key={i}><div><strong>{location.label}</strong><p>{missionIssueText(item)}</p></div><button className="mission-button" onClick={() => { if (location.chapterIndex >= 0) { selectChapter(location.chapterIndex); setSelectedId(location.stepId ?? null); setView('build'); } else setView('setup'); setIssueTarget({ path: item.path }); }}>Go to fix</button></li>; })}</ul>}
                    {!!checked?.warnings.length && <details className="mission-details"><summary>Teaching tips to review ({checked.warnings.length})</summary><ul>{checked.warnings.map((item, i) => <li key={i}>{item.message}</li>)}</ul></details>}
                    <div className="mission-publish"><p>Publishing makes this version available for <strong>new games</strong>. Games already in progress keep their story and student progress.</p><button className="mission-button primary" disabled={!!checked?.errors.length} onClick={() => void run(async () => {
                        const saved = dirty ? await save() : draft;
                        const result = await call<{ draft: MissionDraft; library: MissionSummary[] }>('publish', { id: campaign.id, version: saved.version });
                        setDraft(result.draft); setCampaign(result.draft.campaign); setLibrary(result.library); setNotice('Published. Choose this mission in Teacher controls when starting a new game. Existing games keep their story and progress.');
                    })}>Publish for new games</button></div>
                </section><section className="mission-card"><label className="mission-field"><span>Chapter to preview</span><select value={chapterIndex} onChange={e => selectChapter(Number(e.target.value))}>{campaign.chapters.map((c, i) => <option key={c.id} value={i}>{i + 1}. {c.title}</option>)}</select></label></section><MissionPreview key={`${campaign.id}-${campaign.chapters[chapterIndex]?.id}`} campaign={campaign} chapter={campaign.chapters[chapterIndex]} /><ClueReview campaign={campaign} chapter={campaign.chapters[chapterIndex]} /></>}
                <div hidden={view !== 'live'}><section className="mission-card"><h2>Extra quests for your current class</h2><p>Choose the chapter that matches the running game, then review the optional quests to release.</p><label className="mission-field"><span>Chapter for live quests</span><select value={chapterIndex} onChange={e => selectChapter(Number(e.target.value))}>{campaign.chapters.map((c, i) => <option key={c.id} value={i}>{i + 1}. {c.title}</option>)}</select></label></section><LiveMissionPanel token={token} campaign={campaign} chapter={campaign.chapters[chapterIndex]} version={draft.version} dirty={dirty} onError={failed} /></div>
                <div hidden={view !== 'tools'}><section className="mission-card"><h2>A little help with your next idea</h2><p>These tools are optional. Write and edit your mission in Build steps, or use your own AI and import its response here.</p><button className="mission-button" onClick={() => download(missionJson(campaign), `${campaign.id}.json`)}>Download mission backup</button><label className="mission-field"><span>Chapter for AI &amp; imports</span><select value={chapterIndex} onChange={e => selectChapter(Number(e.target.value))}>{campaign.chapters.map((c, i) => <option key={c.id} value={i}>{i + 1}. {c.title}</option>)}</select></label></section>
                <details className="mission-card"><summary>Create with an AI prompt</summary><p>Describe your idea, copy or download the prompt, then import the AI's JSON response below.</p>
                    <label className="mission-field"><span>Story scenery</span><select aria-label="Story scenery" value={promptThemeId} onChange={e => { setPromptThemeId(e.target.value); setPrompt(''); }}>{Object.values(themes).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
                    <p className="mission-muted">The prompt uses this map's place names. Existing chapters and answers keep their wording. For uninstalled scenery, paste story-context.md from its art kit into your brief.</p>
                    <div className="mission-two-columns"><label className="mission-field"><span>Language level</span><select value={level} onChange={e => { setLevel(e.target.value); setPrompt(''); }}>{['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map(l => <option key={l}>{l}</option>)}</select></label><label className="mission-field"><span>Task</span><select value={promptMode} onChange={e => { setPromptMode(e.target.value as 'create' | 'extend' | 'quests'); setPrompt(''); }}><option value="quests">Add quests to the selected chapter</option><option value="extend">Extend this campaign with chapters</option><option value="create">Create a new campaign</option></select></label></div>
                    <MissionField label="Your mission brief" value={brief} multiline onChange={text => { setBrief(text); setPrompt(''); }} />
                    <button className="mission-button" disabled={!brief.trim() || (promptMode === 'quests' && !campaign.chapters[chapterIndex])} onClick={() => setPrompt(buildMissionPrompt(campaign, brief, level, promptMode, campaign.chapters[chapterIndex]?.id, getTheme(promptThemeId)))}>Build prompt</button>
                    {prompt && <><label className="mission-field"><span>Prompt to give your AI</span><textarea readOnly rows={10} value={prompt} /></label><div className="mission-toolbar"><button className="mission-button" onClick={() => void run(async () => {
                        try { await navigator.clipboard.writeText(prompt); setNotice('Prompt copied.'); } catch { download(prompt, `${campaign.id}-prompt.md`, 'text/markdown'); setNotice('Clipboard unavailable. Prompt downloaded.'); }
                    })}>Copy prompt</button><button className="mission-button" onClick={() => download(prompt, `${campaign.id}-prompt.md`, 'text/markdown')}>Download prompt</button></div></>}
                </details>
                <details className="mission-card"><summary>Import a mission file or AI response</summary><p>Review the proposed changes before applying them to your draft.</p><label className="mission-field"><span>Import action</span><select value={importMode} onChange={e => { setImportMode(e.target.value as 'append' | 'replace' | 'extend'); setCandidate(null); }}><option value="extend">Add steps to: {campaign.chapters[chapterIndex]?.title ?? 'none selected'}</option><option value="append">Add new chapters</option><option value="replace">Replace all draft content</option></select></label>
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
                        <div className="mission-toolbar"><button className="mission-button primary" disabled={!candidate.campaign} onClick={() => { const next = candidate.campaign!; edit(next); setChapterIndex(importMode === 'extend' ? chapterIndex : 0); setSelectedId(null); setView('build'); setNotice('Import applied to the draft. Save when ready.'); }}>Apply to draft</button><button className="mission-button" onClick={() => setCandidate(null)}>Cancel import</button></div>
                        {candidate.campaign && <details><summary>Inspect the proposed JSON</summary><pre>{missionJson(candidate.campaign)}</pre></details>}
                    </div>}
                </details></div>
                {view === 'setup' && <div className="mission-next"><p>Next, add the tasks your students will complete.</p><button className="mission-button primary" onClick={() => setView('build')}>Build steps →</button></div>}
                {view === 'build' && <div className="mission-next"><p>Happy with your steps? See the mission as a student.</p><button className="mission-button primary" onClick={() => setView('review')}>Preview &amp; publish →</button></div>}
            </> : <section className="mission-card mission-empty"><p className="mission-eyebrow">WELCOME TO YOUR TEACHER WORKSPACE</p><h2>What will your class investigate?</h2><p>Start with a ready-made mission and make it yours, or create a new one with a simple example to guide you.</p><button className="mission-button primary" onClick={() => setCreating(true)}>+ Create a mission</button><h3>Choose a mission to edit</h3><nav className="mission-welcome-library" aria-label="Mission library">{library.map(item => <button key={item.id} onClick={() => openMission(item.id)}><strong>{item.title || 'Untitled mission'}</strong><span>{item.publishedRevision ? 'Published · open an editable draft' : 'Draft · keep building'} →</span></button>)}</nav></section>}</div>
        </fieldset>}
    </main>;
}
