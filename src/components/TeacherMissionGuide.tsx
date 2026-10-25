import { useEffect, useMemo, useState } from 'react';
import type { GuideChapter, GuideTask, TeacherGuide } from '../../shared/teacherGuide';
import './TeacherMissionGuide.css';

type Props = { token: string; campaignId?: string; gameId?: string; currentChapter?: number; refreshKey?: string };

function Task({ task, number, chapter }: { task: GuideTask; number: number; chapter: GuideChapter }) {
  const before = new Set<string>();
  const visit = (id: string) => {
    if (before.has(id)) return;
    before.add(id);
    [...chapter.main, ...chapter.optional].find(item => item.id === id)?.before.forEach(visit);
  };
  task.before.forEach(visit);
  const evidence = [...chapter.clues, ...[...chapter.main, ...chapter.optional].filter(item => before.has(item.id)).flatMap(item => item.unlockedClues)];
  return <details className="mission-guide-task">
    <summary>
      <span className="mission-guide-number">{number}</span>
      <span><strong>{task.title}</strong><span className="mission-guide-answer">{task.answer}</span></span>
      {task.witnesses > 0 && <span className="mission-guide-tag">{task.witnesses} {task.witnesses === 1 ? 'witness' : 'witnesses'}</span>}
    </summary>
    <div className="mission-guide-task-body">
      {task.task !== task.title && <p>{task.task}</p>}
      {task.prerequisites && <p className="mission-guide-note">{task.prerequisites}</p>}
      <ol>{task.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
      {task.minimumPlayers > 1 && <p className="mission-guide-note">Needs at least {task.minimumPlayers} students online.</p>}
      <details className="mission-guide-evidence"><summary>Clue trail for this answer</summary>
        <dl>{evidence.map((clue, index) => <div key={index}><dt>{clue.role}</dt><dd>{clue.text}</dd></div>)}</dl>
      </details>
    </div>
  </details>;
}

function Chapter({ chapter }: { chapter: GuideChapter }) {
  return <section className="mission-guide-chapter" aria-label={`Guide: ${chapter.title}`}>
    <h4>{chapter.title}</h4>
    <p><strong>Mission:</strong> {chapter.mission}</p>
    <ol className="mission-guide-flow">{chapter.play.map((step, index) => <li key={index}>{step}</li>)}</ol>
    <h5>Main tasks · answers for you</h5>
    {chapter.main.map((task, index) => <Task key={task.id} task={task} number={index + 1} chapter={chapter} />)}
    <p className="mission-guide-note">Open a task for the exact steps and clues.</p>
    {chapter.optional.length > 0 && <details className="mission-guide-optional"><summary>Optional missions ({chapter.optional.length})</summary>
      {chapter.optional.map((task, index) => <Task key={task.id} task={task} number={index + 1} chapter={chapter} />)}
    </details>}
    <details className="mission-guide-evidence"><summary>Help when students are stuck</summary>
      <p>Ask what their role knows and who might have the missing clue. Each student completes their own Journal task.</p>
      {chapter.thiefBrief && <><h5>The thief’s instructions{chapter.thiefBrief.carry ? ' · same thief as before' : ''}</h5>
        <p>{chapter.thiefBrief.instructions}</p><p><strong>Their story:</strong> {chapter.thiefBrief.story}</p></>}
      {chapter.clues.length > 0 && <dl>{chapter.clues.map((clue, index) => <div key={index}><dt>{clue.role}</dt><dd>{clue.text}</dd></div>)}</dl>}
      {chapter.discoveries.length > 0 && <><h5>Places to visit</h5><dl>{chapter.discoveries.map((clue, index) => <div key={index}><dt>{clue.place}</dt><dd>{clue.text}</dd></div>)}</dl></>}
      {chapter.news.length > 0 && <><h5>News you can release</h5><ol>{chapter.news.map((news, index) => <li key={index}>{news}</li>)}</ol></>}
    </details>
    <p className="mission-guide-note">{chapter.pacing}</p>
  </section>;
}

export default function TeacherMissionGuide({ token, campaignId, gameId, currentChapter = 0, refreshKey }: Props) {
  const [open, setOpen] = useState(!!gameId);
  const [result, setResult] = useState<{ key: string; guide: TeacherGuide | null; error: string } | null>(null);
  const [selection, setSelection] = useState<{ key: object; index: number } | null>(null);
  const [retry, setRetry] = useState(0);
  const selectionKey = useMemo(() => ({ campaignId, gameId, currentChapter }), [campaignId, gameId, currentChapter]);
  const chapter = selection?.key === selectionKey ? selection.index : currentChapter;
  const requestKey = JSON.stringify([campaignId, gameId, refreshKey, retry, token]);
  const current = result?.key === requestKey ? result : null;
  const guide = current?.guide ?? null;
  const error = current?.error ?? '';
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const query = new URLSearchParams(campaignId !== undefined ? { campaign: campaignId } : gameId ? { game: gameId } : {});
    void fetch(`/api/teacher/campaign-guide?${query}`, { headers: { 'x-teacher-session': token }, signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load the teacher guide.');
        if (controller.signal.aborted) return;
        if (gameId && result.game?.id !== gameId || campaignId && result.campaign?.id !== campaignId) throw new Error('The game changed. Reopen its teacher guide.');
        setResult({ key: requestKey, guide: result, error: '' });
      }).catch(cause => { if (!controller.signal.aborted) setResult({ key: requestKey, guide: null, error: cause instanceof Error ? cause.message : 'Could not load the teacher guide.' }); });
    return () => controller.abort();
  }, [open, token, campaignId, gameId, refreshKey, retry, requestKey]);
  const selected = guide?.chapters[Math.min(chapter, guide.chapters.length - 1)];
  return <details className="mission-guide" open={open} onToggle={event => {
    const next = event.currentTarget.open;
    if (next !== open) { setOpen(next); setResult(null); }
  }}>
    <summary><strong>Teacher quick guide</strong><span>Goals, steps & answers</span></summary>
    <div className="mission-guide-body">
      <p className="mission-guide-note">Teacher only · includes solutions</p>
      {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>Try again</button></p>
        : !guide ? <p role="status">Loading the guide…</p> : <>
          <p>{guide.summary}</p>
          <label className="mission-guide-select">Chapter
            <select aria-label="Teacher guide chapter" value={selected ? guide.chapters.indexOf(selected) : 0} onChange={event => setSelection({ key: selectionKey, index: Number(event.target.value) })}>
              {guide.chapters.map((item, index) => <option key={item.id} value={index}>{index + 1}. {item.title}{gameId && index === currentChapter ? ' · now' : ''}</option>)}
            </select>
          </label>
          {selected && <Chapter key={selected.id} chapter={selected} />}
        </>}
    </div>
  </details>;
}
