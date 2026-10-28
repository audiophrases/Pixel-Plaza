import { useState } from 'react';
import type { WarmupView } from '../../shared/warmup';
import { IDENTITY_CHAT_REMINDER } from '../../shared/activityChat';
import './Warmup.css';

type Props = { warmup: WarmupView; feedback: { correct: boolean; wait: boolean } | null; onAnswer: (text: string) => void };

// The opening warm-up: a secret fact about you, and someone to find. The answer is a classmate's name.
export default function Warmup({ warmup, feedback, onAnswer }: Props) {
  const [typed, setTyped] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  // A new task starts a fresh answer; rejected answers stay available to edit.
  const taskId = JSON.stringify([warmup.runId, warmup.step, warmup.task]);
  const [task, setTask] = useState(taskId);
  if (task !== taskId) { setTask(taskId); setTyped(''); setSubmitted(null); }
  const rejected = feedback && !feedback.correct && submitted === typed.trim();
  const finished = warmup.task === null;
  const title = warmup.kind === 'identity' ? 'Who am I?' : warmup.kind === 'pairs' ? 'Find your pair' : 'Find someone who…';
  return <aside className="warmup glass-panel">
    <h2>Warm-up: {warmup.title ?? title}</h2>
    {warmup.instructions && <p>{warmup.instructions}</p>}
    {warmup.kind === 'identity' && <p className="warmup-rule">{IDENTITY_CHAT_REMINDER}</p>}
    <section className="warmup-block warmup-fact">
      <h3>{warmup.kind === 'pairs' ? 'Your word' : 'Your secret'}</h3>
      <p>{warmup.fact}</p>
    </section>
    {finished ? <section className="warmup-block warmup-done">
      <h3>Done</h3>
      <p>{warmup.kind === 'identity' ? 'You solved your task. Keep helping with yes or no answers, without giving away your identity.' : 'You found everyone. Help your classmates!'}</p>
    </section> : <section className="warmup-block warmup-task">
      <h3>{warmup.of > 1 ? `Find (${warmup.step + 1} of ${warmup.of})` : 'Find'}</h3>
      <p className="warmup-ask">{warmup.task}</p>
      <form onSubmit={event => {
        event.preventDefault();
        if (typed.trim()) { setSubmitted(typed.trim()); onAnswer(typed.trim()); }
      }}>
        <input value={typed} maxLength={80} placeholder={warmup.kind === 'identity' ? 'Type their secret name' : 'Type their name'} autoComplete="off" aria-label="Their name" aria-describedby={rejected ? 'warmup-answer-feedback' : undefined}
          onChange={event => setTyped(event.target.value)} />
        <button disabled={!typed.trim()}>Answer</button>
      </form>
      {rejected && <p id="warmup-answer-feedback" className="warmup-wrong" role="status">{feedback.wait
        ? 'Please wait a few seconds before trying again.' : warmup.kind === 'identity'
          ? 'That identity was not accepted. Check your guess and try again.'
          : 'That name was not accepted. Check the name shown above their avatar and try again.'}</p>}
    </section>}
    {warmup.team.total > 0 && <div className="warmup-meter" role="progressbar" aria-valuemin={0} aria-valuemax={warmup.team.total} aria-valuenow={warmup.team.done}>
      <span style={{ width: `${Math.round(100 * warmup.team.done / warmup.team.total)}%` }} />
    </div>}
  </aside>;
}
