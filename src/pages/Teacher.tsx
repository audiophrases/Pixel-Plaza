import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './Teacher.css';

type Entry = { id: string; studentKey: string; sender: string; target: string | null; flag: string | null; text: string; timestamp: number; status: string };
// laptop is set when this runs on the teacher's laptop (npm run classroom).
type Status = {
  open: boolean; pin: string | null; entries: Entry[]; muted: string[]; online: { studentKey: string; name: string }[];
  laptop?: { url: string; signInUrl: string } | null; notice?: string;
};

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`/api/teacher/${path}`, init);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed.'), { status: response.status });
  return result as T;
}

export default function Teacher() {
  const [password, setPassword] = useState('');
  // The password is checked once; the session token carries the rest.
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  // A problem sending students to this laptop, from sign-in or opening the class.
  const [notice, setNotice] = useState('');

  const request = useCallback((path: string, body?: object) => call<Status>(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-teacher-session': token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }), [token]);

  const failed = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : 'Connection failed.');
    if ((cause as { status?: number }).status === 401) { setToken(''); setStatus(null); } // the session expired
  }, []);

  const refresh = useCallback(async () => {
    try { setStatus(await request('status')); setError(''); }
    catch (cause) { failed(cause); }
  }, [request, failed]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => window.clearInterval(timer);
  }, [token, refresh]);

  const signIn = async () => {
    try {
      const { token: session, notice: linked } = await call<{ token: string; notice?: string }>('login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password })
      });
      setStatus(await call<Status>('status', { headers: { 'x-teacher-session': session } }));
      setPassword('');
      setError('');
      setNotice(linked || '');
      setToken(session);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed.'); }
  };

  const action = async (path: string, body: object) => {
    try {
      const result = await request(path, body);
      setStatus(result);
      setError('');
      if (result.notice !== undefined) setNotice(result.notice);
    } catch (cause) { failed(cause); }
  };

  return <main className="teacher-page">
    <header className="teacher-header">
      <div><h1>Teacher controls</h1><p>All student chat waits for your approval.</p></div>
      <Link to="/">Student entrance</Link>
    </header>
    {!token || !status ? <form className="teacher-signin" onSubmit={event => { event.preventDefault(); void signIn(); }}>
      <label htmlFor="teacher-password">Teacher password (the same as PinPlay)</label>
      <input id="teacher-password" type="password" autoComplete="current-password" value={password}
        onChange={event => setPassword(event.target.value)} required />
      <button className="btn btn-primary">Open controls</button>
    </form> : <>
      <section className="teacher-controls">
        <strong>Class is {status.open ? 'open' : 'closed'}</strong>
        {status.pin && <span className="teacher-pin">Class PIN <strong>{status.pin}</strong></span>}
        <button className="btn btn-primary" onClick={() => void action('class', { open: !status.open })}>
          {status.open ? 'Close class' : 'Open class'}
        </button>
        <button className="btn btn-secondary" onClick={() => { setStatus(null); setToken(''); }}>Sign out</button>
      </section>
      {status.laptop && <section className="teacher-laptop">
        <h2>Playing on this laptop</h2>
        <p>Students go to <strong>{status.laptop.signInUrl}</strong> and sign in with Google. They are then sent
          here, to <strong>{status.laptop.url}</strong>, while the class is open.</p>
        {notice && <p role="alert" className="teacher-error">{notice}</p>}
      </section>}
      <section className="teacher-online">
        <h2>In the Plaza now ({status.online.length})</h2>
        <p>{status.online.length ? status.online.map(student => student.name).join(', ') : 'Nobody yet.'}</p>
      </section>
      <section className="teacher-entries">
        <h2>Chat review</h2>
        {status.entries.length === 0 && <p>No messages yet.</p>}
        {status.entries.map(entry => <article key={entry.id} className="teacher-entry">
          <div><strong>{entry.sender}</strong>{entry.target && <> → <strong>{entry.target}</strong> <em>(whisper)</em></>} <small>{new Date(entry.timestamp).toLocaleTimeString()} · {entry.status}</small></div>
          <p>{entry.text}</p>
          {entry.flag && <p className="teacher-flag">{entry.status === 'blocked' ? 'Blocked by moderation' : 'Not checked by moderation'}: {entry.flag}</p>}
          <div className="teacher-actions">
            {entry.status === 'pending' && <>
              <button onClick={() => void action('review', { id: entry.id, approve: true })}>Approve</button>
              <button onClick={() => void action('review', { id: entry.id, approve: false })}>Reject</button>
            </>}
            <button onClick={() => void action('mute', { studentKey: entry.studentKey, muted: !status.muted.includes(entry.studentKey) })}>
              {status.muted.includes(entry.studentKey) ? 'Unmute' : 'Mute'} student
            </button>
          </div>
        </article>)}
      </section>
    </>}
    {error && <p role="alert" className="teacher-error">{error}</p>}
  </main>;
}
