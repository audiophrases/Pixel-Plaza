import { useEffect, useRef, useState } from 'react';
import type { QuestView } from '../../shared/campaign';
import './Journal.css';

type Props = {
  quest: QuestView;
  // What the last answer came to, so the student knows to wait or to think again.
  feedback: { objective: string; correct: boolean; wait: boolean } | null;
  onAnswer: (objective: string, choice: string) => void;
};

const PLACE_ICON: Record<string, string> = { hotel: '🏨', cafe: '☕', shop: '🛍️', square: '⛲', park: '🌳' };

// The student's side of the campaign, kept short and picture-led: who you are, what you know,
// and the one question to answer. It shows only what the server sent this student.
export default function Journal({ quest, feedback, onAnswer }: Props) {
  const [open, setOpen] = useState(true);
  const [fresh, setFresh] = useState(false); // something changed while the journal was shut
  const seen = useRef('');

  useEffect(() => {
    const now = JSON.stringify([quest.status, quest.chapter.index, quest.clues.length, quest.objectives.map(item => item.done)]);
    if (seen.current && seen.current !== now && !open) setFresh(true);
    seen.current = now;
  }, [quest, open]);

  return <aside className="journal glass-panel">
    <button type="button" className="journal-toggle" onClick={() => { setOpen(value => !value); setFresh(false); }}>
      🌰 {quest.chapter.title}{fresh ? ' · new!' : ''} <span>{open ? '▲' : '▼'}</span>
    </button>
    {open && <div className="journal-body">
      <div className="journal-role">
        <span className="journal-role-icon">{quest.role.icon}</span>
        <div><strong>{quest.role.name}</strong><br />{quest.role.card}</div>
      </div>

      {quest.status === 'active' && <p className="journal-intro">{quest.chapter.intro}</p>}

      <ul className="journal-clues">
        {quest.clues.map(clue => <li key={clue.id}>
          <span className="journal-clue-icon">{clue.from === 'job' ? '🔎' : PLACE_ICON[clue.from] ?? '📍'}</span>
          {clue.text}
        </li>)}
      </ul>

      {quest.status === 'active' && quest.objectives.map(objective => <div key={objective.id} className="journal-question">
        <h3>❓ {objective.text}</h3>
        {objective.done ? <p className="journal-right">✅ You got it! Help your classmates.</p> : <>
          <div className="journal-choices">
            {objective.choices.map(choice => <button key={choice.id} type="button" className="journal-choice"
              onClick={() => onAnswer(objective.id, choice.id)}>{choice.text}</button>)}
          </div>
          {feedback?.objective === objective.id && !feedback.correct &&
            <p className="journal-wrong">{feedback.wait ? '⏳ Wait a moment…' : '❌ Not yet. Ask your classmates!'}</p>}
        </>}
      </div>)}

      {quest.chapter.ending && <p className="journal-ending">{quest.chapter.ending}</p>}
      {quest.finale && <p className="journal-ending">{quest.finale}</p>}
    </div>}
  </aside>;
}
