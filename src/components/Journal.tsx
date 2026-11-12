import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AnswerFeedback, BoardView, QuestView } from '../../shared/campaign';
import { REPORT_MAX_LENGTH } from '../../shared/campaign';
import { AUTO_PICK_MS } from '../../shared/sideQuests';
import './Journal.css';
import { Investigation, WitnessInbox, type InvestigationTurn } from './Investigation';
import LanguageHelp from './LanguageHelp';
import EvidencePicture from './EvidencePicture';
import StoryText from './StoryText';
import { CastContext } from './castContext';
import StudentQuestBrowser from './StudentQuestBrowser';
import type { StudentChoicePage, StudentChoiceQuery } from '../../shared/studentChoice';

type Props = {
  quest: QuestView | null; // the mission, if one is running
  board: BoardView | null; // the quest board: the game's side quests and the mission's own
  // What the last answer came to, so the student knows to wait or to think again.
  feedback: AnswerFeedback | null;
  onAnswer: (objective: string, text: string) => void;
  onUndoReport?: (objective: string, version: number) => void;
  onSendAnyway?: (objective: string, version: number) => void; // send writing the checker asked to revise, after confirming
  onAccept?: (objective: string, changePartner?: boolean) => void;
  onLeave?: (objective: string) => void;
  onStart?: (objective: string) => void; // a waiting group starts with who is there
  onAuto?: () => void; // the game chooses a side quest for a student who has not
  onTurn?: (turn: InvestigationTurn) => void;
  library?: StudentChoicePage | null;
  libraryRevision?: number;
  onBrowse?: (query: StudentChoiceQuery & { requestId: string }) => boolean;
  onPick?: (id: string) => boolean;
  choicePaused?: boolean; // the challenge window waits (choosing a name, reconnecting) before opening by itself
  notice?: { text: string; at: number } | null; // the latest warning from the server, shown in the challenge window
};

const SOURCE: Record<string, string> = { job: 'Your clue', reward: 'New clue', news: 'News' };

// The checker asked for a revision, but the student is sure the report already does the task. A dialog asks the quest's
// own question first (or, without one, whether the report already does what the checker said); "No" is the default.
function SendAnyway({ question, feedback, shared, onSend }: { question?: string; feedback: string; shared: boolean; onSend: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => dialog.current?.close();
  return <div className="journal-send-anyway">Sure your report already does this?{' '}
    <button ref={trigger} type="button" className="journal-dismiss" onClick={() => dialog.current?.showModal()}>Send anyway</button>
    {createPortal(<dialog ref={dialog} className="send-anyway-dialog" aria-labelledby={id} onClose={() => trigger.current?.focus()}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
      <h2 id={id}>Are you sure you want to send it?</h2>
      <p>The checker said: “{feedback}”</p>
      <p className="send-anyway-question">{question ?? 'Does your report already do this?'}</p>
      <p className="send-anyway-note">{shared ? 'This finishes the quest for your whole group. ' : ''}Your teacher will see that you sent it anyway.</p>
      <div className="send-anyway-actions">
        <button type="button" autoFocus onClick={close}>No, I will check it</button>
        <button type="button" className="send-anyway-yes" onClick={() => { close(); onSend(); }}>Yes, send it</button>
      </div>
    </dialog>, document.body)}
  </div>;
}

// One question with its own answer box, so typing in one never lands in another.
function Question({ objective, feedback, onAnswer, onUndoReport, onSendAnyway, shared = false, closed = false, quest, onTurn, heading }: { objective: QuestView['objectives'][number]; feedback: Props['feedback']; onAnswer: Props['onAnswer']; onUndoReport?: Props['onUndoReport']; onSendAnyway?: Props['onSendAnyway']; shared?: boolean; closed?: boolean; quest: QuestView | null; onTurn: Props['onTurn']; heading?: string }) {
  const [typed, setTyped] = useState(objective.report?.text ?? '');
  const [hasDraft, setHasDraft] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const reportState = objective.report ? `${objective.report.version}:${objective.report.submitted}:${objective.report.check?.status}` : '';
  const [seenReport, setSeenReport] = useState(reportState);
  if (seenReport !== reportState) {
    setSeenReport(reportState);
    // Teammates receive the shared writing too. Preserve any unfinished draft they already had in this box.
    if (objective.report && (!hasDraft || !typed.trim())) { setTyped(objective.report.text); setHasDraft(false); }
    if (!objective.done && objective.report && !objective.report.submitted) setSubmitted(null);
  }
  const report = objective.kind === 'report';
  const check = objective.report?.check;
  const pending = report && !objective.done && !!objective.report?.submitted && !!check;
  // Only the writing the checker read can be sent anyway; changed writing is checked again.
  const mayInsist = !!onSendAnyway && check?.status === 'revise' && !!objective.report && !objective.report.submitted && typed.trim() === objective.report.text.trim();
  const rejected = feedback?.objective === objective.id && !feedback.correct && submitted === typed.trim();
  const feedbackId = `answer-feedback-${objective.id}`;
  return <section className={`journal-block journal-question${objective.optional ? ' journal-bonus' : ''}`}>
    <h3>{heading ?? (objective.optional ? 'Bonus question' : 'Question')}</h3>
    <p className="journal-ask"><StoryText text={objective.text} /></p>
    <LanguageHelp help={objective.help} answer />
    {objective.done ? <>
      <p className="journal-right">{report ? check?.status === 'sent' ? 'Quest complete. You sent it anyway, so your teacher will read it.' : check ? 'Quest complete.' : 'Sent to your teacher.' : 'Correct.'}</p>
      {check && check.status !== 'sent' && check.feedback !== 'Quest complete.' && <p className="journal-report-feedback" role="status">{check.feedback}</p>}
      {report && objective.report && <p className="journal-submitted-report">{objective.report.text}</p>}
      {report && objective.report?.submitted && onUndoReport && !closed && <>
        <button type="button" className="journal-dismiss" onClick={() => onUndoReport(objective.id, objective.report!.version)}>Undo submission</button>
        {shared && <p className="journal-undo-note">Reopens this report for everyone in your group, with the writing saved.</p>}
      </>}
    </> : closed ? <p>Your teacher ended this campaign.</p> : <>
      {objective.conversation && quest && <Investigation objective={objective.id} conversation={objective.conversation} interviews={quest.interviews ?? []} clues={quest.clues} onTurn={onTurn} />}
      {check && (objective.report?.submitted || check.status === 'revise') && <p className={`journal-report-feedback${check.status === 'revise' ? ' journal-wrong' : ''}`} role="status">{check.feedback}</p>}
      {pending && <>
        <p className="journal-submitted-report">{objective.report!.text}</p>
        {onUndoReport && <button type="button" className="journal-dismiss" onClick={() => onUndoReport(objective.id, objective.report!.version)}>Undo submission</button>}
      </>}
      {!pending && <form className="journal-answer" onSubmit={event => {
        event.preventDefault();
        if (!pending && typed.trim()) { setSubmitted(typed.trim()); setHasDraft(false); onAnswer(objective.id, typed.trim()); }
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
      </form>}
      {mayInsist && <SendAnyway question={objective.report!.confirm} feedback={check!.feedback} shared={shared}
        onSend={() => onSendAnyway!(objective.id, objective.report!.version)} />}
      {rejected && !pending && <p id={feedbackId} className="journal-wrong" role="status">{feedback.message || (feedback.wait
        ? 'Please wait a few seconds before trying again.' : report ? 'Write at least 5 words, then send your report again.'
          : objective.kind === 'name' ? 'That name was not accepted. Check the name shown above their avatar and try again.'
            : 'That answer was not accepted. Check the question and try again.')}</p>}
    </>}
  </section>;
}

// The student's side of the campaign, in short labelled blocks: the task, who you are, what you know, the questions,
// and the quest board. Without a campaign, only the quest board. It shows only what the server sent this student.
export default function Journal({ quest, board: boardView, feedback, onAnswer, onUndoReport, onSendAnyway, onAccept, onLeave, onStart, onAuto, onTurn, library, libraryRevision, onBrowse, onPick, choicePaused, notice }: Props) {
  const [open, setOpen] = useState(() => !!boardView?.studentChoice || window.innerHeight >= 700);
  const [fresh, setFresh] = useState(false); // something changed while the journal was shut
  const [recapSeen, setRecapSeen] = useState(false);
  const seen = useRef('');
  const studentChoice = !!boardView?.studentChoice;
  const active = !!boardView?.board.some(item => item.sideQuest && item.state === 'active' && !item.ended);
  const choosing = boardView?.sideQuests.state === 'choose' || (studentChoice && !active);
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
  const pastBoard = items.filter(item => item.state === 'done' || item.ended);
  const completed = quest?.objectives.filter(item => item.done) ?? [];
  const board = items.filter(item => item.state !== 'done' && !item.ended).sort((a, b) => joinable(b) - joinable(a));

  // A free student who has not chosen in a minute is placed by the game.
  useEffect(() => {
    if (!choosing || studentChoice) return;
    const timer = window.setTimeout(() => onAuto?.(), AUTO_PICK_MS);
    return () => window.clearTimeout(timer);
  }, [choosing, studentChoice, onAuto]);
  // A waiting group may start with who is there from `startAt`: show the button when that time comes.
  const [now, setNow] = useState(() => Date.now());
  const nextStart = items.map(item => item.group?.state === 'open' ? item.group.startAt : null).filter((at): at is number => at !== null && at > now).sort((a, b) => a - b)[0];
  useEffect(() => {
    if (nextStart === undefined) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, nextStart - Date.now()) + 100);
    return () => window.clearTimeout(timer);
  }, [nextStart]);

  const missionContent = quest && <>
      {quest.secret && <section className="journal-block journal-secret">
        <h3>Secret</h3>
        <p className="journal-role">{quest.secret.title}</p>
        <p><StoryText text={quest.secret.text} /></p>
        <LanguageHelp help={quest.secret.help} />
      </section>}

      {quest.recap && !recapSeen && <section className="journal-block journal-recap">
        <h3>Previously</h3>
        <p><StoryText text={quest.recap} /></p>
        <LanguageHelp help={quest.recapHelp} />
        <EvidencePicture image={quest.recapImage} text={quest.recap ?? ''} help={quest.recapHelp} />
        <button type="button" className="journal-dismiss" onClick={() => setRecapSeen(true)}>OK</button>
      </section>}

      {quest.endedEarly && <section className="journal-block journal-ending">
        <h3>The story ends here</h3>
        <p>Your teacher ended this story. Your Journal keeps what you found, and you keep your XP.</p>
      </section>}

      {quest.myTeam && <section className="journal-block journal-crew">
        <h3>Your team: {quest.myTeam.name}</h3>
        <ul className="journal-crew-list">{quest.myTeam.members.map(member => <li key={member.name} className={member.online ? undefined : 'journal-crew-away'}>
          <strong>{member.me ? `${member.name} (you)` : member.name}</strong> · {member.role}{!member.online && ' · not in the plaza'}
        </li>)}</ul>
        <ol className="journal-crew-steps"><li>Read your clue below.</li><li>Tell your team in the <b>🤝 team chat</b>.</li><li>Answer together: one answer counts for the whole team.</li></ol>
      </section>}

      {quest.team.total > 0 && <section className="journal-block journal-team">
        <h3>{quest.myTeam ? 'Your team’s progress' : 'Class progress'}</h3>
        <div className="journal-meter" role="progressbar" aria-valuemin={0} aria-valuemax={quest.team.total} aria-valuenow={quest.team.done}>
          <span style={{ width: `${Math.round(100 * quest.team.done / quest.team.total)}%` }} />
        </div>
        <p>{quest.team.done} of {quest.team.total} answers</p>
      </section>}

      {quest.status !== 'campaign_complete' && <section className="journal-block journal-task">
        <h3>Task</h3>
        <p><StoryText text={quest.chapter.intro} /></p>
        <LanguageHelp help={quest.chapter.help?.intro} />
        <EvidencePicture image={quest.chapter.introImage} text={quest.chapter.intro} help={quest.chapter.help?.intro} />
      </section>}

      {!!quest.cast?.length && <details className="journal-block journal-cast">
        <summary><h3>📖 Who’s who in the story</h3></summary>
        <p className="journal-cast-note">These are characters in the story, not your classmates.</p>
        <ul>{quest.cast.map(member => <li key={member.name}><span className="cast-name">📖 {member.name}</span> {member.about}</li>)}</ul>
      </details>}

      <section className="journal-block">
        <h3>You are</h3>
        <p className="journal-role">{quest.role.name}</p>
        <p><StoryText text={quest.role.card} /></p>
        <LanguageHelp help={quest.role.help} />
      </section>

      <section className="journal-block">
        <h3>What you know</h3>
        <ul className="journal-clues">
          {quest.clues.map(clue => <li key={clue.id}>
            <span className="journal-source">{clue.from === 'job' && clue.image ? 'Your picture · only you have it' : SOURCE[clue.from] ?? `Found: ${clue.from}`}</span>
            <StoryText text={clue.text} />
            <LanguageHelp help={clue.help} />
            <EvidencePicture image={clue.image} text={clue.text} help={clue.help} />
          </li>)}
        </ul>
      </section>

      {quest.status !== 'campaign_complete' && <WitnessInbox interviews={quest.interviews ?? []} clues={quest.clues} onTurn={onTurn} />}
      {main.filter(objective => ended || !objective.done).map(objective => <Question key={objective.id} objective={objective} feedback={feedback} onAnswer={onAnswer} onUndoReport={onUndoReport} onSendAnyway={onSendAnyway} closed={ended} quest={quest} onTurn={onTurn} />)}

      {quest.thieves && quest.thieves.length > 0 && <section className="journal-block journal-ending">
        <h3>{quest.thieves.length === 1 ? 'The thief was' : 'The thieves were'}</h3>
        <p className="journal-role">{quest.thieves.join(' and ')}</p>
      </section>}

      {quest.chapter.ending && <section className="journal-block journal-ending">
        <h3>{quest.status === 'chapter_complete' ? 'The class is ready to advance' : 'Chapter complete'}</h3>
        {quest.status === 'chapter_complete' && <p>{quest.autoNextAt ? 'The next chapter starts by itself in a few minutes. You can keep working until then.' : 'You can keep working until your teacher starts the next chapter.'}</p>}
        <p><StoryText text={quest.chapter.ending} /></p>
        <LanguageHelp help={quest.chapter.help?.ending} />
        <EvidencePicture image={quest.chapter.endingImage} text={quest.chapter.ending ?? ''} help={quest.chapter.help?.ending} />
      </section>}

      {bonus.filter(objective => ended || !objective.done).map(objective => <Question key={objective.id} objective={objective} feedback={feedback} onAnswer={onAnswer} onUndoReport={onUndoReport} onSendAnyway={onSendAnyway} closed={ended} quest={quest} onTurn={onTurn} />)}
      </>;

  return <CastContext.Provider value={quest?.cast ?? []}><aside className="journal glass-panel">
    <button type="button" className="journal-toggle" onClick={() => { setOpen(value => !value); setFresh(false); }}>
      <span>{!ended && quest ? quest.chapter.title : 'Current tasks'}{fresh && <b className="journal-new">NEW</b>}</span>
      <span>{open ? '▲' : '▼'}</span>
    </button>
    {open && <div className={`journal-body${studentChoice ? ' journal-student-choice' : ''}`}>
      {studentChoice && onBrowse && onPick && <StudentQuestBrowser result={library ?? null} active={active}
        refreshKey={JSON.stringify([libraryRevision, boardView])} onBrowse={onBrowse} onPick={onPick}
        paused={choicePaused} notice={notice} />}
      {!ended && missionContent}

      {(!!board.length || (!studentChoice && !ended)) && <section className={`journal-block journal-board${choosing ? ' journal-choosing' : ''}`}><h3>{quest ? 'Quest board' : 'Your side quests'}</h3>
        <p>Do one side quest at a time; each is yours to do once.</p>
        {side?.state === 'open' && <p className="journal-board-card">You can take a side quest now, or when you finish your other work.</p>}
        {choosing && !studentChoice && <p className="journal-board-card journal-choose"><strong>Choose a side quest.</strong> Accept one quest below; classmates waiting for a partner come first. If you have not chosen in a minute, the game chooses for you.</p>}
        {side?.state === 'empty' && !otherBoard && !studentChoice && <p className="journal-board-card">{side.reason} You can help classmates while you wait.</p>}
        {!items.length && !side && <p className="journal-board-card">No optional quests are available right now. Your teacher can add activities. You can continue any tasks above while you wait.</p>}
        {board.map(item => <article key={item.id} className="journal-board-card">
          {item.state === 'active' || item.state === 'done' ? <>
            {item.partner && <p className="journal-partner">Your partner: <strong>{item.partner.name}</strong>{!item.partner.online && ' · away from the plaza'}
              {!item.partner.online && item.state === 'active' && !item.ended && <button className="journal-choice" onClick={() => onAccept?.(item.id, true)}>Find another partner</button>}</p>}
            {item.activity && <p>Exchange evidence with your partner, then write what you learned. Your teacher will read the report.</p>}
            {item.group && <p className="journal-partner">Your {item.group.size === 2 ? 'pair' : 'group'}: <strong>{item.group.members.join(', ')}</strong>
              {item.group.state === 'open' ? ` · waiting for ${item.group.size - item.group.members.length} more` : '. Use chat to work it out together. One answer counts for everyone.'}
              {item.group.state === 'open' && item.group.startAt !== null && item.group.startAt <= now && <button className="journal-choice" onClick={() => onStart?.(item.id)}>Start with who&rsquo;s here</button>}</p>}
            {item.group?.state === 'open' && item.state === 'active' ? <><p className="journal-ask">{item.text}</p><LanguageHelp help={item.help} answer /></>
              : <Question objective={{ id: item.id, text: item.text, help: item.help, kind: item.kind, optional: true, done: item.state === 'done', conversation: item.conversation, report: item.report }} feedback={feedback} onAnswer={onAnswer} onUndoReport={onUndoReport} onSendAnyway={onSendAnyway} closed={!!item.ended} quest={quest} onTurn={onTurn} heading={item.sideQuest ? 'Side quest' : undefined} shared={!!item.group} />}
            {item.sideQuest && item.state === 'active' && !item.ended && <button type="button" className="journal-dismiss" onClick={() => {
              if (window.confirm('Leave this quest and choose another?')) onLeave?.(item.id);
            }}>Leave this quest and choose another</button>}
          </> : <><p className="journal-ask">{item.text}</p><LanguageHelp help={item.help} answer />{item.activity && <p>{item.activity === 'interview' ? 'Interview a classmate' : 'Exchange information with a classmate'}</p>}
            {item.reason && <p>{item.reason}</p>}<button className="journal-choice" disabled={item.state !== 'available'} onClick={() => onAccept?.(item.id)}>{item.joining?.length ? `Join ${item.joining.join(', ')}` : 'Accept quest'}</button></>}
        </article>)}
      </section>}
      {(ended || completed.length > 0 || pastBoard.length > 0) && <details className="journal-history">
        <summary>Completed tasks &amp; past missions</summary>
        {ended ? missionContent : completed.map(objective => <Question key={objective.id} objective={objective} feedback={feedback} onAnswer={onAnswer} onUndoReport={onUndoReport} quest={quest} onTurn={onTurn} />)}
        {pastBoard.map(item => <article key={item.id} className="journal-board-card">
          {item.ended && <p>Ended by your teacher</p>}
          <Question objective={{ ...item, optional: true, done: item.state === 'done' }} feedback={feedback} onAnswer={onAnswer} onUndoReport={onUndoReport} closed={!!item.ended} quest={quest} onTurn={onTurn} heading="Side quest" shared={!!item.group} />
        </article>)}
      {quest?.finale && <section className="journal-block journal-ending"><p><StoryText text={quest.finale} /></p><LanguageHelp help={quest.finaleHelp} /></section>}
      </details>}
    </div>}
  </aside></CastContext.Provider>;
}
