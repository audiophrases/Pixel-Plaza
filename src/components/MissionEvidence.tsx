import { useEffect, useRef, useState } from 'react';
import type { Campaign } from '../../shared/campaign';
import { EVIDENCE_MAX_CHARS, evidenceSource, type EvidenceImage } from '../../shared/evidence';
import { MISSION_MAX_BYTES, missionEnvelope } from '../../shared/missionSchema';
import MissionField from './MissionField';
import EvidencePicture from './EvidencePicture';

export function evidenceFields(campaign: Campaign, index: number) {
    const c = campaign.chapters[index];
    if (!c) return [];
    return [
        { label: 'Opening story', text: c.intro, image: c.introImage, path: ['chapters', index, 'introImage'] },
        { label: 'Chapter ending', text: c.ending, image: c.endingImage, path: ['chapters', index, 'endingImage'] },
        ...c.discoveries.map((d, i) => ({ label: `Map clue ${i + 1} · ${d.zone}`, text: d.text, image: d.image, path: ['chapters', index, 'discoveries', i, 'image'] })),
        ...c.reveals.map((r, i) => ({ label: `Teacher news ${i + 1}`, text: r.text, image: r.image, path: ['chapters', index, 'reveals', i, 'image'] })),
        // Each role's private clue can come with a picture only that role sees: the picture a student describes to the team.
        ...campaign.roles.map(role => ({ label: `Private clue · ${role.name || role.id}`, text: c.roleClues?.[role.id] ?? role.clue, image: c.roleClueImages?.[role.id], path: ['chapters', index, 'roleClueImages', role.id] })),
    ];
}

async function smallPicture(file: File): Promise<string> {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP picture.');
    if (file.size > 8_000_000) throw new Error('Choose a picture smaller than 8 MB.');
    const bitmap = await createImageBitmap(file);
    try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d'); if (!context) throw new Error('Your browser cannot prepare this picture.');
        context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.88, 0.76, 0.64, 0.5, 0.36]) {
            const src = canvas.toDataURL('image/jpeg', quality);
            if (src.length <= EVIDENCE_MAX_CHARS && evidenceSource(src)) return src;
        }
        throw new Error('This picture is too detailed. Crop it or choose a smaller image.');
    } finally { bitmap.close(); }
}

export default function MissionEvidence({ campaign, chapterIndex, onChange }: { campaign: Campaign; chapterIndex: number; onChange: (next: Campaign) => void }) {
    const [error, setError] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const latest = useRef(campaign); latest.current = campaign;
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const update = (path: (string | number)[], image?: EvidenceImage) => {
        const copy = structuredClone(latest.current);
        let target = copy as unknown as Record<string, unknown>;
        for (const key of path.slice(0, -1)) target = (target[key] ??= {}) as Record<string, unknown>;
        if (image) target[path.at(-1)!] = image; else delete target[path.at(-1)!];
        if (new TextEncoder().encode(JSON.stringify(missionEnvelope(copy), null, 2)).length > MISSION_MAX_BYTES) throw new Error('This mission is full (512 KB). Remove a picture or import chapters as separate missions.');
        onChange(copy);
    };
    return <section className="mission-card"><details className="mission-details" data-editor-section="evidence-pictures"><summary>Evidence pictures</summary>
        <p className="mission-muted">Add a picture beside a story, map clue, teacher announcement or a role’s private clue. Students can enlarge it when that text becomes available. Keep the essential evidence in the English text and Catalan help too.</p>
        <p className="mission-muted">Pictures are stored inside the mission and included in exports and sync. Large pictures are reduced automatically. Review small text in the preview before publishing.</p>
        {error && <p role="alert">{error}</p>}
        {evidenceFields(campaign, chapterIndex).map(field => <details className="mission-details" key={field.path.join('.')} data-evidence-path={field.path.join('.')}><summary>{field.label}{field.image ? ' · picture added' : ''}</summary>
            <p>{field.text}</p><EvidencePicture image={field.image} text={field.text} />
            <label className="mission-field"><span>{busy === field.label ? 'Preparing picture…' : `Choose picture · ${field.label}`}</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy !== null} onChange={async event => {
                const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
                const before = latest.current; setError(''); setBusy(field.label);
                try {
                    const src = await smallPicture(file);
                    if (!mounted.current) return;
                    if (latest.current !== before) throw new Error('The mission changed while the picture was preparing. Select the picture again.');
                    update(field.path, { src, alt: field.image?.alt ?? '' });
                } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read this picture.'); }
                finally { setBusy(null); }
            }} /></label>
            {field.image && <><MissionField label={`Picture description · ${field.label}`} value={field.image.alt} maxLength={500} onChange={alt => { try { update(field.path, { ...field.image!, alt }); setError(''); } catch (cause) { setError((cause as Error).message); } }} />
                <p className="mission-muted">Describe what the picture shows for students using screen readers. This is required to publish.</p>
                <button type="button" className="mission-button" onClick={() => { update(field.path); setError(''); }}>Remove picture · {field.label}</button></>}
        </details>)}
    </details></section>;
}
