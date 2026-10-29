import { useEffect, useRef, useState } from 'react';
import type { Conversations, ConversationLine } from '../../shared/support';
import type { AvatarConfig } from '../utils/AvatarRenderer';
import { readCorrection } from '../../shared/diff';
import { tidy } from '../../shared/tidy';
import Correction from './Correction';
import Face from './Face';
import StudentCharacterEditor, { type StudentAction } from './StudentCharacterEditor';
import { ago } from './liveFormat';
import './StudentDrawer.css';

// Everything about one student, beside the class: who they are, a private message, the quick actions (chat,
// sound, spells), and their conversations, one tab for each person or place they talked to.
export type DrawerStudent = { studentKey: string; name: string; zone?: string | null; level?: number; look?: Partial<AvatarConfig> };
type Props = {
  token: string;
  gameId: string;
  student: DrawerStudent;
  online: boolean;
  muted: boolean;
  soundOff: boolean;
  allSoundOff: boolean;
  who: (studentKey: string, name: string) => string;
  action: StudentAction;
  failed: (cause: unknown) => void;
  onClose: () => void;
  onOpen: (studentKey: string) => void; // another student, from a conversation
};

// What became of a line, as one mark.
const MARK: Record<string, [string, string]> = {
  approved: ['✓', 'Posted'], delivered: ['✓', 'Delivered'], 'teacher-inbox': ['✓', 'Sent to you'], sent: ['✓', 'Sent'], pending: ['🕓', 'Waiting for you'],
  blocked: ['⛔', 'Blocked'], rejected: ['✕', 'Not posted'], removed: ['🗑', 'Taken down'], 'language-blocked': ['✋', 'Stopped by the word check'],
  'hint-offered': ['💬', 'Grammar hint generated, not sent'], 'language-checked': ['…', 'Checked, not sent'], submitted: ['…', 'Not sent'], 'not-sent': ['…', 'Not sent'],
  'rate-limited': ['⏱', 'Too fast, not sent'], requested: ['🙋', 'Asked for help'], 'ai-help': ['🤖', 'AI tip given'], 'help-requested': ['🙋', 'Asked for help'],
};

export default function StudentDrawer({ token, gameId, student, online, muted, soundOff, allSoundOff, who, action, failed, onClose, onOpen }: Props) {
  const [data, setData] = useState<Conversations | null>(null);
  const [thread, setThread] = useState<string | null>(null); // the open conversation; null follows the latest
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLLIElement>(null);

  // Their conversations, fresh every few seconds while the drawer is open.
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/teacher/conversations?studentKey=${encodeURIComponent(student.studentKey)}`, { headers: { 'x-teacher-session': token } });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(result.error || 'Could not load the conversations.'), { status: response.status });
        if (!stopped) setData(result as Conversations);
      } catch (cause) { if (!stopped) failed(cause); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [student.studentKey, token, failed]);

  // Esc closes the drawer, unless something inside it is being typed in.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target as HTMLElement | null)?.closest('input, textarea, select, [role="dialog"]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lines = data?.studentKey === student.studentKey ? data.lines : [];
  const latest = new Map<string, number>();
  for (const line of lines) latest.set(line.thread, line.at);
  const threads = [...latest.keys()].sort((a, b) => (latest.get(b) ?? 0) - (latest.get(a) ?? 0));
  const open = thread && latest.has(thread) ? thread : threads[0] ?? null;
  const shown = lines.filter(line => line.thread === open);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [open, shown.length]);

  const classmateName = (key: string) => who(key, data?.names[key] ?? key);
  const label = (key: string) => key === 'nearby' ? '👥 Nearby' : key === 'everyone' ? '📢 Everyone' : key === 'teacher' ? '🧑‍🏫 You' : `🔒 ${classmateName(key.slice(2))}`;
  const speaker = (line: ConversationLine) => line.mine ? student.name : open === 'teacher' ? 'You' : open?.startsWith('p:') ? (data?.names[open.slice(2)] ?? 'Classmate') : 'Classmate';

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      if (!await action('help-message', { studentKey: student.studentKey, text, gameId })) return;
      setDraft('');
      setSent(true);
      setThread('teacher');
      window.setTimeout(() => setSent(false), 2000);
    } finally { setBusy(false); }
  };

  return <aside className="drawer" aria-label={`${student.name}: messages and actions`}>
    <div className="drawer-top">
      <Face player={student.look} name={student.name} />
      <div><strong>{who(student.studentKey, student.name)}</strong>
        <small>{online ? `${student.zone ?? 'in the plaza'}${student.level !== undefined ? ` · Lv ${student.level}` : ''}` : 'not in the plaza'}</small></div>
      <button type="button" className="drawer-close" onClick={onClose} aria-label="Close" title="Close (Esc)">✕</button>
    </div>

    <form className="drawer-reply" onSubmit={event => { event.preventDefault(); void send(); }}>
      <input ref={field} value={draft} maxLength={1000} disabled={busy} placeholder={`Message ${student.name} privately…`}
        aria-label={`Private message to ${student.name}`} onChange={event => setDraft(event.target.value)} />
      <button className="btn btn-primary btn-sm" disabled={busy || !draft.trim()}>{sent ? 'Sent ✓' : 'Send'}</button>
    </form>

    <div className="drawer-actions">
      <button type="button" onClick={() => setEditingCharacter(true)}>Edit name & character</button>
      <button type="button" onClick={() => void action('mute', { studentKey: student.studentKey, muted: !muted })}
        title={muted ? 'Let them chat again' : 'Stop their chat until you unmute it'}>{muted ? '💬 Unmute' : '🤐 Mute'}</button>
      <button type="button" disabled={allSoundOff} onClick={() => void action('sound', { studentKey: student.studentKey, off: !soundOff })}
        title={allSoundOff ? 'Restore class sound first' : soundOff ? 'Let their device read chat aloud again' : 'Their device stops reading chat aloud'}>{soundOff ? '🔊 Sound on' : '🔇 Sound off'}</button>
      {online && <>
        <button type="button" onClick={() => void action('magic', { power: 'freeze', studentKey: student.studentKey })} title="Stops them walking for 15 seconds">❄ Freeze</button>
        <button type="button" onClick={() => void action('magic', { power: 'thaw', studentKey: student.studentKey })}>🔥 Thaw</button>
        <button type="button" onClick={() => void action('magic', { power: 'lightning', studentKey: student.studentKey })} title="A playful tumble: up again in 4 seconds">⚡ Lightning</button>
      </>}
    </div>

    {editingCharacter && <StudentCharacterEditor token={token} gameId={gameId} studentKey={student.studentKey} action={action} failed={failed} onClose={() => setEditingCharacter(false)} />}

    <div className="drawer-threads" role="tablist" aria-label="Conversations">
      {threads.map(key => <button key={key} type="button" role="tab" aria-selected={key === open} onClick={() => setThread(key)}>
        {label(key)} <small>{lines.filter(line => line.thread === key).length}</small></button>)}
    </div>
    {!data && <p className="drawer-empty">Loading…</p>}
    {data && threads.length === 0 && <p className="drawer-empty">{student.name} has not written anything in this game yet.</p>}
    {open?.startsWith('p:') && <button type="button" className="drawer-link" onClick={() => onOpen(open.slice(2))}>Open {classmateName(open.slice(2))} →</button>}
    <ol className="drawer-lines">{shown.map(line => {
      const [mark, meaning] = MARK[line.status] ?? ['·', line.status];
      const correction = !line.mine ? readCorrection(line.text) : null;
      return <li key={line.id} className={`drawer-line${line.mine ? ' mine' : ''}${['language-blocked', 'blocked', 'rejected', 'removed', 'hint-offered', 'submitted', 'not-sent', 'rate-limited', 'language-checked'].includes(line.status) ? ' unsent' : ''}`}>
        <span className="drawer-who">{speaker(line)}</span>
        <span className="drawer-text">{correction ? <><b>✏️</b> <Correction parts={correction} /></> : tidy(line.text)}</span>
        <span className="drawer-meta"><small>{ago(line.at)}</small> <span title={line.reason ? `${meaning}: ${line.reason}` : meaning}>{mark}</span></span>
      </li>;
    })}<li ref={end} aria-hidden="true" /></ol>
  </aside>;
}
