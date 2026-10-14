import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { joinLink } from '../studentAuth';
import { WARMUP_KINDS } from '../../shared/warmupKinds';
import type { WarmupKind } from '../../shared/warmupKinds';
import './Teacher.css';

type Entry = { id: string; studentKey: string; sender: string; target: string | null; flag: string | null; note: string | null; text: string; timestamp: number; status: string };
type CampaignInfo = {
  id: string; title: string; status: 'active' | 'chapter_complete' | 'campaign_complete'; chapter: number; chapters: number; chapterTitle: string;
  reveals: { shown: number; total: number; next: string | null };
  reports: { studentKey: string; objective: string; text: string }[];
  players: { studentKey: string; name: string; role: string; clues: number; done: string[]; thief: boolean }[];
};
type Game = { id: string; name: string; pin: string; lastOpened: number; open: boolean; randomNames: boolean };
// laptop is set when this runs on the teacher's laptop (npm run classroom).
type Status = {
  campaign: CampaignInfo | null; campaigns: { id: string; title: string }[];
  warmup: { active: boolean; kind: 'facts' | 'identity' | 'pairs'; players: { studentKey: string; name: string; fact: string; found: number; of: number }[]; team: { done: number; total: number } } | null;
  open: boolean; game: { id: string; name: string; randomNames: boolean; vision: number } | null; realNames: Record<string, string>; games: Game[]; pin: string | null; entries: Entry[]; mode: 'approve' | 'review'; moderation: boolean; muted: string[]; online: { studentKey: string; name: string }[];
  laptop?: { url: string; signInUrl: string } | null; notice?: string;
};

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`/api/teacher/${path}`, init);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed.'), { status: response.status });
  return result as T;
}

// How far a student sees, in map pixels: a few steps, from the whole map to a small circle
const VISION_CHOICES: [number, string][] = [[0, 'Everyone'], [650, 'Wide'], [450, 'Medium'], [300, 'Small']];

export default function Teacher() {
  const [password, setPassword] = useState('');
  // The password is checked once; the session token carries the rest.
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  // A problem sending students to this laptop, from sign-in or opening the class.
  const [notice, setNotice] = useState('');
  const [newGameName, setNewGameName] = useState('');
  const [warmupKind, setWarmupKind] = useState<WarmupKind>('facts');
  const [copyNote, setCopyNote] = useState(''); // shown when the browser would not copy
  const [copied, setCopied] = useState(''); // the PIN whose link was just copied
  const [vision, setVision] = useState(450); // how far students see in a new game, in map pixels
  const [randomNames, setRandomNames] = useState(true); // students get made-up names, and the teacher sees who they are

  const request = useCallback((path: string, body?: object) => call<Status>(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-teacher-session': token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }), [token]);

  const failed = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : 'Connection failed.');
    if ((cause as { status?: number }).status === 401) { setToken(''); setStatus(null); } // the session expired
  }, []);

  const refresh = useCallback(async () => {
    try { setStatus(await request('status')); setError(''); }
    catch (cause) { failed(cause); }
  }, [request, failed]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => window.clearInterval(timer);
  }, [token, refresh]);

  const signIn = async (typed = password) => {
    try {
      const { token: session, notice: linked } = await call<{ token: string; notice?: string }>('login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: typed })
      });
      setStatus(await call<Status>('status', { headers: { 'x-teacher-session': session } }));
      setPassword('');
      setError('');
      setNotice(linked || '');
      setToken(session);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed.'); }
  };

  // tester.bat opens /teacher?autologin=tester; its throwaway server's password is "tester".
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('autologin') === 'tester') void signIn('tester');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The link for a game: students open it, sign in, and arrive with the PIN already filled in. It is the online
  // site that signs them in, so on the laptop it points there; the PIN stays the same for every lesson.
  const linkFor = (pin: string) => joinLink(status?.laptop?.signInUrl ?? window.location.origin, pin);
  // The clipboard is only offered on https pages and on exactly "localhost", not on the laptop's network address, so
  // there is an older way to try next, and a message when neither works.
  const copyText = async (text: string): Promise<boolean> => {
    try {
      if (window.isSecureContext && navigator.clipboard) { await navigator.clipboard.writeText(text); return true; }
    } catch { /* try the other way */ }
    try {
      const box = document.createElement('textarea');
      box.value = text;
      box.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(box);
      box.select();
      const done = document.execCommand('copy');
      box.remove();
      return done;
    } catch { return false; }
  };
  const copyLink = async (pin: string) => {
    if (await copyText(linkFor(pin))) {
      setCopied(pin);
      setCopyNote('');
      window.setTimeout(() => setCopied(''), 2500);
    } else setCopyNote('Your browser would not copy it. Select the link above and press Ctrl+C.');
  };

  // The plaza may show made-up names; the teacher always sees the real one beside them.
  const who = (studentKey: string, shown: string) => {
    const real = status?.realNames?.[studentKey];
    return real && real !== shown ? `${shown} (${real})` : shown;
  };

  // Oldest waiting message first, like a queue.
  const waiting = status ? status.entries.filter(entry => entry.status === 'pending').reverse() : [];
  const oldest = waiting[0];
  const waitingBefore = useRef(0);

  // A soft beep and the tab title tell the teacher something is waiting, even from another window.
  useEffect(() => {
    document.title = waiting.length ? `(${waiting.length}) Teacher controls` : 'Teacher controls';
    if (waiting.length > waitingBefore.current) {
      try {
        const audio = new AudioContext();
        const tone = audio.createOscillator();
        const volume = audio.createGain();
        tone.frequency.value = 660;
        volume.gain.value = 0.05;
        tone.connect(volume).connect(audio.destination);
        tone.start();
        tone.stop(audio.currentTime + 0.12);
        tone.onended = () => { void audio.close(); };
      } catch { /* sound is optional */ }
    }
    waitingBefore.current = waiting.length;
  }, [waiting.length]);

  const action = async (path: string, body: object) => {
    try {
      const result = await request(path, body);
      setStatus(result);
      setError('');
      if (result.notice !== undefined) setNotice(result.notice);
    } catch (cause) { failed(cause); }
  };

  // A approves and R rejects the oldest waiting message.
  useEffect(() => {
    if (!oldest) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      const key = event.key.toLowerCase();
      if (key === 'a' || key === 'r') void action('review', { id: oldest.id, approve: key === 'a' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return <main className="teacher-page">
    <header className="teacher-header">
      <div><h1>Teacher controls</h1><p>{status?.mode === 'review' ? 'Nearby chat posts after an OpenAI check. Review it here and remove anything unsuitable.' : 'All student chat waits for your approval.'}</p></div>
      <span><Link to="/studio">Theme studio</Link> · <Link to="/">Student entrance</Link></span>
    </header>
    {!token || !status ? <form className="teacher-signin" onSubmit={event => { event.preventDefault(); void signIn(); }}>
      <label htmlFor="teacher-password">Teacher password (the same as PinPlay)</label>
      <input id="teacher-password" type="password" autoComplete="current-password" value={password}
        onChange={event => setPassword(event.target.value)} required />
      <button className="btn btn-primary">Open controls</button>
    </form> : <>
      <section className="teacher-controls">
        <strong>{status.game ? `${status.game.name} is ${status.open ? 'open' : 'closed'}` : 'No game yet'}</strong>
        {status.pin && <span className="teacher-pin">Class PIN <strong>{status.pin}</strong></span>}
        {status.pin && <button className="btn btn-secondary" onClick={() => void copyLink(status.pin!)} title={linkFor(status.pin)}>
          {copied === status.pin ? 'Link copied' : 'Copy the join link'}</button>}
        {status.game && <button className="btn btn-primary" onClick={() => void action('class', { open: !status.open })}>
          {status.open ? 'Close class' : 'Open class'}
        </button>}
        <button className="btn btn-secondary" onClick={() => { setStatus(null); setToken(''); }}>Sign out</button>
      </section>
      <section className="teacher-games">
        <h2>Games</h2>
        {status.pin && <label className="teacher-linkbox">The join link for {status.game?.name ?? 'the open game'}
          <input readOnly value={linkFor(status.pin)} onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()} />
        </label>}
        {copyNote && <p className="teacher-flag">{copyNote}</p>}
        <p>Each game keeps its own PIN, chat and where everyone stood. Close one and reopen it any later lesson; one game is open at a time.</p>
        <form className="teacher-newgame" onSubmit={event => {
          event.preventDefault();
          if (!newGameName.trim()) return;
          void action('game', { name: newGameName, randomNames, vision });
          setNewGameName('');
        }}>
          <input aria-label="Name for a new game" placeholder="New game, e.g. 3A Castanyada" maxLength={40}
            value={newGameName} onChange={event => setNewGameName(event.target.value)} />
          <button className="btn btn-primary" disabled={!newGameName.trim()}>New game</button>
          <label className="teacher-toggle">
            Vision:
            <select value={vision} onChange={event => setVision(Number(event.target.value))} aria-label="How far students see">
              {VISION_CHOICES.map(([radius, label]) => <option key={radius} value={radius}>{label}</option>)}
            </select>
            Students see only the area around them, and classmates farther away are hidden. You can change it any time.
          </label>
          <label className="teacher-toggle">
            <input type="checkbox" checked={randomNames} onChange={event => setRandomNames(event.target.checked)} />
            Random names: students pick a made-up name and you see who is who. Off: first names, with a surname letter when two match.
          </label>
        </form>
        {status.games.length > 0 && <ul>
          {status.games.map(game => <li key={game.id}>
            <span><strong>{game.name}</strong> · PIN {game.pin} · {game.randomNames ? 'random names' : 'real first names'} · {game.open ? 'open now' : `last played ${new Date(game.lastOpened).toLocaleDateString()}`}</span>
            <button className="btn btn-secondary" onClick={() => void copyLink(game.pin)} title={linkFor(game.pin)}>{copied === game.pin ? 'Link copied' : 'Copy join link'}</button>
            <button className="btn btn-secondary teacher-danger" onClick={() => {
              if (window.confirm(`Delete "${game.name}"?\n\nThis erases its chat, where everyone stood, their made-up names and its story. The join link stops working. This cannot be undone.`)) {
                void action('game/delete', { game: game.id, confirm: true });
              }
            }}>Delete</button>
            {!game.open && <button className="btn btn-secondary" onClick={() => void action('class', { open: true, game: game.id })}>
              {status.open ? 'Switch to this game' : 'Open'}
            </button>}
          </li>)}
        </ul>}
      </section>
      {status.game && <section className="teacher-games">
        <h2>Warm-up</h2>
        <p>{WARMUP_KINDS.find(kind => kind.id === warmupKind)?.blurb} Good for the first few minutes.</p>
        <div className="teacher-newgame">
          <select value={warmupKind} onChange={event => setWarmupKind(event.target.value as WarmupKind)} aria-label="Which warm-up">
            {WARMUP_KINDS.map(kind => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
          </select>
          <button className="btn btn-primary" disabled={!status.open} onClick={() => void action('warmup', { op: 'start', type: warmupKind })}>
            {status.warmup?.active ? 'Start again' : 'Start the warm-up'}</button>
          {status.warmup?.active && <button className="btn btn-secondary" onClick={() => void action('warmup', { op: 'end' })}>End the warm-up</button>}
        </div>
        {status.warmup && <>
          <p>{status.warmup.active ? 'In progress' : 'Finished'}: {status.warmup.team.done} of {status.warmup.team.total} found.</p>
          <ul>{status.warmup.players.map(player => <li key={player.studentKey}>
            <span><strong>{who(player.studentKey, player.name)}</strong> · {player.fact} · found {player.found} of {player.of}</span>
          </li>)}</ul>
        </>}
      </section>}
      {status.game && <section className="teacher-games">
        <h2>Vision</h2>
        <p>How far students see around themselves in <strong>{status.game.name}</strong>. Applies at once.</p>
        <div className="teacher-newgame">
          {VISION_CHOICES.map(([radius, label]) => <button key={radius} className={`btn ${status.game?.vision === radius ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => void action('vision', { radius })}>{label}</button>)}
        </div>
      </section>}
      {status.game && <section className="teacher-games">
        <h2>Campaign</h2>
        {!status.campaign ? <>
          <p>Start a story for <strong>{status.game.name}</strong>. Each student gets a role at random and keeps it for the whole campaign. Closing the game saves it, and reopening picks the story up again.</p>
          <div className="teacher-newgame">
            {status.campaigns.map(campaign => <button key={campaign.id} className="btn btn-primary"
              onClick={() => void action('campaign', { op: 'start', campaign: campaign.id })}>Start {campaign.title}</button>)}
          </div>
        </> : <>
          <p><strong>{status.campaign.title}</strong> · chapter {status.campaign.chapter + 1} of {status.campaign.chapters}: {status.campaign.chapterTitle} ·{' '}
            {{ active: 'in progress', chapter_complete: 'ready to advance: students can keep working', campaign_complete: 'finished' }[status.campaign.status]}</p>
          <div className="teacher-newgame">
            {status.campaign.status !== 'campaign_complete' && status.campaign.reveals.next && <button className="btn btn-secondary" title={status.campaign.reveals.next}
              onClick={() => void action('campaign', { op: 'reveal' })}>Reveal the next news ({status.campaign.reveals.shown} of {status.campaign.reveals.total} shown)</button>}
            {status.campaign.status !== 'campaign_complete' && <button className="btn btn-primary" onClick={() => void action('campaign', { op: 'next' })}>
              {status.campaign.chapter + 1 < status.campaign.chapters ? 'Start the next chapter' : 'End the campaign'}
            </button>}
            <button className="btn btn-secondary" onClick={() => {
              if (window.confirm('Erase the campaign for this game, including every role and clue?')) void action('campaign', { op: 'reset', confirm: true });
            }}>Erase campaign</button>
          </div>
          {status.campaign.reports.length > 0 && <>
            <h3>What students wrote</h3>
            <ul>{status.campaign.reports.map(report => <li key={report.studentKey + report.objective}>
              <span><strong>{who(report.studentKey, status.campaign?.players.find(player => player.studentKey === report.studentKey)?.name ?? 'Student')}</strong>: {report.text}</span>
            </li>)}</ul>
          </>}
          {status.campaign.status !== 'campaign_complete' && status.campaign.reveals.next && <p>Next news: <em>{status.campaign.reveals.next}</em></p>}
          {status.campaign.players.length > 0 && <ul>
            {status.campaign.players.map(player => <li key={player.studentKey}>
              <span><strong>{who(player.studentKey, player.name)}</strong> · {player.role}{player.thief ? ' · THIEF' : ''} · {player.clues} place clue{player.clues === 1 ? '' : 's'} · {player.done.length ? `answered ${player.done.length}` : 'not answered yet'}</span>
            </li>)}
          </ul>}
        </>}
      </section>}
      {status.laptop && <section className="teacher-laptop">
        <h2>Playing on this laptop</h2>
        <p>Students go to <strong>{status.laptop.signInUrl}</strong> and sign in with Google. They are then sent
          here, to <strong>{status.laptop.url}</strong>, while the class is open.</p>
        {notice && <p role="alert" className="teacher-error">{notice}</p>}
      </section>}
      <section className="teacher-mode">
        <h2>How chat is moderated</h2>
        <label><input type="radio" name="mode" checked={status.mode === 'approve'} onChange={() => void action('mode', { mode: 'approve' })} />
          Approve every message first</label>
        <label><input type="radio" name="mode" checked={status.mode === 'review'} disabled={!status.moderation}
          onChange={() => void action('mode', { mode: 'review' })} />
          Post nearby chat after OpenAI checks it, and review afterwards</label>
        <p>{status.moderation
          ? 'In the second mode only messages OpenAI cleared post at once. Whispers, flagged messages and anything it could not check still wait for you.'
          : 'The second mode needs an OPENAI_API_KEY (see the README), so it is off.'}</p>
      </section>
      <section className="teacher-online">
        <h2>In the Plaza now ({status.online.length})</h2>
        <p>{status.online.length ? status.online.map(student => who(student.studentKey, student.name)).join(', ') : 'Nobody yet.'}</p>
      </section>
      <section className="teacher-entries">
        <h2>Chat review</h2>
        {waiting.length > 0 && <div className="teacher-queue">
          <strong>{waiting.length} waiting</strong>
          <button className="btn btn-primary" onClick={() => void action('approve-all', {})}>Approve all ({waiting.length})</button>
          <small>or press <kbd>A</kbd> to approve and <kbd>R</kbd> to reject the oldest</small>
        </div>}
        {status.entries.length === 0 && <p>No messages yet.</p>}
        {status.entries.map(entry => <article key={entry.id} className={`teacher-entry${entry === oldest ? ' teacher-oldest' : ''}`}>
          <div><strong>{who(entry.studentKey, entry.sender)}</strong>{entry.target && <> → <strong>{entry.target}</strong> <em>(whisper)</em></>} <small>{new Date(entry.timestamp).toLocaleTimeString()} · {entry.status}</small></div>
          <p>{entry.text}</p>
          {entry.note && <p className="teacher-note">Grammar hint: {entry.note}</p>}
          {entry.flag && <p className="teacher-flag">{entry.status === 'blocked' ? 'Blocked by moderation' : 'Not checked by moderation'}: {entry.flag}</p>}
          <div className="teacher-actions">
            {entry.status === 'pending' && <>
              <button onClick={() => void action('review', { id: entry.id, approve: true })}>Approve</button>
              <button onClick={() => void action('review', { id: entry.id, approve: false })}>Reject</button>
            </>}
            {entry.status === 'approved' && <button onClick={() => void action('review', { id: entry.id, approve: false })}>Remove</button>}
            <button onClick={() => void action('mute', { studentKey: entry.studentKey, muted: !status.muted.includes(entry.studentKey) })}>
              {status.muted.includes(entry.studentKey) ? 'Unmute' : 'Mute'} student
            </button>
          </div>
        </article>)}
      </section>
    </>}
    {error && <p role="alert" className="teacher-error">{error}</p>}
  </main>;
}
