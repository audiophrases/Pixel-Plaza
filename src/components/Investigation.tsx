import { useState } from 'react';
import type { ConversationView, InterviewView, QuestView } from '../../shared/campaign';

export type InvestigationTurn =
  | { t: 'interview-ask'; objective: string; witness: string; clue: string; text: string }
  | { t: 'interview-reply'; id: string; clue: string; text: string };
type Props = { clues: QuestView['clues']; onTurn?: (turn: InvestigationTurn) => void };

function EvidenceMessage({ clues, onSend, label, disabled = false }: Props & { onSend: (clue: string, text: string) => void; label: string; disabled?: boolean }) {
  const [text, setText] = useState('');
  const [clue, setClue] = useState('');
  const privateClues = clues.filter(c => c.from === 'job' || c.from === 'reward');
  const chosen = privateClues.some(c => c.id === clue) ? clue : privateClues.at(-1)?.id ?? '';
  return <form className="journal-evidence-form" onSubmit={event => {
    event.preventDefault();
    if (chosen && text.trim()) onSend(chosen, text.trim());
  }}>
    <label>Your evidence to share<select value={chosen} onChange={event => setClue(event.target.value)}>
      {privateClues.map(c => <option key={c.id} value={c.id}>{c.text}</option>)}
    </select></label>
    <label>{label}<textarea maxLength={200} rows={3} value={text} onChange={event => setText(event.target.value)} required /></label>
    <button type="submit" disabled={disabled || !chosen || !text.trim()}>Send for teacher approval</button>
  </form>;
}

function Transcript({ interview }: { interview: InterviewView }) {
  return <article className="journal-transcript">
    <p><strong>{interview.incoming ? 'Question from' : 'Witness:'} {interview.name}</strong></p>
    <p>{interview.question} <small>({interview.questionStatus})</small></p>
    {interview.shared && <p>Evidence shared with the question: {interview.shared}</p>}
    {interview.answer && <p>Reply: {interview.answer}</p>}
    {interview.evidence && <p>Witness evidence: {interview.evidence}</p>}
    {interview.answerStatus && <small>Reply {interview.answerStatus}</small>}
  </article>;
}

export function Investigation({ objective, conversation, interviews, clues, onTurn }: Props & {
  objective: string; conversation: ConversationView; interviews: InterviewView[];
}) {
  const [witness, setWitness] = useState('');
  const records = interviews.filter(i => !i.incoming && i.objective === objective);
  const peers = conversation.witnesses.filter(p => !records.some(i => i.name === p.name && (i.questionStatus === 'approved' || i.questionStatus === 'pending')));
  const selected = peers.some(p => p.id === witness) ? witness : peers[0]?.id ?? '';
  return <div className="journal-investigation">
    <p><strong>Witness evidence: {conversation.completed} of {conversation.required}</strong></p>
    <p>Ask about this question and compare your private clues. Your teacher approves the question and reply before you can submit a conclusion.</p>
    {records.map(interview => <Transcript key={interview.id} interview={interview} />)}
    {conversation.completed < conversation.required && <>
      {peers.length ? <>
        <label>Choose a witness<select value={selected} onChange={event => setWitness(event.target.value)}>
          {peers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
        <EvidenceMessage key={selected} clues={clues} label="Your question about this mystery" disabled={!onTurn}
          onSend={(clue, text) => onTurn?.({ t: 'interview-ask', objective, witness: selected, clue, text })} />
      </> : <p>Waiting for a classmate or an approved reply. You can help by answering questions below.</p>}
    </>}
  </div>;
}

export function WitnessInbox({ interviews, clues, onTurn }: Props & { interviews: InterviewView[] }) {
  const incoming = interviews.filter(i => i.incoming);
  if (!incoming.length) return null;
  return <section className="journal-block"><h3>Classmates need your evidence</h3>
    {incoming.map(interview => <div key={interview.id} className="journal-investigation">
      <p>{interview.task}</p>
      <Transcript interview={interview} />
      {interview.answerStatus !== 'approved' && interview.answerStatus !== 'pending' && <EvidenceMessage
        clues={clues} label="Your reply: explain what your evidence tells you" disabled={!onTurn}
        onSend={(clue, text) => onTurn?.({ t: 'interview-reply', id: interview.id, clue, text })} />}
    </div>)}
  </section>;
}
