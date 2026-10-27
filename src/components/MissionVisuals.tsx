import { useState } from 'react';
import { prerequisiteIds, type Campaign, type Chapter, type Objective, type Role } from '../../shared/campaign';
import { stepType, stepTypes } from './missionEditing';

export type MissionIconName = 'map' | 'roles' | 'steps' | 'eye' | 'clue' | 'flag' | 'pin' | 'news';
const iconPaths: Record<MissionIconName, string> = {
    map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5m6-2v16m6-14v16',
    roles: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3a4 4 0 0 1 0 8M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    steps: 'M4 3h6v6H4V3m10 12h6v6h-6v-6M7 9v9h7M14 6h6m-3-3 3 3-3 3',
    eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12m13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    clue: 'm12 3 9 9-9 9-9-9 9-9m0 5v5m0 3h.01',
    flag: 'M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0',
    pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0m-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    news: 'm3 10 15-6v16L3 14v-4m4 5 1 6h4l-2-5M21 8v8',
};
export function MissionIcon({ name }: { name: MissionIconName }) {
    return <svg className="mission-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]} /></svg>;
}
export function RoleBadge({ role, index }: { role: Role; index: number }) {
    return <span className={`mission-avatar role-tone-${index % 6}`} aria-hidden="true">{role.name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() || '?'}</span>;
}

export function ChapterStrip({ chapters, selected, onSelect }: { chapters: Chapter[]; selected: number; onSelect: (index: number) => void }) {
    return <nav className="mission-chapter-strip" aria-label="Chapter journey">{chapters.map((chapter, i) => <button type="button" key={chapter.id} className={selected === i ? 'selected' : ''} aria-current={selected === i ? 'true' : undefined} onClick={() => onSelect(i)}>
        <span className="mission-chapter-number">{String(i + 1).padStart(2, '0')}</span><span><small>CHAPTER {i + 1}</small><strong>{chapter.title || 'Untitled chapter'}</strong><span>{chapter.objectives.filter(o => !o.optional).length} main · {chapter.objectives.filter(o => o.optional).length} optional</span></span>
    </button>)}</nav>;
}

export function StepConnections({ objective, chapter, onSelect }: { objective: Objective; chapter: Chapter; onSelect?: (id: string) => void }) {
    const ids = prerequisiteIds(objective);
    return <div className="mission-connections">
        <span className="mission-connection-label">{ids.length ? objective.requires?.mode === 'any' ? 'After any of' : 'After' : objective.board?.afterMain ? 'After main steps' : 'Chapter start'}</span>
        {ids.map((id, i) => { const index = chapter.objectives.findIndex(o => o.id === id); return <span className="mission-connection-link" key={id}>{i > 0 && <small>{objective.requires?.mode === 'any' ? 'or' : '+'}</small>}{onSelect && index >= 0 ? <button type="button" title={chapter.objectives[index].text} onClick={() => onSelect(id)}>Step {index + 1}</button> : <span>{index >= 0 ? `Step ${index + 1}` : 'Missing step'}</span>}</span>; })}
        {!!ids.length && objective.board?.afterMain && <span className="mission-condition">+ main steps finished</span>}
        {objective.board?.teacherReleased && <span className="mission-condition">Teacher releases</span>}
        {!!objective.board?.minPlayers && objective.board.minPlayers > 1 && <span className="mission-condition">{objective.board.minPlayers}+ online</span>}
    </div>;
}

export function StepGlance({ objective, campaign }: { objective: Objective; campaign: Campaign }) {
    const answerRole = campaign.roles.find(r => r.id === objective.answerRole);
    const answers = objective.kind === 'report' ? 'A written report · teacher reviews' : objective.answerThief ? 'The secret thief’s name' : answerRole ? `A classmate who is ${answerRole.name}` : objective.accept.filter(a => a.trim()).join(' / ') || 'Add an accepted answer';
    const witnesses = objective.conversation?.witnesses ?? (objective.activity ? 1 : 0);
    return <div className="mission-step-glance"><div><MissionIcon name="eye" /><span><small>STUDENTS SEE</small><p>{objective.text || 'Your instructions will appear here.'}</p></span></div><div><MissionIcon name="flag" /><span><small>THEY RESPOND WITH</small><p>{answers}</p>{witnesses > 0 && <p className="mission-evidence-note">After {witnesses} approved {witnesses === 1 ? 'witness exchange' : 'witness exchanges'}</p>}</span></div></div>;
}

export default function MissionStoryMap({ campaign, chapterIndex, onChapter, onEdit, onSetup, onPreview }: { campaign: Campaign; chapterIndex: number; onChapter: (index: number) => void; onEdit: (id?: string) => void; onSetup: () => void; onPreview: () => void }) {
    const [roleId, setRoleId] = useState('');
    const role = campaign.roles.find(r => r.id === roleId);
    const chapter = campaign.chapters[chapterIndex];
    if (!chapter) return <section className="mission-card"><h2>Start your story</h2><button className="mission-button primary" onClick={() => onEdit()}>Add a chapter</button></section>;
    const main = chapter.objectives.filter(o => !o.optional);
    const optional = chapter.objectives.filter(o => o.optional);
    const renderTask = (objective: Objective) => {
        const index = chapter.objectives.indexOf(objective);
        const type = stepTypes.find(t => t.id === stepType(objective))!;
        const recipients = campaign.roles.filter(r => objective.rewards?.[r.id]?.trim());
        const shownRecipients = role ? recipients.filter(r => r.id === role.id) : recipients;
        const audience = objective.board?.roles?.length ? campaign.roles.filter(r => objective.board!.roles!.includes(r.id)).map(r => r.name).join(', ') : 'Everyone';
        return <article className={`mission-story-task task-${type.id}`} key={objective.id}>
            <StepConnections objective={objective} chapter={chapter} onSelect={onEdit} />
            <button type="button" className="mission-story-task-open" aria-label={`Edit step ${index + 1}: ${objective.text || 'Untitled step'}`} onClick={() => onEdit(objective.id)}><span className="mission-story-task-icon" aria-hidden="true">{type.icon}</span><span><small>STEP {index + 1} · {type.name}</small><strong>{objective.text || 'Add student instructions'}</strong></span><span className="mission-task-edit" aria-hidden="true">↗</span></button>
            <div className="mission-task-meta"><span>{objective.board ? 'Quest board' : objective.optional ? 'Bonus task' : 'Main task'}</span><span>{audience}</span>{(objective.conversation || objective.activity) && <span>{objective.conversation?.witnesses ?? 1} witness exchange{objective.conversation?.witnesses === 2 ? 's' : ''}</span>}</div>
            {shownRecipients.length > 0 && <div className="mission-task-rewards"><span><MissionIcon name="clue" /> Unlocks a private clue</span>{shownRecipients.map(r => <div key={r.id}><RoleBadge role={r} index={campaign.roles.indexOf(r)} /><span>{role ? objective.rewards![r.id] : r.name}</span></div>)}</div>}
        </article>;
    };
    return <div className="mission-story-map">
        <section className="mission-map-intro"><div><p className="mission-eyebrow">THE BIG PICTURE</p><h2>Your story, at a glance.</h2><p>Explore a chapter. Follow the tasks. See who gets each clue.</p></div><button type="button" className="mission-button" onClick={onPreview}><MissionIcon name="eye" /> Try as a student</button></section>
        <ChapterStrip chapters={campaign.chapters} selected={chapterIndex} onSelect={onChapter} />
        <section className="mission-map-canvas" aria-label="Chapter story map">
            <div className="mission-map-heading"><div><p className="mission-eyebrow">CHAPTER {chapterIndex + 1} / {campaign.chapters.length}</p><h2>{chapter.title || 'Untitled chapter'}</h2></div><button type="button" className="mission-button" onClick={() => onEdit()}>Edit this chapter</button></div>
            <div className="mission-map-opening"><span className="mission-map-marker"><MissionIcon name="flag" /></span><div><h3>The story begins</h3><p>{chapter.intro || 'Add an opening story to set the scene for your students.'}</p></div></div>
            <section className="mission-cast-section"><div className="mission-section-heading"><div><h3><MissionIcon name="roles" /> Who knows what?</h3><p>Each role starts with a private clue. Choose a role to follow its clues through the tasks.</p></div><button type="button" className="mission-button" onClick={onSetup}>Edit roles</button></div>
                <div className="mission-role-filters" role="group" aria-label="Follow a role’s clues"><button type="button" aria-pressed={!role} onClick={() => setRoleId('')}>All roles</button>{campaign.roles.map((r, i) => <button type="button" key={r.id} aria-pressed={role?.id === r.id} onClick={() => setRoleId(r.id)}><RoleBadge role={r} index={i} />{r.name || 'Unnamed role'}</button>)}</div>
                <div className="mission-clue-cards">{campaign.roles.filter(r => !role || r.id === role.id).map(r => <article key={r.id} className={`mission-clue-card role-tone-${campaign.roles.indexOf(r) % 6}`}><div><RoleBadge role={r} index={campaign.roles.indexOf(r)} /><span><strong>{r.name || 'Unnamed role'}</strong><small>PRIVATE STARTING CLUE</small></span></div><p>{(chapter.roleClues?.[r.id] ?? r.clue) || 'No starting clue yet.'}</p></article>)}</div>
                {chapter.thieves && <p className="mission-mystery-note"><span aria-hidden="true">?</span> Secret thief: selected students receive a separate story and skip tasks they already know.</p>}
            </section>
            <div className="mission-map-route"><section className="mission-route-section"><div className="mission-section-heading"><div><h3><MissionIcon name="steps" /> The main story <span className="mission-count">{main.length} tasks</span></h3><p>Read the opening rule above each task. Click a task to edit it or a linked step to see what comes before.</p></div></div><div className="mission-story-grid">{main.map(renderTask)}</div>{!main.length && <p className="mission-map-empty">No main tasks yet. Add a question or a writing task in the chapter editor.</p>}</section>
            {optional.length > 0 && <section className="mission-optional-route"><div className="mission-section-heading"><div><h3>Explore a little more <span className="mission-count">{optional.length} optional</span></h3><p>Bonus tasks and quest board activities. These never hold up the main story.</p></div></div><div className="mission-story-grid">{optional.map(renderTask)}</div></section>}
            {(chapter.discoveries.length > 0 || chapter.reveals.length > 0) && <div className="mission-world-clues"><details><summary><MissionIcon name="pin" /> {chapter.discoveries.length} map clues</summary>{chapter.discoveries.map(d => <p key={d.id}>{d.text || 'Add clue text'}</p>)}</details><details><summary><MissionIcon name="news" /> {chapter.reveals.length} teacher hints</summary>{chapter.reveals.map(n => <p key={n.id}>{n.text || 'Add hint text'}</p>)}</details></div>}
            <div className="mission-map-ending"><span className="mission-map-marker"><MissionIcon name="flag" /></span><div><h3>Chapter complete</h3><p>{chapter.ending || 'Add a closing message for this chapter.'}</p><small>{main.length > 0 ? `Class ready at ${Math.round(chapter.share * 100)}% · ` : ''}You choose when to move on</small></div></div>
            </div>
        </section>
    </div>;
}
