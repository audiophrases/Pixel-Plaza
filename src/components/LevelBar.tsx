import { useEffect, useRef, useState } from 'react';
import { FLAIRS, NAME_COLOURS, REWARDS, XP, levelOf, unlocked, unlockedAt, type Style } from '../../shared/levels';
import './LevelBar.css';

const SEGMENTS = 18;

// The experience bar, as in Minecraft: the level above a bar that fills toward the next one. New experience
// floats up from it with the reason; clicking it opens what the levels unlock.
// reason: why the latest experience came, shown with it.
export function LevelBar({ xp, reason, onOpen }: { xp: number; reason?: string; onOpen: () => void }) {
  const { level, into, need } = levelOf(xp);
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
    const opened = now > was ? unlockedAt(now) : [];
    const text = now > was ? `Level ${now}!${opened.length ? ` New: ${opened.join(', ')}` : ''}` : `+${xp - previous} XP${why.current ? ` · ${why.current}` : ''}`;
    setPopup({ key: Date.now(), text, levelUp: now > was });
    const timer = window.setTimeout(() => setPopup(null), now > was ? 4500 : 2500);
    return () => window.clearTimeout(timer);
  }, [xp]);

  return <button type="button" className="level-bar" onClick={onOpen}
    title={`Level ${level}: ${into} of ${need} XP to level ${level + 1}. Click to see your rewards.`}
    aria-label={`Level ${level}, ${into} of ${need} experience to the next level. Open rewards.`}>
    {popup && <span key={popup.key} className={`level-popup${popup.levelUp ? ' level-up' : ''}`} role="status">{popup.text}</span>}
    <span className="level-number">{level}</span>
    <span className="level-track" aria-hidden="true">
      <span className="level-fill" style={{ width: `${(into / need) * 100}%` }} />
      {Array.from({ length: SEGMENTS - 1 }, (_, index) => <i key={index} style={{ left: `${((index + 1) / SEGMENTS) * 100}%` }} />)}
    </span>
  </button>;
}

// What the levels unlock, with the ones already open to choose from.
export function Rewards({ xp, style, onChoose, onClose }: { xp: number; style: Style; onChoose: (style: Style) => void; onClose: () => void }) {
  const { level, into, need } = levelOf(xp);
  const lock = (id: typeof REWARDS[number]['id']) => !unlocked(id, level) && <small className="rewards-lock">Level {REWARDS.find(reward => reward.id === id)!.level}</small>;
  return <div className="rewards-panel" role="dialog" aria-label="Your rewards">
    <div className="rewards-heading">
      <h2>Level {level}</h2>
      <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
    </div>
    <p>{into} of {need} XP to level {level + 1}. Your level stays with you in every game.</p>
    <details className="rewards-earn">
      <summary>How to earn XP</summary>
      <ul>
        <li>Varied questions and useful replies to classmates: +{XP.participation} (small lesson limit)</li>
        <li>Your teacher stars a good message or report: +{XP.teacher}</li>
        <li>A right answer in your journal: +{XP.answer}</li>
        <li>A partner quest completed: +{XP.quest}</li>
        <li>Everyone found in a warm-up: +{XP.warmup}</li>
      </ul>
    </details>

    <h3>Name colour {lock('colour')}</h3>
    <div className="rewards-row">{NAME_COLOURS.map((colour, index) => <button key={colour} type="button"
      className={`rewards-swatch${style.colour === index ? ' chosen' : ''}`} style={{ background: colour }}
      disabled={index !== 0 && !unlocked('colour', level)} aria-pressed={style.colour === index} aria-label={index === 0 ? 'White' : `Colour ${index}`}
      onClick={() => onChoose({ ...style, colour: index })} />)}</div>

    <h3>Flair {lock('flair')}</h3>
    <div className="rewards-row">
      <button type="button" className={`rewards-flair${style.flair === null ? ' chosen' : ''}`} aria-pressed={style.flair === null}
        onClick={() => onChoose({ ...style, flair: null })}>None</button>
      {FLAIRS.map(flair => <button key={flair} type="button" className={`rewards-flair${style.flair === flair ? ' chosen' : ''}`}
        disabled={!unlocked('flair', level)} aria-pressed={style.flair === flair} onClick={() => onChoose({ ...style, flair })}>{flair}</button>)}
    </div>

    <h3>More emotes {lock('emotes')}</h3>
    <p className="rewards-note">{unlocked('emotes', level) ? 'Unlocked: ❤️ 👋 😮 🎉 are in your emote bar.' : '❤️ 👋 😮 🎉 for your emote bar.'}</p>
  </div>;
}
