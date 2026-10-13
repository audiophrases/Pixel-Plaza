import { useEffect, useRef, useState } from 'react';
import type { QuestView } from '../../shared/campaign';
import './Journal.css';

type Props = {
  quest: QuestView;
  // What the last answer came to, so the student knows to wait or to think again.
  feedback: { objective: string; correct: boolean; wait: boolean } | null;
  onAnswer: (objective: string, choice: string) => void;
};

// The student's side of the campaign: their job, what they have found, and the question to answer.
// It shows only what the server sent this student; the other roles' clues never arrive.
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
      Journal{fresh ? ' · new' : ''} {open ? '▲' : '▼'}
    </button>
    {open && <div className="journal-body">
      <h2>{quest.campaign.title}</h2>
      <p className="journal-chapter">Chapter {quest.chapter.index + 1} of {quest.chapter.of}: {quest.chapter.title}</p>
      <p>{quest.chapter.intro}</p>

      <h3>You are the {quest.role.name}</h3>
      <p>{quest.role.card}</p>

      <h3>What you know</h3>
      <ul className="journal-clues">
        {quest.clues.map(clue => <li key={clue.id}><span>{clue.from}</span> {clue.text}</li>)}
      </ul>

      {quest.status === 'active' && quest.objectives.map(objective => <div key={objective.id} className="journal-question">
        <h3>{objective.text}</h3>
        {objective.done ? <p className="journal-right">✓ You got it. Help your classmates!</p> : <>
          <div className="journal-choices">
            {objective.choices.map(choice => <button key={choice.id} type="button" className="spelling-fix"
              onClick={() => onAnswer(objective.id, choice.id)}>{choice.text}</button>)}
          </div>
          {feedback?.objective === objective.id && !feedback.correct &&
            <p className="journal-wrong">{feedback.wait ? 'Wait a moment, then try again.' : 'Not quite. Ask your classmates, then try again in a few seconds.'}</p>}
        </>}
      </div>)}

      {quest.chapter.ending && <p className="journal-ending">{quest.chapter.ending}</p>}
      {quest.finale && <p className="journal-ending">{quest.finale}</p>}
    </div>}
  </aside>;
}
