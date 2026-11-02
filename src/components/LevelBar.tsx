import { useEffect, useRef, useState } from 'react';
import { EXTRA_EMOTES, NAME_COLOURS, REWARDS, XP, levelOf, nextReward, unlockedBetween, type Style } from '../../shared/levels';
import './LevelBar.css';

const SEGMENTS = 18;

// The experience bar, as in Minecraft: the level above a bar that fills toward the next one. New experience
// floats up from it with the reason; clicking it opens what the levels unlock. Beside the bar waits the
// next unlock's icon, and a dot on the level says something new is open that the student has not looked at.
// reason: why the latest experience came, shown with it.
export function LevelBar({ xp, reason, fresh = false, onOpen }: { xp: number; reason?: string; fresh?: boolean; onOpen: () => void }) {
  const { level, into, need } = levelOf(xp);
  const next = nextReward(level);
  const [popup, setPopup] = useState<{ key: number; text: string; levelUp: boolean } | null>(null);
  const before = useRef<number | null>(null);
  const why = useRef(reason);
  useEffect(() => { why.current = reason; }, [reason]);
  useEffect(() => {
    const previous = before.current;
    before.current = xp;
    if (previous === null || xp <= previous) return;
    const was = levelOf(previous).level;
    const now = levelOf(xp).level;
    const opened = unlockedBetween(was, now);
    const text = now > was ? `Level ${now}!${opened.length ? ` ${opened.join(' ')}` : ''}` : `+${xp - previous} XP${why.current ? ` · ${why.current}` : ''}`;
    setPopup({ key: Date.now(), text, levelUp: now > was });
    const timer = window.setTimeout(() => setPopup(null), now > was ? 4500 : 2500);
    return () => window.clearTimeout(timer);
  }, [xp]);

  return <button type="button" className="level-bar" onClick={onOpen}
    title={`Level ${level}: ${into} of ${need} XP to level ${level + 1}.${next ? ` Next: ${next.name} at level ${next.level}.` : ''} Click to see your rewards.`}
    aria-label={`Level ${level}, ${into} of ${need} experience to the next level.${fresh ? ' New rewards.' : ''} Open rewards.`}>
    {popup && <span key={popup.key} className={`level-popup${popup.levelUp ? ' level-up' : ''}`} role="status">{popup.text}</span>}
    <span className="level-number">{level}{fresh && <span className="level-new" aria-hidden="true" />}</span>
    <span className="level-track" aria-hidden="true">
      <span className="level-fill" style={{ width: `${(into / need) * 100}%` }} />
      {Array.from({ length: SEGMENTS - 1 }, (_, index) => <i key={index} style={{ left: `${((index + 1) / SEGMENTS) * 100}%` }} />)}
    </span>
    {next && <span className="level-next" aria-hidden="true">{next.icon}</span>}
  </button>;
}

// Every step of the ladder, in order: the open ones to choose from, the rest greyed with the level they open at.
export function Rewards({ xp, style, onChoose, onClose }: { xp: number; style: Style; onChoose: (style: Style) => void; onClose: () => void }) {
  const { level, into, need } = levelOf(xp);
  return <div className="rewards-panel" role="dialog" aria-label="Your rewards">
    <div className="rewards-heading">
      <h2>Level {level}</h2>
      <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
    </div>
    <p>{into} of {need} XP to level {level + 1}. Your level stays with you in every game.</p>
    <details className="rewards-earn">
      <summary>How to earn XP</summary>
      <ul>
        <li>Your first message to a classmate: +{XP.firstMessage} (once)</li>
        <li>Varied questions and useful replies to classmates: +{XP.participation} (small lesson limit)</li>
        <li>Your teacher stars a good message or report: +{XP.teacher}</li>
        <li>A right answer in your journal: +{XP.answer}</li>
        <li>A partner quest completed: +{XP.quest}</li>
        <li>Everyone found in a warm-up: +{XP.warmup}</li>
      </ul>
    </details>

    {REWARDS.map(reward => {
      const open = level >= reward.level;
      const { pick, options } = reward;
      // A pick's first reward offers "none"; a later one only adds options.
      const first = pick && REWARDS.find(item => item.pick === pick) === reward;
      return <section key={reward.id} className={`rewards-step${open ? '' : ' locked'}`}>
        <h3><span aria-hidden="true">{reward.icon}</span> {reward.name}
          {!open && <small className="rewards-lock" title={`Level ${reward.level}`} aria-label={`Unlocks at level ${reward.level}`}>🔒 {reward.level}</small>}</h3>

        {reward.id === 'colour' && <div className="rewards-row">{NAME_COLOURS.map((colour, index) => <button key={colour} type="button"
          className={`rewards-swatch${style.colour === index ? ' chosen' : ''}`} style={{ background: colour }}
          disabled={index !== 0 && !open} aria-pressed={style.colour === index} aria-label={index === 0 ? 'White' : `Colour ${index}`}
          onClick={() => onChoose({ ...style, colour: index })} />)}</div>}

        {reward.id === 'emotes' && <div className="rewards-row">{EXTRA_EMOTES.map(emote => <span key={emote} className="rewards-emote">{emote}</span>)}</div>}

        {pick && options && <div className="rewards-row">
          {first && <button type="button" className={`rewards-none${style[pick] === null ? ' chosen' : ''}`} disabled={!open}
            aria-pressed={style[pick] === null} aria-label={`No ${reward.name.toLowerCase()}`} onClick={() => onChoose({ ...style, [pick]: null })} />}
          {options.map((option, index) => option.startsWith('#')
            ? <button key={option} type="button" className={`rewards-swatch${style[pick] === option ? ' chosen' : ''}`} style={{ background: option }}
              disabled={!open} aria-pressed={style[pick] === option} aria-label={`${reward.name} colour ${index + 1}`}
              onClick={() => onChoose({ ...style, [pick]: option })} />
            : <button key={option} type="button" className={`rewards-flair${style[pick] === option ? ' chosen' : ''}`}
              disabled={!open} aria-pressed={style[pick] === option} onClick={() => onChoose({ ...style, [pick]: option })}>{option}</button>)}
        </div>}
      </section>;
    })}
  </div>;
}
