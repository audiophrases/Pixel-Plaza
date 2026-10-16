import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttemptPage, HelpAlert, HelpTopic, MessageAttempt, TeacherSupport as Support } from '../../shared/support';
import './TeacherSupport.css';

type Student = { studentKey: string; name: string };
type Props = {
  gameId: string;
  token: string;
  support: Support;
  students: Student[];
  who: (studentKey: string, name: string) => string;
  action: (path: string, body: object) => Promise<boolean>;
  failed: (cause: unknown) => void;
  embedded?: boolean; // inside a card that already has the heading and count
};

const topics: Record<HelpTopic, string> = {
  writing: 'Expressing an idea', instructions: 'Game instructions',
  'classmate-message': 'Understanding a classmate', other: 'Something else'
};
const sources: Record<MessageAttempt['source'], string> = {
  chat: 'Chat', interview: 'Witness exchange', answer: 'Journal answer',
  warmup: 'Warm-up', teacher: 'Private teacher message', help: 'Help request'
};
const statuses: Record<string, string> = {
  'teacher-inbox': 'Sent privately to teacher', delivered: 'Delivered',
  approved: 'Approved', pending: 'Waiting for review', blocked: 'Blocked',
  rejected: 'Rejected', accepted: 'Accepted', incorrect: 'Incorrect',
  sent: 'Sent', submitted: 'Submitted', 'not-sent': 'Not sent',
  'language-blocked': 'Stopped by language check', 'language-checked': 'Language checked',
  'hint-offered': 'Language hint offered', 'rate-limited': 'Too many messages at once',
  invalid: 'Could not submit', waiting: 'Waiting to submit', correct: 'Correct answer',
  'help-requested': 'Help requested', unavailable: 'Could not complete this action', removed: 'Removed from chat',
  'ai-help': 'AI language hint', 'ai-help-pending': 'AI hint requested'
};

function time(timestamp: number) {
  return new Date(timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

function mergeAttempts(current: MessageAttempt[], incoming: MessageAttempt[]) {
  const merged = new Map(current.map(attempt => [attempt.id, attempt]));
  for (const attempt of incoming) merged.set(attempt.id, attempt);
  return [...merged.values()].sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
}

export default function TeacherSupport({ gameId, token, support, students, who, action, failed, embedded = false }: Props) {
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState('');
  const [changing, setChanging] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [historyStudent, setHistoryStudent] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attempts, setAttempts] = useState<MessageAttempt[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const context = useRef<{ controller: AbortController; loadedOlder: boolean; loadingOlder: boolean; refreshing: boolean } | null>(null);
  const refreshHistory = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    setRecipient('');
    setMessage('');
    setSent('');
    setHistoryStudent('');
    setShowResolved(false);
    setHistoryOpen(false);
  }, [gameId]);

  // Each game/student gets its own request context. Old responses cannot replace a new selection.
  const readHistory = useCallback(async (cursor: string | null, signal: AbortSignal): Promise<AttemptPage> => {
    const query = new URLSearchParams({ gameId });
    if (historyStudent) query.set('studentKey', historyStudent);
    if (cursor) query.set('cursor', cursor);
    const response = await fetch(`/api/teacher/attempts?${query}`, {
      headers: { 'x-teacher-session': token }, signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || 'Could not load message history.'), { status: response.status });
    return result as AttemptPage;
  }, [gameId, token, historyStudent]);

  useEffect(() => {
    const current = { controller: new AbortController(), loadedOlder: false, loadingOlder: false, refreshing: false };
    context.current = current;
    setAttempts([]);
    setNext(null);
    setLoading(true);
    setHistoryError('');
    const refresh = async () => {
      if (current.refreshing || current.controller.signal.aborted) return;
      current.refreshing = true;
      try {
        const page = await readHistory(null, current.controller.signal);
        if (current.controller.signal.aborted) return;
        setAttempts(previous => mergeAttempts(previous, page.attempts));
        if (!current.loadedOlder && !current.loadingOlder) setNext(page.next);
        setHistoryError('');
      } catch (cause) {
        if (!current.controller.signal.aborted) {
          setHistoryError(cause instanceof Error ? cause.message : 'Could not load message history.');
          if ((cause as { status?: number }).status === 401) failed(cause);
        }
      } finally {
        current.refreshing = false;
        if (!current.controller.signal.aborted) setLoading(current.loadingOlder);
      }
    };
    refreshHistory.current = refresh;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 10000);
    return () => {
      current.controller.abort();
      window.clearInterval(timer);
      if (context.current === current) {
        context.current = null;
        refreshHistory.current = null;
      }
    };
  }, [readHistory, failed]);

  const loadOlder = async () => {
    const current = context.current;
    if (!next || !current || current.loadingOlder) return;
    current.loadingOlder = true;
    setLoading(true);
    try {
      const page = await readHistory(next, current.controller.signal);
      if (current.controller.signal.aborted) return;
      current.loadedOlder = true;
      setAttempts(previous => mergeAttempts(previous, page.attempts));
      setNext(page.next);
      setHistoryError('');
    } catch (cause) {
      if (!current.controller.signal.aborted) {
        setHistoryError(cause instanceof Error ? cause.message : 'Could not load older messages.');
        if ((cause as { status?: number }).status === 401) failed(cause);
      }
    } finally {
      current.loadingOlder = false;
      if (!current.controller.signal.aborted) setLoading(current.refreshing);
    }
  };

  const selectStudent = (studentKey: string) => {
    if (studentKey !== recipient) setMessage('');
    setRecipient(studentKey);
    setHistoryStudent(studentKey);
    setHistoryOpen(true);
    setSent('');
    document.getElementById('teacher-help-message')?.focus();
  };

  const updateAlert = async (alert: HelpAlert, status: 'acknowledged' | 'resolved') => {
    setChanging(alert.id);
    try { await action('help-status', { id: alert.id, status, gameId }); }
    finally { setChanging(null); }
  };

  const sendMessage = async () => {
    if (!recipient || !message.trim() || sending) return;
    setSending(true);
    setSent('');
    try {
      if (await action('help-message', { studentKey: recipient, text: message, gameId })) {
        setMessage('');
        setSent('Private message sent.');
        void refreshHistory.current?.();
      }
    } finally { setSending(false); }
  };

  const active = support.alerts.filter(alert => alert.status !== 'resolved');
  const alerts = showResolved ? support.alerts : active;
  const teacherRecipient = (attempt: MessageAttempt) => who(attempt.studentKey,
    students.find(student => student.studentKey === attempt.studentKey)?.name
    ?? support.alerts.find(alert => alert.studentKey === attempt.studentKey)?.name ?? 'Student');

  return <section className={`teacher-support${embedded ? ' teacher-support-embedded' : ''}`} aria-labelledby={embedded ? undefined : 'teacher-support-heading'}>
    <div className="teacher-support-heading">
      {!embedded && <h2 id="teacher-support-heading">Student help {active.length > 0 && <span className="teacher-help-count">{active.length} to follow up</span>}</h2>}
      <a href="#teacher-help-history" onClick={() => setHistoryOpen(true)}>Message history</a>
    </div>
    <p>Students can ask for help. Three related language blocks, grammar hints or incorrect answers within five minutes suggest a check-in. You decide what support they need.</p>
    {support.ai && <p className="teacher-ai-count">AI help requests used: <strong>{support.ai.used} / {support.ai.students}</strong> students in this session.</p>}
    {active.length === 0 && <p>No students waiting for help.</p>}
    {support.alerts.some(alert => alert.status === 'resolved') && <label className="teacher-help-toggle">
      <input type="checkbox" checked={showResolved} onChange={event => setShowResolved(event.target.checked)} /> Show completed check-ins
    </label>}
    <div className="teacher-help-alerts">{alerts.map(alert => <article key={alert.id} className={`teacher-help-alert teacher-help-${alert.status}`}>
      <div className="teacher-help-alert-heading">
        <strong>{who(alert.studentKey, alert.name)}</strong>
        <span>{alert.kind === 'requested' ? 'Asked for help' : 'Suggested check-in'} · {alert.status === 'acknowledged' ? 'Helping' : alert.status === 'resolved' ? 'Completed' : 'Waiting'}</span>
      </div>
      <p><strong>{topics[alert.topic]}</strong>{alert.note && <> · {alert.note}</>}</p>
      {alert.ai && <div className="teacher-note"><strong>{alert.ai.pending ? 'AI hint in progress…' : 'AI feedback'}</strong>
        {alert.ai.tip && <p>{alert.ai.tip}</p>}
        <small>You can intervene or let the student continue.</small>
      </div>}
      <small>{time(alert.timestamp)}</small>
      {alert.evidence.length > 0 && <details>
        <summary>What prompted this check-in ({alert.evidence.length})</summary>
        <ul>{alert.evidence.map((evidence, index) => <li key={`${evidence.timestamp}-${index}`}>
          <span>{evidence.reason}</span> <small>{time(evidence.timestamp)}</small>
          <blockquote>{evidence.text}</blockquote>
        </li>)}</ul>
      </details>}
      <div className="teacher-actions">
        <button type="button" disabled={sending} onClick={() => selectStudent(alert.studentKey)}>View messages &amp; help</button>
        {alert.status === 'open' && <button type="button" disabled={changing !== null} onClick={() => void updateAlert(alert, 'acknowledged')}>I’m helping</button>}
        {alert.status !== 'resolved' && <button type="button" disabled={changing !== null} onClick={() => void updateAlert(alert, 'resolved')}>Help completed / helped in person</button>}
      </div>
    </article>)}</div>

    <form className="teacher-help-compose" onSubmit={event => { event.preventDefault(); void sendMessage(); }}>
      <h3>Send private help</h3>
      <p>Help a student express an idea or understand instructions and messages. Only that student sees your reply.</p>
      <label htmlFor="teacher-help-recipient">Student</label>
      <select id="teacher-help-recipient" value={recipient} disabled={sending} required onChange={event => {
        if (event.target.value !== recipient) setMessage('');
        setRecipient(event.target.value);
        setHistoryStudent(event.target.value);
        if (event.target.value) setHistoryOpen(true);
        setSent('');
      }}>
        <option value="">Choose a student</option>
        {students.map(student => <option key={student.studentKey} value={student.studentKey}>{who(student.studentKey, student.name)}</option>)}
      </select>
      <label htmlFor="teacher-help-message">Your message</label>
      <textarea id="teacher-help-message" value={message} disabled={sending} maxLength={1000} required rows={3}
        placeholder="Tell me your idea. We can work out how to say it together."
        onChange={event => { setMessage(event.target.value); setSent(''); }} />
      <div className="teacher-help-send">
        <button className="btn btn-primary" disabled={sending || !recipient || !message.trim()}>{sending ? 'Sending…' : 'Send private message'}</button>
        <span role="status">{sent}</span>
      </div>
    </form>

    <details id="teacher-help-history" className="teacher-help-history" open={historyOpen}
      onToggle={event => setHistoryOpen(event.currentTarget.open)}>
      <summary>Submitted message history</summary>
      <p>Review submitted chat, witness exchanges and answers, including attempts that were blocked or not sent. Private teacher replies are recorded here too.</p>
      <div className="teacher-help-history-controls">
        <label htmlFor="teacher-history-student">Show</label>
        <select id="teacher-history-student" value={historyStudent} onChange={event => setHistoryStudent(event.target.value)}>
          <option value="">All students</option>
          {students.map(student => <option key={student.studentKey} value={student.studentKey}>{who(student.studentKey, student.name)}</option>)}
        </select>
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => {
          setLoading(true);
          void refreshHistory.current?.();
        }}>Refresh messages</button>
      </div>
      {historyError && <p className="teacher-error" role="alert">{historyError}</p>}
      {!attempts.length && <p role="status">{loading ? 'Loading messages…' : 'No submitted messages yet.'}</p>}
      <ol className="teacher-attempts">{attempts.map(attempt => <li key={attempt.id} className={`teacher-attempt teacher-attempt-${attempt.source}`}>
        <div><strong>{attempt.source === 'teacher' ? 'Teacher' : who(attempt.studentKey, attempt.sender)}</strong>
          {attempt.target && <> → {attempt.source === 'teacher' ? teacherRecipient(attempt) : attempt.target}</>}
          <small>{time(attempt.timestamp)} · {sources[attempt.source]} · {statuses[attempt.status] ?? attempt.status.replaceAll('_', ' ').replaceAll('-', ' ')}</small>
        </div>
        {attempt.objective && <p className="teacher-attempt-context">Task: {attempt.objective}</p>}
        <p className="teacher-attempt-text">{attempt.text || <em>Empty submission</em>}</p>
        {attempt.finalText && attempt.finalText !== attempt.text && <p className="teacher-attempt-text"><strong>Revised submission:</strong> {attempt.finalText}</p>}
        {attempt.reason && <p className="teacher-attempt-reason">Reason: {attempt.reason}</p>}
        {attempt.correction && <p className="teacher-note">Language hint: {attempt.correction}</p>}
        {attempt.source !== 'teacher' && <button type="button" disabled={sending} onClick={() => selectStudent(attempt.studentKey)}>Help this student</button>}
      </li>)}</ol>
      {next && <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void loadOlder()}>{loading ? 'Loading…' : 'Load older messages'}</button>}
      {attempts.length > 0 && !next && !loading && <p className="teacher-history-end">All submitted messages for this selection are shown.</p>}
    </details>
  </section>;
}
