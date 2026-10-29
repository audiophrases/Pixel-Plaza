import { useEffect, useRef, useState } from 'react';
import type { AvatarConfig } from '../utils/AvatarRenderer';
import AvatarEditor from './AvatarEditor';
import './StudentCharacterEditor.css';

type Profile = { studentKey: string; name: string; avatar: AvatarConfig };
export type StudentAction = (path: string, body: object, onError?: (cause: unknown) => void) => Promise<boolean>;

export default function StudentCharacterEditor({ token, gameId, studentKey, action, failed, onClose }: {
  token: string; gameId: string; studentKey: string;
  action: StudentAction; failed: (cause: unknown) => void; onClose: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    void (async () => {
      try {
        const query = new URLSearchParams({ gameId, studentKey });
        const response = await fetch(`/api/teacher/student?${query}`, { headers: { 'x-teacher-session': token }, signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw Object.assign(new Error(result.error || 'Could not load this character.'), { status: response.status });
        if (controller.signal.aborted) return;
        setProfile(result as Profile);
        setName(result.name);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Could not load this character.');
        if ((cause as { status?: number }).status === 401) failed(cause);
      }
    })();
    return () => { controller.abort(); previousFocus?.focus(); };
  }, [token, gameId, studentKey, failed]);

  const save = async (avatar: AvatarConfig) => {
    if (!profile || busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await action('student', { gameId, studentKey, name, avatar }, cause => {
        setError(cause instanceof Error ? cause.message : 'Could not save these changes. Try again.');
      });
      if (saved) onClose();
    } finally { setBusy(false); }
  };

  return <div className="student-character-backdrop" onClick={event => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} tabIndex={-1} className="student-character-dialog" role="dialog" aria-modal="true" aria-label="Edit student name and character"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose(); }
        if (event.key !== 'Tab') return;
        const fields = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? [])]
          .filter(field => !field.closest('fieldset:disabled'));
        const first = fields[0], last = fields.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
      }}>
      {profile ? <AvatarEditor initialConfig={profile.avatar} mode="teacher" busy={busy} onSave={avatar => void save(avatar)} onCancel={onClose}>
        <label className="student-character-name">Name in this game
          <input autoFocus value={name} maxLength={24} onChange={event => setName(event.target.value)} aria-label="Student display name" />
        </label>
        <p className="student-character-scope">The name applies to this game. Character, outfit and voice stay with this student across games.</p>
      </AvatarEditor> : <>
        <p role="status">{error ? 'Character unavailable.' : 'Loading character…'}</p>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
      </>}
      {error && <p role="alert" className="student-character-error">{error}</p>}
    </div>
  </div>;
}
