import { prerequisiteIds, type Campaign, type Chapter, type Objective, type Role } from '../../shared/campaign';
import MissionField from './MissionField';
import { MissionIcon, RoleBadge } from './MissionVisuals';
import { changeStepType, stepType, stepTypes, type StepType } from './missionEditing';

export function RoleClues({ roles, value, onChange, label, inherited = false }: { roles: Role[]; value?: Record<string, string>; onChange: (value: Record<string, string>) => void; label: string; inherited?: boolean }) {
    const count = roles.filter(role => value?.[role.id]?.trim()).length;
    return <details className="mission-details mission-reward-editor" data-editor-section={inherited ? 'chapter-clues' : 'reward-clues'}><summary><MissionIcon name="clue" /> {label}<span className="mission-count">{count} / {roles.length} roles</span></summary><p className="mission-muted">Each student sees only their role’s clue. {inherited ? 'An empty field keeps the role’s usual starting clue.' : 'An empty field gives no new clue after this task.'}</p><div className="mission-reward-grid">{roles.map((role, i) => <div key={role.id} className={`mission-reward-card role-tone-${i % 6}`}><div><RoleBadge role={role} index={i} /><small>{value?.[role.id]?.trim() ? 'CLUE ADDED' : inherited ? 'USING STARTING CLUE' : 'NO NEW CLUE'}</small></div><MissionField label={role.name || 'Unnamed role'} multiline placeholder={inherited ? role.clue : `What will ${role.name || 'this role'} learn?`} value={value?.[role.id] ?? ''} onChange={text => {
        const next = { ...value }; if (text.trim()) next[role.id] = text; else delete next[role.id]; onChange(next);
    }} /></div>)}</div></details>;
}

function Prerequisites({ objective, chapter, onChange }: { objective: Objective; chapter: Chapter; onChange: (patch: Partial<Objective>) => void }) {
    const ids = prerequisiteIds(objective); const mode = objective.requires?.mode ?? (objective.after ? 'single' : 'start');
    const dependsOn = (candidate: Objective, target: string, visited = new Set<string>()): boolean => {
        if (visited.has(candidate.id)) return false;
        visited.add(candidate.id);
        return prerequisiteIds(candidate).some(id => id === target || !!chapter.objectives.find(o => o.id === id && dependsOn(o, target, visited)));
    };
    const choices = chapter.objectives.filter(o => o.id !== objective.id && (objective.optional || !o.optional) && !dependsOn(o, objective.id));
    return <div className="mission-unlock"><label className="mission-field"><span>When does this step open?</span><select value={mode} onChange={e => {
        const next = e.target.value; const selected = ids.filter(id => choices.some(o => o.id === id));
        const first = selected[0] ?? choices.at(-1)?.id;
        onChange(next === 'start' ? { after: undefined, requires: undefined } : next === 'single' ? { after: first, requires: undefined } : { after: undefined, requires: { mode: next as 'all' | 'any', objectives: selected.length ? selected : first ? [first] : [] } });
    }}><option value="start">At the start of the chapter</option><option value="single" disabled={!choices.length}>After another step</option><option value="all" disabled={!choices.length}>After all the steps I choose</option><option value="any" disabled={!choices.length}>After any one of the steps I choose</option></select></label>
        {mode === 'single' ? <label className="mission-field"><span>Complete this step first</span><select value={objective.after} onChange={e => onChange({ after: e.target.value })}>{choices.map(o => <option key={o.id} value={o.id}>Step {chapter.objectives.indexOf(o) + 1}: {o.text.slice(0, 90) || 'Untitled step'}</option>)}</select></label>
        : mode !== 'start' && <div className="mission-checklist">{choices.map(o => <label key={o.id}><input type="checkbox" checked={ids.includes(o.id)} onChange={e => onChange({ after: undefined, requires: { mode: mode as 'all' | 'any', objectives: e.target.checked ? [...ids, o.id] : ids.filter(id => id !== o.id) } })} />Step {chapter.objectives.indexOf(o) + 1}: {o.text.slice(0, 100) || 'Untitled step'}</label>)}</div>}
        <p className="mission-muted">The list controls display order. This rule controls when students can begin.</p>
    </div>;
}

export default function MissionStepEditor({ objective, chapter, campaign, onChange }: { objective: Objective; chapter: Chapter; campaign: Campaign; onChange: (patch: Partial<Objective>) => void }) {
    const type = stepType(objective); const info = stepTypes.find(t => t.id === type)!;
    const gatesMain = chapter.objectives.some(o => !o.optional && prerequisiteIds(o).includes(objective.id));
    return <>
        <details className="mission-details mission-change-type"><summary><span className="mission-inline-type" aria-hidden="true">{info.icon}</span> {info.name}<span className="mission-summary-note">Change task type</span></summary><label className="mission-field"><span>Step type</span><select value={type} onChange={e => onChange(changeStepType(objective, e.target.value as StepType, campaign.roles[0]?.id))}>{stepTypes.map(t => <option key={t.id} value={t.id} disabled={t.id === 'thief' && !chapter.thieves && type !== 'thief' || t.id === 'role' && !campaign.roles.length || gatesMain && (t.id === 'interview' || t.id === 'exchange')}>{t.name}</option>)}</select></label><p className="mission-muted">{info.description} Changing type keeps your instructions and resets the answer settings.</p></details>
        <div className="mission-form-section-title"><span>1</span><h3>The student’s task</h3></div>
        <MissionField label="What should students do?" value={objective.text} placeholder="For example: Where was the missing box last seen?" multiline onChange={text => onChange({ text })} />
        {type === 'text' && <><MissionField label="Accepted answers (one per line)" value={objective.accept.join('\n')} placeholder={'For example:\npark\npond'} multiline maxLength={3630} onChange={text => onChange({ accept: text.split('\n') })} onBlur={() => { const accept = objective.accept.map(a => a.trim()).filter(Boolean); if (JSON.stringify(accept) !== JSON.stringify(objective.accept)) onChange({ accept }); }} /><p className="mission-muted">Add alternative words or phrases that should also count as correct.</p></>}
        {type === 'role' && <label className="mission-field"><span>Which role should they find?</span><select value={objective.answerRole} onChange={e => onChange({ answerRole: e.target.value })}>{campaign.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
        {type === 'thief' && <p className="mission-tip">The game checks the name of the assigned thief. You do not need to enter an answer.</p>}
        {objective.kind === 'report' && <p className="mission-tip">A response of five words counts as an attempt. You read the report; it is not automatically graded. Required evidence exchanges need approval first.</p>}
        <div className="mission-form-section-title"><span>2</span><h3>When &amp; where it appears</h3></div>
        <label className="mission-field"><span>Where does this step appear?</span><select value={objective.board ? 'board' : objective.optional ? 'optional' : 'main'} onChange={e => {
            const value = e.target.value;
            const ids = prerequisiteIds(objective).filter(id => chapter.objectives.some(o => o.id === id && !o.optional));
            onChange({ optional: value !== 'main', board: value === 'board' ? { afterMain: true } : undefined, ...(value === 'board' ? { thiefKnows: undefined } : {}), ...(value === 'main' ? { after: objective.after && ids.includes(objective.after) ? objective.after : undefined, requires: objective.requires && ids.length ? { ...objective.requires, objectives: ids } : undefined } : {}) });
        }}><option value="main" disabled={!!objective.activity}>Main steps · everyone completes these</option><option value="optional" disabled={!!objective.activity || gatesMain}>Bonus steps · students may skip these</option><option value="board" disabled={!!objective.answerThief || gatesMain}>Quest board · students choose to accept</option></select></label>
        {gatesMain && <p className="mission-muted">Other main steps wait for this one. Change their opening rules first to turn this into a bonus or partner task.</p>}
        {objective.activity && <p className="mission-muted">Partner activities are optional quest board tasks. The game assigns a partner.</p>}
        <Prerequisites objective={objective} chapter={chapter} onChange={onChange} />
        {objective.board && <details className="mission-details" open={!!objective.activity}><summary>Who can take this quest?</summary><div className="mission-board-settings">
            <label><input type="checkbox" checked={!!objective.board.afterMain} onChange={e => onChange({ board: { ...objective.board, afterMain: e.target.checked } })} />Only after finishing the main steps (also applies to partners)</label>
            <label><input type="checkbox" checked={!!objective.board.teacherReleased} onChange={e => onChange({ board: { ...objective.board, teacherReleased: e.target.checked } })} />Hide until I release it in Teacher controls</label>
            <label className="mission-field"><span>Minimum online students</span><input type="number" min={objective.activity ? 2 : 1} max={40} value={objective.board.minPlayers ?? (objective.activity ? 2 : 1)} onChange={e => onChange({ board: { ...objective.board, minPlayers: Math.max(objective.activity ? 2 : 1, Math.min(40, Number(e.target.value) || 1)) } })} /></label>
            <p className="mission-muted">Available to these roles. Leave all unchecked for everyone.</p><div className="mission-checklist">{campaign.roles.map(role => <label key={role.id}><input type="checkbox" checked={objective.board?.roles?.includes(role.id) ?? false} onChange={e => onChange({ board: { ...objective.board, roles: e.target.checked ? [...(objective.board?.roles ?? []), role.id] : objective.board?.roles?.filter(id => id !== role.id) } })} />{role.name}</label>)}</div>
            {objective.activity && <><label className="mission-field"><span>Partner role</span><select value={objective.board.partnerRole ?? ''} onChange={e => onChange({ board: { ...objective.board, partnerRole: e.target.value || undefined } })}><option value="">Any other investigator</option>{campaign.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label><input type="checkbox" checked={!!objective.board.differentRole} onChange={e => onChange({ board: { ...objective.board, differentRole: e.target.checked } })} />Assign a partner with a different role</label><p className="mission-muted">Each student accepts once per game. Reports record the partner; they do not verify speaking.</p></>}
        </div></details>}
        <div className="mission-form-section-title"><span>3</span><h3>Clues &amp; conversation <small>Optional</small></h3></div>
        <details className="mission-details"><summary>Evidence &amp; extra options</summary>
            <label className="mission-field"><span>Evidence exchanges before answering</span><select value={objective.conversation?.witnesses ?? (objective.activity ? 1 : 0)} onChange={e => onChange({ conversation: Number(e.target.value) ? { witnesses: Number(e.target.value) as 1 | 2 } : undefined })}>{!objective.activity && <option value={0}>No exchange required</option>}<option value={1}>One witness</option>{!objective.activity && <option value={2}>Two witnesses</option>}</select></label>
            {chapter.thieves && !objective.board && !objective.answerThief && <label><input type="checkbox" checked={!!objective.thiefKnows} onChange={e => onChange({ thiefKnows: e.target.checked })} />The thief already knows this answer (skip it for them)</label>}
        </details>
        <RoleClues roles={campaign.roles} value={objective.rewards} label="Give new clues after this step (optional)" onChange={rewards => onChange({ rewards })} />
    </>;
}
