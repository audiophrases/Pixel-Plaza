import type { CorrectionPart } from '../../shared/diff';

// A teacher's correction as PinPlay shows it: the student's words, a wrong one struck through in red with an
// arrow to the right one in green. Used where the teacher writes it and where the student reads it.
export default function Correction({ parts }: { parts: CorrectionPart[] }) {
  return <span className="correction">{parts.map((part, index) => {
    const space = index > 0 ? ' ' : '';
    if (part.kind === 'same') return <span key={index}>{space}{part.text}</span>;
    if (part.kind === 'del') return <span key={index}>{space}<span className="diff-del">{part.text}</span></span>;
    const replaces = parts[index - 1]?.kind === 'del';
    return <span key={index}>{space}{replaces && <span className="diff-arrow">→ </span>}<span className="diff-ins">{part.text}</span></span>;
  })}</span>;
}
