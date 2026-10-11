import React, { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PhaserGame from '../components/PhaserGame';
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
}

export default function Game() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as GameState | null;
  const [session] = useState(() => readStudentSession());
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  // A grammar hint waiting for the student's choice: what they wrote, the fix, and why.
  const [nudge, setNudge] = useState<{ original: string; corrected: string; why: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const keptRun = useRef(0); // hints in a row the student turned down
  const [spelling, setSpelling] = useState<Misspelling[]>([]); // words that stopped the last message
  const [whisperTo, setWhisperTo] = useState(''); // a classmate's id; empty means nearby chat
  const [classmates, setClassmates] = useState<{ id: string; name: string }[]>([]);
  const [connection, setConnection] = useState<PlazaConnection | null>(null);
  const [status, setStatus] = useState<PlazaStatus>({ state: 'connecting' });
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      if (event.t === 'chat') say({ id: event.id, sender: event.sender, text: event.text, timestamp: event.ts, whisper: event.whisper, to: event.to });
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
    if (connection.send({ t: 'chat', text, ...(whisperTo ? { to: whisperTo } : {}), ...extra })) {
      setChatInput('');
      setNudge(null);
      setSpelling([]);
    } else setMessages(prev => [...prev, { sender: 'System Warning', text: 'Not connected. Try again in a moment.' }]);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !connection || checking) return;
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
        setNudge({ original: chatInput, corrected: hint.corrected, why: hint.why });
        return;
      }
      keptRun.current = 0;
      deliver(chatInput);
    } finally {
      setChecking(false);
    }
  };

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

        <div className="chat-container glass-panel">
          <div className="chat-messages">
            {messages.map((msg, i) => {
              const isWarning = msg.sender.includes('Warning');
              const isSystem = msg.sender.startsWith('System');
              
              return (
                <div key={i} className={`chat-message ${isSystem ? 'system-msg' : ''} ${isWarning ? 'warning-msg' : ''} ${msg.whisper ? 'whisper-msg' : ''}`}>
                  <span className="chat-sender">{msg.whisper ? `${msg.sender} → ${msg.to} (whisper)` : msg.sender}:</span>
                  <span className="chat-text">{msg.text}</span>
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
          {nudge && <div className="grammar-help" role="status">
            <div><strong>Try this:</strong> <span className="grammar-fix">{nudge.corrected}</span></div>
            <div className="grammar-why">{nudge.why}</div>
            <div className="grammar-actions">
              <button type="button" className="btn btn-primary" onClick={useHint} title="Send the sentence above">OK</button>
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
              className="chat-input"
              placeholder={whisperTo ? 'Whisper (your teacher can read it)...' : 'Message people nearby (teacher approves)...'}
              maxLength={200}
              value={chatInput}
              onChange={(e) => { setChatInput(e.target.value); setNudge(null); if (!e.target.value) setSpelling([]); }}
              onCopy={handlePreventClipboard}
              onPaste={handlePreventClipboard}
              onCut={handlePreventClipboard}
              autoComplete="off"
              spellCheck="true"
            />
            <button type="submit" className="btn btn-primary chat-send-btn" disabled={checking}>{checking ? '…' : 'Send'}</button>
          </form>
        </div>
      </div>
    </div>
  );
}
