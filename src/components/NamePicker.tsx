import './NamePicker.css';

type Props = { name: string; onAnother: () => void; onKeep: () => void };

// Shown while a game gives made-up names: the student takes the name they like, or asks for another.
// Until they keep one they cannot chat, so nobody is introduced under a name they are about to change.
export default function NamePicker({ name, onAnother, onKeep }: Props) {
  return <section className="name-picker glass-panel" role="dialog" aria-label="Choose your name">
    <p className="name-picker-label">Your name in the Plaza</p>
    <p className="name-picker-name">{name}</p>
    <div className="name-picker-actions">
      <button type="button" className="btn btn-secondary" onClick={onAnother}>Another name</button>
      <button type="button" className="btn btn-primary" onClick={onKeep}>Keep this name</button>
    </div>
    <p className="name-picker-note">You keep it for the whole game. Your teacher knows who you are.</p>
  </section>;
}
