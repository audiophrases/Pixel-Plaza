import { useEffect, useMemo, useRef, useState } from 'react';
import './CommandPalette.css';

// Ctrl+K: one box for everything on the teacher page. Type a student's name for what can be done with them,
// "ana: try this" to send Ana a private message at once, or an action ("approve all", "everyone chat",
// "end warm-up"). Each command shows its keyboard key when it has one, so using the box teaches the keys.
export type Command = {
  id: string;
  label: string;
  icon?: string;
  hint?: string; // a keyboard key, or a word of where it goes
  keywords?: string;
  run: () => void | Promise<unknown>;
  stay?: boolean; // keeps the box open (it filled the box in instead of acting)
};
export type PaletteStudent = { studentKey: string; name: string; real?: string; online: boolean };

type Props = {
  open: boolean;
  onClose: () => void;
  commands: Command[]; // for the class, in the order they are suggested
  students: PaletteStudent[];
  forStudent: (student: PaletteStudent, fill: (text: string) => void) => Command[];
  send: (student: PaletteStudent, text: string) => Promise<boolean>;
};

const RECENT_KEY = 'pixelplaza.palette.recent.v1';
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]; } catch { return []; } };

export default function CommandPalette({ open, onClose, commands, students, forStudent, send }: Props) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState(0);
  const [note, setNote] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(''); setChosen(0); setNote('');
    window.requestAnimationFrame(() => field.current?.focus());
  }, [open]);

  const fill = (text: string) => { setQuery(text); setChosen(0); window.requestAnimationFrame(() => field.current?.focus()); };
  const named = (text: string) => {
    const wanted = fold(text.trim());
    if (!wanted) return [];
    const starts = students.filter(student => [student.name, student.real ?? ''].some(name => fold(name).startsWith(wanted) || fold(name).split(/\s+/).some(part => part.startsWith(wanted))));
    return starts.length ? starts : students.filter(student => fold(`${student.name} ${student.real ?? ''}`).includes(wanted));
  };

  const results: Command[] = useMemo(() => {
    // "ana: try this" sends; "ana:" alone waits for the words.
    const message = query.match(/^([^:]{1,40}):\s*(.*)$/s);
    if (message) {
      const [, who, text] = message;
      const to = named(who).slice(0, 6);
      if (!to.length) return [{ id: 'nobody', label: `No student called “${who.trim()}”`, icon: '🤷', run: () => {}, stay: true }];
      return to.map(student => ({
        id: `send:${student.studentKey}`, icon: '✉️', hint: text.trim() ? 'Enter' : undefined,
        label: text.trim() ? `Send to ${student.name}: “${text.trim()}”` : `Write to ${student.name} after the colon…`,
        stay: !text.trim(),
        run: async () => {
          if (!text.trim()) return;
          setNote(await send(student, text.trim()) ? `Sent to ${student.name} ✓` : 'Not sent.');
        },
      }));
    }
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) {
      const recent = readRecent().map(id => commands.find(command => command.id === id)).filter((command): command is Command => !!command);
      return [...recent, ...commands.filter(command => !recent.includes(command))].slice(0, 12);
    }
    // A student's name first: everything that can be done with them. A name among other words ("mute ana") gives
    // only what the other words describe.
    let people = named(words.join(' ')).slice(0, 3).flatMap(student => forStudent(student, fill));
    const name = people.length || words.length < 2 ? -1 : words.findIndex(word => named(word).length > 0);
    if (name >= 0) {
      const rest = words.filter((_, index) => index !== name);
      people = named(words[name]).slice(0, 3).flatMap(student => forStudent(student, fill))
        .filter(command => rest.every(word => fold(`${command.label} ${command.keywords ?? ''}`).includes(word)));
    }
    const matches = commands.filter(command => words.every(word => fold(`${command.label} ${command.keywords ?? ''}`).includes(word)));
    return [...people, ...matches].slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, commands, students]);

  useEffect(() => { setChosen(index => Math.min(index, Math.max(0, results.length - 1))); }, [results.length]);
  useEffect(() => { list.current?.children[chosen]?.scrollIntoView({ block: 'nearest' }); }, [chosen]);

  const run = async (command: Command | undefined) => {
    if (!command) return;
    try { localStorage.setItem(RECENT_KEY, JSON.stringify([command.id, ...readRecent().filter(id => id !== command.id)].slice(0, 6))); } catch { /* remembered for this visit */ }
    await command.run();
    if (!command.stay && !command.id.startsWith('send:')) onClose();
    if (command.id.startsWith('send:') && !command.stay) fill(query.replace(/:.*$/s, ': '));
  };

  if (!open) return null;
  return <div className="palette-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="palette" role="dialog" aria-label="Search or do anything">
      <input ref={field} className="palette-input" value={query} placeholder="A student, an action, or “name: message”…"
        aria-label="Search or do anything" aria-controls="palette-results" role="combobox" aria-expanded="true"
        onChange={event => { setQuery(event.target.value); setChosen(0); setNote(''); }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setChosen(index => Math.min(index + 1, results.length - 1)); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setChosen(index => Math.max(index - 1, 0)); }
          else if (event.key === 'Enter') { event.preventDefault(); void run(results[chosen]); }
          else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        }} />
      {note && <p className="palette-note" role="status">{note}</p>}
      <ol id="palette-results" ref={list} className="palette-results" role="listbox">
        {results.map((command, index) => <li key={`${command.id}:${index}`} role="option" aria-selected={index === chosen}
          className={index === chosen ? 'chosen' : undefined} onMouseEnter={() => setChosen(index)} onMouseDown={event => { event.preventDefault(); void run(command); }}>
          <span className="palette-icon">{command.icon ?? '•'}</span>
          <span className="palette-label">{command.label}</span>
          {command.hint && <kbd>{command.hint}</kbd>}
        </li>)}
        {results.length === 0 && <li className="palette-none">Nothing matches. Try a student's name, or words like “chat”, “warm-up”, “approve”.</li>}
      </ol>
      <p className="palette-help"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> do it · <kbd>Esc</kbd> close · “ana: …” sends a private message</p>
    </div>
  </div>;
}
