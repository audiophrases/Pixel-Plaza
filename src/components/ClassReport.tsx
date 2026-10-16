import { useMemo, useState } from 'react';
import { buildReportPrompt, type ClassReportData } from '../../shared/classReport';

const LEVEL_KEY = 'pixelplaza.report.level';
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];

// Builds a prompt with the lesson's log for an AI chat, which writes the report: who is doing well, who needs
// help, who is not doing much. Names can be swapped for codes; the key stays here and is not in the prompt.
export default function ClassReport({ token, copy }: { token: string; copy: (text: string) => Promise<boolean> }) {
  const [scope, setScope] = useState<'lesson' | 'game'>('lesson');
  const [level, setLevel] = useState(() => { try { return localStorage.getItem(LEVEL_KEY) || 'A2'; } catch { return 'A2'; } });
  const [hideNames, setHideNames] = useState(true);
  const [data, setData] = useState<ClassReportData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const report = useMemo(() => data && buildReportPrompt(data, { level, hideNames }), [data, level, hideNames]);

  const load = async () => {
    setBusy(true); setError(''); setNote('');
    try {
      const response = await fetch(`/api/teacher/report?scope=${scope}`, { headers: { 'x-teacher-session': token } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'The report could not be built.');
      setData(result as ClassReportData);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The report could not be built.'); }
    finally { setBusy(false); }
  };
  const chooseLevel = (value: string) => { setLevel(value); try { localStorage.setItem(LEVEL_KEY, value); } catch { /* remembered for this visit */ } };
  const download = () => {
    if (!report) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([report.prompt], { type: 'text/plain' }));
    link.download = `pixel-plaza-report-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return <>
    <p>Builds a prompt with what each student wrote, answered and asked for. Paste it into ChatGPT, Claude or Gemini to get a report: who is doing well, who needs help, who is not doing much, and the most common errors.</p>
    <div className="teacher-newgame">
      <label className="teacher-inline">Log
        <select value={scope} onChange={event => { setScope(event.target.value as 'lesson' | 'game'); setData(null); }}>
          <option value="lesson">This lesson (since the class opened)</option>
          <option value="game">The whole game (every lesson)</option>
        </select>
      </label>
      <label className="teacher-inline">Level
        <select value={level} onChange={event => chooseLevel(event.target.value)}>{LEVELS.map(item => <option key={item}>{item}</option>)}</select>
      </label>
      <label className="teacher-inline"><input type="checkbox" checked={hideNames} onChange={event => setHideNames(event.target.checked)} /> Hide names (Student 1, Student 2…)</label>
      <button className="btn btn-primary" disabled={busy} onClick={() => void load()}>{busy ? 'Building…' : data ? 'Build again' : 'Build the prompt'}</button>
    </div>
    <p className="teacher-muted">The prompt contains your students' writing. Paste it only into an AI service your school allows.{hideNames ? ' With names hidden, the key below stays on this screen and is not in the prompt.' : ''}</p>
    {error && <p role="alert" className="teacher-error">{error}</p>}
    {report && data && <>
      <p><strong>{data.students.length} {data.students.length === 1 ? 'student' : 'students'}</strong>, {data.students.filter(student => student.lines.some(line => line.source !== 'teacher')).length} wrote something · {report.prompt.length.toLocaleString()} characters</p>
      <textarea className="teacher-report-text" readOnly value={report.prompt} rows={10} onFocus={event => event.currentTarget.select()} aria-label="The report prompt" />
      <div className="teacher-actions">
        <button className="btn btn-primary" onClick={() => void copy(report.prompt).then(done => setNote(done ? 'Copied. Paste it into your AI chat.' : 'Your browser would not copy it. Click in the box, press Ctrl+A, then Ctrl+C.'))}>Copy the prompt</button>
        <button className="btn" onClick={download}>Download as a text file</button>
      </div>
      {note && <p className="teacher-muted" role="status">{note}</p>}
      {report.key.length > 0 && <details className="teacher-report-key">
        <summary>Name key ({report.key.length})</summary>
        <table><thead><tr><th>In the report</th><th>Student</th><th>Name in the plaza</th></tr></thead>
          <tbody>{report.key.map(row => <tr key={row.code}><td>{row.code}</td><td>{row.real}</td><td>{row.plaza}</td></tr>)}</tbody></table>
      </details>}
    </>}
  </>;
}
