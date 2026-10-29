import { useState } from 'react';
import { ANSWERS, FORMATS, LEVELS, THEMES, checkQuest, type QuestAnswer, type QuestFormat, type QuestLevel, type QuestTheme, type SideQuest, type StoryChapter } from '../../shared/sideQuests';
import MissionField from './MissionField';

// The form keeps lists as the teacher types them: commas for focus, tags and roles, one accepted answer a line.
type Draft = {
    title: string; text: string; theme: QuestTheme; category: string; chapter: string; level: QuestLevel; format: QuestFormat; answer: QuestAnswer;
    minutes: string; focus: string; tags: string; accept: string; teacherNote: string; successCriteria: string; roles: string; after: string; afterMain: boolean;
};
const list = (text: string, separator: RegExp) => text.split(separator).map(item => item.trim()).filter(Boolean);
const draftOf = (quest: SideQuest): Draft => ({
    title: quest.title, text: quest.text, theme: quest.theme, category: quest.category, chapter: quest.chapter ?? '', level: quest.level, format: quest.format, answer: quest.answer,
    minutes: String(quest.minutes), focus: quest.focus.join(', '), tags: quest.tags.join(', '), accept: quest.accept.join('\n'), teacherNote: quest.teacherNote,
    roles: quest.roles?.join(', ') ?? '', after: quest.after ?? '', afterMain: !!quest.afterMain,
    successCriteria: quest.successCriteria ?? '',
});
const questOf = (draft: Draft, id: string) => ({
    id, title: draft.title, text: draft.text, theme: draft.theme, category: draft.category, chapter: draft.theme === 'story' ? draft.chapter : null,
    level: draft.level, format: draft.format, answer: draft.answer, minutes: Number(draft.minutes), focus: list(draft.focus, /,/), tags: list(draft.tags, /,/),
    accept: draft.answer === 'text' ? list(draft.accept, /\n/) : [], teacherNote: draft.teacherNote,
    ...(draft.answer === 'report' && draft.successCriteria.trim() ? { successCriteria: draft.successCriteria.trim() } : {}),
    ...(draft.theme === 'story' && draft.roles.trim() ? { roles: list(draft.roles, /,/) } : {}),
    ...(draft.theme === 'story' && draft.after.trim() ? { after: draft.after.trim() } : {}),
    ...(draft.theme === 'story' && draft.afterMain ? { afterMain: true } : {}),
});
// Writing or changing one side quest, beside the library: the fields, what is still missing, and the quest as a student
// sees it on the quest board. The server checks it again and gives a new quest its ID.
export default function SideQuestEditor({ quest, creating, chapters, categories, busy, saved, onSave, onClose }: {
    quest: SideQuest; creating: boolean; chapters: StoryChapter[]; categories: string[]; busy: boolean; saved: boolean;
    onSave: (quest: ReturnType<typeof questOf>) => void; onClose: () => void;
}) {
    const [draft, setDraft] = useState(() => draftOf(quest));
    const [touched, setTouched] = useState(false);
    const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft(current => ({ ...current, [key]: value })); setTouched(true); };
    const candidate = questOf(draft, quest.id || 'sq-new');
    const checked = checkQuest(candidate);
    const problem = 'error' in checked ? checked.error.replace(/^[^:]*: /, '') : null;
    const format = FORMATS.find(f => f.id === draft.format)!;
    const story = draft.theme === 'story';

    return <form className="ql-editor" aria-label={creating ? 'New side quest' : `Edit ${quest.title}`} onSubmit={e => { e.preventDefault(); if (!problem) onSave(candidate); }}>
        <div className="mission-toolbar"><h2>{creating ? 'New side quest' : 'Edit side quest'}</h2><button type="button" className="mission-button" onClick={onClose}>Close</button></div>
        <MissionField label="Title" value={draft.title} maxLength={120} placeholder="For example: Café Order" onChange={value => set('title', value)} />
        <MissionField label="What the student reads" multiline value={draft.text} maxLength={2000} placeholder="Short, clear instructions at the quest's level." onChange={value => set('text', value)} />
        <div className="mission-two-columns">
            <label className="mission-field"><span>Theme</span><select value={draft.theme} onChange={e => set('theme', e.target.value as QuestTheme)}>{THEMES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label className="mission-field"><span>Category</span><input list="ql-categories" value={draft.category} maxLength={120} placeholder="For example: Role-plays" onChange={e => set('category', e.target.value)} />
                <datalist id="ql-categories">{categories.map(category => <option key={category} value={category} />)}</datalist></label>
            <label className="mission-field"><span>Level</span><select value={draft.level} onChange={e => set('level', e.target.value as QuestLevel)}>{LEVELS.map(l => <option key={l.id} value={l.id}>{l.id} {l.name}</option>)}</select></label>
            <label className="mission-field"><span>Who</span><select value={draft.format} onChange={e => set('format', e.target.value as QuestFormat)}>{FORMATS.map(f => <option key={f.id} value={f.id}>{f.name}{f.players > 1 ? ` (needs ${f.players} online)` : ''}</option>)}</select></label>
            <label className="mission-field"><span>Answer</span><select value={draft.answer} onChange={e => set('answer', e.target.value as QuestAnswer)}>{ANSWERS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label className="mission-field"><span>Minutes</span><input type="number" min={1} max={60} value={draft.minutes} onChange={e => set('minutes', e.target.value)} /></label>
        </div>
        {draft.answer === 'text' && <MissionField label="Accepted answers (one a line)" multiline value={draft.accept} maxLength={4000} placeholder={'hotel\nthe hotel'} onChange={value => set('accept', value)} />}
        {story && <fieldset className="ql-story-fields"><legend>Story</legend>
            <label className="mission-field"><span>Chapter</span><select value={draft.chapter} onChange={e => set('chapter', e.target.value)}>
                <option value="" disabled>Choose a chapter…</option>
                {[...new Set(chapters.map(c => c.campaign))].map(campaign => <optgroup key={campaign} label={campaign}>{chapters.filter(c => c.campaign === campaign).map(c => <option key={c.id} value={c.id}>{c.number}. {c.title}</option>)}</optgroup>)}
                {draft.chapter && !chapters.some(c => c.id === draft.chapter) && <option value={draft.chapter}>{draft.chapter} (in no published mission)</option>}
            </select></label>
            <MissionField label="Only for roles (role IDs, commas between)" value={draft.roles} maxLength={400} placeholder="Leave empty for every role" onChange={value => set('roles', value)} />
            <MissionField label="Unlocks after the main question (its ID)" value={draft.after} maxLength={64} placeholder="Leave empty to unlock at once" onChange={value => set('after', value)} />
            <label className="ql-check"><input type="checkbox" checked={draft.afterMain} onChange={e => set('afterMain', e.target.checked)} />Only after the student has finished the main mystery</label>
        </fieldset>}
        <div className="mission-two-columns">
            <MissionField label="Focus (commas between)" value={draft.focus} maxLength={2000} placeholder="past simple, ordering food" onChange={value => set('focus', value)} />
            <MissionField label="Tags (commas between)" value={draft.tags} maxLength={2000} placeholder="cafe, role-play, warm-up" onChange={value => set('tags', value)} />
        </div>
        <MissionField label="Teacher note" multiline value={draft.teacherNote} maxLength={4000} placeholder="What to look for, how to adapt it, the solution." onChange={value => set('teacherNote', value)} />
        {draft.answer === 'report' && <MissionField label="Success criteria (optional, private)" multiline value={draft.successCriteria} maxLength={600} placeholder="For example: Recommend one place and give two reasons. Otherwise the instructions are used." onChange={value => set('successCriteria', value)} />}

        <div className="ql-board-preview" aria-label="On the quest board"><p className="mission-eyebrow">ON THE QUEST BOARD</p>
            <p>{draft.title.trim() || 'Title'}: {draft.text.trim() || 'What the student reads.'}</p>
            <small>{draft.answer === 'text' ? 'The student types the answer; the game checks it.' : 'Reports receive an automatic task check and a short revision hint.'}{format.players > 1 ? ` Waits until ${format.players} students are online.` : ''}</small></div>
        {problem && touched && <p className="ql-reason" role="status">Still to do: {problem}</p>}
        {saved && !touched && <p className="mission-sync" role="status">✓ Saved.</p>}
        <div className="mission-toolbar"><button className="mission-button primary" disabled={busy || !!problem}>{creating ? 'Add to the library' : 'Save changes'}</button></div>
        {!creating && <p className="mission-muted">Games that already have this quest keep the version they got.</p>}
    </form>;
}
