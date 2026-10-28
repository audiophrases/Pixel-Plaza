import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { missionJson } from '../../shared/missionSchema';
import type { LiveMissionPreview, LiveMissionTarget, MissionSync } from '../../shared/missionTypes';
import {
    ANSWERS, FORMATS, LEVELS, THEMES, questCategories, questFacets, questObjective, searchQuests,
    type QuestAnswer, type QuestFilters, type QuestFormat, type QuestLevel, type QuestTheme, type SideQuest, type SideQuestLibrary, type StoryChapter,
} from '../../shared/sideQuests';
import SideQuestEditor from '../components/SideQuestEditor';
import { readTeacherSession, storeTeacherSession } from '../teacherSession';
import './MissionStudio.css';
import './QuestLibrary.css';

// `route` follows /api/teacher/: "missions/…" for the running game, "side-quests/…" for the library itself.
async function request<T>(token: string, route: string, body?: object): Promise<T> {
    const response = await fetch(`/api/teacher/${route}`, { method: body ? 'POST' : 'GET', headers: { 'x-teacher-session': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error([result.error, ...(result.errors ?? []).map((e: { path: string; message: string }) => `${e.path}: ${e.message}`)].join('\n')), { status: response.status });
    return result;
}
function download(text: string, filename: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// How this laptop's quests stand with the online Pixel Plaza, where they live (nothing to say on the online site).
function syncText(sync: MissionSync): string {
    const waiting = sync.waiting === 1 ? '1 change waits' : `${sync.waiting} changes wait`;
    if (sync.state === 'synced') return '✓ Saved online: this laptop has the same quests as the online Pixel Plaza.';
    if (sync.state === 'signin') return `Not linked to the online Pixel Plaza: sign in to Teacher controls again on this laptop.${sync.waiting ? ` ${waiting} on this laptop to upload.` : ''}`;
    if (sync.state === 'outdated') return `The online Pixel Plaza does not keep side quests yet: it needs updating.${sync.waiting ? ` ${waiting} on this laptop until then.` : ''}`;
    return sync.waiting ? `No internet: ${waiting} on this laptop and go online when the connection is back.` : 'No internet: showing the quests this laptop has.';
}

const MAX_RELEASE = 10; // the game reviews at most ten quests at a time
const PAGE = 40;
const EMPTY: SideQuestLibrary = { chapters: [], quests: [] };
const levelName = (id: QuestLevel) => `${id} ${LEVELS.find(l => l.id === id)?.name ?? ''}`;
const toggle = <T,>(list: T[] | undefined, value: T): T[] => list?.includes(value) ? list.filter(item => item !== value) : [...(list ?? []), value];
type Listing = { quests: SideQuest[]; trash: SideQuest[]; versions: Record<string, number>; chapters: StoryChapter[]; sync?: MissionSync };
const blankQuest = (): SideQuest => ({
    id: '', title: '', theme: 'social', category: '', chapter: null, level: 'A2', format: 'solo', answer: 'report', minutes: 5,
    focus: [], tags: [], text: '', accept: [], teacherNote: '',
});

// A Mission Studio file with one chapter holding the chosen quests: import it with "Extend the selected chapter".
function missionPack(quests: SideQuest[]): string {
    return missionJson({ id: 'side-quest-pack', title: 'Side quest pack', finale: '', roles: [], chapters: [{
        id: 'side-quest-pack', title: 'Side quests', intro: '', recap: '', ending: '', share: 1,
        objectives: quests.map(questObjective), discoveries: [], reveals: [],
    }] });
}

function Chips<T extends string>({ label, values, chosen, counts, name, onChange }: { label: string; values: readonly T[]; chosen: T[] | undefined; counts: Record<string, number>; name: (value: T) => string; onChange: (next: T[]) => void }) {
    return <div className="ql-filter" role="group" aria-label={label}><span>{label}</span><div>
        {values.map(value => <button key={value} type="button" className={`ql-chip${chosen?.includes(value) ? ' on' : ''}`} aria-pressed={!!chosen?.includes(value)}
            onClick={() => onChange(toggle(chosen, value))}>{name(value)} <small>{counts[value] ?? 0}</small></button>)}
    </div></div>;
}

export default function QuestLibrary() {
    const [token, setToken] = useState(readTeacherSession); const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
    const [query, setQuery] = useState(''); const [filters, setFilters] = useState<QuestFilters>({});
    const [fitsOnly, setFitsOnly] = useState(false); const [shown, setShown] = useState(PAGE);
    const [selected, setSelected] = useState<string[]>([]);
    const [target, setTarget] = useState<LiveMissionTarget | null>(null);
    const [preview, setPreview] = useState<LiveMissionPreview | null>(null);
    // The library is data on the server, like missions: null until it arrives, EMPTY when this server has none yet.
    const [library, setLibrary] = useState<SideQuestLibrary | null>(null);
    const [trash, setTrash] = useState<SideQuest[]>([]); const [versions, setVersions] = useState<Record<string, number>>({});
    const [sync, setSync] = useState<MissionSync | null>(null);
    const [showTrash, setShowTrash] = useState(false); const [confirming, setConfirming] = useState<string | null>(null);
    // The quest open in the editor, new or stored; `saved` once it is stored, until the next edit.
    const [editing, setEditing] = useState<{ quest: SideQuest; creating: boolean; saved: boolean; key: number } | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const quests = (library ?? EMPTY).quests;
    const chapterName = (id: string | null) => { const c = library?.chapters.find(item => item.id === id); return c ? `${c.campaign} ch. ${c.number}` : id ? `chapter ${id}` : ''; };

    const signedOut = (cause: unknown) => { if ((cause as { status?: number }).status === 401) { storeTeacherSession(''); setToken(''); } };
    const run = async (work: () => Promise<void>) => {
        setBusy(true); setError(''); setNotice('');
        try { await work(); } catch (cause) {
            setPreview(null); setError(cause instanceof Error ? cause.message : 'Connection failed.'); signedOut(cause);
        } finally { setBusy(false); }
    };
    const apply = (result: Listing) => {
        setLibrary({ chapters: result.chapters, quests: result.quests }); setTrash(result.trash); setVersions(result.versions);
        if (result.sync) {
            setSync(result.sync);
            if (result.sync.questsKeptBoth?.length) setNotice(`Changed online too, so both versions are kept. Yours is now “${result.sync.questsKeptBoth.map(item => item.title).join('”, “')}”.`);
        }
    };
    const refresh = () => run(async () => { setTarget((await request<{ target: LiveMissionTarget | null }>(token, 'missions/live')).target); setPreview(null); });
    useEffect(() => {
        if (!token) return;
        let active = true;
        request<{ target: LiveMissionTarget | null }>(token, 'missions/live').then(result => { if (active) setTarget(result.target); })
            .catch(cause => { if (active) { setError(cause.message); signedOut(cause); } });
        request<Listing>(token, 'side-quests/list').then(result => { if (active) apply(result); })
            .catch(cause => { if (active) { setError(cause.message || 'Could not load the library.'); signedOut(cause); } });
        return () => { active = false; };
    }, [token]);
    // A reviewed selection is only valid for what was reviewed; cancel it when the page moves on.
    useEffect(() => {
        const id = preview?.id;
        return () => { if (id && token) void request(token, 'missions/live-cancel', { previewId: id }).catch(() => {}); };
    }, [token, preview?.id]);

    // Why a quest cannot go into the running game right now; the server checks again.
    const blocked = (quest: SideQuest): string | null => {
        if (!target) return null;
        if (target.objectiveIds.includes(quest.id) || target.additions.some(a => a.id === quest.id)) return 'Already in this game.';
        if (quest.chapter && quest.chapter !== target.chapter.id) return `Story quest for ${chapterName(quest.chapter)}; the game is on another chapter.`;
        if (quest.after && !target.objectiveIds.includes(quest.after)) return 'Needs a question this game does not have.';
        return null;
    };
    const results = useMemo(() => {
        const found = searchQuests(quests, query, filters);
        return fitsOnly && target ? found.filter(quest => !blocked(quest)) : found;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [quests, query, filters, fitsOnly, target]);
    const facets = useMemo(() => questFacets(library ?? EMPTY, query, filters), [library, query, filters]);
    const categories = useMemo(() => questCategories(quests), [quests]);
    const usedChapters = useMemo(() => new Set(quests.map(quest => quest.chapter)), [quests]);
    const chosen = selected.map(id => quests.find(quest => quest.id === id)).filter((quest): quest is SideQuest => !!quest);
    const setFilter = (next: QuestFilters) => { setFilters(next); setShown(PAGE); };
    const pick = (quest: SideQuest) => { setPreview(null); setSelected(current => current.includes(quest.id) ? current.filter(id => id !== quest.id) : [...current, quest.id]); };
    const surprise = (n: number) => {
        const pool = results.filter(quest => !selected.includes(quest.id) && !blocked(quest));
        const picks: string[] = [];
        while (picks.length < n && pool.length) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
        setPreview(null); setSelected(current => [...current, ...picks]);
    };
    const presets: { label: string; apply: () => void }[] = [
        { label: 'Warm-ups (5 min)', apply: () => { setQuery(''); setFilter({ maxMinutes: 5 }); } },
        { label: 'Auto-checked answers', apply: () => { setQuery(''); setFilter({ answers: ['text'] }); } },
        { label: 'Pair work', apply: () => { setQuery(''); setFilter({ formats: ['pair'] }); } },
        { label: 'Mingles', apply: () => { setQuery(''); setFilter({ formats: ['mingle'] }); } },
        ...(target && library?.chapters.some(c => c.id === target.chapter.id) && usedChapters.has(target.chapter.id) ? [{ label: `Story quests for ${chapterName(target.chapter.id)}`, apply: () => { setQuery(''); setFilter({ chapters: [target.chapter.id] }); } }] : []),
        { label: 'Halloween & autumn', apply: () => { setQuery(''); setFilter({ categories: categories.filter(c => /autumn/i.test(c.category)).map(c => c.category) }); } },
        { label: 'Christmas & winter', apply: () => { setQuery(''); setFilter({ categories: categories.filter(c => /winter/i.test(c.category)).map(c => c.category) }); } },
    ];
    const anyFilter = !!query || Object.values(filters).some(value => Array.isArray(value) ? value.length : !!value);

    // Writing, changing, deleting and restoring quests. Every answer brings the whole library back.
    const edit = (quest: SideQuest, creating = false) => { setConfirming(null); setEditing({ quest, creating, saved: false, key: Date.now() }); };
    const save = (quest: { id: string }) => run(async () => {
        const result = await request<Listing & { quest: SideQuest }>(token, 'side-quests/save', editing?.creating ? { quest, create: true } : { quest, version: versions[quest.id] });
        apply(result);
        setEditing({ quest: result.quest, creating: false, saved: true, key: Date.now() });
    });
    const remove = (quest: SideQuest) => run(async () => {
        apply(await request<Listing>(token, 'side-quests/delete', { id: quest.id, version: versions[quest.id] }));
        setConfirming(null); setSelected(current => current.filter(id => id !== quest.id)); if (editing?.quest.id === quest.id) setEditing(null);
        setNotice(`“${quest.title}” moved to Trash. Restore it from Trash whenever you need it.`);
    });
    const restore = (quest: SideQuest) => run(async () => {
        apply(await request<Listing>(token, 'side-quests/restore', { id: quest.id, version: versions[quest.id] }));
        setNotice(`“${quest.title}” is back in the library.`);
    });
    const importFile = (file: File) => run(async () => {
        let quests: unknown;
        try { quests = JSON.parse(await file.text()); } catch { throw new Error('That file is not a side quest file (JSON).'); }
        const result = await request<Listing & { imported: { added: number; updated: number; unchanged: number } }>(token, 'side-quests/import', { quests });
        apply(result);
        setNotice(`Imported ${file.name}: ${result.imported.added} new, ${result.imported.updated} changed, ${result.imported.unchanged} already the same.`);
    });

    return <main className="mission-page ql-page">
        <header className="mission-header"><div><p className="mission-eyebrow">PIXEL PLAZA · TEACHER WORKSPACE</p><h1>Side Quest Library</h1>
            <p>{library === null ? 'Quests' : `${quests.length} quests`} for fast finishers, warm-ups and sessions between chapters. Write your own or change any of them, then search, pick, and add them to the running game.</p>
            {sync && sync.state !== 'home' && <p className={`mission-sync mission-sync-${sync.state}`} role="status">{syncText(sync)}</p>}</div>
            <nav className="ql-links"><Link to="/teacher">Teacher controls</Link><Link to="/mission-studio">Mission Studio</Link></nav></header>
        {error && <p className="mission-error" role="alert">{error}</p>}{notice && <p className="mission-notice" role="status">{notice}</p>}
        {!token ? <form className="mission-card mission-login" onSubmit={e => { e.preventDefault(); void run(async () => {
            const response = await fetch('/api/teacher/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
            const result = await response.json(); if (!response.ok) throw new Error(result.error);
            storeTeacherSession(result.token); setToken(result.token); setPassword('');
        }); }}><h2>Teacher sign-in</h2><label className="mission-field"><span>Teacher password</span><input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label><button className="mission-button primary" disabled={busy}>Open the library</button></form>
        : <div className={`ql-layout${editing ? ' ql-editing' : ''}`}>
            <section className="ql-main">
                <div className="mission-card ql-search">
                    <label className="ql-searchbox"><span className="ql-sr">Search quests</span>
                        <input type="search" value={query} autoFocus placeholder='Search: food, debate, past simple, riddle, Christmas, hotel…' onChange={e => { setQuery(e.target.value); setShown(PAGE); setShowTrash(false); }} /></label>
                    <div className="ql-presets">{presets.map(preset => <button key={preset.label} type="button" className="ql-preset" onClick={() => { preset.apply(); setShowTrash(false); }}>{preset.label}</button>)}</div>
                    <div className="ql-filter" role="group" aria-label="Kind"><span>Kind</span><div>
                        {([['', 'All'], ['story', 'Story quests'], ['generic', 'Generic quests']] as const).map(([value, label]) =>
                            <button key={label} type="button" className={`ql-chip${(filters.kind ?? '') === value ? ' on' : ''}`} aria-pressed={(filters.kind ?? '') === value}
                                onClick={() => setFilter({ ...filters, kind: value || undefined })}>{label}</button>)}
                    </div></div>
                    <Chips label="Theme" values={THEMES.map(t => t.id)} chosen={filters.themes} counts={facets.themes} name={(id: QuestTheme) => THEMES.find(t => t.id === id)!.name} onChange={themes => setFilter({ ...filters, themes })} />
                    {(filters.kind === 'story' || filters.themes?.includes('story') || filters.chapters?.length) ? <Chips label="Chapter" values={(library ?? EMPTY).chapters.filter(c => usedChapters.has(c.id) || filters.chapters?.includes(c.id)).map(c => c.id)} chosen={filters.chapters} counts={facets.chapters} name={id => { const c = library!.chapters.find(item => item.id === id)!; return `${c.campaign} ${c.number}. ${c.title}`; }} onChange={chapters => setFilter({ ...filters, chapters })} /> : null}
                    <Chips label="Level" values={LEVELS.map(l => l.id)} chosen={filters.levels} counts={facets.levels} name={levelName} onChange={levels => setFilter({ ...filters, levels })} />
                    <Chips label="Who" values={FORMATS.map(f => f.id)} chosen={filters.formats} counts={facets.formats} name={(id: QuestFormat) => FORMATS.find(f => f.id === id)!.name} onChange={formats => setFilter({ ...filters, formats })} />
                    <Chips label="Answer" values={ANSWERS.map(a => a.id)} chosen={filters.answers} counts={facets.answers} name={(id: QuestAnswer) => ANSWERS.find(a => a.id === id)!.name} onChange={answers => setFilter({ ...filters, answers })} />
                    <div className="ql-row">
                        <label className="ql-select"><span>Category</span><select value={filters.categories?.length === 1 ? filters.categories[0] : ''} onChange={e => setFilter({ ...filters, categories: e.target.value ? [e.target.value] : undefined })}>
                            <option value="">All categories</option>
                            {THEMES.map(theme => <optgroup key={theme.id} label={theme.name}>{categories.filter(c => c.theme === theme.id).map(c => <option key={c.category} value={c.category}>{c.category} ({c.count})</option>)}</optgroup>)}
                        </select></label>
                        <label className="ql-select"><span>Time</span><select value={filters.maxMinutes ?? 0} onChange={e => setFilter({ ...filters, maxMinutes: Number(e.target.value) || undefined })}>
                            <option value={0}>Any length</option><option value={5}>5 minutes or less</option><option value={10}>10 minutes or less</option>
                        </select></label>
                        {target && <label className="ql-check"><input type="checkbox" checked={fitsOnly} onChange={e => setFitsOnly(e.target.checked)} />Only quests that fit {target.game.name} now</label>}
                        {anyFilter && <button type="button" className="mission-button" onClick={() => { setQuery(''); setFilter({}); setFitsOnly(false); }}>Clear search</button>}
                    </div>
                </div>
                <div className="mission-toolbar ql-count">
                    <h2>{showTrash ? `Trash (${trash.length})` : results.length === quests.length ? `All ${results.length} quests` : `${results.length} of ${quests.length} quests`}</h2>
                    <div className="ql-tools">
                        <button type="button" className="mission-button primary" disabled={busy || library === null} onClick={() => edit(blankQuest(), true)}>+ New side quest</button>
                        <button type="button" className="mission-button" disabled={busy || library === null} onClick={() => fileInput.current?.click()}>Import file</button>
                        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importFile(file); }} />
                        <button type="button" className="mission-button" disabled={!results.length} onClick={() => download(JSON.stringify({ quests: results }, null, 2), 'side-quests.json')}>Export {results.length === quests.length ? 'all' : 'these'}</button>
                        <button type="button" className="mission-button" aria-pressed={showTrash} onClick={() => setShowTrash(!showTrash)}>{showTrash ? 'Back to the library' : `Trash (${trash.length})`}</button>
                        {!showTrash && <button type="button" className="mission-button" disabled={!results.length || selected.length >= MAX_RELEASE} onClick={() => surprise(Math.min(5, MAX_RELEASE - selected.length))}>Pick 5 at random from these</button>}
                    </div></div>
                {showTrash ? <div className="mission-card">{trash.length ? trash.map(quest => <div className="mission-trash-row" key={quest.id}><span><strong>{quest.title}</strong> <small className="mission-muted">{quest.category} · {levelName(quest.level)}</small></span>
                    <button type="button" className="mission-button" disabled={busy} onClick={() => void restore(quest)}>Restore quest</button></div>)
                    : <p>Trash is empty.</p>}<p className="mission-muted">A quest in Trash cannot be added to games. Games that already have it keep it.</p></div>
                : <>
                {library !== null && !quests.length && <p className="mission-card ql-empty">The library is empty. On the class laptop the quests arrive from the online Pixel Plaza once you sign in to Teacher controls with internet. You can also write a quest or import a file.</p>}
                {!!quests.length && !results.length && <p className="mission-card ql-empty">No quests match. Try fewer words or clear a filter.</p>}
                <div className="ql-results">{results.slice(0, shown).map(quest => {
                    const reason = blocked(quest); const theme = THEMES.find(t => t.id === quest.theme)!;
                    const on = selected.includes(quest.id);
                    return <article key={quest.id} className={`ql-card ql-${quest.theme}${on ? ' selected' : ''}${editing?.quest.id === quest.id ? ' editing' : ''}`}>
                        <header>
                            <span className={`ql-kind ql-kind-${theme.kind}`}>{theme.kind === 'story' ? `Story · ${chapterName(quest.chapter)}` : `Generic · ${theme.name}`}</span>
                            <span className={`ql-level ql-level-${quest.level}`}>{levelName(quest.level)}</span>
                        </header>
                        <h3>{quest.title}</h3>
                        <p className="ql-meta">{quest.category} · {FORMATS.find(f => f.id === quest.format)!.name} · {quest.minutes} min · {quest.answer === 'text' ? 'Typed answer, checked by the game' : 'Written report for you to read'}{quest.roles?.length ? ` · only for: ${quest.roles.join(', ')}` : ''}</p>
                        <p className="ql-text">{quest.text}</p>
                        {!!quest.focus.length && <p className="ql-focus">Focus: {quest.focus.join(' · ')}</p>}
                        <details><summary>Teacher note{quest.answer === 'text' ? ' and answers' : ''}</summary>
                            <p>{quest.teacherNote}</p>
                            {quest.answer === 'text' && <p><strong>Accepted:</strong> {quest.accept.join(' · ')}</p>}
                            {quest.after && <p>Unlocks after the main question <code>{quest.after}</code>.</p>}
                            {quest.afterMain && <p>Unlocks when a student has finished the chapter's main mystery.</p>}
                            <p className="ql-tags">{quest.tags.map(tag => <button key={tag} type="button" onClick={() => { setQuery(tag); setShown(PAGE); }}>#{tag}</button>)}</p>
                            <p className="mission-muted">ID {quest.id}</p>
                        </details>
                        {confirming === quest.id
                            ? <div className="ql-confirm" role="alert"><span>Move to Trash?</span><button type="button" className="mission-button danger" disabled={busy} onClick={() => void remove(quest)}>Move to Trash</button><button type="button" className="mission-button" onClick={() => setConfirming(null)}>Keep</button></div>
                            : <div className="ql-edit-row"><button type="button" onClick={() => edit(quest)}>Edit</button><button type="button" onClick={() => edit({ ...quest, title: `${quest.title.slice(0, 110)} (copy)` }, true)}>Duplicate</button><button type="button" className="danger" onClick={() => setConfirming(quest.id)}>Delete</button></div>}
                        <footer>{reason ? <span className="ql-reason">{reason}</span> : <span />}
                            <button type="button" className={`mission-button${on ? ' primary' : ''}`} disabled={!on && (!!reason || selected.length >= MAX_RELEASE)} onClick={() => pick(quest)}>{on ? 'Selected ✓' : 'Select'}</button></footer>
                    </article>;
                })}</div>
                {results.length > shown && <button type="button" className="mission-button ql-more" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, results.length - shown)} more</button>}
                </>}
            </section>

            {editing ? <aside className="mission-card ql-tray" aria-label="Side quest editor">
                <SideQuestEditor key={editing.key} quest={editing.quest} creating={editing.creating} saved={editing.saved} busy={busy}
                    chapters={library?.chapters ?? []} categories={categories.map(c => c.category)} onSave={quest => void save(quest)} onClose={() => setEditing(null)} />
            </aside>
            : <aside className="mission-card ql-tray" aria-label="Your selection">
                <div className="mission-toolbar"><h2>Your selection</h2><button type="button" className="mission-button" disabled={busy} onClick={() => void refresh()}>Refresh game</button></div>
                {target ? <p className="ql-target"><strong>{target.game.name}</strong> · {target.campaign.title}<br />Chapter {target.chapter.index + 1}: {target.chapter.title}
                    {!target.open && <><br /><em>Open this game in Teacher controls to add quests.</em></>}{target.ended && <><br /><em>This campaign has ended.</em></>}</p>
                    : <p className="ql-target">No game is running. In Teacher controls, open a game and start a campaign (for example <strong>Plaza Free Play</strong>) to add quests. You can still browse, write and download.</p>}
                <p className="mission-muted">{selected.length} of {MAX_RELEASE} chosen. The game adds up to {MAX_RELEASE} at a time.</p>
                {chosen.length ? <ol className="ql-chosen">{chosen.map(quest => <li key={quest.id}><span>{quest.title} <small>{quest.level} · {quest.theme === 'story' ? chapterName(quest.chapter) : THEMES.find(t => t.id === quest.theme)!.name}</small></span>
                    <button type="button" aria-label={`Remove ${quest.title}`} onClick={() => pick(quest)}>×</button></li>)}</ol> : <p>Select quests from the results.</p>}
                <fieldset className="ql-actions" disabled={busy}>
                    <button type="button" className="mission-button primary" disabled={!target?.open || target.ended || !chosen.length || chosen.some(quest => !!blocked(quest))} onClick={() => void run(async () => {
                        const result = await request<{ target: LiveMissionTarget; preview: LiveMissionPreview }>(token, 'missions/library-preview', { gameId: target!.game.id, targetVersion: target!.version, targetEpoch: target!.epoch, chapterId: target!.chapter.id, questIds: selected });
                        setTarget(result.target); setPreview(result.preview);
                    })}>Review and add to the game</button>
                    <button type="button" className="mission-button" disabled={!chosen.length} onClick={() => download(missionPack(chosen), 'side-quest-pack.json')}>Download for Mission Studio</button>
                    {!!selected.length && <button type="button" className="mission-button" onClick={() => { setSelected([]); setPreview(null); }}>Clear selection</button>}
                </fieldset>
                {preview && <div className="mission-import-preview"><h3>Ready to release to {preview.game.name}</h3>
                    <p className="mission-muted">This review expires at {new Date(preview.expires).toLocaleTimeString()}. Students who can accept now:</p>
                    <ul>{preview.quests.map(quest => <li key={quest.id}><strong>{quests.find(q => q.id === quest.id)?.title ?? quest.id}</strong> · {quest.audience} · {quest.eligibleNow} now</li>)}</ul>
                    <div className="mission-toolbar"><button type="button" className="mission-button primary" disabled={busy} onClick={() => void run(async () => {
                        const result = await request<{ target: LiveMissionTarget; released: string[] }>(token, 'missions/live-release', { previewId: preview.id });
                        setTarget(result.target); setPreview(null); setSelected([]); setNotice(`${result.released.length} quests are on the quest board in ${preview.game.name}.`);
                    })}>Release to students</button>
                    <button type="button" className="mission-button" disabled={busy} onClick={() => void run(async () => { await request(token, 'missions/live-cancel', { previewId: preview.id }); setPreview(null); })}>Cancel</button></div>
                </div>}
                {!!target?.additions.length && <details className="ql-added"><summary>Added to this chapter ({target.additions.length})</summary>
                    <ul>{target.additions.map(item => <li key={item.id}>{quests.find(q => q.id === item.id)?.title ?? item.text}{item.withdrawn ? ' · withdrawn' : item.started ? ' · started' : ''}</li>)}</ul>
                    <p className="mission-muted">Withdraw unstarted quests in Mission Studio.</p></details>}
                <details className="ql-help"><summary>How it works</summary>
                    <p><strong>Story quests</strong> use one chapter of a story mission and can be added while that chapter runs. <strong>Generic quests</strong> work in any game, also in a free-play mission between chapters.</p>
                    <p>Levels: {LEVELS.map(l => `${l.id} ${l.name}: ${l.description}`).join(' ')}</p>
                    <p>Students accept a quest on their quest board, do it and type their answer. Typed answers are checked by the game; written reports count once a student writes a real attempt, and you read them in Teacher controls.</p>
                    <p>Every quest is yours to change: <strong>Edit</strong> it, <strong>Duplicate</strong> it to make a variant, or <strong>Delete</strong> it (it goes to Trash). <strong>Export</strong> saves quests as a file; <strong>Import file</strong> adds the quests in a file and updates those with the same ID.</p>
                </details>
            </aside>}
        </div>}
    </main>;
}
