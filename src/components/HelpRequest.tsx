import { useEffect, useId, useRef, useState } from 'react';
import type { HelpTopic, StudentSupport } from '../../shared/support';
import './HelpRequest.css';

export default function HelpRequest({ support, online, chatDraft = '', onRequest, onOpenChat }: {
  support: StudentSupport;
  online: boolean;
  chatDraft?: string;
  onRequest: (topic: HelpTopic, text: string, route?: 'auto' | 'teacher') => boolean;
  onOpenChat: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<HelpTopic>('writing');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const pendingRequest = useRef(false);
  const awaitingHint = useRef(false);
  const timer = useRef(0);
  const panelId = useId();
  const status = support.request?.status;
  const aiPending = !!support.ai?.pending;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!pendingRequest.current || support.ai?.pending
      || (!support.request && !support.ai?.tip)) return;
    pendingRequest.current = false;
    window.clearTimeout(timer.current);
    setSending(false);
    setError('');
    if (!awaitingHint.current || !support.ai?.tip) setOpen(false);
  }, [support.request, support.ai]);

  useEffect(() => {
    if (!online) { pendingRequest.current = false; window.clearTimeout(timer.current); setSending(false); }
  }, [online]);

  const request = () => {
    awaitingHint.current = !!support.ai?.available && !support.ai.used;
    if (onRequest(topic, text.trim(), 'auto')) {
      pendingRequest.current = true;
      setSending(true); setError('');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        pendingRequest.current = false; setSending(false);
        setError('Help is taking longer than expected. Your note is saved here.');
      }, 8000);
    } else setError('Waiting for a connection. Your note is still here; try again when connected.');
  };

  return <div className="student-help">
    <button className="student-help-toggle" type="button" aria-expanded={open} aria-controls={panelId}
      onClick={() => { if (!open && !text) setText(chatDraft.slice(0, 500)); setOpen(current => !current); }}>I need help</button>
    {status && <span className={`student-help-status student-help-${status}`} role="status">
      {status === 'open' ? 'Help requested' : status === 'acknowledged' ? 'Teacher is helping' : 'Help completed'}
    </span>}
    {open && <form className="student-help-panel glass-panel" id={panelId} onSubmit={event => {
      event.preventDefault();
      if (sending) return;
      request();
    }}>
      <h2>Get help</h2>
      <p>Tell us where you’re stuck.</p>
      {support.ai?.tip && <div className="student-ai-tip" role="status"><strong>A hint for you</strong><p>{support.ai.tip}</p></div>}
      {aiPending && <p role="status">Getting your language hint…</p>}
      <label>Help with
        <select value={topic} onChange={event => setTopic(event.target.value as HelpTopic)} disabled={sending}>
          <option value="writing">Writing in English</option>
          <option value="instructions">Game instructions</option>
          <option value="classmate-message">A classmate’s message</option>
          <option value="other">Something else</option>
        </select>
      </label>
      <label>Your question or unfinished sentence
        <textarea value={text} onChange={event => setText(event.target.value)} maxLength={500} rows={3}
          placeholder="Write in any language if that helps." disabled={sending} />
      </label>
      {error && <p className="student-help-error" role="alert">{error}</p>}
      {!online && <p className="student-help-error" role="status">Reconnecting to your teacher…</p>}
      <div className="student-help-actions">
        <button type="submit" className="btn btn-primary" disabled={sending}>
          {sending ? 'Sending…' : 'Get help'}
        </button>
        <button type="button" className="spelling-fix" onClick={() => setOpen(false)}>Close</button>
      </div>
      {support.messages.length > 0 && <button type="button" className="student-help-chat" onClick={() => {
        onOpenChat();
        setOpen(false);
      }}>Open teacher messages</button>}
    </form>}
  </div>;
}
