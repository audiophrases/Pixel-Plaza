import React, { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Journal from '../components/Journal';
import { wordDiff } from '../../shared/diff';
import PhaserGame from '../components/PhaserGame';
import type { QuestView } from '../../shared/campaign';
import { PlazaConnection } from '../plaza';
import { loadChecker } from '../spellingData';
import type { Checker, Misspelling } from '../spelling';
import type { PlazaStatus } from '../plaza';
import { readStudentSession } from '../studentAuth';
import type { AvatarConfig } from '../utils/AvatarRenderer';
import './Game.css';

interface GameState {
  roomCode: string;
  avatarConfig: AvatarConfig | null; // null keeps the saved avatar
}

interface ChatMessage {
  id?: string;
  sender: string;
  text: string;
  timestamp?: number;
  whisper?: boolean;
  to?: string;
  marks?: [number, number][]; // words the sender was offered a better version of and kept
}

// Text with some character ranges wrapped, so a changed or mistaken word can have its own shade.
function Marked({ text, marks, className }: { text: string; marks?: readonly (readonly [number, number])[]; className: string }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of [...(marks ?? [])].sort((a, b) => a[0] - b[0])) {
    if (start < at || end > text.length) continue;
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={start} className={className}>{text.slice(start, end)}</mark>);
    at = end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

export default function Game() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as GameState | null;
  const [session] = useState(() => readStudentSession());
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  // A grammar hint waiting for the student's choice: what they wrote, the fix, and why.
  const [nudge, setNudge] = useState<{ original: string; corrected: string } | null>(null);
  const [checking, setChecking] = useState(false);
  // A message on its way: the draft stays in the box until the server says it took it.
  const [sending, setSending] = useState(false);
  const [quest, setQuest] = useState<QuestView | null>(null); // this student's part of the campaign, if one is running
  const [answered, setAnswered] = useState<{ objective: string; correct: boolean; wait: boolean } | null>(null);
  const [sendError, setSendError] = useState(''); // why the last message did not go, shown by the box
  const pending = useRef<{ cid: string; text: string; timer: number } | null>(null);
  const keptRun = useRef(0); // hints in a row the student turned down
  const chatField = useRef<HTMLInputElement>(null);
  const [spelling, setSpelling] = useState<Misspelling[]>([]); // words that stopped the last message
  const [whisperTo, setWhisperTo] = useState(''); // a classmate's id; empty means nearby chat
  const [classmates, setClassmates] = useState<{ id: string; name: string }[]>([]);
  const [connection, setConnection] = useState<PlazaConnection | null>(null);
  const [status, setStatus] = useState<PlazaStatus>({ state: 'connecting' });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatBox = useRef<HTMLDivElement>(null);
  // The chat box can be dragged out of the way of the map and folded away; it remembers where.
  const [seenCount, setSeenCount] = useState(0); // messages the student has had the chance to read
  const [chatSpot, setChatSpot] = useState<{ x: number; y: number; folded: boolean }>(() => {
    try { return { x: 0, y: 0, folded: false, ...JSON.parse(localStorage.getItem('pixelplaza.chat') || '{}') }; }
    catch { return { x: 0, y: 0, folded: false }; }
  });
  useEffect(() => {
    try { localStorage.setItem('pixelplaza.chat', JSON.stringify(chatSpot)); } catch { /* storage disabled */ }
  }, [chatSpot]);

  // While the chat is open everything counts as read; folded, new messages from others pile up.
  useEffect(() => { if (!chatSpot.folded) setSeenCount(messages.length); }, [chatSpot.folded, messages.length]);
  const unread = chatSpot.folded
    ? messages.slice(seenCount).filter(message => !message.sender.startsWith('System') && message.sender !== session?.student.displayName).length
    : 0;

  // Enter jumps to the chat box from the map, and Escape leaves it, so a student never needs the mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const field = chatField.current;
      if (!field || event.ctrlKey || event.metaKey || event.altKey) return;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '');
      if (event.key === 'Enter' && !typing) { event.preventDefault(); field.focus(); }
      else if (event.key === 'Escape' && document.activeElement === field) field.blur();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dragChat = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = chatBox.current;
    if (!box || (event.target as HTMLElement).closest('button')) return;
    const home = box.getBoundingClientRect(); // where it sits now, with the current offset
    const start = { x: event.clientX, y: event.clientY, spotX: chatSpot.x, spotY: chatSpot.y };
    const move = (next: PointerEvent) => {
      // Keep the whole box on screen
      const x = Math.min(Math.max(start.spotX + next.clientX - start.x, start.spotX - home.left), start.spotX + window.innerWidth - home.right);
      const y = Math.min(Math.max(start.spotY + next.clientY - start.y, start.spotY - home.top), start.spotY + window.innerHeight - home.bottom);
      setChatSpot(spot => ({ ...spot, x, y }));
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  useEffect(() => {
    if (!state?.roomCode || !session) {
      navigate('/');
      return;
    }

    const plaza = new PlazaConnection(state.roomCode, session.studentToken, state.avatarConfig);
    const say = (message: ChatMessage) => setMessages(prev => [...prev, message]);
    const unsubscribe = plaza.subscribe(event => {
      if (event.t === 'roster' || event.t === 'join' || event.t === 'leave') {
        const others = [...plaza.players.values()].filter(player => player.id !== plaza.selfId);
        setClassmates(others.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
        if (event.t === 'leave') setWhisperTo(current => (current === event.id ? '' : current));
      }
      // What became of the message being sent. A refusal gives the draft back, with the reason beside it.
      const settled = (event.t === 'notice' || event.t === 'result') && !!event.cid && event.cid === pending.current?.cid;
      if (settled && pending.current) {
        const sent = pending.current;
        window.clearTimeout(sent.timer);
        pending.current = null;
        setSending(false);
        if (event.t === 'notice' && event.level === 'warning') {
          setChatInput(sent.text);
          setSendError(event.text);
          return;
        }
        setChatInput('');
        setSendError('');
        chatField.current?.blur(); // sent: the keys walk again until Enter opens the box
      }
      if (event.t === 'result') return;
      if (event.t === 'quest') { setQuest(event.quest); setAnswered(null); return; }
      if (event.t === 'answered') { setAnswered({ objective: event.objective, correct: event.correct, wait: event.wait }); return; }
      if (event.t === 'chat') say({ id: event.id, sender: event.sender, text: event.text, timestamp: event.ts, whisper: event.whisper, to: event.to, marks: event.marks });
      else if (event.t === 'retract') setMessages(prev => prev.filter(message => message.id !== event.id));
      else if (event.t === 'notice') say({ sender: event.level === 'warning' ? 'System Warning' : 'System', text: event.text });
    });
    const unwatch = plaza.onStatus(next => {
      setStatus(next);
      if (next.state === 'online') setConnection(plaza); // the map appears once connected
      if (next.state === 'stopped' && next.message) say({ sender: 'System Warning', text: next.message });
    });

    return () => {
      unsubscribe();
      unwatch();
      if (pending.current) window.clearTimeout(pending.current.timer);
      pending.current = null;
      plaza.close();
    };
  }, [state, session, navigate]);

  // Scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!state?.roomCode || !session) return null;

  // Sends a message; `extra` tells the teacher what the student did with a hint.
  const deliver = (text: string, extra: object = {}) => {
    if (!connection) return;
    const cid = crypto.randomUUID();
    if (connection.send({ t: 'chat', text, cid, ...(whisperTo ? { to: whisperTo } : {}), ...extra })) {
      // The draft stays (as what is being sent) until the server answers.
      setChatInput(text);
      setNudge(null);
      setSpelling([]);
      setSendError('');
      setSending(true);
      const timer = window.setTimeout(() => {
        pending.current = null;
        setSending(false);
        setSendError('No answer from the server. Your message is still here; check the chat before sending it again.');
      }, 15000);
      pending.current = { cid, text, timer };
    } else setMessages(prev => [...prev, { sender: 'System Warning', text: 'Not connected. Try again in a moment.' }]);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !connection || checking || sending || nudge) return;
    setChecking(true);
    try {
      // Every word must be English. Names of people in the Plaza are fine.
      // If the dictionary cannot load, chat carries on rather than stopping.
      const names = [session.student.displayName, ...[...connection.players.values()].map(player => player.name)];
      let check: Checker | null = null;
      try {
        check = await loadChecker();
        const problems = check(chatInput, names);
        setSpelling(problems);
        if (problems.length) return;
      } catch { /* offline dictionary: the teacher still reviews the message */ }

      // Then a grammar hint, once, and only if they have not been turning them all down.
      if (keptRun.current >= 3) { keptRun.current = 2; return deliver(chatInput); }
      const hint = await connection.check(chatInput);
      if (!hint.ok && (!check || check(hint.corrected, names).length === 0)) {
        setNudge({ original: chatInput, corrected: hint.corrected });
        return;
      }
      keptRun.current = 0;
      deliver(chatInput);
    } finally {
      setChecking(false);
    }
  };

  // OK sends the corrected sentence; Ignore (below) sends the student's own, with the words that differ marked.
  const useHint = () => {
    if (!nudge) return;
    keptRun.current = 0;
    deliver(nudge.corrected, { was: nudge.original });
  };

  const keepMine = () => {
    if (!nudge) return;
    keptRun.current += 1;
    deliver(nudge.original, { better: nudge.corrected });
  };

  // Swaps one word for a suggestion and takes it off the list.
  const useSuggestion = (word: string, suggestion: string) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    setChatInput(current => current.replace(new RegExp(`(?<![\\p{L}'’])${escaped}(?![\\p{L}'’])`, 'u'), suggestion));
    setSpelling(current => current.filter(item => item.word !== word));
  };

  const handlePreventClipboard = (e: React.ClipboardEvent) => {
    e.preventDefault();
  };

  return (
    <div className="game-container">
      {/* Background Phaser Canvas */}
      {connection && <PhaserGame connection={connection} />}
      
      {/* React UI Overlay */}
      <div className="ui-layer">
        <header className="game-header glass-panel">
          <h1 className="heading-pixel" style={{fontSize: '1.2rem', margin: 0}}>Pixel Plaza</h1>
          <div className="room-info">
            <span className="badge">Room: Lobby</span>
            <span className="badge">{session.student.displayName}</span>
            {state.roomCode && <span className="badge">Class: {state.roomCode}</span>}
            {status.state !== 'online' && <span className="badge badge-status">
              {status.state === 'stopped' ? 'Disconnected' : status.state === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
            </span>}
          </div>
        </header>

        {status.state === 'stopped' && status.message && <div className="class-ended glass-panel" role="alert">
          <p>{status.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>Back to the start</button>
        </div>}

        {quest && <Journal quest={quest} feedback={answered}
          onAnswer={(objective, text) => connection?.send({ t: 'answer', objective, text })} />}

        <div className={`chat-container glass-panel${chatSpot.folded ? ' chat-folded' : ''}`} ref={chatBox}
          style={{ transform: `translate(${chatSpot.x}px, ${chatSpot.y}px)` }}>
          <div className="chat-handle" onPointerDown={dragChat} title="Drag to move the chat">
            <span className={unread ? 'chat-unread' : undefined}>{unread ? `Chat · ${unread} new` : 'Chat'}</span>
            <button type="button" aria-label={chatSpot.folded ? 'Show chat' : 'Hide chat'}
              onClick={() => setChatSpot(spot => ({ ...spot, folded: !spot.folded }))}>{chatSpot.folded ? '▲' : '▼'}</button>
          </div>
          <div className="chat-messages">
            {messages.map((msg, i) => {
              const isWarning = msg.sender.includes('Warning');
              const isSystem = msg.sender.startsWith('System');
              
              return (
                <div key={i} className={`chat-message ${isSystem ? 'system-msg' : ''} ${isWarning ? 'warning-msg' : ''} ${msg.whisper ? 'whisper-msg' : ''}`}>
                  <span className="chat-sender">{msg.whisper ? `${msg.sender} → ${msg.to} (whisper)` : msg.sender}:</span>
                  <span className="chat-text"><Marked text={msg.text} marks={msg.marks} className="slip" /></span>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          <div className="emote-bar">
            {['🙋', '❓', '👍', '😂'].map(emote => (
              <button 
                key={emote} 
                className="emote-btn" 
                onClick={() => connection?.send({ t: 'emote', emote })}
                title={`Send ${emote} emote`}
              >
                {emote}
              </button>
            ))}
          </div>
          
          {spelling.length > 0 && <div className="spelling-help" role="alert">
            <strong>Use English words only.</strong>
            {spelling.map(item => <div key={item.word} className="spelling-word">
              <span className="spelling-bad">{item.word}</span>
              {item.suggestions.length ? <>
                <span>try:</span>
                {item.suggestions.map(suggestion => <button key={suggestion} type="button" className="spelling-fix"
                  onClick={() => useSuggestion(item.word, suggestion)}>{suggestion}</button>)}
              </> : <span>is not an English word. Try a different word.</span>}
            </div>)}
          </div>}
          {sendError && <div className="composer-error" role="alert">{sendError}</div>}
          {nudge && <div className="grammar-help" role="status">
            <div className="grammar-fix"><Marked text={nudge.corrected} marks={wordDiff(nudge.original, nudge.corrected).corrected} className="diff-new" /></div>
            <div className="grammar-actions">
              <button type="button" className="btn btn-primary" onClick={useHint} title="Send the corrected sentence">OK</button>
              <button type="button" className="spelling-fix" onClick={keepMine} title="Send my sentence as I wrote it">Ignore</button>
            </div>
          </div>}
          <form className="chat-input-wrapper" onSubmit={event => void handleSendMessage(event)}>
            <select
              className="chat-target"
              value={whisperTo}
              onChange={(e) => setWhisperTo(e.target.value)}
              title="Who can read this message"
            >
              <option value="">Nearby</option>
              {classmates.map(player => <option key={player.id} value={player.id}>Whisper: {player.name}</option>)}
            </select>
            <input 
              type="text" 
              ref={chatField}
              className="chat-input"
              placeholder={whisperTo ? 'Whisper (your teacher can read it)...' : 'Message people nearby (teacher approves)...'}
              maxLength={200}
              value={chatInput}
              readOnly={sending}
              onChange={(e) => { setChatInput(e.target.value); setNudge(null); setSendError(''); if (!e.target.value) setSpelling([]); }}
              onCopy={handlePreventClipboard}
              onPaste={handlePreventClipboard}
              onCut={handlePreventClipboard}
              autoComplete="off"
              spellCheck="true"
            />
            {!nudge && <button type="submit" className="btn btn-primary chat-send-btn" disabled={checking || sending}>{checking || sending ? '…' : 'Send'}</button>}
          </form>
        </div>
      </div>
    </div>
  );
}
