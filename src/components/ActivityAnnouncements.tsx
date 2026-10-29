import { useEffect, useRef, useState } from 'react';
import type { BoardView, QuestView } from '../../shared/campaign';
import type { WarmupView } from '../../shared/warmup';
import { activityAnnouncements, readAcknowledgements, saveAcknowledgements } from './announcementQueue';
import './ActivityAnnouncements.css';

export default function ActivityAnnouncements({ quest, board = null, warmup, storageKey, paused }: { quest: QuestView | null; board?: BoardView | null; warmup: WarmupView | null; storageKey: string; paused: boolean }) {
    const [seen, setSeen] = useState(() => readAcknowledgements(storageKey));
    const [reviewScope, setReviewScope] = useState<string | null>(null);
    const activityScope = JSON.stringify([quest?.runId ?? quest?.campaign.id, quest?.chapter.index, warmup?.runId ?? warmup?.kind]);
    const review = reviewScope === activityScope;
    const dialog = useRef<HTMLDialogElement>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    const body = useRef<HTMLDivElement>(null);
    const pending = activityAnnouncements(quest, warmup, seen, board);
    const current = paused || (!quest && !warmup && !board) ? null : review ? {
        id: 'review', kind: 'chapter', eyebrow: 'READ AGAIN', title: 'Your current instructions', acknowledge: [],
        sections: activityAnnouncements(quest, warmup, new Set(), board).flatMap(item => [{ label: item.title, text: item.next }, ...item.sections]),
        next: 'Press OK to return to the game. Your tasks are still in the Journal and Warm-up panel.',
    } : pending[0];
    const currentId = current?.id;
    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (currentId) {
            if (!element.open) element.showModal();
            body.current?.scrollTo?.(0, 0);
            heading.current?.focus();
        } else if (element.open) element.close();
    }, [currentId]);
    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        const keepOpen = (event: Event) => event.preventDefault();
        element.addEventListener('cancel', keepOpen);
        return () => { element.removeEventListener('cancel', keepOpen); element.close(); };
    }, []);
    const acknowledge = () => {
        if (!current) return;
        if (review) { setReviewScope(null); return; }
        const next = new Set([...seen, ...current.acknowledge]);
        saveAcknowledgements(storageKey, next); setSeen(next);
    };
    return <>
        {(quest || warmup) && <button type="button" className="activity-instructions-button" disabled={paused} onClick={() => setReviewScope(activityScope)}>Instructions</button>}
        <dialog ref={dialog} className={`activity-announcement activity-${current?.kind ?? 'chapter'}`} aria-labelledby="activity-announcement-title" aria-describedby="activity-announcement-next"
            onKeyDown={event => { if (event.key === 'Escape') event.preventDefault(); event.stopPropagation(); }}>
            {current && <><header><span className="activity-announcement-icon" aria-hidden="true">{current.kind === 'warmup' ? '☀' : current.kind === 'board' ? '✦' : current.kind === 'ending' ? '✓' : current.kind === 'news' ? '!' : '▤'}</span><div><p>{current.eyebrow}</p><h2 id="activity-announcement-title" tabIndex={-1} ref={heading}>{current.title}</h2></div></header>
                <div className="activity-announcement-body" ref={body}>{current.sections.filter(section => section.text.trim()).map((section, index) => <section key={index}><h3>{section.label}</h3><p>{section.text}</p></section>)}</div>
                <footer><p id="activity-announcement-next">{current.next}</p><div><small>{!review && pending.length > 1 ? `${pending.length - 1} more ${pending.length === 2 ? 'announcement' : 'announcements'} after this` : 'Read again anytime with Instructions'}</small><button type="button" className="activity-announcement-ok" onClick={acknowledge}>OK</button></div></footer></>}
        </dialog>
    </>;
}
