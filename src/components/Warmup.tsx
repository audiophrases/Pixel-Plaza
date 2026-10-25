import { useState } from 'react';
import type { WarmupView } from '../../shared/warmup';
import { IDENTITY_CHAT_REMINDER } from '../../shared/activityChat';
import './Warmup.css';

type Props = { warmup: WarmupView; feedback: { correct: boolean; wait: boolean } | null; onAnswer: (text: string) => void };

// The opening warm-up: a secret fact about you, and someone to find. The answer is a classmate's name.
export default function Warmup({ warmup, feedback, onAnswer }: Props) {
  const [typed, setTyped] = useState('');
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
        if (typed.trim()) { onAnswer(typed.trim()); setTyped(''); }
      }}>
        <input value={typed} maxLength={80} placeholder={warmup.kind === 'identity' ? 'Type their secret name' : 'Type their name'} autoComplete="off" aria-label="Their name"
          onChange={event => setTyped(event.target.value)} />
        <button disabled={!typed.trim()}>Answer</button>
      </form>
      {feedback && !feedback.correct && <p className="warmup-wrong">{feedback.wait ? 'Wait a moment.' : 'Not yet. Ask more classmates.'}</p>}
    </section>}
    {warmup.team.total > 0 && <div className="warmup-meter" role="progressbar" aria-valuemin={0} aria-valuemax={warmup.team.total} aria-valuenow={warmup.team.done}>
      <span style={{ width: `${Math.round(100 * warmup.team.done / warmup.team.total)}%` }} />
    </div>}
  </aside>;
}
