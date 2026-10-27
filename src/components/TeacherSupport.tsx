import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttemptPage, MessageAttempt, TeacherSupport as Support } from '../../shared/support';
import './TeacherSupport.css';
import { groupRepeats, tidy } from '../../shared/tidy';

type Student = { studentKey: string; name: string };
type Props = {
  gameId: string;
  token: string;
  support: Support;
  students: Student[];
  who: (studentKey: string, name: string) => string;
  failed: (cause: unknown) => void;
  onStudent: (studentKey: string) => void; // opens that student beside the class
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

// Everything students submitted in this game, blocked and unsent attempts too, and the teacher's private replies:
// for everyone or one student, newest first, older pages on request. What needs the teacher now is in Needs you.
// The page keys it by game, so another game starts over with every student.
export default function TeacherSupport({ gameId, token, support, students, who, failed, onStudent }: Props) {
  const [historyStudent, setHistoryStudent] = useState('');
  const [attempts, setAttempts] = useState<MessageAttempt[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const context = useRef<{ controller: AbortController; loadedOlder: boolean; loadingOlder: boolean; refreshing: boolean } | null>(null);
  const refreshHistory = useRef<(() => Promise<void>) | null>(null);

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

  const teacherRecipient = (attempt: MessageAttempt) => who(attempt.studentKey,
    students.find(student => student.studentKey === attempt.studentKey)?.name
    ?? support.alerts.find(alert => alert.studentKey === attempt.studentKey)?.name ?? 'Student');

  return <section className="teacher-support" aria-label="Message history">
    <p>Everything students submitted, including attempts that were blocked or not sent, and your private replies.</p>
    {support.ai && <p className="teacher-ai-count">AI help requests used: <strong>{support.ai.used} / {support.ai.students}</strong> students in this session.</p>}
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
    {/* The same submission repeated (spam, or trying again) is one entry with a count. */}
    <ol className="teacher-attempts">{groupRepeats(attempts, (a, b) => a.studentKey === b.studentKey && a.source === b.source && a.status === b.status && a.text.trim() === b.text.trim())
      .map(({ item: attempt, count }) => <li key={attempt.id} className={`teacher-attempt teacher-attempt-${attempt.source}`}>
      <div><strong>{attempt.source === 'teacher' ? 'Teacher' : who(attempt.studentKey, attempt.sender)}</strong>
        {attempt.target && <> → {attempt.source === 'teacher' ? teacherRecipient(attempt) : attempt.target}</>}
        <small>{time(attempt.timestamp)} · {sources[attempt.source]} · {statuses[attempt.status] ?? attempt.status.replaceAll('_', ' ').replaceAll('-', ' ')}</small>
      </div>
      {attempt.objective && <p className="teacher-attempt-context">Task: {attempt.objective}</p>}
      <p className="teacher-attempt-text">{attempt.text ? tidy(attempt.text) : <em>Empty submission</em>}{count > 1 && <strong className="teacher-attempt-times"> ×{count}</strong>}</p>
      {attempt.finalText && attempt.finalText !== attempt.text && <p className="teacher-attempt-text"><strong>Revised submission:</strong> {attempt.finalText}</p>}
      {attempt.reason && <p className="teacher-attempt-reason">Reason: {attempt.reason}</p>}
      {attempt.correction && <p className="teacher-note">Language hint: {attempt.correction}</p>}
      {attempt.source !== 'teacher' && <button type="button" onClick={() => onStudent(attempt.studentKey)}>Open this student</button>}
    </li>)}</ol>
    {next && <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void loadOlder()}>{loading ? 'Loading…' : 'Load older messages'}</button>}
    {attempts.length > 0 && !next && !loading && <p className="teacher-history-end">All submitted messages for this selection are shown.</p>}
  </section>;
}
