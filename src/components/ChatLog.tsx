import { groupRepeats, tidy } from '../../shared/tidy';
import { XP } from '../../shared/levels';
import type { LiveEntry } from './LiveClass';
import { ago, outcome, scope } from './liveFormat';
import './ChatLog.css';

// What students are saying, filtered to one kind of chat: everyone near each other, the whole plaza, private
// messages, or what was blocked. Each line: who, to whom, the words, what became of it, and a star or a take-down.
export type ChatFilter = 'all' | 'nearby' | 'everyone' | 'private' | 'blocked';
const CHAT_FILTERS: [ChatFilter, string][] = [['all', 'All'], ['nearby', '👥 Nearby'], ['everyone', '📢 Everyone'], ['private', '🔒 Private'], ['blocked', '⛔ Blocked']];

const shows = (filter: ChatFilter, entry: LiveEntry) => filter === 'all' ? true
  : filter === 'blocked' ? entry.status === 'blocked' || entry.status === 'rejected' || entry.status === 'removed'
  : filter === 'private' ? !!entry.target
  : filter === 'everyone' ? !entry.target && !!entry.everyone
  : !entry.target && !entry.everyone;

type Props = {
  entries: LiveEntry[];
  filter: ChatFilter;
  onFilter: (filter: ChatFilter) => void;
  who: (studentKey: string, name: string) => string;
  action: (path: string, body: object) => Promise<boolean>;
  onSelect: (studentKey: string) => void;
};

export default function ChatLog({ entries, filter, onFilter, who, action, onSelect }: Props) {
  const lines = entries.filter(entry => entry.status !== 'pending' && shows(filter, entry));
  return <div className="chat-log">
    <div className="chat-log-filters" role="group" aria-label="Which chat">
      {CHAT_FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => onFilter(id)}>
        {label} <small>{entries.filter(entry => entry.status !== 'pending' && shows(id, entry)).length}</small></button>)}
    </div>
    {lines.length === 0 && <p className="chat-log-empty">Nothing here yet.</p>}
    {/* The same message sent again and again is one line with a count. */}
    <ol className="chat-log-lines">{groupRepeats(lines, (a, b) => a.studentKey === b.studentKey && a.text.trim() === b.text.trim() && a.status === b.status).map(({ item: entry, count }) => {
      const [icon, label] = outcome[entry.status] ?? ['·', entry.status];
      return <li key={entry.id} className={`chat-log-line chat-log-${entry.status}`}>
        <button type="button" className="chat-log-who" onClick={() => onSelect(entry.studentKey)} title="Open this student">{who(entry.studentKey, entry.sender)}</button>
        <span className="chat-log-scope">{scope(entry)}</span>
        <span className="chat-log-text">{tidy(entry.text)}{count > 1 && <span className="live-times">×{count}</span>}</span>
        <span className="chat-log-end">
          <small>{ago(entry.timestamp)}</small>
          <span title={label}>{icon}</span>
          {entry.status === 'approved' && (entry.starred ? <span title="Starred">⭐</span>
            : <button type="button" title={`Give ${XP.teacher} XP for good English`} onClick={() => void action('xp', { chatId: entry.id })}>☆</button>)}
          {entry.status === 'approved' && <button type="button" title="Take it down from every screen" onClick={() => void action('remove', { id: entry.id })}>🗑</button>}
        </span>
      </li>;
    })}</ol>
  </div>;
}
