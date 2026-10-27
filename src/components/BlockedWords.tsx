import { useState } from 'react';
import type { BlockedStatus } from '../../shared/blockedWords';
import './BlockedWords.css';

// Words and phrases blocked for this lesson: a box to add them (commas between several), what each one took down
// and stopped and who kept trying, and the last lesson's, to block again.
type Props = {
  blocked: BlockedStatus;
  open: boolean; // they last for one lesson, so the class must be open
  who: (studentKey: string, name: string) => string;
  action: (path: string, body: object) => Promise<boolean>;
  onSelect: (studentKey: string) => void;
};

export default function BlockedWords({ blocked, open, who, action, onSelect }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const typed = text.split(/[,\n]/).map(words => words.trim()).filter(Boolean);
  // The server's rule, said before sending: two letters at least, 60 characters at most.
  const wrong = typed.find(words => (words.match(/\p{L}/gu)?.length ?? 0) < 2 || words.length > 60);
  const block = async (words: string[]) => {
    setBusy(true);
    try { return await action('block', { words }); } finally { setBusy(false); }
  };

  return <div className="blocked-words">
    <form className="teacher-newgame" onSubmit={event => { event.preventDefault(); if (typed.length) void block(typed).then(done => { if (done) setText(''); }); }}>
      <input value={text} maxLength={600} disabled={!open || busy} onChange={event => setText(event.target.value)} aria-label="Words or phrases to block for this lesson"
        placeholder={open ? 'Words or phrases, e.g. free andrei, free a' : 'Open the class to block words for its lesson'} />
      <button className="btn btn-primary" disabled={!open || busy || !typed.length || !!wrong}>🚫 Block</button>
    </form>
    {wrong && <p className="teacher-flag">“{wrong}”: each word or phrase needs two letters or more, and 60 characters at most.</p>}
    <p className="teacher-muted">Until you close the class. However it is written (capitals, fr33, freeee, f r e e, endings like -s), no message to classmates
      can say it, and what already said it this lesson comes down. A student who tries is told you blocked it; nobody else sees it. Messages to you are never blocked.</p>
    {blocked.words.length === 0 ? <p>Nothing is blocked in this lesson.</p> : <ul className="blocked-list">{blocked.words.map(word => <li key={word.key}>
      <span className="blocked-term"><strong>{word.words}</strong>
        <small>{[word.removed > 0 && `${word.removed} taken down`, word.stopped > 0 ? `${word.stopped} ${word.stopped === 1 ? 'try' : 'tries'} stopped` : 'no tries yet'].filter(Boolean).join(' · ')}</small>
        {word.by.map(item => <button key={item.studentKey} type="button" className="blocked-who" onClick={() => onSelect(item.studentKey)} title="Open this student">
          {who(item.studentKey, item.name)}{item.count > 1 && <small>×{item.count}</small>}</button>)}
      </span>
      <button className="btn btn-secondary btn-sm" disabled={!open} onClick={() => void action('unblock', { key: word.key })}>Unblock</button>
    </li>)}</ul>}
    {blocked.before.length > 0 && <p className="blocked-before">Last lesson: {blocked.before.map(words => <q key={words}>{words}</q>)}
      <button className="btn btn-secondary btn-sm" disabled={!open || busy} onClick={() => void block(blocked.before)}>Block again</button></p>}
  </div>;
}
