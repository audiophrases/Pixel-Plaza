import { useState } from 'react';
import { boardWait, isUnlocked, prerequisiteIds, type Campaign, type Chapter, type Objective, type Role } from '../../shared/campaign';
import { plazaMap } from '../../shared/plazaMap';

export function MissionField({ label, value, onChange, multiline = false, maxLength = 6000 }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; maxLength?: number }) {
    return <label className="mission-field"><span>{label}</span>{multiline
        ? <textarea value={value} maxLength={maxLength} rows={3} onChange={e => onChange(e.target.value)} />
        : <input value={value} maxLength={maxLength} onChange={e => onChange(e.target.value)} />}</label>;
}
const freshId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

function Prerequisites({ objective, chapter, onChange }: { objective: Objective; chapter: Chapter; onChange: (patch: Partial<Objective>) => void }) {
    const ids = prerequisiteIds(objective); const mode = objective.requires?.mode ?? (objective.after ? 'single' : 'start');
    return <div><label className="mission-field"><span>Unlock rule</span><select value={mode} onChange={e => {
        const next = e.target.value;
        onChange(next === 'start' ? { after: undefined, requires: undefined } : next === 'single' ? { after: ids[0], requires: undefined } : { after: undefined, requires: { mode: next as 'all' | 'any', objectives: [...ids] } });
    }}><option value="start">Available from the start</option>{objective.after && <option value="single">After one objective (existing rule)</option>}<option value="all">After all selected objectives</option><option value="any">After any selected objective</option></select></label>
        {mode === 'single' ? <label className="mission-field"><span>Unlock after</span><select value={objective.after} onChange={e => onChange({ after: e.target.value || undefined })}><option value="">Available from the start</option>{chapter.objectives.filter(o => o.id !== objective.id).map(o => <option key={o.id} value={o.id}>{o.text.slice(0, 65) || o.id}</option>)}</select></label>
        : mode !== 'start' && <div className="mission-checklist">{chapter.objectives.filter(o => o.id !== objective.id).map(o => <label key={o.id}><input type="checkbox" checked={ids.includes(o.id)} onChange={e => onChange({ after: undefined, requires: { mode: mode as 'all' | 'any', objectives: e.target.checked ? [...ids, o.id] : ids.filter(id => id !== o.id) } })} />{o.text.slice(0, 80) || o.id}{o.optional ? ' (optional)' : ''}</label>)}</div>}
    </div>;
}

function RoleClues({ roles, value, onChange, label }: { roles: Role[]; value?: Record<string, string>; onChange: (value: Record<string, string>) => void; label: string }) {
    return <details className="mission-details"><summary>{label}</summary>{roles.map(role => <MissionField key={role.id} label={role.name || role.id} multiline value={value?.[role.id] ?? ''} onChange={text => {
        const next = { ...value }; if (text) next[role.id] = text; else delete next[role.id]; onChange(next);
    }} />)}</details>;
}

export default function MissionEditor({ campaign, chapterIndex, setChapterIndex, onChange }: { campaign: Campaign; chapterIndex: number; setChapterIndex: (value: number) => void; onChange: (campaign: Campaign) => void }) {
    const chapter = campaign.chapters[chapterIndex];
    const updateChapter = (patch: Partial<Chapter>) => onChange({ ...campaign, chapters: campaign.chapters.map((c, i) => i === chapterIndex ? { ...c, ...patch } : c) });
    const updateObjective = (index: number, patch: Partial<Objective>) => updateChapter({ objectives: chapter.objectives.map((o, i) => i === index ? { ...o, ...patch } : o) });
    const move = <T,>(items: T[], index: number, offset: number): T[] => {
        const next = [...items]; const target = index + offset;
        if (target < 0 || target >= next.length) return next;
        [next[index], next[target]] = [next[target], next[index]]; return next;
    };
    return <div className="mission-editor">
        <section className="mission-card"><h2>Campaign</h2><p className="mission-muted">ID: {campaign.id}</p>
            <MissionField label="Campaign title" value={campaign.title} maxLength={120} onChange={title => onChange({ ...campaign, title })} />
            <MissionField label="Finale" value={campaign.finale} multiline onChange={finale => onChange({ ...campaign, finale })} />
            <details className="mission-details"><summary>Roles and starting clues ({campaign.roles.length})</summary>
                {campaign.roles.map((role, i) => <fieldset key={role.id}><legend>{role.name || role.id}</legend><small>ID: {role.id}</small>
                    {(['name', 'card', 'clue'] as const).map(key => <MissionField key={key} label={{ name: 'Role name', card: 'Role card', clue: 'Starting clue' }[key]} value={role[key]} multiline={key !== 'name'} maxLength={key === 'name' ? 120 : 6000}
                        onChange={text => onChange({ ...campaign, roles: campaign.roles.map((r, j) => i === j ? { ...r, [key]: text } : r) })} />)}
                    <button className="mission-button danger" onClick={() => onChange({ ...campaign, roles: campaign.roles.filter((_, j) => i !== j) })}>Remove role</button>
                </fieldset>)}
                <button className="mission-button" disabled={campaign.roles.length >= 20} onClick={() => onChange({ ...campaign, roles: [...campaign.roles, { id: freshId('role'), name: 'New role', card: '', clue: '' }] })}>Add role</button>
            </details>
        </section>
        <section className="mission-card"><div className="mission-toolbar"><h2>Chapters</h2><button className="mission-button" disabled={campaign.chapters.length >= 20} onClick={() => {
            const next: Chapter = { id: freshId('chapter'), title: 'New chapter', intro: '', recap: '', ending: '', share: 0.6, objectives: [], discoveries: [], reveals: [] };
            onChange({ ...campaign, chapters: [...campaign.chapters, next] }); setChapterIndex(campaign.chapters.length);
        }}>Add chapter</button></div>
            <nav className="mission-chapters" aria-label="Chapters">{campaign.chapters.map((c, i) => <button key={c.id} className={i === chapterIndex ? 'selected' : ''} aria-current={i === chapterIndex ? 'step' : undefined} onClick={() => setChapterIndex(i)}>{i + 1}. {c.title || 'Untitled'}</button>)}</nav>
            {chapter && <>
                <p className="mission-muted">ID: {chapter.id}</p>
                <div className="mission-toolbar"><button className="mission-button" disabled={chapterIndex === 0} onClick={() => { onChange({ ...campaign, chapters: move(campaign.chapters, chapterIndex, -1) }); setChapterIndex(chapterIndex - 1); }}>Move chapter earlier</button>
                    <button className="mission-button" disabled={chapterIndex === campaign.chapters.length - 1} onClick={() => { onChange({ ...campaign, chapters: move(campaign.chapters, chapterIndex, 1) }); setChapterIndex(chapterIndex + 1); }}>Move chapter later</button>
                    <button className="mission-button danger" onClick={() => { onChange({ ...campaign, chapters: campaign.chapters.filter((_, i) => i !== chapterIndex) }); setChapterIndex(0); }}>Remove chapter</button></div>
                {(['title', 'intro', 'recap', 'ending'] as const).map(key => <MissionField key={key} label={{ title: 'Chapter title', intro: 'Opening story', recap: 'Previously', ending: 'Chapter ending' }[key]} value={chapter[key]} multiline={key !== 'title'} maxLength={key === 'title' ? 120 : 6000} onChange={text => updateChapter({ [key]: text })} />)}
                <label className="mission-field"><span>Class readiness threshold (%)</span><input type="number" min={1} max={100} value={Math.round(chapter.share * 100)} onChange={e => updateChapter({ share: Number(e.target.value) / 100 })} /></label>
                <p className="mission-muted">Questions stay open until the teacher advances the chapter.</p>
                <RoleClues roles={campaign.roles} value={chapter.roleClues} label="Clues at the start of this chapter" onChange={roleClues => updateChapter({ roleClues })} />
                <details className="mission-details"><summary>Secret thief</summary><label><input type="checkbox" checked={!!chapter.thieves} onChange={e => updateChapter({ thieves: e.target.checked ? { card: '', story: '' } : undefined })} /> Use a secret thief</label>
                    {chapter.thieves && <>
                        <label><input type="checkbox" checked={!!chapter.thieves.carry} onChange={e => updateChapter({ thieves: { ...chapter.thieves!, carry: e.target.checked } })} /> Keep the preceding chapter's thief</label>
                        {(['card', 'story', 'label'] as const).map(key => <MissionField key={key} label={{ card: 'Secret card', story: 'Story to tell classmates', label: 'Story label' }[key]} value={chapter.thieves?.[key] ?? ''} multiline={key !== 'label'} maxLength={key === 'label' ? 120 : 6000} onChange={text => updateChapter({ thieves: { ...chapter.thieves!, [key]: text } })} />)}
                    </>}
                </details>
                <h3>Objectives and answers</h3>
                <details className="mission-details"><summary>Quest links</summary><div className="mission-table-wrap"><table><thead><tr><th>Objective</th><th>Unlock rule</th><th>Prerequisites</th><th>Audience</th></tr></thead><tbody>{chapter.objectives.map(o => <tr key={o.id}><td>{o.text || o.id}</td><td>{prerequisiteIds(o).length ? o.requires?.mode === 'any' ? 'Any selected' : 'All selected' : 'From the start'}</td><td>{prerequisiteIds(o).map(id => chapter.objectives.find(q => q.id === id)?.text || id).join('; ') || '—'}</td><td>{o.board ? 'Quest board' : o.optional ? 'Optional question' : 'Main story'}</td></tr>)}</tbody></table></div></details>
                {chapter.objectives.map((objective, i) => <fieldset key={objective.id}><legend>{i + 1}. {objective.optional ? 'Optional quest' : 'Main objective'}</legend><small>ID: {objective.id}</small>
                    <MissionField label="Student instructions" value={objective.text} multiline onChange={text => updateObjective(i, { text })} />
                    <label className="mission-field"><span>Answer mode</span><select value={objective.activity ?? (objective.kind === 'report' ? 'report' : objective.answerRole ? 'role' : objective.answerThief ? 'thief' : 'text')} onChange={e => {
                        const value = e.target.value; const social = value === 'interview' || value === 'exchange';
                        updateObjective(i, { kind: value === 'report' || social ? 'report' : undefined, activity: social ? value : undefined,
                            answerThief: value === 'thief' ? true : undefined, answerRole: value === 'role' ? campaign.roles[0]?.id : undefined, accept: [],
                            board: value === 'thief' ? undefined : social ? objective.board ?? { afterMain: true, minPlayers: 2 } : objective.board ? { ...objective.board, partnerRole: undefined, differentRole: undefined } : undefined,
                            ...(social ? { optional: true, thiefKnows: undefined } : {}) });
                    }}><option value="text">Accepted phrase</option><option value="role">Name of a classmate with a role</option><option value="thief">Name of the thief</option><option value="report">Written report</option><option value="interview">Interview a partner</option><option value="exchange">Exchange information with a partner</option></select></label>
                    <Prerequisites objective={objective} chapter={chapter} onChange={patch => updateObjective(i, patch)} />
                    {objective.answerRole && <label className="mission-field"><span>Find a classmate with this role</span><select value={objective.answerRole} onChange={e => updateObjective(i, { answerRole: e.target.value })}>{campaign.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
                    {!objective.kind && !objective.answerThief && !objective.answerRole && <MissionField label="Accepted answers (one per line)" value={objective.accept.join('\n')} multiline maxLength={3630} onChange={text => updateObjective(i, { accept: text.split('\n') })} />}
                    {objective.kind === 'report' && <p className="mission-muted">Five words count as an attempt. The teacher reads the report.</p>}
                    <div className="mission-toolbar"><label><input type="checkbox" checked={!!objective.optional} onChange={e => updateObjective(i, { optional: e.target.checked, ...(!e.target.checked ? { board: undefined, activity: undefined } : {}) })} /> Optional quest</label><label><input type="checkbox" checked={!!objective.thiefKnows} onChange={e => updateObjective(i, { thiefKnows: e.target.checked })} /> Thief already knows the answer</label></div>
                    <label><input type="checkbox" checked={!!objective.board} onChange={e => updateObjective(i, e.target.checked ? { optional: true, board: { afterMain: true } } : { board: undefined, activity: undefined })} /> Offer on the quest board</label>
                    {objective.board && <div className="mission-board-settings"><p className="mission-muted">Each student can accept this quest once in a game.</p>
                        <label><input type="checkbox" checked={!!objective.board.afterMain} onChange={e => updateObjective(i, { board: { ...objective.board, afterMain: e.target.checked } })} /> For investigators who have finished the main mystery (including their partners)</label>
                        <label><input type="checkbox" checked={!!objective.board.teacherReleased} onChange={e => updateObjective(i, { board: { ...objective.board, teacherReleased: e.target.checked } })} /> Hide until the teacher releases it</label>
                        <label className="mission-field"><span>Minimum online students</span><input type="number" min={1} max={40} value={objective.board.minPlayers ?? (objective.activity ? 2 : 1)} onChange={e => updateObjective(i, { board: { ...objective.board, minPlayers: Number(e.target.value) } })} /></label>
                        <p>Who can accept it? Leave all roles unchecked to include everyone.</p><div className="mission-checklist">{campaign.roles.map(role => <label key={role.id}><input type="checkbox" checked={objective.board?.roles?.includes(role.id) ?? false} onChange={e => updateObjective(i, { board: { ...objective.board, roles: e.target.checked ? [...(objective.board?.roles ?? []), role.id] : objective.board?.roles?.filter(id => id !== role.id) } })} />{role.name}</label>)}</div>
                        {objective.activity && <><label className="mission-field"><span>Partner role</span><select value={objective.board.partnerRole ?? ''} onChange={e => updateObjective(i, { board: { ...objective.board, partnerRole: e.target.value || undefined } })}><option value="">Any other investigator</option>{campaign.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label><input type="checkbox" checked={!!objective.board.differentRole} onChange={e => updateObjective(i, { board: { ...objective.board, differentRole: e.target.checked } })} /> Assign a partner with a different role</label><p className="mission-muted">The report records the assigned partner but does not verify speaking.</p></>}
                    </div>}
                    <RoleClues roles={campaign.roles} value={objective.rewards} label="Clues awarded after this answer" onChange={rewards => updateObjective(i, { rewards })} />
                    <div className="mission-toolbar"><button className="mission-button" disabled={i === 0} onClick={() => updateChapter({ objectives: move(chapter.objectives, i, -1) })}>Move earlier</button><button className="mission-button" disabled={i === chapter.objectives.length - 1} onClick={() => updateChapter({ objectives: move(chapter.objectives, i, 1) })}>Move later</button>
                        <button className="mission-button" disabled={chapter.objectives.length >= 100} onClick={() => updateChapter({ objectives: [...chapter.objectives, { ...structuredClone(objective), id: freshId('quest') }] })}>Duplicate quest</button>
                        <button className="mission-button danger" onClick={() => updateChapter({ objectives: chapter.objectives.filter((_, j) => i !== j) })}>Remove quest</button></div>
                </fieldset>)}
                <button className="mission-button" disabled={chapter.objectives.length >= 100} onClick={() => updateChapter({ objectives: [...chapter.objectives, { id: freshId('quest'), text: '', accept: [] }] })}>Add objective or quest</button>
                <details className="mission-details"><summary>Discoveries on the map ({chapter.discoveries.length})</summary>{chapter.discoveries.map((discovery, i) => <fieldset key={discovery.id}><legend>{discovery.id}</legend>
                    <label className="mission-field"><span>Location</span><select value={discovery.zone} onChange={e => updateChapter({ discoveries: chapter.discoveries.map((d, j) => i === j ? { ...d, zone: e.target.value } : d) })}>{plazaMap.zones.map(z => <option key={z.id}>{z.id}</option>)}</select></label>
                    <MissionField label="Discovery clue" value={discovery.text} multiline onChange={text => updateChapter({ discoveries: chapter.discoveries.map((d, j) => i === j ? { ...d, text } : d) })} />
                    <button className="mission-button danger" onClick={() => updateChapter({ discoveries: chapter.discoveries.filter((_, j) => i !== j) })}>Remove discovery</button></fieldset>)}
                    <button className="mission-button" disabled={chapter.discoveries.length >= 100} onClick={() => updateChapter({ discoveries: [...chapter.discoveries, { id: freshId('clue'), zone: plazaMap.zones[0].id, text: '' }] })}>Add discovery</button></details>
                <details className="mission-details"><summary>Teacher news ({chapter.reveals.length})</summary>{chapter.reveals.map((news, i) => <fieldset key={news.id}><legend>News {i + 1}</legend>
                    <MissionField label="News text" value={news.text} multiline onChange={text => updateChapter({ reveals: chapter.reveals.map((n, j) => i === j ? { ...n, text } : n) })} />
                    <button className="mission-button" disabled={i === 0} onClick={() => updateChapter({ reveals: move(chapter.reveals, i, -1) })}>Move earlier</button> <button className="mission-button danger" onClick={() => updateChapter({ reveals: chapter.reveals.filter((_, j) => i !== j) })}>Remove news</button></fieldset>)}
                    <button className="mission-button" disabled={chapter.reveals.length >= 100} onClick={() => updateChapter({ reveals: [...chapter.reveals, { id: freshId('news'), text: '' }] })}>Add teacher news</button></details>
                <h3>When clues arrive</h3><div className="mission-table-wrap"><table><thead><tr><th>Role</th><th>At chapter start</th>{chapter.objectives.filter(o => o.rewards).map(o => <th key={o.id}>After: {o.text}</th>)}</tr></thead><tbody>{campaign.roles.map(role => <tr key={role.id}><th>{role.name}</th><td>{chapter.roleClues?.[role.id] ?? role.clue}</td>{chapter.objectives.filter(o => o.rewards).map(o => <td key={o.id}>{o.rewards?.[role.id] ?? '—'}</td>)}</tr>)}</tbody></table></div>
            </>}
        </section>
    </div>;
}

export function MissionPreview({ campaign, chapter }: { campaign: Campaign; chapter?: Chapter }) {
    const [roleId, setRoleId] = useState(''); const [thief, setThief] = useState(false); const [step, setStep] = useState(0); const [rosterSize, setRosterSize] = useState(20);
    const role = campaign.roles.find(r => r.id === roleId) ?? campaign.roles[0];
    if (!chapter || !role) return <p>Add a chapter and a role to preview the journal.</p>;
    const done = chapter.objectives.slice(0, step).map(o => o.id);
    if (thief) for (const o of chapter.objectives.filter(o => o.thiefKnows || o.answerThief)) done.push(o.id);
    return <section className="mission-card"><h2>Student journal preview</h2><p className="mission-muted">Simulation only. Avatar clues use placeholders; discovery clues and news are listed separately in the editor.</p>
        <label className="mission-field"><span>Role</span><select value={role.id} onChange={e => setRoleId(e.target.value)}>{campaign.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label><input type="checkbox" checked={thief} disabled={!chapter.thieves} onChange={e => setThief(e.target.checked)} /> Preview as the thief</label>
        <label className="mission-field"><span>Mark the first {Math.min(step, chapter.objectives.length)} objectives answered</span><input type="range" min={0} max={chapter.objectives.length} value={Math.min(step, chapter.objectives.length)} onChange={e => setStep(Number(e.target.value))} /></label>
        <label className="mission-field"><span>Simulated class size</span><input type="number" min={1} max={40} value={rosterSize} onChange={e => setRosterSize(Number(e.target.value))} /></label>
        {rosterSize < campaign.roles.length && <p className="mission-warning">Some roles will be missing. Prepare news with the clues they would hold.</p>}
        <div className="mission-journal"><h3>{chapter.title}</h3><p>{chapter.intro}</p><h4>You are {role.name}</h4><p>{role.card}</p><h4>What you know</h4><ul>
            <li>{thief && chapter.thieves ? chapter.thieves.story : chapter.roleClues?.[role.id] ?? role.clue}</li>
            {chapter.objectives.filter(o => done.includes(o.id) && o.rewards?.[role.id]).map(o => <li key={o.id}>{o.rewards![role.id]}</li>)}
        </ul>{thief && chapter.thieves && <><h4>Your secret</h4><p>{chapter.thieves.card}</p></>}
            <h4>Available objectives</h4><ul>{chapter.objectives.filter(o => !o.board && isUnlocked(o, done) && !(thief && chapter.thieves && (o.thiefKnows || o.answerThief))).map(o => <li key={o.id}>{done.includes(o.id) ? '✓ ' : ''}{o.text}{o.optional ? ' (optional)' : ''}</li>)}</ul>
            {chapter.objectives.some(o => o.board) && <><h4>Quest board offers</h4><p>This preview assumes teacher-gated quests have been released. The game checks partner availability.</p><ul>{chapter.objectives.filter(o => o.board && (!o.board.roles?.length || o.board.roles.includes(role.id))).map(o => <li key={o.id}>{o.text} — {done.includes(o.id) ? 'Report submitted' : boardWait(o, chapter, role.id, done, true, rosterSize) ?? 'Available to accept'}</li>)}</ul></>}
        </div>
    </section>;
}
