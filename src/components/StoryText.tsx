import { useContext } from 'react';
import { castParts } from '../../shared/cast';
import { CastContext } from './castContext';
import './StoryText.css';

// Story text with each character's name marked 📖, in its own colour, so a character never looks like a classmate.
export default function StoryText({ text }: { text: string }) {
  const cast = useContext(CastContext);
  return <>{castParts(text, cast).map((part, i) => typeof part === 'string' ? part
    : <span key={i} className="cast-name" title={`${part.member.name}: ${part.member.about} (a character in the story)`}>📖 {part.text}</span>)}</>;
}
