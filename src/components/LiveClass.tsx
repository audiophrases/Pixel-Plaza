import { useEffect, useState, type ReactNode } from 'react';
import type { HelpAlert } from '../../shared/support';
import { HARM_LABEL, type Incident } from '../../shared/safety';
import type { BlockedStatus } from '../../shared/blockedWords';
import { tidy } from '../../shared/tidy';
import { loadChecker } from '../spellingData';
import { IDENTITY_NAMES } from '../../shared/warmupKinds';
import type { AvatarConfig } from '../utils/AvatarRenderer';
import Face from './Face';
import Correction from './Correction';
import { correctionParts, correctionText } from '../../shared/diff';
import { ago } from './liveFormat';
import './LiveClass.css';

// The class as it happens, on one screen: everything that needs the teacher in one list, most urgent first, and the
// students as faces that say who needs them. A face opens that student's drawer; everything else is in the tabs below.
export type LiveEntry = { id: string; studentKey: string; sender: string; target: string | null; everyone?: boolean; flag: string | null; note: string | null;
  text: string; timestamp: number; status: string; starred?: boolean };
export type LiveStudent = { studentKey: string; name: string; zone: string | null; level?: number; look?: Partial<AvatarConfig>; inTab?: boolean; tabSwitches?: number; tabAwayAt?: number | null };
// A clip one student's device read aloud: a chat message (id) or a voice sample (no id). `now` is the server's clock.
export type LivePlay = { at: number; studentKey: string; id: string | null; senderKey: string; text: string };
export type LiveSound = { allOff?: boolean; off: string[]; now: number; plays: LivePlay[] };
type Props = {
  gameId: string;
  alerts: HelpAlert[];
  incidents: Incident[]; // harmful things students tried to send: first in To do
  repeats: BlockedStatus['repeats']; // what many students are all writing to everyone, to block or leave
  online: LiveStudent[];
  known: { studentKey: string; name: string }[]; // everyone seen in this game, online or not
  muted: string[];
  sound: LiveSound;
  open: boolean;
  who: (studentKey: string, name: string) => string;
  action: (path: string, body: object) => Promise<boolean>;
  selected: string | null;
  onSelect: (studentKey: string | null) => void;
};

type Evidence = HelpAlert['evidence'][number];

// The reason without the "Word check:" the game puts in front of word-check reasons.
const plainReason = (reason: string) => reason.replace(/^Word check:\s*/, '');

// Why an attempt went wrong, in a few words, from the reason the game recorded.
function why(recorded: string): string {
  const reason = plainReason(recorded);
  const words = reason.match(/^(?:English word check|Use English words only):\s*(.+?)\.?$/);
  if (words) return `not English: ${words[1]}`;
  if (reason.startsWith('Grammar hint:')) return `grammar: ${reason.slice('Grammar hint:'.length).replace(/\s*Try: “.*”$/, '').trim()}`;
  if (reason.startsWith('Answer not accepted:')) return `wrong answer to: ${reason.slice('Answer not accepted:'.length).trim()}`;
  if (reason.startsWith('Message filter:')) return `blocked: ${reason.slice('Message filter:'.length).trim()}`;
  return reason;
}

const PLAYING_MS = 10_000; // a clip that started this recently is probably still playing
const LATELY_MS = 2 * 60_000; // with nothing searched, what played in the last two minutes is shown

// Loose enough that "i love you" finds “I love you!!”.
const plain = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// One line per message read aloud, newest first, with every device it played on and how often.
type Heard = { key: string; id: string | null; senderKey: string; text: string; last: number; devices: { studentKey: string; times: number }[] };
function heardAloud(plays: LivePlay[]): Heard[] {
  const heard = new Map<string, Heard>();
  for (const play of plays) {
    const key = play.id ?? `sample:${play.senderKey}`;
    const line = heard.get(key) ?? { key, id: play.id, senderKey: play.senderKey, text: play.text, last: play.at, devices: [] };
    heard.set(key, line);
    const device = line.devices.find(item => item.studentKey === play.studentKey);
    if (device) device.times += 1;
    else line.devices.push({ studentKey: play.studentKey, times: 1 });
  }
  return [...heard.values()];
}

export default function LiveClass({ gameId, alerts, incidents, repeats, online, known, muted, sound, open, who, action, selected, onSelect }: Props) {
  const [replies, setReplies] = useState<Record<string, string>>({}); // drafts, by student
  const [sent, setSent] = useState<string | null>(null); // the student a private message just went to
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState(''); // something the teacher heard in the room
  const [soundBusy, setSoundBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null); // the one item opened to its details

  const needing = alerts.filter(alert => alert.status !== 'resolved');
  // Most urgent first: harm, what the whole plaza is repeating, a student asking,
  // then a student who may be stuck.
  const asking = needing.filter(alert => alert.kind === 'requested').sort((a, b) => a.timestamp - b.timestamp);
  const stuck = needing.filter(alert => alert.kind === 'suggested').sort((a, b) => a.timestamp - b.timestamp);
  const total = incidents.length + repeats.length + asking.length + stuck.length;
  const lookOf = (studentKey: string) => online.find(student => student.studentKey === studentKey)?.look;
  const nameOf = (studentKey: string) => online.find(student => student.studentKey === studentKey)?.name ?? known.find(student => student.studentKey === studentKey)?.name ?? 'Student';

  // What the game already showed the student for each attempt in a check-in: the AI's grammar correction, or the
  // word check's suggestions when it is sure of every word. Those need no teacher; the rest get a Fix button.
  const [autoFix, setAutoFix] = useState<Record<string, string | null>>({});
  const evidenceKey = (alert: HelpAlert, item: Evidence) => `${alert.id}:${item.timestamp}`;
  const signature = stuck.flatMap(alert => alert.evidence.map(item => evidenceKey(alert, item))).join('|');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found: Record<string, string | null> = {};
      let check: Awaited<ReturnType<typeof loadChecker>> | null = null;
      for (const alert of stuck) for (const item of alert.evidence) {
        const key = evidenceKey(alert, item);
        const grammar = item.reason.match(/Try: “(.*)”$/)?.[1];
        if (grammar) { found[key] = grammar; continue; }
        if (!plainReason(item.reason).match(/^(?:English word check|Use English words only):/)) { found[key] = null; continue; }
        try {
          check ??= await loadChecker();
          const mistakes = check(item.text, [...known.map(student => student.name), ...IDENTITY_NAMES]);
          found[key] = mistakes.length && mistakes.every(mistake => mistake.sure && mistake.suggestions[0])
            ? mistakes.reduce((text, mistake) => text.replace(mistake.word, mistake.suggestions[0]), item.text) : null;
        } catch { found[key] = null; }
      }
      if (!cancelled) setAutoFix(found);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // The teacher's fix: their message in a box to change, sent as a correction the student sees in colour.
  const [fixing, setFixing] = useState<{ key: string; alert: HelpAlert; original: string } | null>(null);
  const [fixText, setFixText] = useState('');
  const [fixed, setFixed] = useState<Set<string>>(() => new Set());
  const startFix = (alert: HelpAlert, item: Evidence) => { setFixing({ key: evidenceKey(alert, item), alert, original: item.text }); setFixText(item.text); };
  const sendFix = async () => {
    if (!fixing || busy || !fixText.trim() || fixText.trim() === fixing.original.trim()) return;
    const { alert, key, original } = fixing;
    setBusy(true);
    try {
      if (!await action('help-message', { studentKey: alert.studentKey, text: correctionText(original, fixText), gameId })) return;
      const done = new Set(fixed).add(key);
      setFixed(done);
      setFixing(null);
      // Every attempt that needed the teacher is fixed: the check-in is done. Otherwise the teacher is on it.
      const left = alert.evidence.filter(item => autoFix[evidenceKey(alert, item)] == null && !done.has(evidenceKey(alert, item)));
      await action('help-status', { id: alert.id, status: left.length ? 'acknowledged' : 'resolved', gameId });
    } finally { setBusy(false); }
  };

  const reply = async (studentKey: string, alert?: HelpAlert) => {
    const text = (replies[studentKey] ?? '').trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      if (!await action('help-message', { studentKey, text, gameId })) return;
      setReplies(current => ({ ...current, [studentKey]: '' }));
      setSent(studentKey);
      window.setTimeout(() => setSent(current => current === studentKey ? null : current), 2500);
      // Answering is helping.
      if (alert?.status === 'open') await action('help-status', { id: alert.id, status: 'acknowledged', gameId });
    } finally { setBusy(false); }
  };
  const replyBox = (studentKey: string, alert?: HelpAlert) => <form className="live-reply" onSubmit={event => { event.preventDefault(); void reply(studentKey, alert); }}>
    <input value={replies[studentKey] ?? ''} maxLength={1000} disabled={busy} aria-label={`Private message to ${nameOf(studentKey)}`}
      placeholder={`Message ${nameOf(studentKey)} privately…`} onChange={event => setReplies(current => ({ ...current, [studentKey]: event.target.value }))} />
    <button className="btn btn-primary btn-sm" disabled={busy || !(replies[studentKey] ?? '').trim()}>{sent === studentKey ? 'Sent ✓' : 'Send'}</button>
  </form>;
  const person = (studentKey: string, name: string) => <button type="button" className="live-person" onClick={event => { event.stopPropagation(); onSelect(studentKey); }} title="Open this student">
    <Face player={lookOf(studentKey)} name={name} /><strong>{who(studentKey, name)}</strong>
  </button>;
  // One line until it is opened: who, what, the words, how long ago, and the quickest answer.
  const toggle = (id: string) => setExpanded(current => current === id ? null : id);
  const summary = (id: string, studentKey: string, name: string, what: ReactNode, words: string, at: number, buttons: ReactNode) =>
    <div className="live-row" role="button" tabIndex={0} aria-expanded={expanded === id} onClick={() => toggle(id)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(id); } }}>
      {person(studentKey, name)}
      <span className="live-scope">{what}</span>
      <span className="live-snippet">{words}</span>
      <small>{ago(at)}</small>
      <span className="live-row-buttons" onClick={event => event.stopPropagation()}>{buttons}</span>
      <span className="live-caret" aria-hidden="true">{expanded === id ? '▾' : '▸'}</span>
    </div>;

  // Students: whoever needs the teacher first, then everyone else by name.
  const helpFor = (studentKey: string) => needing.find(alert => alert.studentKey === studentKey);
  const incidentOf = (studentKey: string) => incidents.find(incident => incident.studentKey === studentKey);
  const urgency = (studentKey: string) => (incidentOf(studentKey) ? 3 : 0) + (helpFor(studentKey)?.status === 'open' ? 2 : helpFor(studentKey) ? 1 : 0);
  const tiles: LiveStudent[] = [...online, ...needing.filter(alert => !online.some(student => student.studentKey === alert.studentKey))
    .map(alert => ({ studentKey: alert.studentKey, name: alert.name, zone: null }))];
  tiles.sort((a, b) => urgency(b.studentKey) - urgency(a.studentKey) || who(a.studentKey, a.name).localeCompare(who(b.studentKey, b.name)));

  // Heard a phrase in the room? It leads to the devices that played it, each one click from silent.
  const heard = heardAloud(sound.plays);
  // Every word typed, in any order: what the teacher remembers of it is enough.
  const looking = plain(phrase).split(' ').filter(Boolean);
  const found = looking.length ? heard.filter(line => looking.every(word => plain(line.text).includes(word)))
    : heard.filter(line => line.last > sound.now - LATELY_MS).slice(0, 3);
  const playing = new Set(sound.plays.filter(play => play.at > sound.now - PLAYING_MS).map(play => play.studentKey));
  const allSoundOff = sound.allOff === true;
  const silenced = (studentKey: string) => allSoundOff || sound.off.includes(studentKey);
  const silence = (studentKey: string) => void action('sound', { studentKey, off: !silenced(studentKey) });
  const toggleAllSound = async () => {
    setSoundBusy(true);
    try { await action('sound-all', { off: !allSoundOff }); }
    finally { setSoundBusy(false); }
  };

  const helpItem = (alert: HelpAlert) => {
    const first = alert.evidence.at(-1);
    return <li key={alert.id} className={`live-item live-help live-help-${alert.status}${expanded === alert.id ? ' live-open' : ''}`}>
      {summary(alert.id, alert.studentKey, alert.name,
        <>{alert.kind === 'requested' ? '🙋 asks for help' : `💡 stuck ${alert.evidence.reduce((sum, item) => sum + (item.count ?? 1), 0)}×`}{alert.status === 'acknowledged' && ' · 👀'}</>,
        tidy(alert.kind === 'requested' ? alert.note || first?.text || '' : first?.text || alert.note || ''), alert.timestamp,
        <>
          {alert.status === 'open' && <button className="live-soft" onClick={() => void action('help-status', { id: alert.id, status: 'acknowledged', gameId })} title="You are helping (in person or here)">👀</button>}
          <button className="live-yes" onClick={() => void action('help-status', { id: alert.id, status: 'resolved', gameId })} title="Helped: take it off the list" aria-label="Done">✓</button>
        </>)}
      {expanded === alert.id && <div className="live-details">
        {alert.kind === 'suggested' && alert.evidence.length > 0
          ? <ul className="live-evidence">{alert.evidence.map(item => {
              const key = evidenceKey(alert, item);
              const auto = autoFix[key];
              return <li key={key}>
                <small>{ago(item.timestamp)}</small> <q>{tidy(item.text)}</q>{(item.count ?? 1) > 1 && <span className="live-times">×{item.count}</span>} <span className="live-why">{why(item.reason)}</span>
                {auto ? <span className="live-auto" title="The game already showed the student this">→ {auto}</span>
                  : fixed.has(key) ? <span className="live-fixed">✓ fix sent</span>
                  : auto === null && fixing?.key !== key && <button type="button" className="live-fix" onClick={() => startFix(alert, item)} title="Correct it: the student gets it highlighted">✏️ Fix</button>}
                {fixing?.key === key && <form className="live-fixer" onSubmit={event => { event.preventDefault(); void sendFix(); }}>
                  <input autoFocus value={fixText} maxLength={400} disabled={busy} aria-label={`Correct ${nameOf(alert.studentKey)}'s message`}
                    onFocus={event => { const end = event.currentTarget.value.length; event.currentTarget.setSelectionRange(end, end); }}
                    onChange={event => setFixText(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setFixing(null); }} />
                  <button className="btn btn-primary btn-sm" disabled={busy || !fixText.trim() || fixText.trim() === item.text.trim()}>Send ↵</button>
                  <p className="live-fix-preview">{fixText.trim() && fixText.trim() !== item.text.trim()
                    ? <Correction parts={correctionParts(item.text, fixText)} /> : <em>Change the words, then press Enter. Esc closes.</em>}</p>
                </form>}
              </li>;
            })}</ul>
          : (alert.note || first) && <p className="live-text">{tidy(alert.note || first!.text)}</p>}
        {(alert.since ?? 0) > 0 && <p className="live-notes"><span className="live-tag live-tag-ok">✓ Since then: {alert.since} {alert.since === 1 ? 'message posted or answer right' : 'messages posted or answers right'}</span></p>}
        {alert.ai?.tip && <p className="live-notes"><span className="live-tag">🤖 AI hint given: {alert.ai.tip}</span></p>}
        {replyBox(alert.studentKey, alert)}
      </div>}
    </li>;
  };

  return <section className="live" aria-label="The class now">
    <div className="live-column">
      <div className="live-heading">
        <h2>Needs you {total > 0 && <span className="live-count">{total}</span>}</h2>
      </div>
      {total === 0 && <p className="live-clear">{open ? '✓ All caught up' : 'The class is closed.'}</p>}
      <ol className="live-todo">
        {/* Harm first: what was tried, how often, by whom. Nothing happens to the student unless the teacher acts. */}
        {incidents.map(incident => <li key={incident.id} className={`live-item live-incident${expanded === incident.id ? ' live-open' : ''}`}>
          {summary(incident.id, incident.studentKey, incident.name,
            <span className="live-harm">🚨 {HARM_LABEL[incident.harm]}{incident.count > 1 && ` ×${incident.count}`}</span>, tidy(incident.texts[0] ?? ''), incident.lastTs,
            <>
              <button className="live-soft" onClick={() => void action('mute', { studentKey: incident.studentKey, muted: !muted.includes(incident.studentKey) })}
                title={muted.includes(incident.studentKey) ? 'Let them chat again' : 'Stop their chat until you unmute it'}>{muted.includes(incident.studentKey) ? '💬' : '🤐'}</button>
              <button className="live-yes" onClick={() => void action('incident', { id: incident.id })} title="Seen: take it off the list" aria-label="Seen">✓</button>
            </>)}
          {expanded === incident.id && <div className="live-details">
            <ul className="live-incident-texts">{incident.texts.map((text, index) => <li key={index}><q>{tidy(text)}</q></li>)}</ul>
            {incident.harm === 'self-harm' && <p className="live-notes"><span className="live-tag live-tag-warn">Check on this student in person.</span></p>}
            {replyBox(incident.studentKey)}
          </div>}
        </li>)}
        {/* Many students writing the same thing to everyone: block it for the lesson (what already says it comes down), or leave it. */}
        {repeats.map(repeat => {
          const id = `repeat:${repeat.key}`;
          return <li key={id} className={`live-item live-repeat${expanded === id ? ' live-open' : ''}`}>
            <div className="live-row" role="button" tabIndex={0} aria-expanded={expanded === id} onClick={() => toggle(id)}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(id); } }}>
              <span className="live-scope live-repeat-who">🔁 {repeat.students.length} students to everyone</span>
              <span className="live-snippet"><q>{repeat.words}</q></span>
              <span className="live-row-buttons" onClick={event => event.stopPropagation()}>
                <button className="live-no" onClick={() => void action('block', { words: [repeat.words] })}
                  title={`Block “${repeat.words}” for this lesson and take down what already says it`} aria-label="Block">🚫</button>
                <button className="live-yes" onClick={() => void action('let-through', { key: repeat.key, words: repeat.words })}
                  title="Leave it: not offered again this lesson" aria-label="Leave it">✓</button>
              </span>
              <span className="live-caret" aria-hidden="true">{expanded === id ? '▾' : '▸'}</span>
            </div>
            {expanded === id && <div className="live-details">
              <p className="live-notes">{repeat.students.map(student => <span key={student.studentKey}>{person(student.studentKey, student.name)}</span>)}</p>
              <ul className="live-incident-texts">{repeat.examples.map((text, index) => <li key={index}><q>{tidy(text)}</q></li>)}</ul>
            </div>}
          </li>;
        })}
        {asking.map(helpItem)}
        {stuck.map(helpItem)}
      </ol>
    </div>

    <div className="live-column">
      <div className="live-heading"><h2>Class <span className="live-muted">{online.length} here</span>
        {online.filter(s => s.inTab === false).length > 0 && (
          <span className="live-tab-away-badge" title={online.filter(s => s.inTab === false).map(s => who(s.studentKey, s.name)).join(', ')}>
            ⚠️ {online.filter(s => s.inTab === false).length} out of tab
          </span>
        )}
      </h2>
        <input type="search" className="live-heard-search" value={phrase} onChange={event => setPhrase(event.target.value)}
          placeholder="🔊 Heard something? Type it" aria-label="Find which devices read a phrase aloud" />
      </div>
      <div className="live-sound-control">
        <button type="button" className={`btn btn-sm ${allSoundOff ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={allSoundOff} disabled={soundBusy}
          onClick={() => void toggleAllSound()} title={allSoundOff ? 'Release the class sound lock. Individual locks and student mute choices stay in effect.' : 'Stop TTS and game sounds on all student devices, including late joiners.'}>
          {allSoundOff ? '🔊 Restore student sound' : '🔇 Mute all student sound'}</button>
        {allSoundOff && <p role="status">All student sound is off until you restore it.</p>}
      </div>
      {found.length > 0 && <ul className="live-heard" aria-label="Read aloud">{found.map(line => <li key={line.key}>
        <div className="live-heard-top"><q>{line.text}</q>
          {line.id ? person(line.senderKey, nameOf(line.senderKey)) : <span className="live-muted">🎙 voice test</span>}
          <small>{ago(line.last, sound.now)}</small></div>
        <div className="live-heard-on"><span title="Played aloud on">🔊</span>{line.devices.map(({ studentKey, times }) => {
          const name = who(studentKey, nameOf(studentKey));
          return <button key={studentKey} type="button" className="live-heard-device" aria-pressed={silenced(studentKey)} disabled={allSoundOff} onClick={() => silence(studentKey)}
            title={allSoundOff ? 'Restore class sound before changing individual sound settings' : silenced(studentKey) ? `Turn ${name}’s sound back on` : `Turn ${name}’s sound off`}>
            <Face player={lookOf(studentKey)} name={nameOf(studentKey)} />{name}{times > 1 && <small>×{times}</small>}<span>{silenced(studentKey) ? '🔇' : '🔈'}</span>
          </button>;
        })}</div>
      </li>)}</ul>}
      {looking.length > 0 && found.length === 0 && <p className="live-heard-none">Nothing like that was read aloud in the last 15 minutes.</p>}
      {tiles.length === 0 && <p className="live-clear">Nobody in the plaza yet.</p>}
      <div className="live-tiles">{tiles.map(student => {
        const help = helpFor(student.studentKey);
        const away = !online.some(item => item.studentKey === student.studentKey);
        const tabAway = !away && student.inTab === false;
        const tabCount = student.tabSwitches ?? 0;
        return <button key={student.studentKey} type="button" aria-pressed={selected === student.studentKey}
          className={`live-tile${help?.status === 'open' || incidentOf(student.studentKey) ? ' live-tile-help' : ''}${away ? ' live-tile-away' : ''}${tabAway ? ' live-tile-tab-away' : ''}`}
          onClick={() => onSelect(selected === student.studentKey ? null : student.studentKey)}
          title={`${who(student.studentKey, student.name)}${student.zone ? ` · ${student.zone}` : ''}${tabAway ? ' · ⚠️ Out of tab right now' : ''}${tabCount > 0 ? ` · Left tab ${tabCount}x` : ''}`}>
          <Face player={student.look} name={student.name} />
          <span className="live-tile-name">{student.name}</span>
          {incidentOf(student.studentKey) ? <span className="live-tile-flag" title={`🚨 ${HARM_LABEL[incidentOf(student.studentKey)!.harm]}`}>🚨</span>
            : help && <span className="live-tile-flag" title={help.kind === 'requested' ? 'Asks for help' : 'May need help'}>{help.kind === 'requested' ? '🙋' : '💡'}</span>}
          {tabAway && <span className="live-tile-tab-away-badge" title={`Currently out of tab! Left tab ${tabCount} time${tabCount === 1 ? '' : 's'}`}>⚠️ Away</span>}
          {!tabAway && tabCount > 0 && <span className="live-tile-tab-count-badge" title={`Left tab ${tabCount} time${tabCount === 1 ? '' : 's'}`}>⚠️ {tabCount}×</span>}
          {muted.includes(student.studentKey) && <span className="live-tile-muted" title="Chat muted">🤐</span>}
          {silenced(student.studentKey) ? <span className="live-tile-sound" title="Sound off">🔇</span>
            : playing.has(student.studentKey) && <span className="live-tile-sound live-tile-playing" title="Reading a message aloud">🔊</span>}
        </button>;
      })}</div>
    </div>
  </section>;
}
