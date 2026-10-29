import { useEffect, useRef, useState } from 'react';
import type { AnswerFeedback, BoardView, QuestView } from '../../shared/campaign';
import { REPORT_MAX_LENGTH } from '../../shared/campaign';
import { AUTO_PICK_MS } from '../../shared/sideQuests';
import './Journal.css';
import { Investigation, WitnessInbox, type InvestigationTurn } from './Investigation';

type Props = {
  quest: QuestView | null; // the mission, if one is running
  board: BoardView | null; // the quest board: the game's side quests and the mission's own
  // What the last answer came to, so the student knows to wait or to think again.
  feedback: AnswerFeedback | null;
  onAnswer: (objective: string, text: string) => void;
  onUndoReport?: (objective: string, version: number) => void;
  onAccept?: (objective: string, changePartner?: boolean) => void;
  onLeave?: (objective: string) => void;
  onStart?: (objective: string) => void; // a waiting group starts with who is there
  onAuto?: () => void; // the game chooses a side quest for a student who has not
  onTurn?: (turn: InvestigationTurn) => void;
};

const SOURCE: Record<string, string> = { job: 'Your clue', reward: 'New clue', news: 'News' };

// One question with its own answer box, so typing in one never lands in another.
function Question({ objective, feedback, onAnswer, onUndoReport, shared = false, closed = false, quest, onTurn, heading }: { objective: QuestView['objectives'][number]; feedback: Props['feedback']; onAnswer: Props['onAnswer']; onUndoReport?: Props['onUndoReport']; shared?: boolean; closed?: boolean; quest: QuestView | null; onTurn: Props['onTurn']; heading?: string }) {
  const [typed, setTyped] = useState(objective.report?.text ?? '');
  const [hasDraft, setHasDraft] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const reportState = objective.report ? `${objective.report.version}:${objective.report.submitted}` : '';
  const [seenReport, setSeenReport] = useState(reportState);
  if (seenReport !== reportState) {
    setSeenReport(reportState);
    // Teammates receive the shared writing too. Preserve any unfinished draft they already had in this box.
    if (objective.report && (!hasDraft || !typed.trim())) { setTyped(objective.report.text); setHasDraft(false); }
    if (!objective.done && objective.report && !objective.report.submitted) setSubmitted(null);
  }
  const report = objective.kind === 'report';
  const rejected = feedback?.objective === objective.id && !feedback.correct && submitted === typed.trim();
  const feedbackId = `answer-feedback-${objective.id}`;
  return <section className={`journal-block journal-question${objective.optional ? ' journal-bonus' : ''}`}>
    <h3>{heading ?? (objective.optional ? 'Bonus question' : 'Question')}</h3>
    <p className="journal-ask">{objective.text}</p>
    {objective.done ? <>
      <p className="journal-right">{report ? 'Sent to your teacher.' : 'Correct.'}</p>
      {report && objective.report && <p className="journal-submitted-report">{objective.report.text}</p>}
      {report && objective.report?.submitted && onUndoReport && !closed && <>
        <button type="button" className="journal-dismiss" onClick={() => onUndoReport(objective.id, objective.report!.version)}>Undo submission</button>
        {shared && <p className="journal-undo-note">Reopens this report for everyone in your group, with the writing saved.</p>}
      </>}
    </> : closed ? <p>Your teacher ended this campaign.</p> : <>
      {objective.conversation && quest && <Investigation objective={objective.id} conversation={objective.conversation} interviews={quest.interviews ?? []} clues={quest.clues} onTurn={onTurn} />}
      <form className="journal-answer" onSubmit={event => {
        event.preventDefault();
        if (typed.trim()) { setSubmitted(typed.trim()); setHasDraft(false); onAnswer(objective.id, typed.trim()); }
      }}>
        {report ? <textarea value={typed} maxLength={REPORT_MAX_LENGTH} rows={4}
          placeholder="Write your evidence and decision in English"
          aria-describedby={rejected ? feedbackId : undefined}
          aria-label="Your report" onChange={event => { setTyped(event.target.value); setHasDraft(true); }} /> :
          <input value={typed} maxLength={80} autoComplete="off"
            placeholder={objective.kind === 'name' ? 'Type their name' : 'Type your answer in English'}
            aria-describedby={rejected ? feedbackId : undefined}
            aria-label="Your answer" onChange={event => { setTyped(event.target.value); setHasDraft(true); }} />}
        <button className="journal-choice" disabled={!typed.trim() || (!!objective.conversation && objective.conversation.completed < objective.conversation.required)}>{report ? 'Send report' : 'Answer'}</button>
      </form>
      {rejected && <p id={feedbackId} className="journal-wrong" role="status">{feedback.message || (feedback.wait
        ? 'Please wait a few seconds before trying again.' : report ? 'Write at least 5 words, then send your report again.'
          : objective.kind === 'name' ? 'That name was not accepted. Check the name shown above their avatar and try again.'
            : 'That answer was not accepted. Check the question and try again.')}</p>}
    </>}
  </section>;
}

// The student's side of the campaign, in short labelled blocks: the task, who you are, what you know, the questions,
// and the quest board. Without a campaign, only the quest board. It shows only what the server sent this student.
export default function Journal({ quest, board: boardView, feedback, onAnswer, onUndoReport, onAccept, onLeave, onStart, onAuto, onTurn }: Props) {
  const [open, setOpen] = useState(() => window.innerHeight >= 700); // shut at first on a short screen, where it would cover the map
  const [fresh, setFresh] = useState(false); // something changed while the journal was shut
  const [recapSeen, setRecapSeen] = useState(false);
  const seen = useRef('');
  const choosing = boardView?.sideQuests.state === 'choose';
  // Free for a side quest: the journal opens at the choice.
  const [wasChoosing, setWasChoosing] = useState(choosing);
  if (choosing !== wasChoosing) { setWasChoosing(choosing); if (choosing) { setOpen(true); setFresh(false); } }

  useEffect(() => {
    const now = JSON.stringify([quest?.status, quest?.chapter.index, quest?.clues.length, quest?.objectives, boardView?.board, quest?.interviews]);
    if (seen.current && seen.current !== now && !open) setFresh(true);
    seen.current = now;
  }, [quest, boardView, open]);

  const main = quest?.objectives.filter(item => !item.optional) ?? [];
  const bonus = quest?.objectives.filter(item => item.optional) ?? [];
  const side = boardView?.sideQuests;
  const items = boardView?.board ?? [];
  const otherBoard = items.some(item => !item.sideQuest);
  const ended = quest?.status === 'campaign_complete';
  // Classmates waiting for a partner come first.
  const joinable = (item: BoardView['board'][number]) => Number(item.state === 'available' && !!item.joining?.length);
  const board = [...items].sort((a, b) => joinable(b) - joinable(a));

  // A free student who has not chosen in a minute is placed by the game.
  useEffect(() => {
    if (!choosing) return;
    const timer = window.setTimeout(() => onAuto?.(), AUTO_PICK_MS);
    return () => window.clearTimeout(timer);
  }, [choosing, onAuto]);
  // A waiting group may start with who is there from `startAt`: show the button when that time comes.
  const [now, setNow] = useState(() => Date.now());
  const nextStart = items.map(item => item.group?.state === 'open' ? item.group.startAt : null).filter((at): at is number => at !== null && at > now).sort((a, b) => a - b)[0];
  useEffect(() => {
    if (nextStart === undefined) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, nextStart - Date.now()) + 100);
    return () => window.clearTimeout(timer);
  }, [nextStart]);

  return <aside className="journal glass-panel">
    <button type="button" className="journal-toggle" onClick={() => { setOpen(value => !value); setFresh(false); }}>
      <span>{quest?.chapter.title ?? 'Side quests'}{fresh && <b className="journal-new">NEW</b>}</span>
      <span>{open ? '▲' : '▼'}</span>
    </button>
    {open && <div className="journal-body">
      {quest && <>
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
      {main.map(objective => <Question key={objective.id} objective={objective} feedback={feedback} onAnswer={onAnswer} onUndoReport={onUndoReport} quest={quest} onTurn={onTurn} />)}

      {quest.thieves && quest.thieves.length > 0 && <section className="journal-block journal-ending">
        <h3>{quest.thieves.length === 1 ? 'The thief was' : 'The thieves were'}</h3>
        <p className="journal-role">{quest.thieves.join(' and ')}</p>
      </section>}

      {quest.chapter.ending && <section className="journal-block journal-ending">
        <h3>{quest.status === 'chapter_complete' ? 'The class is ready to advance' : 'Chapter complete'}</h3>
        {quest.status === 'chapter_complete' && <p>You can keep working until your teacher starts the next chapter.</p>}
        <p>{quest.chapter.ending}</p>
      </section>}

      {bonus.map(objective => <Question key={objective.id} objective={objective} feedback={feedback} onAnswer={onAnswer} onUndoReport={onUndoReport} closed={ended} quest={quest} onTurn={onTurn} />)}
      </>}
      {(!ended || !!items.length) && <section className={`journal-block journal-board${choosing ? ' journal-choosing' : ''}`}><h3>{quest ? 'Quest board' : 'Your side quests'}</h3>
        <p>Do one side quest at a time; each is yours to do once.</p>
        {side?.state === 'open' && <p className="journal-board-card">You can take a side quest now, or when you finish your other work.</p>}
        {choosing && <p className="journal-board-card journal-choose"><strong>Choose a side quest.</strong> Accept one quest below; classmates waiting for a partner come first. If you have not chosen in a minute, the game chooses for you.</p>}
        {side?.state === 'empty' && !otherBoard && <p className="journal-board-card">{side.reason} You can help classmates while you wait.</p>}
        {!items.length && !side && <p className="journal-board-card">No optional quests are available right now. Your teacher can add activities. You can continue any tasks above while you wait.</p>}
        {board.map(item => <article key={item.id} className="journal-board-card">
          {item.state === 'active' || item.state === 'done' ? <>
            {item.partner && <p className="journal-partner">Your partner: <strong>{item.partner.name}</strong>{!item.partner.online && ' · away from the plaza'}
              {!item.partner.online && item.state === 'active' && !item.ended && <button className="journal-choice" onClick={() => onAccept?.(item.id, true)}>Find another partner</button>}</p>}
            {item.activity && <p>Exchange evidence with your partner, then write what you learned. Your teacher will read the report.</p>}
            {item.group && <p className="journal-partner">Your {item.group.size === 2 ? 'pair' : 'group'}: <strong>{item.group.members.join(', ')}</strong>
              {item.group.state === 'open' ? ` · waiting for ${item.group.size - item.group.members.length} more` : '. One answer counts for everyone; work it out together.'}
              {item.group.state === 'open' && item.group.startAt !== null && item.group.startAt <= now && <button className="journal-choice" onClick={() => onStart?.(item.id)}>Start with who&rsquo;s here</button>}</p>}
            {item.group?.state === 'open' && item.state === 'active' ? <p className="journal-ask">{item.text}</p>
              : <Question objective={{ id: item.id, text: item.text, kind: item.kind, optional: true, done: item.state === 'done', conversation: item.conversation, report: item.report }} feedback={feedback} onAnswer={onAnswer} onUndoReport={onUndoReport} closed={!!item.ended} quest={quest} onTurn={onTurn} heading={item.sideQuest ? 'Side quest' : undefined} shared={!!item.group} />}
            {item.sideQuest && item.state === 'active' && !item.ended && <button type="button" className="journal-dismiss" onClick={() => onLeave?.(item.id)}>Leave this quest and choose another</button>}
          </> : <><p className="journal-ask">{item.text}</p>{item.activity && <p>{item.activity === 'interview' ? 'Interview a classmate' : 'Exchange information with a classmate'}</p>}
            {item.reason && <p>{item.reason}</p>}<button className="journal-choice" disabled={item.state !== 'available'} onClick={() => onAccept?.(item.id)}>{item.joining?.length ? `Join ${item.joining.join(', ')}` : 'Accept quest'}</button></>}
        </article>)}
      </section>}
      {quest?.finale && <section className="journal-block journal-ending"><p>{quest.finale}</p></section>}
    </div>}
  </aside>;
}
