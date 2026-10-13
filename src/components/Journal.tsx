import { useEffect, useRef, useState } from 'react';
import type { QuestView } from '../../shared/campaign';
import './Journal.css';

type Props = {
  quest: QuestView;
  // What the last answer came to, so the student knows to wait or to think again.
  feedback: { objective: string; correct: boolean; wait: boolean } | null;
  onAnswer: (objective: string, text: string) => void;
};

// The student's side of the campaign, in short labelled blocks: the task, who you are, what
// you know, and the question. It shows only what the server sent this student.
export default function Journal({ quest, feedback, onAnswer }: Props) {
  const [open, setOpen] = useState(true);
  const [fresh, setFresh] = useState(false); // something changed while the journal was shut
  const seen = useRef('');
  const [typed, setTyped] = useState('');

  useEffect(() => {
    const now = JSON.stringify([quest.status, quest.chapter.index, quest.clues.length, quest.objectives.map(item => item.done)]);
    if (seen.current && seen.current !== now && !open) setFresh(true);
    seen.current = now;
  }, [quest, open]);

  return <aside className="journal glass-panel">
    <button type="button" className="journal-toggle" onClick={() => { setOpen(value => !value); setFresh(false); }}>
      <span>{quest.chapter.title}{fresh && <b className="journal-new">NEW</b>}</span>
      <span>{open ? '▲' : '▼'}</span>
    </button>
    {open && <div className="journal-body">
      {quest.status === 'active' && <section className="journal-block journal-task">
        <h3>Task</h3>
        <p>{quest.chapter.intro}</p>
      </section>}

      <section className="journal-block">
        <h3>You are</h3>
        <p className="journal-role">{quest.role.name}</p>
        <p>{quest.role.card}</p>
      </section>

      <section className="journal-block">
        <h3>What you know</h3>
        <ul className="journal-clues">
          {quest.clues.map(clue => <li key={clue.id}>
            <span className="journal-source">{clue.from === 'job' ? 'Your clue' : `Found: ${clue.from}`}</span>
            {clue.text}
          </li>)}
        </ul>
      </section>

      {quest.status === 'active' && quest.objectives.map(objective => <section key={objective.id} className="journal-block journal-question">
        <h3>Question</h3>
        <p className="journal-ask">{objective.text}</p>
        {objective.done ? <p className="journal-right">Correct. Help your classmates.</p> : <>
          <form className="journal-answer" onSubmit={event => {
            event.preventDefault();
            if (typed.trim()) { onAnswer(objective.id, typed.trim()); setTyped(''); }
          }}>
            <input value={typed} maxLength={80} placeholder="Type your answer in English" autoComplete="off"
              aria-label="Your answer" onChange={event => setTyped(event.target.value)} />
            <button className="journal-choice" disabled={!typed.trim()}>Answer</button>
          </form>
          {feedback?.objective === objective.id && !feedback.correct &&
            <p className="journal-wrong">{feedback.wait ? 'Wait a moment.' : 'Not yet. Ask your classmates.'}</p>}
        </>}
      </section>)}

      {quest.chapter.ending && <section className="journal-block journal-ending">
        <h3>Chapter complete</h3>
        <p>{quest.chapter.ending}</p>
      </section>}
      {quest.finale && <section className="journal-block journal-ending"><p>{quest.finale}</p></section>}
    </div>}
  </aside>;
}
