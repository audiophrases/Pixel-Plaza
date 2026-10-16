import React, { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Journal from '../components/Journal';
import Warmup from '../components/Warmup';
import type { WarmupView } from '../../shared/warmup';
import NamePicker from '../components/NamePicker';
import HelpRequest from '../components/HelpRequest';
import { wordDiff } from '../../shared/diff';
import { firstName } from '../../shared/names';
import PhaserGame from '../components/PhaserGame';
import type { QuestView } from '../../shared/campaign';
import type { StudentSupport } from '../../shared/support';
import { PlazaConnection } from '../plaza';
import { messageId } from '../utils/messageId';
import { loadChecker } from '../spellingData';
import type { Checker, Misspelling } from '../spelling';
import type { PlazaStatus } from '../plaza';
import { readStudentSession } from '../studentAuth';
import type { AvatarConfig } from '../utils/AvatarRenderer';
import { GameAudio, soundIsMuted, unlockSound, type SoundState } from '../audio';
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
  teacher?: boolean;
  voice?: string;
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
  const audioRef = useRef<GameAudio | null>(null);
  const [sound, setSound] = useState<SoundState>(() => ({
    muted: session ? soundIsMuted(session.student.studentKey) : false,
    messageId: null, needsInteraction: false, error: '',
  }));
  // Shown as the first name, with a surname letter added when a classmate shares it; the plaza tells us which.
  const [myName, setMyName] = useState(() => firstName(readStudentSession()?.student.displayName ?? ''));
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  // A grammar hint waiting for the student's choice: what they wrote, the fix, and why.
  const [nudge, setNudge] = useState<{ original: string; corrected: string } | null>(null);
  const [checking, setChecking] = useState(false);
  // A message on its way: the draft stays in the box until the server says it took it.
  const [sending, setSending] = useState(false);
  const [warmup, setWarmup] = useState<WarmupView | null>(null); // the opening warm-up, while the teacher has it on
  const [warmupFeedback, setWarmupFeedback] = useState<{ correct: boolean; wait: boolean } | null>(null);
  const [alias, setAlias] = useState<{ name: string; kept: boolean } | null>(null); // set when this game gives made-up names
  const [quest, setQuest] = useState<QuestView | null>(null); // this student's part of the campaign, if one is running
  const [answered, setAnswered] = useState<{ objective: string; correct: boolean; wait: boolean } | null>(null);
  const [sendError, setSendError] = useState(''); // why the last message did not go, shown by the box
  const [support, setSupport] = useState<StudentSupport>({ request: null, messages: [] });
  const teacherMessageIds = useRef(new Set<string>());
  const submissionAttemptId = useRef<string | null>(null);
  const plazaRef = useRef<PlazaConnection | null>(null);
  const pending = useRef<{ cid: string; text: string; timer: number } | null>(null);
  const keptRun = useRef(0); // hints in a row the student turned down
  const chatField = useRef<HTMLInputElement>(null);
  const [spelling, setSpelling] = useState<Misspelling[]>([]); // words that stopped the last message
  // Who a message is for: 'auto' whispers to the nearest classmate (the default), a classmate's id whispers to them,
  // 'teacher' is private help, and '' is everyone nearby, sent only when the student chooses it.
  const [target, setTarget] = useState('auto');
  const [nearest, setNearest] = useState<{ id: string; name: string } | null>(null);
  const whisperTo = target === 'auto' ? nearest?.id ?? '' : target;
  const draft = useRef(''); // the nearest classmate is not changed while a message is being written
  useEffect(() => { draft.current = chatInput; }, [chatInput]);
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
    ? messages.slice(seenCount).filter(message => !message.sender.startsWith('System') && message.sender !== myName).length
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
    // Joining normally unlocks sound. These gestures also cover refreshed game
    // tabs where the browser requires a fresh interaction before autoplay.
    const enable = () => { if (audioRef.current && !audioRef.current.snapshot.muted) unlockSound(); };
    window.addEventListener('pointerdown', enable, true);
    window.addEventListener('keydown', enable, true);
    return () => {
      window.removeEventListener('pointerdown', enable, true);
      window.removeEventListener('keydown', enable, true);
    };
  }, []);

  useEffect(() => {
    if (!state?.roomCode || !session) {
      navigate('/');
      return;
    }

    const plaza = new PlazaConnection(state.roomCode, session.studentToken, state.avatarConfig, session.student.studentKey);
    const audio = new GameAudio(session.studentToken, session.student.studentKey);
    audioRef.current = audio;
    const unhear = audio.subscribe(setSound);
    plazaRef.current = plaza;
    const findNearest = () => {
      const me = plaza.players.get(plaza.selfId);
      if (draft.current && me) return;
      let best: { id: string; name: string } | null = null;
      let bestDistance = Infinity;
      for (const player of me ? plaza.players.values() : []) {
        const distance = Math.hypot(player.x - me!.x, player.y - me!.y);
        if (player.id !== me!.id && distance < bestDistance) { best = { id: player.id, name: player.name }; bestDistance = distance; }
      }
      setNearest(current => current?.id === best?.id && current?.name === best?.name ? current : best);
    };
    const nearestTimer = window.setInterval(findNearest, 1000);
    const say = (message: ChatMessage) => setMessages(prev => message.id && prev.some(item => item.id === message.id) ? prev : [...prev, message]);
    const unsubscribe = plaza.subscribe(event => {
      if (event.t === 'roster' || event.t === 'join' || event.t === 'leave' || event.t === 'rename') {
        const me = plaza.players.get(plaza.selfId ?? '');
        if (me) setMyName(me.name);
        const others = [...plaza.players.values()].filter(player => player.id !== plaza.selfId);
        setClassmates(others.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
        if (event.t === 'leave') setTarget(current => (current === event.id ? 'auto' : current));
        findNearest();
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
      if (event.t === 'support') {
        setSupport(event.support);
        const unseen = event.support.messages.filter(message => !teacherMessageIds.current.has(message.id));
        for (const message of unseen) {
          teacherMessageIds.current.add(message.id);
          say({ id: `teacher:${message.id}`, sender: 'Teacher', text: message.text, timestamp: message.timestamp, teacher: true });
        }
        if (unseen.length) setChatSpot(spot => ({ ...spot, folded: false }));
        return;
      }
      if (event.t === 'warmup') { setWarmup(event.warmup); setWarmupFeedback(null); return; }
      if (event.t === 'warmup-answered') {
        setWarmupFeedback({ correct: event.correct, wait: event.wait });
        if (event.correct && !event.wait) audio.goal();
        return;
      }
      if (event.t === 'alias') { setAlias({ name: event.name, kept: event.kept }); return; }
      if (event.t === 'quest') { setQuest(event.quest); setAnswered(null); return; }
      if (event.t === 'answered') {
        setAnswered({ objective: event.objective, correct: event.correct, wait: event.wait });
        if (event.correct && !event.wait) audio.goal();
        return;
      }
      if (event.t === 'chat') {
        say({ id: event.id, sender: event.sender, text: event.text, timestamp: event.ts, whisper: event.whisper, to: event.to, marks: event.marks, voice: event.voice });
        if (event.id) audio.receive(event.id, !!event.history);
      }
      else if (event.t === 'retract') {
        audio.retract(event.id);
        setMessages(prev => prev.filter(message => message.id !== event.id));
      }
      else if (event.t === 'notice') say({ sender: event.level === 'warning' ? 'System Warning' : 'System', text: event.text });
    });
    const unwatch = plaza.onStatus(next => {
      setStatus(next);
      if (next.state !== 'online') audio.stop();
      if (next.state === 'online') setConnection(plaza); // the map appears once connected
      if (next.state === 'stopped' && next.message) say({ sender: 'System Warning', text: next.message });
    });

    return () => {
      window.clearInterval(nearestTimer);
      unsubscribe();
      unwatch();
      unhear();
      audio.dispose();
      if (audioRef.current === audio) audioRef.current = null;
      if (pending.current) window.clearTimeout(pending.current.timer);
      pending.current = null;
      if (plazaRef.current === plaza) plazaRef.current = null;
      plaza.close();
    };
  }, [state, session, navigate]);

  // Scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!state?.roomCode || !session) return null;

  const sendRecorded = (plaza: PlazaConnection, message: object, attemptId: string): boolean => {
    const sent = plaza.send(message);
    if (!sent) plaza.recordAttemptOutcome(attemptId, 'not-sent', 'Not connected; this submission did not reach its recipient.');
    return sent;
  };

  // Sends a message; `extra` tells the teacher what the student did with a hint.
  const deliver = (text: string, extra: object = {}) => {
    const plaza = plazaRef.current;
    if (!plaza) return;
    const cid = messageId();
    const attemptId = submissionAttemptId.current;
    const message = { t: 'chat', text, cid, ...(attemptId ? { attemptId } : {}), ...(whisperTo ? { to: whisperTo } : {}), ...extra };
    if (attemptId ? sendRecorded(plaza, message, attemptId) : plaza.send(message)) {
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
    } else setSendError('Not connected. Your message is still here; try again in a moment.');
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const plaza = plazaRef.current;
    if (!chatInput.trim() || !plaza || checking || sending || nudge) return;
    if (target === 'auto' && !nearest) { setSendError('Nobody else is in the Plaza yet. Choose "Nearby" or your teacher.'); return; }
    const text = chatInput;
    const attemptId = plaza.recordAttempt(text, whisperTo || undefined);
    submissionAttemptId.current = attemptId;
    // Asking a teacher for help must still work when a student cannot write in English.
    if (whisperTo === 'teacher') return deliver(text);
    setChecking(true);
    try {
      // Every word must be English. Names of people in the Plaza are fine.
      // If the dictionary cannot load, chat carries on rather than stopping.
      const names = [session.student.displayName, ...[...plaza.players.values()].map(player => player.name)];
      let check: Checker | null = null;
      try {
        check = await loadChecker();
        const problems = check(text, names);
        setSpelling(problems);
        if (problems.length) {
          plaza.recordAttemptOutcome(attemptId, 'language-blocked', `English word check: ${problems.map(problem => problem.word).join(', ')}`);
          return;
        }
      } catch { /* offline dictionary: the teacher still reviews the message */ }

      // Then a grammar hint, once, and only if they have not been turning them all down.
      if (keptRun.current >= 3) { keptRun.current = 2; return deliver(text); }
      const hint = await plaza.check(text, attemptId);
      if (!hint.ok && (!check || check(hint.corrected, names).length === 0)) {
        setNudge({ original: text, corrected: hint.corrected });
        return;
      }
      keptRun.current = 0;
      deliver(text);
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
  const applySuggestion = (word: string, suggestion: string) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    setChatInput(current => current.replace(new RegExp(`(?<![\\p{L}'’])${escaped}(?![\\p{L}'’])`, 'u'), suggestion));
    setSpelling(current => current.filter(item => item.word !== word));
  };

  const handlePreventClipboard = (e: React.ClipboardEvent) => {
    e.preventDefault();
  };

  const openTeacherChat = () => {
    setChatSpot(spot => ({ ...spot, folded: false }));
    if (!checking && !sending) {
      setTarget('teacher');
      setNudge(null);
      setSpelling([]);
      submissionAttemptId.current = null;
    }
    window.requestAnimationFrame(() => chatField.current?.focus());
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
            <span className="badge">{myName}</span>
            {state.roomCode && <span className="badge">Class: {state.roomCode}</span>}
            {status.state !== 'online' && <span className="badge badge-status">
              {status.state === 'stopped' ? 'Disconnected' : status.state === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
            </span>}
          </div>
          <button type="button" className="sound-toggle" aria-pressed={!sound.muted}
            title={sound.muted ? 'Turn on chat voices and goal sounds' : 'Mute chat voices and goal sounds'}
            onClick={() => audioRef.current?.setMuted(!sound.muted)}>
            {sound.muted ? '🔇 Sound off' : '🔊 Sound on'}
          </button>
          {!sound.muted && sound.needsInteraction && <button type="button" className="sound-enable" onClick={unlockSound}>Enable sound</button>}
          {!sound.muted && sound.error && <p className="sound-error" role="status">{sound.error}</p>}
        </header>

        <HelpRequest support={support} online={status.state === 'online'} chatDraft={chatInput}
          onRequest={(topic, text, route) => {
            const plaza = plazaRef.current;
            if (!plaza) return false;
            const topics = { writing: 'I need help writing my ideas in English.', instructions: 'I need help understanding game instructions.',
              'classmate-message': "I need help understanding a classmate's message.", other: 'I need help.' };
            const attemptId = plaza.recordAttempt(text || topics[topic], 'teacher', 'help', topic);
            return sendRecorded(plaza, { t: 'help-request', topic, text, route, attemptId }, attemptId);
          }}
          onOpenChat={openTeacherChat} />

        {status.state === 'stopped' && status.message && <div className="class-ended glass-panel" role="alert">
          <p>{status.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>Back to the start</button>
        </div>}

        {warmup && (!alias || alias.kept) && <Warmup warmup={warmup} feedback={warmupFeedback}
          onAnswer={text => {
            const plaza = plazaRef.current;
            if (!plaza) return;
            const attemptId = plaza.recordAttempt(text, undefined, 'warmup');
            sendRecorded(plaza, { t: 'warmup-answer', text, attemptId }, attemptId);
          }} />}

        {alias && !alias.kept && <NamePicker name={alias.name}
          onAnother={() => connection?.send({ t: 'reroll' })} onKeep={() => connection?.send({ t: 'keep' })} />}

        {quest && <Journal quest={quest} feedback={answered}
          onTurn={turn => {
            const plaza = plazaRef.current;
            if (!plaza) return;
            const interview = turn.t === 'interview-reply' ? quest.interviews?.find(item => item.id === turn.id) : undefined;
            const objective = turn.t === 'interview-ask' ? turn.objective : interview?.objective;
            const target = turn.t === 'interview-ask' ? turn.witness : [...plaza.players.values()].find(player => player.name === interview?.name)?.id;
            const attemptId = plaza.recordAttempt(turn.text, target, 'interview', objective);
            sendRecorded(plaza, { ...turn, attemptId }, attemptId);
          }}
          onAccept={(objective, changePartner) => connection?.send({ t: 'quest-accept', objective, changePartner })}
          onAnswer={(objective, text) => {
            const plaza = plazaRef.current;
            if (!plaza) return;
            const attemptId = plaza.recordAttempt(text, undefined, 'answer', objective);
            sendRecorded(plaza, { t: 'answer', objective, text, attemptId }, attemptId);
          }} />}

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
                <div key={msg.id ?? i} className={`chat-message ${isSystem ? 'system-msg' : ''} ${isWarning ? 'warning-msg' : ''} ${msg.whisper ? 'whisper-msg' : ''} ${msg.teacher ? 'teacher-msg' : ''} ${msg.id && sound.messageId === msg.id ? 'chat-speaking' : ''}`}>
                  {/* Notices from the game are just the sentence, with no "System:" in front */}
                  {!isSystem && <span className="chat-sender">{msg.teacher ? 'Teacher (private)' : msg.whisper ? `${msg.sender} → ${msg.to} (whisper)` : msg.sender}:</span>}
                  <span className="chat-text"><Marked text={msg.text} marks={msg.marks} className="slip" /></span>
                  {!isSystem && !msg.teacher && msg.id && <button type="button" className="chat-listen" disabled={sound.muted || status.state !== 'online'}
                    aria-label={sound.messageId === msg.id ? `Stop reading ${msg.sender}'s message` : `Listen to ${msg.sender}'s message`}
                    onClick={() => sound.messageId === msg.id ? audioRef.current?.stop() : audioRef.current?.replay(msg.id!)}>
                    {sound.messageId === msg.id ? '■ Stop' : '▶ Listen'}
                  </button>}
                  {msg.teacher && <button type="button" className="teacher-reply" disabled={checking || sending}
                    onClick={openTeacherChat}>Reply to teacher</button>}
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
                  onClick={() => applySuggestion(item.word, suggestion)}>{suggestion}</button>)}
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
              value={target}
              onChange={(e) => { setTarget(e.target.value); setNudge(null); setSpelling([]); setSendError(''); submissionAttemptId.current = null; }}
              disabled={checking || sending}
              title="Who can read this message"
            >
              <option value="auto">{nearest ? `Nearest: ${nearest.name}` : 'Nearest classmate'}</option>
              {classmates.map(player => <option key={player.id} value={player.id}>Whisper: {player.name}</option>)}
              <option value="">Nearby: everyone close</option>
              <option value="teacher">Teacher (private help)</option>
            </select>
            <input 
              type="text" 
              ref={chatField}
              className="chat-input"
              placeholder={whisperTo === 'teacher' ? 'Ask your teacher in any language…' : whisperTo ? `Whisper to ${target === 'auto' ? nearest?.name : classmates.find(player => player.id === target)?.name ?? 'a classmate'} (your teacher can read it)...` : 'Message people nearby (teacher approves)...'}
              maxLength={200}
              value={chatInput}
              readOnly={checking || sending}
              onChange={(e) => { setChatInput(e.target.value); setNudge(null); submissionAttemptId.current = null; setSendError(''); if (!e.target.value) setSpelling([]); }}
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
