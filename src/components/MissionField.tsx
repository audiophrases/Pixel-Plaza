export default function MissionField({ label, value, onChange, multiline = false, maxLength = 6000, placeholder, onBlur }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; maxLength?: number; placeholder?: string; onBlur?: () => void }) {
    return <label className="mission-field"><span>{label}</span>{multiline
        ? <textarea value={value} placeholder={placeholder} maxLength={maxLength} rows={3} onBlur={onBlur} onChange={e => onChange(e.target.value)} />
        : <input value={value} placeholder={placeholder} maxLength={maxLength} onBlur={onBlur} onChange={e => onChange(e.target.value)} />}</label>;
}
