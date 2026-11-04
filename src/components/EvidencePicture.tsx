import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EvidenceImage } from '../../shared/evidence';
import type { TextHelp } from '../../shared/campaign';
import LanguageHelp from './LanguageHelp';
import './EvidencePicture.css';

export default function EvidencePicture({ image, text, help }: { image?: EvidenceImage; text: string; help?: TextHelp }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const id = useId();
    const [failed, setFailed] = useState<string | null>(null);
    if (!image) return null;
    if (failed === image.src) return <p className="evidence-unavailable">Picture unavailable. Read the evidence text.</p>;
    return <figure className="evidence-picture">
        <button ref={trigger} type="button" className="evidence-thumbnail" aria-label={`Enlarge evidence: ${image.alt}`} onClick={() => dialog.current?.showModal()}>
            <img src={image.src} alt={image.alt} loading="lazy" onError={() => setFailed(image.src)} />
            <span>Enlarge evidence</span>
        </button>
        {createPortal(<dialog key={image.src} ref={dialog} className="evidence-dialog" aria-labelledby={id} onClose={() => trigger.current?.focus()}
            onCancel={event => { event.preventDefault(); event.stopPropagation(); dialog.current?.close(); }}
            onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); dialog.current?.close(); } }}>
            <header><h2 id={id}>Evidence</h2><button type="button" autoFocus onClick={() => dialog.current?.close()}>Close picture</button></header>
            <img src={image.src} alt={image.alt} />
            <p>{text}</p><LanguageHelp help={help} />
        </dialog>, document.body)}
    </figure>;
}
