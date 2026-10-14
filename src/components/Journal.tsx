import { useEffect, useRef, useState } from 'react';
import type { QuestView } from '../../shared/campaign';
import { REPORT_MAX_LENGTH } from '../../shared/campaign';
import './Journal.css';
import { Investigation, WitnessInbox, type InvestigationTurn } from './Investigation';

type Props = {
  quest: QuestView;
  // What the last answer came to, so the student knows to wait or to think again.
  feedback: { objective: string; correct: boolean; wait: boolean } | null;
  onAnswer: (objective: string, text: string) => void;
  onAccept?: (objective: string, changePartner?: boolean) => void;
  onTurn?: (turn: InvestigationTurn) => void;
};

const SOURCE: Record<string, string> = { job: 'Your clue', reward: 'New clue', news: 'News' };

// One question with its own answer box, so typing in one never lands in another.
function Question({ objective, feedback, onAnswer, closed = false, quest, onTurn }: { objective: QuestView['objectives'][number]; feedback: Props['feedback']; onAnswer: Props['onAnswer']; closed?: boolean; quest: QuestView; onTurn: Props['onTurn'] }) {
  const [typed, setTyped] = useState('');
  const report = objective.kind === 'report';
  return <section className={`journal-block journal-question${objective.optional ? ' journal-bonus' : ''}`}>
    <h3>{objective.optional ? 'Bonus question' : 'Question'}</h3>
    <p className="journal-ask">{objective.text}</p>
    {objective.done ? <p className="journal-right">{report ? 'Sent to your teacher.' : 'Correct.'}</p> : closed ? <p>Your teacher ended this campaign.</p> : <>
      {objective.conversation && <Investigation objective={objective.id} conversation={objective.conversation} interviews={quest.interviews ?? []} clues={quest.clues} onTurn={onTurn} />}
      <form className="journal-answer" onSubmit={event => {
        event.preventDefault();
        if (typed.trim()) { onAnswer(objective.id, typed.trim()); setTyped(''); }
      }}>
        {report ? <textarea value={typed} maxLength={REPORT_MAX_LENGTH} rows={4}
          placeholder="Write your evidence and decision in English"
          aria-label="Your report" onChange={event => setTyped(event.target.value)} /> :
          <input value={typed} maxLength={80} autoComplete="off"
            placeholder={objective.kind === 'name' ? 'Type their name' : 'Type your answer in English'}
            aria-label="Your answer" onChange={event => setTyped(event.target.value)} />}
        <button className="journal-choice" disabled={!typed.trim() || (!!objective.conversation && objective.conversation.completed < objective.conversation.required)}>{report ? 'Send report' : 'Answer'}</button>
      </form>
      {feedback?.objective === objective.id && !feedback.correct &&
        <p className="journal-wrong">{feedback.wait ? 'Wait a moment.' : report ? 'Write a little more.' : 'Not yet. Ask your classmates.'}</p>}
    </>}
  </section>;
}

// The student's side of the campaign, in short labelled blocks: the task, who you are, what
// you know, and the questions. It shows only what the server sent this student.
export default function Journal({ quest, feedback, onAnswer, onAccept, onTurn }: Props) {
  const [open, setOpen] = useState(() => window.innerHeight >= 700); // shut at first on a short screen, where it would cover the map
  const [fresh, setFresh] = useState(false); // something changed while the journal was shut
  const [recapSeen, setRecapSeen] = useState(false);
  const seen = useRef('');

  useEffect(() => {
    const now = JSON.stringify([quest.status, quest.chapter.index, quest.clues.length, quest.objectives, quest.board, quest.interviews]);
    if (seen.current && seen.current !== now && !open) setFresh(true);
    seen.current = now;
  }, [quest, open]);

  const main = quest.objectives.filter(item => !item.optional);
  const bonus = quest.objectives.filter(item => item.optional);

  return <aside className="journal glass-panel">
    <button type="button" className="journal-toggle" onClick={() => { setOpen(value => !value); setFresh(false); }}>
      <span>{quest.chapter.title}{fresh && <b className="journal-new">NEW</b>}</span>
      <span>{open ? '▲' : '▼'}</span>
    </button>
    {open && <div className="journal-body">
      {quest.secret && <section className="journal-block journal-secret">
        <h3>Secret</h3>
        <p className="journal-role">{quest.secret.title}</p>
        <p>{quest.secret.text}</p>
      </section>}

      {quest.recap && !recapSeen && <section className="journal-block journal-recap">
        <h3>Previously</h3>
        <p>{quest.recap}</p>
        <button type="button" className="journal-dismiss" onClick={() => setRecapSeen(true)}>OK</button>
      </section>}

      {quest.team.total > 0 && <section className="journal-block journal-team">
        <h3>Class progress</h3>
        <div className="journal-meter" role="progressbar" aria-valuemin={0} aria-valuemax={quest.team.total} aria-valuenow={quest.team.done}>
          <span style={{ width: `${Math.round(100 * quest.team.done / quest.team.total)}%` }} />
        </div>
        <p>{quest.team.done} of {quest.team.total} answers</p>
      </section>}

      {quest.status !== 'campaign_complete' && <section className="journal-block journal-task">
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
            <span className="journal-source">{SOURCE[clue.from] ?? `Found: ${clue.from}`}</span>
            {clue.text}
          </li>)}
        </ul>
      </section>

      {quest.status !== 'campaign_complete' && <WitnessInbox interviews={quest.interviews ?? []} clues={quest.clues} onTurn={onTurn} />}
      {main.map(objective => <Question key={objective.id} objective={objective} feedback={feedback} onAnswer={onAnswer} quest={quest} onTurn={onTurn} />)}

      {quest.thieves && quest.thieves.length > 0 && <section className="journal-block journal-ending">
        <h3>{quest.thieves.length === 1 ? 'The thief was' : 'The thieves were'}</h3>
        <p className="journal-role">{quest.thieves.join(' and ')}</p>
      </section>}

      {quest.chapter.ending && <section className="journal-block journal-ending">
        <h3>{quest.status === 'chapter_complete' ? 'The class is ready to advance' : 'Chapter complete'}</h3>
        {quest.status === 'chapter_complete' && <p>You can keep working until your teacher starts the next chapter.</p>}
        <p>{quest.chapter.ending}</p>
      </section>}

      {bonus.map(objective => <Question key={objective.id} objective={objective} feedback={feedback} onAnswer={onAnswer} closed={quest.status === 'campaign_complete'} quest={quest} onTurn={onTurn} />)}
      {!!quest.board?.length && <section className="journal-block journal-board"><h3>Quest board</h3><p>Choose your next mystery. Each quest is yours to do once.</p>
        {quest.board.map(item => <article key={item.id} className="journal-board-card">
          {item.state === 'active' || item.state === 'done' ? <>
            {item.partner && <p className="journal-partner">Your partner: <strong>{item.partner.name}</strong>{!item.partner.online && ' · away from the plaza'}
              {!item.partner.online && item.state === 'active' && quest.status !== 'campaign_complete' && <button className="journal-choice" onClick={() => onAccept?.(item.id, true)}>Find another partner</button>}</p>}
            {item.activity && <p>Exchange evidence with your partner, then write what you learned. Your teacher will read the report.</p>}
            <Question objective={{ id: item.id, text: item.text, kind: item.kind, optional: true, done: item.state === 'done', conversation: item.conversation }} feedback={feedback} onAnswer={onAnswer} closed={quest.status === 'campaign_complete'} quest={quest} onTurn={onTurn} />
          </> : <><p className="journal-ask">{item.text}</p>{item.activity && <p>{item.activity === 'interview' ? 'Interview a classmate' : 'Exchange information with a classmate'}</p>}
            {item.reason && <p>{item.reason}</p>}<button className="journal-choice" disabled={item.state !== 'available'} onClick={() => onAccept?.(item.id)}>Accept quest</button></>}
        </article>)}
      </section>}
      {quest.finale && <section className="journal-block journal-ending"><p>{quest.finale}</p></section>}
    </div>}
  </aside>;
}
