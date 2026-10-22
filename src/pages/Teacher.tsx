import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { joinLink } from '../studentAuth';
import { WARMUP_KINDS } from '../../shared/warmupKinds';
import type { WarmupKind } from '../../shared/warmupKinds';
import { readTeacherSession, storeTeacherSession } from '../teacherSession';
import './Teacher.css';
import { MAP_SIZE, plazaMap } from '../../shared/plazaMap';
import type { InterviewView } from '../../shared/campaign';
import type { TeacherSupport as Support } from '../../shared/support';
import type { CampaignChoice } from '../../shared/missionTypes';
import { XP } from '../../shared/levels';
import TeacherSupport from '../components/TeacherSupport';
import ClassReport from '../components/ClassReport';

type Entry = { id: string; studentKey: string; sender: string; target: string | null; everyone?: boolean; flag: string | null; note: string | null; text: string; timestamp: number; status: string; starred?: boolean };
type CampaignInfo = {
  id: string; title: string; status: 'active' | 'chapter_complete' | 'campaign_complete'; chapter: number; chapters: number; chapterTitle: string; chapterTitles?: string[];
  reveals: { shown: number; total: number; next: string | null };
  reports: { studentKey: string; objective: string; text: string; partner?: string; starred?: boolean }[];
  interviews?: (InterviewView & { studentKey: string; witnessKey: string; questionId: string; answerId: string | null })[];
  board?: { id: string; text: string; teacherReleased: boolean; released: boolean; accepted: number; completed: number }[];
  players: { studentKey: string; name: string; role: string; clues: number; done: string[]; thief: boolean }[];
};
type Game = { id: string; name: string; pin: string; lastOpened: number; open: boolean; randomNames: boolean };
type LiveStudent = { studentKey: string; name: string; x: number; y: number; zone: string | null; level?: number };
// laptop is set when this runs on the teacher's laptop (npm run classroom).
type Status = {
  campaign: CampaignInfo | null; campaigns: CampaignChoice[];
  warmup: { active: boolean; kind: 'facts' | 'identity' | 'pairs'; players: { studentKey: string; name: string; fact: string; found: number; of: number }[]; team: { done: number; total: number } } | null;
  open: boolean; game: { id: string; name: string; randomNames: boolean; vision: number } | null; realNames: Record<string, string>; games: Game[]; pin: string | null; entries: Entry[]; mode: 'approve' | 'review'; moderation: boolean; muted: string[]; online: LiveStudent[];
  laptop?: { url: string; signInUrl: string } | null; notice?: string;
  support: Support;
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
  const [movingStudent, setMovingStudent] = useState(false);
  const [password, setPassword] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  // The password is checked once; the session token carries the rest.
  const [token, setToken] = useState(readTeacherSession);
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
  const [openCards, setOpenCards] = useState(readOpenCards); // which cards the teacher left open or closed
  useEffect(() => { try { localStorage.setItem(CARDS_KEY, JSON.stringify(openCards)); } catch { /* remembered for this visit only */ } }, [openCards]);

  const request = useCallback((path: string, body?: object) => call<Status>(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-teacher-session': token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }), [token]);

  const failed = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : 'Connection failed.');
    if ((cause as { status?: number }).status === 401) { storeTeacherSession(''); setToken(''); setStatus(null); } // the session expired
  }, []);

  const refresh = useCallback(async () => {
    try { setStatus(await request('status')); setError(''); }
    catch (cause) { failed(cause); }
  }, [request, failed]);

  useEffect(() => {
    if (!token) return;
    void refresh();
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
      storeTeacherSession(session);
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
  const helpBefore = useRef<Set<string>>(new Set());
  const openHelp = status?.support?.alerts.filter(alert => alert.status === 'open') ?? [];
  const helpSignature = openHelp.map(alert => alert.id).join(',');

  // A soft beep and the tab title tell the teacher something is waiting, even from another window.
  useEffect(() => {
    const helpIds = helpSignature ? helpSignature.split(',') : [];
    const count = waiting.length + helpIds.length;
    document.title = count ? `(${count}) Teacher controls${helpIds.length ? ' · help needed' : ''}` : 'Teacher controls';
    if (waiting.length > waitingBefore.current || helpIds.some(id => !helpBefore.current.has(id))) {
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
    helpBefore.current = new Set(helpIds);
  }, [waiting.length, helpSignature]);

  const action = async (path: string, body: object) => {
    try {
      const result = await request(path, body);
      setStatus(result);
      setError('');
      if (result.notice !== undefined) setNotice(result.notice);
      return true;
    } catch (cause) { failed(cause); return false; }
  };

  // Saved classmates remain available for private help even when they are offline or have no alert.
  const supportStudents = new Map<string, { studentKey: string; name: string }>();
  if (status) {
    for (const student of status.support?.students ?? []) supportStudents.set(student.studentKey, student);
    for (const student of status.online) supportStudents.set(student.studentKey, student);
    for (const player of status.campaign?.players ?? []) if (!supportStudents.has(player.studentKey)) supportStudents.set(player.studentKey, player);
    for (const player of status.warmup?.players ?? []) if (!supportStudents.has(player.studentKey)) supportStudents.set(player.studentKey, player);
    for (const alert of status.support?.alerts ?? []) if (!supportStudents.has(alert.studentKey)) supportStudents.set(alert.studentKey, alert);
    for (const entry of status.entries) if (!supportStudents.has(entry.studentKey)) supportStudents.set(entry.studentKey, { studentKey: entry.studentKey, name: entry.sender });
  }

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

  // Every section is a card that folds away. The bar at the top lists them with a count each: red for something
  // waiting on the teacher, grey for information. A card's open or closed state is remembered on this computer.
  const choose = (id: CardId) => {
    setOpenCards(previous => ({ ...previous, [id]: true }));
    window.requestAnimationFrame(() => document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const toggle = (id: CardId, open: boolean) => setOpenCards(previous => previous[id] === open ? previous : { ...previous, [id]: open });
  const campaign = status?.campaign ?? null;
  const cards: CardInfo[] = !status ? [] : [
    ...(status.game ? [{ id: 'help' as const, title: 'Student help', badge: openHelp.length, alert: true }] : []),
    { id: 'chat', title: 'Chat review', badge: waiting.length, alert: true },
    ...(status.game ? [
      { id: 'live' as const, title: 'Live plaza', badge: status.online.length, label: `${status.online.length} online` },
      { id: 'campaign' as const, title: 'Campaign', label: campaign ? `chapter ${campaign.chapter + 1} of ${campaign.chapters}` : 'not started' },
      { id: 'warmup' as const, title: 'Warm-up', label: status.warmup?.active ? 'running' : undefined },
      { id: 'vision' as const, title: 'Vision', label: VISION_CHOICES.find(([radius]) => radius === status.game?.vision)?.[1] },
    ] : []),
    { id: 'games', title: 'Games', label: `${status.games.length}` },
    { id: 'mode', title: 'How chat is moderated', label: status.mode === 'review' ? 'review after' : 'approve first' },
    ...(status.laptop ? [{ id: 'laptop' as const, title: 'Playing on this laptop' }] : []),
    ...(status.game ? [{ id: 'report' as const, title: 'Class report' }] : []),
  ];
  const closeAll = () => setOpenCards(Object.fromEntries(cards.map(info => [info.id, false])));
  const card = (id: CardId, children: ReactNode) => {
    const info = cards.find(item => item.id === id);
    return info && <Card info={info} open={openCards[id] ?? DEFAULT_OPEN.includes(id)} onToggle={open => toggle(id, open)}>{children}</Card>;
  };

  return <main className="teacher-page">
    <header className="teacher-header">
      <div><h1>Teacher controls</h1><p>{status?.mode === 'review' ? 'Chat posts after an OpenAI check: nearby, to everyone or a whisper. Review it here and remove anything unsuitable.' : 'All student chat waits for your approval.'}</p></div>
      <span><Link to="/quest-library">Side quest library</Link> · <Link to="/mission-studio">Mission Studio</Link> · <Link to="/studio">Theme studio</Link> · <Link to="/">Student entrance</Link></span>
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
        <button className="btn btn-secondary" onClick={() => { storeTeacherSession(''); setStatus(null); setToken(''); }}>Sign out</button>
      </section>
      <nav className="teacher-nav" aria-label="Sections">
        {GROUPS.map(group => {
          const items = group.cards.flatMap(id => cards.filter(info => info.id === id));
          return items.length > 0 && <div key={group.title} className="teacher-nav-group">
            <span>{group.title}</span>
            {items.map(info => <button key={info.id} type="button" className={`teacher-nav-chip${info.alert && info.badge ? ' teacher-nav-alert' : ''}`}
              onClick={() => choose(info.id)}>
              {info.title}<Badge info={info} />
            </button>)}
          </div>;
        })}
        <button type="button" className="teacher-nav-close" onClick={closeAll}>Close all</button>
      </nav>

      <h2 className="teacher-group">During class</h2>
      {status.game && card('help', <TeacherSupport key={status.game.id} gameId={status.game.id} token={token} embedded
        support={status.support ?? { alerts: [], students: [] }}
        students={[...supportStudents.values()].sort((a, b) => who(a.studentKey, a.name).localeCompare(who(b.studentKey, b.name)))}
        who={who} action={action} failed={failed} />)}

      {card('chat', <>
        {waiting.length > 0 && <div className="teacher-queue">
          <strong>{waiting.length} waiting</strong>
          <button className="btn btn-primary" onClick={() => void action('approve-all', {})}>Approve all ({waiting.length})</button>
          <small>or press <kbd>A</kbd> to approve and <kbd>R</kbd> to reject the oldest</small>
        </div>}
        {status.entries.length === 0 && <p>No messages yet.</p>}
        {status.entries.map(entry => <article key={entry.id} className={`teacher-entry${entry === oldest ? ' teacher-oldest' : ''}`}>
          <div><strong>{who(entry.studentKey, entry.sender)}</strong>{entry.target && <> → <strong>{entry.target}</strong> <em>(whisper)</em></>}{entry.everyone && <> → <strong>everyone</strong></>} <small>{new Date(entry.timestamp).toLocaleTimeString()} · {entry.status}</small></div>
          <p>{entry.text}</p>
          {entry.note && <p className="teacher-note">{entry.note.startsWith('Investigation:') ? entry.note : `Grammar hint: ${entry.note}`}</p>}
          {entry.flag && <p className="teacher-flag">{entry.status === 'blocked' ? 'Blocked by moderation' : 'Not checked by moderation'}: {entry.flag}</p>}
          <div className="teacher-actions">
            {entry.status === 'pending' && <>
              <button className="btn btn-sm btn-primary" onClick={() => void action('review', { id: entry.id, approve: true })}>Approve</button>
              <button className="btn btn-sm" onClick={() => void action('review', { id: entry.id, approve: false })}>Reject</button>
            </>}
            {entry.status === 'approved' && <button className="btn btn-sm" onClick={() => void action('review', { id: entry.id, approve: false })}>Remove</button>}
            {entry.status === 'approved' && <StarButton starred={entry.starred} onStar={() => void action('xp', { chatId: entry.id })} />}
            <button className="btn btn-sm" onClick={() => void action('mute', { studentKey: entry.studentKey, muted: !status.muted.includes(entry.studentKey) })}>
              {status.muted.includes(entry.studentKey) ? 'Unmute' : 'Mute'} student
            </button>
          </div>
        </article>)}
      </>)}

      {status.game && card('live', <>
        <p>{status.open ? 'Updates every 2 seconds. Select a student to find them on the map.' : 'The class is closed.'}</p>
        <div className="teacher-actions" style={{ marginBottom: '1rem' }}>
          <button className="btn btn-sm" onClick={() => void action('magic', { power: 'rain' })}>Make it rain (15s)</button>
          <button className="btn btn-sm" disabled={!status.online.some(s => s.studentKey === selectedStudent)} onClick={() => setMovingStudent(!movingStudent)} aria-pressed={movingStudent}>{movingStudent ? 'Cancel move' : 'Move selected student'}</button>
          {(['freeze', 'thaw', 'lightning'] as const).map(power => <button key={power} className="btn btn-sm" disabled={!status.online.some(s => s.studentKey === selectedStudent)} onClick={() => void action('magic', { power, studentKey: selectedStudent })}>{power === 'freeze' ? 'Freeze (15s)' : power === 'thaw' ? 'Thaw' : 'Lightning (revive in 4s)'}</button>)}
        </div>
        <p role="status">{movingStudent ? 'Click an open path on the map to teleport the selected student.' : 'Select a student to cast a spell. Lightning is a playful tumble: they get up after 4 seconds.'}</p>
        <div className="teacher-map" style={{ cursor: movingStudent ? 'crosshair' : undefined }} aria-label="Live student locations in the plaza" onClick={event => {
          if (!movingStudent || !selectedStudent) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          void action('magic', { power: 'teleport', studentKey: selectedStudent, x: (event.clientX - bounds.left) / bounds.width * MAP_SIZE, y: (event.clientY - bounds.top) / bounds.height * MAP_SIZE });
          setMovingStudent(false);
        }}>
          <img src={plazaMap.image} alt="Plaza map" />
          {status.online.map((student, index) => <button key={student.studentKey} type="button"
            className={`teacher-map-marker${selectedStudent === student.studentKey ? ' selected' : ''}`}
            style={{ left: `${student.x / MAP_SIZE * 100}%`, top: `${student.y / MAP_SIZE * 100}%` }}
            onClick={event => { event.stopPropagation(); setSelectedStudent(student.studentKey); }}
            aria-pressed={selectedStudent === student.studentKey}
            aria-label={`${who(student.studentKey, student.name)}: ${student.zone ?? 'plaza'}`}
            title={`${who(student.studentKey, student.name)} · ${student.zone ?? 'plaza'}`}>
            {index + 1}
            {selectedStudent === student.studentKey && <span className="teacher-map-label">{who(student.studentKey, student.name)}</span>}
          </button>)}
        </div>
        {status.online.length ? <ul className="teacher-map-roster">{status.online.map((student, index) => <li key={student.studentKey}>
          <button type="button" aria-pressed={selectedStudent === student.studentKey}
            onClick={event => { event.stopPropagation(); setSelectedStudent(student.studentKey); }}>
            <strong>{index + 1}. {who(student.studentKey, student.name)}</strong> · {student.zone ?? 'plaza'}{student.level !== undefined && <> · Lv {student.level}</>}
          </button>
        </li>)}</ul> : <p>No students in the plaza right now.</p>}
      </>)}

      {status.game && <h2 className="teacher-group">Activities</h2>}
      {status.game && card('warmup', <>
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
      </>)}

      {status.game && card('campaign', !campaign ? <>
        <p>Start a story for <strong>{status.game.name}</strong>. Each student gets a role at random and keeps it for the whole campaign. Closing the game saves it, and reopening picks the story up again.</p>
        <ul className="teacher-campaign-choices">{status.campaigns.map(choice => <li key={choice.id}>
          <div>
            <strong>{choice.title}</strong>
            <small>{choice.chapters.length} {choice.chapters.length === 1 ? 'chapter' : 'chapters'} · {features(choice)}</small>
            <ol className="teacher-chapter-line">{chapterPreview(choice.chapters).map(([number, title]) => <li key={title}>{number > 0 && <span>{number}.</span>}{title}</li>)}</ol>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => void action('campaign', { op: 'start', campaign: choice.id })}>Start</button>
        </li>)}</ul>
        <p className="teacher-muted">Change these chapters or write your own campaign in <Link to="/mission-studio">Mission Studio</Link>.</p>
      </> : <>
        <p><strong>{campaign.title}</strong> · {{ active: 'in progress', chapter_complete: 'ready for the next chapter: students can keep working', campaign_complete: 'finished' }[campaign.status]}</p>
        <ol className="teacher-chapter-steps">{(campaign.chapterTitles ?? []).map((title, index) => {
          const state = campaign.status === 'campaign_complete' || index < campaign.chapter ? 'done' : index === campaign.chapter ? 'now' : 'next';
          return <li key={index} className={`teacher-step-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="teacher-step-number">{state === 'done' ? '✓' : index + 1}</span>
            <span>{title}</span>
            {state === 'now' && <small>now</small>}
          </li>;
        })}</ol>
        {campaign.status !== 'campaign_complete' && <div className="teacher-newgame">
          {campaign.reveals.next && <button className="btn btn-secondary" title={campaign.reveals.next}
            onClick={() => void action('campaign', { op: 'reveal' })}>Reveal the next news ({campaign.reveals.shown} of {campaign.reveals.total} shown)</button>}
          <button className="btn btn-primary" onClick={() => void action('campaign', { op: 'next' })}>
            {campaign.chapter + 1 < campaign.chapters ? `Start chapter ${campaign.chapter + 2}: ${campaign.chapterTitles?.[campaign.chapter + 1] ?? ''}` : 'End the campaign'}
          </button>
        </div>}
        {campaign.status !== 'campaign_complete' && campaign.reveals.next && <p>Next news: <em>{campaign.reveals.next}</em></p>}
        {campaign.players.length > 0 && <><h3>Students</h3><ul>
          {campaign.players.map(player => <li key={player.studentKey}>
            <span><strong>{who(player.studentKey, player.name)}</strong> · {player.role}{player.thief ? ' · THIEF' : ''} · {player.clues} place clue{player.clues === 1 ? '' : 's'} · {player.done.length ? `answered ${player.done.length}` : 'not answered yet'}</span>
          </li>)}
        </ul></>}
        {!!campaign.board?.length && <><h3>Quest board</h3><p>Release prepared quests when the class needs another mystery.</p><ul>{campaign.board.map(quest => <li key={quest.id}><span>{quest.text} · {quest.accepted} accepted · {quest.completed} completed</span>
          {quest.teacherReleased && !quest.released && campaign.status !== 'campaign_complete' && <button className="btn btn-secondary btn-sm" onClick={() => void action('quest-release', { objective: quest.id })}>Release quest</button>}
          {quest.teacherReleased && quest.released && <small>Released</small>}</li>)}</ul></>}
        {campaign.reports.length > 0 && <>
          <h3>What students wrote</h3>
          <ul>{campaign.reports.map(report => <li key={report.studentKey + report.objective}>
            <span><strong>{who(report.studentKey, campaign.players.find(player => player.studentKey === report.studentKey)?.name ?? 'Student')}</strong>{report.partner ? ` · partner: ${report.partner}` : ''}: {report.text}</span>
            <StarButton starred={report.starred} onStar={() => void action('xp', { report: { studentKey: report.studentKey, objective: report.objective } })} />
          </li>)}</ul>
        </>}
        {!!campaign.interviews?.length && <details className="teacher-interviews"><summary>Witness exchanges ({campaign.interviews.length})</summary>
          <p>Review questions and replies in the chat queue. These records verify participation; you assess the language and reasoning.</p>
          {campaign.interviews.map(interview => <article key={interview.id} className="teacher-entry">
            <strong>{who(interview.studentKey, campaign.players.find(p => p.studentKey === interview.studentKey)?.name ?? 'Student')} → {who(interview.witnessKey, interview.name)}</strong>
            <p>{interview.task}</p>
            <p>Question ({interview.questionStatus}): {interview.question}</p>
            {interview.shared && <p>Investigator evidence: {interview.shared}</p>}
            {interview.answer && <p>Reply ({interview.answerStatus}): {interview.answer}</p>}
            {interview.evidence && <p>Witness evidence: {interview.evidence}</p>}
            <div className="teacher-actions">
              {interview.questionStatus === 'pending' && <>
                <button className="btn btn-sm btn-primary" onClick={() => void action('review', { id: interview.questionId, approve: true })}>Approve question</button>
                <button className="btn btn-sm" onClick={() => void action('review', { id: interview.questionId, approve: false })}>Reject question</button>
              </>}
              {interview.answerStatus === 'pending' && <>
                <button className="btn btn-sm btn-primary" onClick={() => void action('review', { id: interview.answerId, approve: true })}>Approve reply</button>
                <button className="btn btn-sm" onClick={() => void action('review', { id: interview.answerId, approve: false })}>Reject reply</button>
              </>}
              {interview.questionStatus === 'approved' && <button className="btn btn-sm" onClick={() => void action('review', { id: interview.questionId, approve: false })}>Remove question</button>}
              {interview.answerStatus === 'approved' && <button className="btn btn-sm" onClick={() => void action('review', { id: interview.answerId, approve: false })}>Remove reply</button>}
            </div>
          </article>)}
        </details>}
        <p className="teacher-muted">Students finished early, or a short session between chapters? <Link to="/quest-library">Add side quests from the library</Link>: story quests for this chapter or generic ones for any game.
          Change chapters in <Link to="/mission-studio">Mission Studio</Link>.</p>
        <button className="btn btn-secondary btn-sm teacher-danger" onClick={() => {
          if (window.confirm('Erase the campaign for this game, including every role and clue?')) void action('campaign', { op: 'reset', confirm: true });
        }}>Erase campaign</button>
      </>)}

      <h2 className="teacher-group">Setup</h2>
      {card('games', <>
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
            <span className="teacher-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => void copyLink(game.pin)} title={linkFor(game.pin)}>{copied === game.pin ? 'Link copied' : 'Copy join link'}</button>
              {!game.open && <button className="btn btn-secondary btn-sm" onClick={() => void action('class', { open: true, game: game.id })}>
                {status.open ? 'Switch to this game' : 'Open'}
              </button>}
              <button className="btn btn-secondary btn-sm teacher-danger" onClick={() => {
                if (window.confirm(`Delete "${game.name}"?\n\nThis erases its chat, full submission history, help requests, where everyone stood, their made-up names and its story. The join link stops working. This cannot be undone.`)) {
                  void action('game/delete', { game: game.id, confirm: true });
                }
              }}>Delete</button>
            </span>
          </li>)}
        </ul>}
      </>)}

      {status.game && card('vision', <>
        <p>How far students see around themselves in <strong>{status.game.name}</strong>. Applies at once.</p>
        <div className="teacher-newgame">
          {VISION_CHOICES.map(([radius, label]) => <button key={radius} className={`btn ${status.game?.vision === radius ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => void action('vision', { radius })}>{label}</button>)}
        </div>
      </>)}

      {card('mode', <>
        <label><input type="radio" name="mode" checked={status.mode === 'approve'} onChange={() => void action('mode', { mode: 'approve' })} />
          Approve every message first</label>
        <label><input type="radio" name="mode" checked={status.mode === 'review'} disabled={!status.moderation}
          onChange={() => void action('mode', { mode: 'review' })} />
          Post chat after OpenAI checks it, and review afterwards</label>
        <p>{status.moderation
          ? 'In the second mode only messages OpenAI cleared post at once: nearby, to everyone or a whisper. Witness exchanges, flagged messages and anything it could not check still wait for you.'
          : 'The second mode needs an OPENAI_API_KEY (see the README), so it is off.'}</p>
      </>)}

      {status.laptop && card('laptop', <>
        <p>Students go to <strong>{status.laptop.signInUrl}</strong> and sign in with Google. They are then sent
          here, to <strong>{status.laptop.url}</strong>, while the class is open.</p>
      </>)}

      {status.game && <h2 className="teacher-group">After class</h2>}
      {status.game && card('report', <ClassReport token={token} copy={copyText} />)}

      {notice && <p role="alert" className="teacher-error">{notice}</p>}
    </>}
    {error && <p role="alert" className="teacher-error">{error}</p>}
  </main>;
}

type CardId = 'help' | 'chat' | 'live' | 'campaign' | 'warmup' | 'vision' | 'games' | 'mode' | 'laptop' | 'report';
// badge: a number to show; alert: that number is something waiting on the teacher; label: a word of status instead.
type CardInfo = { id: CardId; title: string; badge?: number; alert?: boolean; label?: string };
// Every card starts closed; the counts in the bar say where to look. (A new key, so cards left open before close once.)
const DEFAULT_OPEN: CardId[] = [];
const CARDS_KEY = 'pixelplaza.teacher.cards.v2';
// The page in four parts, in the order a lesson uses them.
const GROUPS: { title: string; cards: CardId[] }[] = [
  { title: 'During class', cards: ['help', 'chat', 'live'] },
  { title: 'Activities', cards: ['warmup', 'campaign'] },
  { title: 'Setup', cards: ['games', 'vision', 'mode', 'laptop'] },
  { title: 'After class', cards: ['report'] },
];

function readOpenCards(): Partial<Record<CardId, boolean>> {
  try { return JSON.parse(localStorage.getItem(CARDS_KEY) ?? '{}') ?? {}; } catch { return {}; }
}

// The teacher's star: experience for a good message or report, once each.
function StarButton({ starred, onStar }: { starred?: boolean; onStar: () => void }) {
  return starred ? <span className="teacher-starred">⭐ Starred</span>
    : <button className="btn btn-sm" title={`Give ${XP.teacher} XP for good English`} onClick={onStar}>⭐ +{XP.teacher} XP</button>;
}

function Badge({ info }: { info: CardInfo }) {
  if (info.alert) return info.badge ? <span className="teacher-badge teacher-badge-alert">{info.badge}</span> : null;
  return info.label ? <span className="teacher-badge">{info.label}</span> : null;
}

function Card({ info, open, onToggle, children }: { info: CardInfo; open: boolean; onToggle: (open: boolean) => void; children: ReactNode }) {
  return <details id={`card-${info.id}`} className="teacher-card" open={open} onToggle={event => onToggle(event.currentTarget.open)}>
    <summary><h3>{info.title}</h3><Badge info={info} /></summary>
    <div className="teacher-card-body">{children}</div>
  </details>;
}

// What is special about a campaign, from what it contains.
function features(choice: CampaignChoice): string {
  return [
    choice.mystery ? 'a mystery: find the thief' : 'no mystery',
    choice.witnesses && 'witness exchanges before each conclusion',
    choice.partnerQuests && 'partner quests on a quest board',
  ].filter(Boolean).join(' · ');
}

// The chapters in order, numbered; a long run of sessions is shortened, and the gap has no number.
function chapterPreview(chapters: string[]): [number, string][] {
  const numbered = chapters.map((title, index): [number, string] => [index + 1, title]);
  return chapters.length > 6 ? [...numbered.slice(0, 2), [0, `… ${chapters.length - 3} more …`], numbered[numbered.length - 1]] : numbered;
}
