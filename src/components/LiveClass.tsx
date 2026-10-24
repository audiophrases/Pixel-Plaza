import { useState } from 'react';
import type { HelpAlert } from '../../shared/support';
import { loadChecker } from '../spellingData';
import { IDENTITY_NAMES } from '../../shared/warmupKinds';
import type { AvatarConfig } from '../utils/AvatarRenderer';
import { XP } from '../../shared/levels';
import Face from './Face';
import './LiveClass.css';

// The class as it happens, on one screen: everything waiting on the teacher in one queue, oldest first, and the
// students as faces that say who needs them. Everything else on the teacher page is setup and can stay folded.
export type LiveEntry = { id: string; studentKey: string; sender: string; target: string | null; everyone?: boolean; flag: string | null; note: string | null;
  text: string; timestamp: number; status: string; starred?: boolean };
export type LiveStudent = { studentKey: string; name: string; zone: string | null; level?: number; look?: Partial<AvatarConfig> };
// A clip one student's device read aloud: a chat message (id) or a voice sample (no id). `now` is the server's clock.
export type LivePlay = { at: number; studentKey: string; id: string | null; senderKey: string; text: string };
export type LiveSound = { off: string[]; now: number; plays: LivePlay[] };
type Props = {
  gameId: string;
  entries: LiveEntry[];
  alerts: HelpAlert[];
  online: LiveStudent[];
  known: { studentKey: string; name: string }[]; // everyone seen in this game, online or not
  muted: string[];
  sound: LiveSound;
  mode: 'approve' | 'review';
  moderation: boolean; // an OpenAI key is set, so chat can post before review
  open: boolean;
  who: (studentKey: string, name: string) => string;
  action: (path: string, body: object) => Promise<boolean>;
  selected: string | null;
  onSelect: (studentKey: string | null) => void;
};

// "now", "3m", "1h": how long something has waited, at a glance.
function ago(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, (now - timestamp) / 1000);
  return seconds < 45 ? 'now' : seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`;
}

// Who a message was for, as the students' chat shows it.
const scope = (entry: LiveEntry) => entry.target ? `🔒 ${entry.target}` : entry.everyone ? '📢 everyone' : '👥 nearby';
const outcome: Record<string, [string, string]> = {
  approved: ['✓', 'Posted'], rejected: ['✕', 'Not posted'], removed: ['🗑', 'Removed'], blocked: ['⛔', 'Blocked by moderation'], pending: ['🕓', 'Waiting for you'],
};

type Todo = { at: number; entry?: LiveEntry; alert?: HelpAlert };
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

export default function LiveClass({ gameId, entries, alerts, online, known, muted, sound, mode, moderation, open, who, action, selected, onSelect }: Props) {
  const [replies, setReplies] = useState<Record<string, string>>({}); // drafts, by student
  const [sent, setSent] = useState<string | null>(null); // the student a private message just went to
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState(''); // something the teacher heard in the room

  const waiting = entries.filter(entry => entry.status === 'pending');
  const needing = alerts.filter(alert => alert.status !== 'resolved');
  const todo: Todo[] = [...waiting.map(entry => ({ at: entry.timestamp, entry })), ...needing.map(alert => ({ at: alert.timestamp, alert }))]
    .sort((a, b) => a.at - b.at);
  const recent = entries.filter(entry => entry.status !== 'pending').slice(0, 40);
  const lookOf = (studentKey: string) => online.find(student => student.studentKey === studentKey)?.look;
  const nameOf = (studentKey: string) => online.find(student => student.studentKey === studentKey)?.name ?? known.find(student => student.studentKey === studentKey)?.name ?? 'Student';

  // A private reply ready to send: what the student wrote, and a better version when the game has one.
  const prefill = async (studentKey: string, item: Evidence) => {
    let fixed = item.reason.match(/Try: “(.*)”$/)?.[1] ?? null;
    const flagged = plainReason(item.reason).match(/^(?:English word check|Use English words only):/);
    if (!fixed && flagged) {
      try {
        const check = await loadChecker();
        fixed = check(item.text, [...known.map(student => student.name), ...IDENTITY_NAMES])
          .reduce((text, mistake) => mistake.suggestions[0] ? text.replace(mistake.word, mistake.suggestions[0]) : text, item.text);
        if (fixed === item.text) fixed = null;
      } catch { /* no dictionary: the quote alone */ }
    }
    const question = item.reason.match(/^Answer not accepted:\s*(.+)$/)?.[1];
    const text = question ? `About “${question}”, you wrote “${item.text}”. `
      : `You wrote “${item.text}”.${fixed ? ` Try: “${fixed}”` : ' '}`;
    setReplies(current => ({ ...current, [studentKey]: text }));
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
  const person = (studentKey: string, name: string) => <button type="button" className="live-person" onClick={() => onSelect(studentKey)} title="Show this student">
    <Face player={lookOf(studentKey)} name={name} /><strong>{who(studentKey, name)}</strong>
  </button>;

  // Students: whoever needs the teacher first, then everyone else by name.
  const helpFor = (studentKey: string) => needing.find(alert => alert.studentKey === studentKey);
  const waitingFrom = (studentKey: string) => waiting.filter(entry => entry.studentKey === studentKey).length;
  const urgency = (studentKey: string) => (helpFor(studentKey)?.status === 'open' ? 2 : helpFor(studentKey) ? 1 : 0) + (waitingFrom(studentKey) ? 0.5 : 0);
  const tiles: LiveStudent[] = [...online, ...needing.filter(alert => !online.some(student => student.studentKey === alert.studentKey))
    .map(alert => ({ studentKey: alert.studentKey, name: alert.name, zone: null }))];
  tiles.sort((a, b) => urgency(b.studentKey) - urgency(a.studentKey) || who(a.studentKey, a.name).localeCompare(who(b.studentKey, b.name)));
  const chosen = selected ? tiles.find(student => student.studentKey === selected) ?? known.find(student => student.studentKey === selected) : undefined;
  const live = online.find(student => student.studentKey === selected); // the chosen student, if they are in the plaza
  const here = !!live;

  // Heard a phrase in the room? It leads to the devices that played it, each one click from silent.
  const heard = heardAloud(sound.plays);
  // Every word typed, in any order: what the teacher remembers of it is enough.
  const looking = plain(phrase).split(' ').filter(Boolean);
  const found = looking.length ? heard.filter(line => looking.every(word => plain(line.text).includes(word)))
    : heard.filter(line => line.last > sound.now - LATELY_MS).slice(0, 3);
  const playing = new Set(sound.plays.filter(play => play.at > sound.now - PLAYING_MS).map(play => play.studentKey));
  const silenced = (studentKey: string) => sound.off.includes(studentKey);
  const silence = (studentKey: string) => void action('sound', { studentKey, off: !silenced(studentKey) });

  return <section className="live" aria-label="The class now">
    <div className="live-column">
      <div className="live-heading">
        <h2>To do {todo.length > 0 && <span className="live-count">{todo.length}</span>}</h2>
        {waiting.length > 1 && <button className="btn btn-primary btn-sm" onClick={() => void action('approve-all', {})} title="Post every waiting message">✓ Approve all {waiting.length}</button>}
        {/* Too many to approve? Posting first and reviewing after is one click away. */}
        <div className="live-mode" role="group" aria-label="How chat is moderated">
          <button type="button" aria-pressed={mode === 'approve'} onClick={() => void action('mode', { mode: 'approve' })} title="Every message waits for you">✋ Approve first</button>
          <button type="button" aria-pressed={mode === 'review'} disabled={!moderation} onClick={() => void action('mode', { mode: 'review' })}
            title={moderation ? 'Messages OpenAI clears post at once; you review them below' : 'Needs an OpenAI key'}>⚡ Post, then review</button>
        </div>
      </div>
      {todo.length === 0 && <p className="live-clear">{open ? '✓ All caught up' : 'The class is closed.'}</p>}
      <ol className="live-todo">{todo.map(({ entry, alert }, index) => entry ? <li key={entry.id} className={`live-item live-chat${index === 0 ? ' live-first' : ''}`}>
        <div className="live-item-top">{person(entry.studentKey, entry.sender)}<span className="live-scope">→ {entry.note?.startsWith('Investigation:') ? '🔎 witness' : scope(entry)}</span><small>{ago(entry.timestamp)}</small></div>
        <p className="live-text">{entry.text}</p>
        {(entry.flag || entry.note) && <p className="live-notes">
          {entry.flag && <span className="live-tag live-tag-warn">⚠ not checked: {entry.flag}</span>}
          {entry.note && !entry.note.startsWith('Investigation:') && <span className="live-tag">💡 {entry.note}</span>}
        </p>}
        <div className="live-actions">
          <button className="live-yes" onClick={() => void action('review', { id: entry.id, approve: true })} title={index === 0 ? 'Post it (A)' : 'Post it'} aria-label="Approve">✓</button>
          <button className="live-no" onClick={() => void action('review', { id: entry.id, approve: false })} title={index === 0 ? 'Do not post it (R)' : 'Do not post it'} aria-label="Reject">✕</button>
        </div>
      </li> : alert && <li key={alert.id} className={`live-item live-help live-help-${alert.status}`}>
        <div className="live-item-top">{person(alert.studentKey, alert.name)}
          <span className="live-scope">{alert.kind === 'requested' ? '🙋 asks for help' : '💡 may need help'}{alert.status === 'acknowledged' && ' · 👀 you’re on it'}</span>
          <small>{ago(alert.timestamp)}</small></div>
        {alert.kind === 'suggested' && alert.evidence.length > 0
          ? <ul className="live-evidence">{alert.evidence.map((item, index) => <li key={index}>
              <small>{ago(item.timestamp)}</small> <q>{item.text}</q> <span className="live-why">{why(item.reason)}</span>
              <button type="button" className="live-fix" onClick={() => void prefill(alert.studentKey, item)} title="Put a correction in the private reply below">Send a fix</button>
            </li>)}</ul>
          : (alert.note || alert.evidence.at(-1)) && <p className="live-text">{alert.note || alert.evidence.at(-1)!.text}</p>}
        {(alert.since ?? 0) > 0 && <p className="live-notes"><span className="live-tag live-tag-ok">✓ Since then: {alert.since} {alert.since === 1 ? 'message posted or answer right' : 'messages posted or answers right'}</span></p>}
        {alert.ai?.tip && <p className="live-notes"><span className="live-tag">🤖 AI hint given: {alert.ai.tip}</span></p>}
        {replyBox(alert.studentKey, alert)}
        <div className="live-actions">
          {alert.status === 'open' && <button className="live-soft" onClick={() => void action('help-status', { id: alert.id, status: 'acknowledged', gameId })} title="You are helping (in person or here)">👀</button>}
          <button className="live-yes" onClick={() => void action('help-status', { id: alert.id, status: 'resolved', gameId })} title="Helped: take it off the list" aria-label="Done">✓</button>
        </div>
      </li>)}</ol>

      {recent.length > 0 && <>
        <h3 className="live-subheading">Chat</h3>
        <ol className="live-recent">{recent.map(entry => {
          const [icon, label] = outcome[entry.status] ?? ['·', entry.status];
          return <li key={entry.id} className={`live-line live-line-${entry.status}`}>
            <button type="button" className="live-line-who" onClick={() => onSelect(entry.studentKey)}>{who(entry.studentKey, entry.sender)}</button>
            <span className="live-line-scope">{scope(entry)}</span>
            <span className="live-line-text">{entry.text}</span>
            <span className="live-line-end">
              <span title={label}>{icon}</span>
              {entry.status === 'approved' && (entry.starred ? <span title="Starred">⭐</span>
                : <button type="button" title={`Give ${XP.teacher} XP for good English`} onClick={() => void action('xp', { chatId: entry.id })}>☆</button>)}
              {entry.status === 'approved' && <button type="button" title="Take it down from every screen" onClick={() => void action('review', { id: entry.id, approve: false })}>🗑</button>}
            </span>
          </li>;
        })}</ol>
      </>}
    </div>

    <div className="live-column">
      <div className="live-heading"><h2>Class <span className="live-muted">{online.length} here</span></h2>
        <input type="search" className="live-heard-search" value={phrase} onChange={event => setPhrase(event.target.value)}
          placeholder="🔊 Heard something? Type it" aria-label="Find which devices read a phrase aloud" />
      </div>
      {found.length > 0 && <ul className="live-heard" aria-label="Read aloud">{found.map(line => <li key={line.key}>
        <div className="live-heard-top"><q>{line.text}</q>
          {line.id ? person(line.senderKey, nameOf(line.senderKey)) : <span className="live-muted">🎙 voice test</span>}
          <small>{ago(line.last, sound.now)}</small></div>
        <div className="live-heard-on"><span title="Played aloud on">🔊</span>{line.devices.map(({ studentKey, times }) => {
          const name = who(studentKey, nameOf(studentKey));
          return <button key={studentKey} type="button" className="live-heard-device" aria-pressed={silenced(studentKey)} onClick={() => silence(studentKey)}
            title={silenced(studentKey) ? `Turn ${name}’s sound back on` : `Turn ${name}’s sound off`}>
            <Face player={lookOf(studentKey)} name={nameOf(studentKey)} />{name}{times > 1 && <small>×{times}</small>}<span>{silenced(studentKey) ? '🔇' : '🔈'}</span>
          </button>;
        })}</div>
      </li>)}</ul>}
      {looking.length > 0 && found.length === 0 && <p className="live-heard-none">Nothing like that was read aloud in the last 15 minutes.</p>}
      {tiles.length === 0 && <p className="live-clear">Nobody in the plaza yet.</p>}
      <div className="live-tiles">{tiles.map(student => {
        const help = helpFor(student.studentKey);
        const count = waitingFrom(student.studentKey);
        const away = !online.some(item => item.studentKey === student.studentKey);
        return <button key={student.studentKey} type="button" aria-pressed={selected === student.studentKey}
          className={`live-tile${help?.status === 'open' ? ' live-tile-help' : ''}${away ? ' live-tile-away' : ''}`}
          onClick={() => onSelect(selected === student.studentKey ? null : student.studentKey)} title={`${who(student.studentKey, student.name)}${student.zone ? ` · ${student.zone}` : ''}`}>
          <Face player={student.look} name={student.name} />
          <span className="live-tile-name">{student.name}</span>
          {help && <span className="live-tile-flag" title={help.kind === 'requested' ? 'Asks for help' : 'May need help'}>{help.kind === 'requested' ? '🙋' : '💡'}</span>}
          {count > 0 && <span className="live-tile-count" title={`${count} waiting for you`}>{count}</span>}
          {muted.includes(student.studentKey) && <span className="live-tile-muted" title="Chat muted">🤐</span>}
          {silenced(student.studentKey) ? <span className="live-tile-sound" title="Sound off">🔇</span>
            : playing.has(student.studentKey) && <span className="live-tile-sound live-tile-playing" title="Reading a message aloud">🔊</span>}
        </button>;
      })}</div>

      {chosen && <div className="live-student">
        <div className="live-student-top">
          <Face player={lookOf(chosen.studentKey)} name={chosen.name} />
          <div><strong>{who(chosen.studentKey, chosen.name)}</strong>
            <small>{live ? `${live.zone ?? 'in the plaza'}${live.level !== undefined ? ` · Lv ${live.level}` : ''}` : 'not in the plaza'}</small></div>
          <button type="button" className="live-close" onClick={() => onSelect(null)} aria-label="Close">✕</button>
        </div>
        <ol className="live-recent">{entries.filter(entry => entry.studentKey === chosen.studentKey).slice(0, 5).map(entry => <li key={entry.id} className={`live-line live-line-${entry.status}`}>
          <span className="live-line-scope">{scope(entry)}</span><span className="live-line-text">{entry.text}</span>
          <span className="live-line-end"><span title={outcome[entry.status]?.[1] ?? entry.status}>{outcome[entry.status]?.[0] ?? '·'}</span></span>
        </li>)}</ol>
        {replyBox(chosen.studentKey, helpFor(chosen.studentKey))}
        <div className="live-spells">
          <button type="button" onClick={() => void action('mute', { studentKey: chosen.studentKey, muted: !muted.includes(chosen.studentKey) })}>
            {muted.includes(chosen.studentKey) ? '💬 Unmute chat' : '🤐 Mute chat'}</button>
          <button type="button" onClick={() => silence(chosen.studentKey)} title={silenced(chosen.studentKey) ? 'Let their device read chat aloud again' : 'Their device stops reading chat aloud, until you turn it back on'}>
            {silenced(chosen.studentKey) ? '🔊 Sound on' : '🔇 Sound off'}</button>
          {here && <>
            <button type="button" onClick={() => void action('magic', { power: 'freeze', studentKey: chosen.studentKey })} title="Stops them walking for 15 seconds">❄ Freeze</button>
            <button type="button" onClick={() => void action('magic', { power: 'thaw', studentKey: chosen.studentKey })}>🔥 Thaw</button>
            <button type="button" onClick={() => void action('magic', { power: 'lightning', studentKey: chosen.studentKey })} title="A playful tumble: up again in 4 seconds">⚡ Lightning</button>
          </>}
        </div>
      </div>}
    </div>
  </section>;
}
