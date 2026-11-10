import { useEffect, useRef, useState } from 'react';
import type { StudentChoicePage, StudentChoiceQuery } from '../../shared/studentChoice';
import './StudentQuestBrowser.css';

type Props = {
  result: StudentChoicePage | null;
  active: boolean;
  refreshKey: string;
  onBrowse: (query: StudentChoiceQuery & { requestId: string }) => boolean;
  onPick: (id: string) => boolean;
};
const FORMATS = { pair: '👥 Pair · 2', group: '👥 Group · 3', mingle: '💬 Mingle · 4+', solo: '👤 Solo' };

export default function StudentQuestBrowser({ result, active, refreshKey, onBrowse, onPick }: Props) {
  const [open, setOpen] = useState(!active);
  const [query, setQuery] = useState<StudentChoiceQuery>({ search: '', format: '', level: '', page: 0 });
  const [request, setRequest] = useState<{ id: string; key: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) { setWasActive(active); setOpen(!active); }
  const browse = useRef(onBrowse);
  useEffect(() => { browse.current = onBrowse; }, [onBrowse]);
  const queryKey = JSON.stringify([query, refreshKey, retry]);
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const id = crypto.randomUUID();
      setRequest({ id, key: queryKey }); setError('');
      if (!browse.current({ ...query, requestId: id })) setError('Reconnecting. Try again in a moment.');
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open, query, queryKey]);
  const page = request?.key === queryKey && result?.requestId === request?.id ? result : null;
  useEffect(() => {
    if (!open || !request || page) return;
    const timer = window.setTimeout(() => setError('Could not load challenges. Try again.'), 8000);
    return () => window.clearTimeout(timer);
  }, [open, request, page]);
  const filters = (value: Partial<StudentChoiceQuery>) => setQuery(current => ({ ...current, ...value, page: 0 }));
  return <section className="student-choice" aria-label="Choose a challenge">
    <button type="button" className="journal-choice student-choice-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {active ? 'Browse challenges' : 'Choose a challenge'} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
    </button>
    {open && <>
      <p className="student-choice-steps">1. Pick one. 2. Chat together. 3. Answer.</p>
      {active && <p>Finish or leave your current quest to pick another.</p>}
      <label className="student-choice-search">Search<input type="search" value={query.search} maxLength={120} placeholder="Find a challenge" onChange={event => filters({ search: event.target.value })} /></label>
      <div className="student-choice-filters">
        <label>Players<select value={query.format} onChange={event => filters({ format: event.target.value as StudentChoiceQuery['format'] })}>
          <option value="">Any size</option>{Object.entries(FORMATS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>Level<select value={query.level} onChange={event => filters({ level: event.target.value as StudentChoiceQuery['level'] })}>
          <option value="">All levels</option>{['A1', 'A2', 'B1', 'B2'].map(level => <option key={level}>{level}</option>)}
        </select></label>
      </div>
      <div className="student-choice-count"><span role="status">{error || page?.error || (page ? `${page.total} challenge${page.total === 1 ? '' : 's'}` : 'Loading…')}</span>
        <button type="button" className="journal-dismiss" onClick={() => setRetry(value => value + 1)}>Refresh</button></div>
      {page?.enabled && !page.error && <>
        {!page.items.length && <p>{query.search || query.format || query.level ? 'No matches. Try another search or filter.' : 'No challenges yet. Ask your teacher to add some to the library.'}</p>}
        {page.items.map(item => <article className="student-choice-card" key={item.id}>
          <h4>{item.title}</h4>
          <p className="student-choice-meta">{FORMATS[item.format]} · {item.level} · {item.minutes} min</p>
          <p>{item.text}</p>
          {!!item.joining.length && <p className="student-choice-join">Waiting: {item.joining.join(', ')}</p>}
          {item.reason && <p className="student-choice-meta">{item.reason}</p>}
          <button type="button" className="journal-choice" disabled={active || item.state !== 'available'} onClick={() => {
            if (!onPick(item.id)) setError('Reconnecting. Try again in a moment.');
          }}>{item.state === 'done' ? '✓ Completed' : item.state === 'active' ? 'Your current quest' : item.joining.length ? 'Join them' : 'Choose this'}</button>
        </article>)}
        {page.pages > 1 && <nav className="student-choice-pages" aria-label="Challenge pages">
          <button type="button" className="journal-choice" disabled={page.page === 0} onClick={() => setQuery(current => ({ ...current, page: page.page - 1 }))}>Back</button>
          <span>{page.page + 1} / {page.pages}</span>
          <button type="button" className="journal-choice" disabled={page.page + 1 >= page.pages} onClick={() => setQuery(current => ({ ...current, page: page.page + 1 }))}>Next</button>
        </nav>}
      </>}
    </>}
  </section>;
}
