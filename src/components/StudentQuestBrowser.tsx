import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StudentChallenge, StudentChoicePage, StudentChoiceQuery } from '../../shared/studentChoice';
import { messageId } from '../utils/messageId';
import './StudentQuestBrowser.css';

type Props = {
  result: StudentChoicePage | null;
  active: boolean;
  refreshKey: string;
  onBrowse: (query: StudentChoiceQuery & { requestId: string }) => boolean;
  onPick: (id: string) => boolean;
  paused?: boolean; // another step comes first (choosing a name, reconnecting): do not open by itself
  notice?: { text: string; at: number } | null; // the server's latest warning, e.g. why a pick was refused
};
const FORMATS = { pair: '👥 Pair · 2', group: '👥 Group · 3', mingle: '💬 Mingle · 4+', solo: '👤 Solo' };
const LONG_TEXT = 170; // longer descriptions fold to a few lines, with "Read all"
const REFRESH_MS = 1000; // board changes refresh an open list at most this often
const SEARCH_MS = 200;

// Student Choice: a launcher in the Journal and a large window to browse the library and join a challenge. The window
// opens by itself when the student is free, keeps showing the list while it refreshes (no flashing), and closes once
// the student has a challenge.
export default function StudentQuestBrowser({ result, active, refreshKey, onBrowse, onPick, paused = false, notice = null }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(!active);
  const [wasActive, setWasActive] = useState(active);
  const [query, setQuery] = useState<StudentChoiceQuery>({ search: '', format: '', level: '', page: 0 });
  const [request, setRequest] = useState<{ id: string; key: string } | null>(null);
  const [shown, setShown] = useState<{ page: StudentChoicePage; key: string } | null>(null);
  const [error, setError] = useState<{ kind: 'browse' | 'pick'; text: string } | null>(null);
  const [picking, setPicking] = useState<{ id: string; at: number } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const queryKey = JSON.stringify(query);

  // Free again (finished or left a challenge): offer the window once more. Busy: the window has done its job.
  if (wasActive !== active) {
    setWasActive(active);
    setAutoOpen(!active);
    if (active) { setOpen(false); setPicking(null); }
  }
  // The answer to the latest request replaces the list; an older answer never does.
  if (result && request && result.requestId === request.id && shown?.page !== result) {
    setShown({ page: result, key: request.key });
    if (error?.kind === 'browse') setError(null);
  }
  // A refused pick comes back as a warning: show it here, where the student is looking.
  if (picking && notice && notice.at >= picking.at) { setPicking(null); setError({ kind: 'pick', text: notice.text }); }

  // The native dialog follows `open`; Escape and the Close button set it back.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const showing = element.hasAttribute('open');
    if (open && !showing) {
      if (typeof element.showModal === 'function') element.showModal(); else element.setAttribute('open', '');
      element.querySelector<HTMLElement>('h2')?.focus(); // not the search box: on a phone that would pop up the keyboard
    }
    if (!open && showing) { if (typeof element.close === 'function') element.close(); else element.removeAttribute('open'); }
  }, [open]);
  useEffect(() => { const element = dialog.current; return () => { if (element?.hasAttribute('open')) element.close?.(); }; }, []);
  // Opens by itself once no other window (an announcement, a picture) is showing.
  useEffect(() => {
    if (!autoOpen || paused || active || open) return;
    const timer = window.setInterval(() => {
      if (document.querySelector('dialog[open]')) return;
      setAutoOpen(false); setError(null); setOpen(true);
    }, 400);
    return () => window.clearInterval(timer);
  }, [autoOpen, paused, active, open]);

  // Requests: a changed search or filter soon after typing stops; board changes at most once a second; nothing while shut.
  const browse = useRef(onBrowse);
  useEffect(() => { browse.current = onBrowse; }, [onBrowse]);
  const latest = useRef({ query, queryKey });
  useEffect(() => { latest.current = { query, queryKey }; }, [query, queryKey]);
  const sentKey = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const fetchNow = useCallback(() => {
    window.clearTimeout(timer.current); timer.current = undefined;
    const id = messageId(), { query: current, queryKey: key } = latest.current;
    sentKey.current = key;
    setRequest({ id, key });
    if (!browse.current({ ...current, requestId: id })) setError({ kind: 'browse', text: 'Reconnecting. Try again in a moment.' });
  }, []);
  useEffect(() => {
    if (!open) { window.clearTimeout(timer.current); timer.current = undefined; sentKey.current = null; return; }
    if (sentKey.current !== queryKey) { window.clearTimeout(timer.current); timer.current = window.setTimeout(fetchNow, SEARCH_MS); }
    else if (timer.current === undefined) timer.current = window.setTimeout(fetchNow, REFRESH_MS);
  }, [open, queryKey, refreshKey, fetchNow]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const waiting = !!request && result?.requestId !== request.id; // the latest request has no answer yet
  useEffect(() => {
    if (!open || !request || !waiting) return;
    const slow = window.setTimeout(() => setError({ kind: 'browse', text: 'Could not load challenges. Try again.' }), 8000);
    return () => window.clearTimeout(slow);
  }, [open, request, waiting]);
  // A pick that gets no answer frees the buttons again, with a fresh list.
  useEffect(() => {
    if (!picking) return;
    const slow = window.setTimeout(() => { setPicking(null); fetchNow(); }, 6000);
    return () => window.clearTimeout(slow);
  }, [picking, fetchNow]);

  function show() { setError(null); setOpen(true); }
  const page = shown?.page ?? null;
  const stale = !!shown && shown.key !== queryKey; // the list is for an older search: dimmed until the new one arrives
  const filters = (value: Partial<StudentChoiceQuery>) => setQuery(current => ({ ...current, ...value, page: 0 }));
  const turn = (to: number) => { setQuery(current => ({ ...current, page: to })); body.current?.scrollTo?.(0, 0); };
  const pick = (item: StudentChallenge) => {
    if (onPick(item.id)) { setPicking({ id: item.id, at: Date.now() }); setError(null); }
    else setError({ kind: 'pick', text: 'Reconnecting. Try again in a moment.' });
  };
  const status = error?.text ?? page?.error ?? (!page || stale ? 'Loading…' : `${page.total} challenge${page.total === 1 ? '' : 's'}`);
  const items = page?.enabled && !page.error ? page.items : [];
  const joinable = (item: StudentChallenge) => item.state === 'available' && item.joining.length > 0;
  const card = (item: StudentChallenge) => {
    const long = item.text.length > LONG_TEXT, more = expanded.has(item.id);
    return <article key={item.id} className={`challenge-card${joinable(item) ? ' challenge-card-waiting' : ''}${item.state === 'done' ? ' challenge-card-done' : ''}`}>
      <h4>{item.title}</h4>
      <p className="challenge-meta">{FORMATS[item.format]} · {item.level} · {item.minutes} min</p>
      <p className={`challenge-text${long && !more ? ' challenge-text-folded' : ''}`}>{item.text}</p>
      {long && <button type="button" className="challenge-more" aria-expanded={more} onClick={() => setExpanded(current => {
        const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next;
      })}>{more ? 'Show less' : 'Read all'}</button>}
      {!!item.joining.length && <p className="challenge-join">Waiting: {item.joining.join(', ')}</p>}
      {item.reason && <p className="challenge-meta">{item.reason}</p>}
      <button type="button" className="challenge-pick" disabled={active || stale || !!picking || item.state !== 'available'} onClick={() => pick(item)}>
        {picking?.id === item.id ? 'Joining…' : item.state === 'done' ? '✓ Completed' : item.state === 'active' ? 'Your current quest' : item.joining.length ? `Join ${item.joining.join(', ')}` : 'Choose this'}
      </button>
    </article>;
  };
  const together = items.filter(joinable), others = items.filter(item => !joinable(item));

  return <section className="student-choice" aria-label="Challenges">
    <button ref={launcher} type="button" className={`student-choice-open${active ? '' : ' student-choice-open-free'}`} aria-haspopup="dialog" onClick={show}>
      🎯 {active ? 'Browse challenges' : 'Choose a challenge'}
    </button>
    {!active && <p className="student-choice-hint">1. Pick one. 2. Chat together. 3. Answer.</p>}
    {createPortal(<dialog ref={dialog} className="challenge-picker" aria-labelledby={titleId}
      onClose={() => { setOpen(false); launcher.current?.focus(); }}
      onCancel={event => { event.preventDefault(); setOpen(false); }}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); setOpen(false); } }}>
      {open && <>
        <header className="challenge-picker-header">
          <div><p>YOUR CHOICE</p><h2 id={titleId} tabIndex={-1}>{active ? 'Browse challenges' : 'Choose a challenge'}</h2>
            <span className="challenge-picker-steps">1. Pick one. 2. Chat together. 3. Answer.</span></div>
          <button type="button" className="challenge-picker-close" onClick={() => setOpen(false)}>✕ Close</button>
        </header>
        <div className="challenge-picker-tools">
          <label className="challenge-picker-search">Search<input type="search" value={query.search} maxLength={120} placeholder="Find a challenge" onChange={event => filters({ search: event.target.value })} /></label>
          <label>Players<select value={query.format} onChange={event => filters({ format: event.target.value as StudentChoiceQuery['format'] })}>
            <option value="">Any size</option>{Object.entries(FORMATS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label>Level<select value={query.level} onChange={event => filters({ level: event.target.value as StudentChoiceQuery['level'] })}>
            <option value="">All levels</option>{['A1', 'A2', 'B1', 'B2'].map(level => <option key={level}>{level}</option>)}
          </select></label>
        </div>
        {active && <p className="challenge-picker-note">You are doing a challenge. Finish it, or leave it in your Journal, to pick another.</p>}
        <div ref={body} className={`challenge-picker-body${stale ? ' challenge-picker-stale' : ''}`} aria-busy={!page || stale}>
          {page?.enabled && !page.error && !items.length && !stale && <p className="challenge-picker-empty">{query.search || query.format || query.level ? 'No matches. Try another search or filter.' : 'No challenges yet. Ask your teacher to add some to the library.'}</p>}
          {!!together.length && <section className="challenge-group challenge-group-waiting"><h3>Classmates waiting for you</h3><div className="challenge-grid">{together.map(card)}</div></section>}
          {!!others.length && <section className="challenge-group">{!!together.length && <h3>More challenges</h3>}<div className="challenge-grid">{others.map(card)}</div></section>}
        </div>
        <footer className="challenge-picker-footer">
          <span role="status" className={error ? 'challenge-picker-error' : undefined}>{status}</span>
          <div>
            {!!page && page.pages > 1 && <nav className="challenge-picker-pages" aria-label="Challenge pages">
              <button type="button" disabled={stale || page.page === 0} onClick={() => turn(page.page - 1)}>Back</button>
              <span>{page.page + 1} / {page.pages}</span>
              <button type="button" disabled={stale || page.page + 1 >= page.pages} onClick={() => turn(page.page + 1)}>Next</button>
            </nav>}
            <button type="button" onClick={fetchNow}>Refresh</button>
          </div>
        </footer>
      </>}
    </dialog>, document.body)}
  </section>;
}
