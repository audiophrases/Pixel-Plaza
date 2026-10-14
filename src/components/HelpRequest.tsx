import { useEffect, useId, useRef, useState } from 'react';
import type { HelpTopic, StudentSupport } from '../../shared/support';
import './HelpRequest.css';

export default function HelpRequest({ support, online, onRequest, onOpenChat }: {
  support: StudentSupport;
  online: boolean;
  onRequest: (topic: HelpTopic, text: string) => boolean;
  onOpenChat: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<HelpTopic>('writing');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const pendingRequest = useRef(false);
  const panelId = useId();
  const status = support.request?.status;

  useEffect(() => {
    if (!support.request || !pendingRequest.current) return;
    pendingRequest.current = false;
    setSending(false);
    setError('');
    setOpen(false);
    setText('');
  }, [support.request]);

  useEffect(() => {
    if (!online) { pendingRequest.current = false; setSending(false); }
  }, [online]);

  return <div className="student-help">
    <button className="student-help-toggle" type="button" aria-expanded={open} aria-controls={panelId}
      onClick={() => setOpen(current => !current)}>I need help</button>
    {status && <span className={`student-help-status student-help-${status}`} role="status">
      {status === 'open' ? 'Teacher notified' : status === 'acknowledged' ? 'Teacher is helping' : 'Help completed'}
    </span>}
    {open && <form className="student-help-panel glass-panel" id={panelId} onSubmit={event => {
      event.preventDefault();
      if (sending) return;
      if (onRequest(topic, text.trim())) {
        pendingRequest.current = true;
        setSending(true);
        setError('');
      } else setError('Waiting for a connection. Your note is still here; try again when connected.');
    }}>
      <h2>Ask your teacher for help</h2>
      <p>Your teacher can help you here in chat or in class.</p>
      <label>What do you need help with?
        <select value={topic} onChange={event => setTopic(event.target.value as HelpTopic)} disabled={sending}>
          <option value="writing">Writing my ideas in English</option>
          <option value="instructions">Understanding game instructions</option>
          <option value="classmate-message">Understanding a classmate's message</option>
          <option value="other">Something else</option>
        </select>
      </label>
      <label>Tell your teacher more (optional)
        <textarea value={text} onChange={event => setText(event.target.value)} maxLength={500} rows={3}
          placeholder="Write in any language if that helps." disabled={sending} />
      </label>
      {error && <p className="student-help-error" role="alert">{error}</p>}
      {!online && <p className="student-help-error" role="status">Reconnecting to your teacher…</p>}
      <div className="student-help-actions">
        <button type="submit" className="btn btn-primary" disabled={sending || !online}>
          {sending ? 'Sending…' : 'Notify my teacher'}
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
