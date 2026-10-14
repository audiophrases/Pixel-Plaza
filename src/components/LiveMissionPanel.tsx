import { useEffect, useState } from 'react';
import type { Campaign, Chapter } from '../../shared/campaign';
import type { LiveMissionInspection, LiveMissionPreview, LiveMissionTarget } from '../../shared/missionTypes';

async function liveCall<T>(token: string, op: string, body?: object): Promise<T> {
    const response = await fetch(`/api/teacher/missions/${op}`, { method: body ? 'POST' : 'GET', headers: { 'x-teacher-session': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error([result.error, ...(result.errors ?? []).map((e: { path: string; message: string }) => `${e.path}: ${e.message}`)].join('\n')), { status: response.status });
    return result;
}

export default function LiveMissionPanel({ token, campaign, chapter, version, dirty, onError }: { token: string; campaign: Campaign; chapter?: Chapter; version: number; dirty: boolean; onError: (cause: unknown) => void }) {
    const [target, setTarget] = useState<LiveMissionTarget | null>(null); const [selected, setSelected] = useState<string[]>([]);
    const [preview, setPreview] = useState<{ value: LiveMissionPreview; stamp: string } | null>(null);
    const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [error, setError] = useState('');
    const [inspection, setInspection] = useState<{ value: LiveMissionInspection; game: string; epoch: string } | null>(null);
    const available = chapter?.objectives.filter(o => o.optional && o.board && !target?.objectiveIds.includes(o.id) && !target?.additions.some(a => a.id === o.id)) ?? [];
    const selection = selected.filter(id => available.some(o => o.id === id));
    const stamp = JSON.stringify([campaign.id, version, chapter?.id, target?.game.id, target?.epoch, target?.chapter.id, target?.version, selection]);
    const reviewed = preview?.stamp === stamp && !dirty ? preview.value : null;
    const canReview = target?.open && !target.ended && chapter?.id === target.chapter.id && !dirty && selection.length > 0 && selection.length <= 10;
    useEffect(() => {
        let active = true;
        liveCall<{ target: LiveMissionTarget | null }>(token, 'live').then(result => { if (active) setTarget(result.target); }).catch(cause => { if (active) { setError(cause.message); if (cause.status === 401) onError(cause); } });
        return () => { active = false; };
    }, [token, campaign.id, onError]);
    useEffect(() => {
        const id = preview?.value.id;
        return () => { if (id) void liveCall(token, 'live-cancel', { previewId: id }).catch(() => {}); };
    }, [token, preview?.value.id, stamp]);
    const run = async (work: () => Promise<void>) => {
        setBusy(true); setError(''); setNotice('');
        try { await work(); } catch (cause) { setPreview(null); setError(cause instanceof Error ? cause.message : 'Connection failed.'); if ((cause as { status?: number }).status === 401) onError(cause); }
        finally { setBusy(false); }
    };
    const refresh = () => run(async () => { const result = await liveCall<{ target: LiveMissionTarget | null }>(token, 'live'); setTarget(result.target); setPreview(null); });
    return <section className="mission-card"><div className="mission-toolbar"><h2>Add quests to a running game</h2><button className="mission-button" disabled={busy} onClick={() => void refresh()}>Refresh live target</button></div>
        <p>Review a saved selection before releasing it. Other edits in this draft stay in Studio.</p>
        {error && <p className="mission-error" role="alert">{error}</p>}{notice && <p className="mission-notice" role="status">{notice}</p>}
        <fieldset className="mission-live-controls" disabled={busy}>
            {!target ? <p>Open a game and start its campaign in Teacher controls to add live quests.</p> : <>
                <p><strong>{target.game.name}</strong> · {target.campaign.title} · chapter {target.chapter.index + 1}: <strong>{target.chapter.title}</strong></p>
                {!target.open && <p>Open this game in Teacher controls first.</p>}{target.ended && <p>This campaign has ended.</p>}
                {dirty && <p>Save the draft before reviewing a live release.</p>}
                {chapter?.id !== target.chapter.id && <p>Select the chapter with ID <strong>{target.chapter.id}</strong> to match the running game.</p>}
                {available.length ? <div className="mission-checklist">{available.map(quest => <label key={quest.id}><input type="checkbox" checked={selection.includes(quest.id)} onChange={e => { setSelected(e.target.checked ? [...selection, quest.id] : selection.filter(id => id !== quest.id)); setPreview(null); }} />{quest.text || quest.id}</label>)}</div> : <p>Add or duplicate an optional board quest in this chapter to give it a new ID.</p>}
                <button className="mission-button" disabled={!canReview} onClick={() => void run(async () => {
                    const result = await liveCall<{ target: LiveMissionTarget; preview: LiveMissionPreview }>(token, 'live-preview', { gameId: target.game.id, targetVersion: target.version, targetEpoch: target.epoch, chapterId: chapter!.id, sourceId: campaign.id, sourceVersion: version, objectiveIds: selection });
                    setTarget(result.target); setPreview({ value: result.preview, stamp });
                })}>Review live release</button>
                {reviewed && <div className="mission-import-preview"><h3>Review: {reviewed.game.name} · {reviewed.chapter.title}</h3>
                    <p>This selection expires at {new Date(reviewed.expires).toLocaleTimeString()}. Eligibility counts are a snapshot; the game checks again when students accept.</p>
                    <ul>{reviewed.quests.map(quest => <li key={quest.id}><strong>{quest.text}</strong><p>{quest.audience} · {quest.eligibleNow} students can accept now{quest.activity ? ` · ${quest.activity}` : ''}</p><details><summary>Answers, clues and eligibility</summary><pre>{JSON.stringify(quest.definition, null, 2)}</pre></details></li>)}</ul>
                    <div className="mission-toolbar"><button className="mission-button primary" onClick={() => void run(async () => {
                        const result = await liveCall<{ target: LiveMissionTarget; released: string[] }>(token, 'live-release', { previewId: reviewed.id }); setTarget(result.target); setPreview(null); setSelected([]); setNotice(`${result.released.length} quests released to ${reviewed.game.name}. Student progress is preserved.`);
                    })}>Release reviewed quests</button><button className="mission-button" onClick={() => void run(async () => { await liveCall(token, 'live-cancel', { previewId: reviewed.id }); setPreview(null); })}>Cancel live release</button></div>
                </div>}
                {!!target.additions.length && <><h3>Live additions in this chapter</h3><ul>{target.additions.map(quest => <li key={quest.id}><p>{quest.text} · {quest.withdrawn ? 'withdrawn' : quest.started ? 'started by a student' : 'not started'}</p>
                    <button className="mission-button" onClick={() => void run(async () => { const result = await liveCall<{ inspection: LiveMissionInspection }>(token, `live-inspect?id=${encodeURIComponent(quest.id)}`); setInspection({ value: result.inspection, game: target.game.id, epoch: target.epoch }); })}>Inspect released definition</button>{' '}
                    <button className="mission-button danger" disabled={quest.withdrawn || quest.started || !target.open || target.ended} onClick={() => void run(async () => {
                        const result = await liveCall<{ target: LiveMissionTarget }>(token, 'live-withdraw', { gameId: target.game.id, targetVersion: target.version, targetEpoch: target.epoch, objectiveId: quest.id }); setTarget(result.target); setPreview(null); setNotice('Unstarted quest withdrawn. Its ID stays reserved in this game.');
                    })}>Withdraw unstarted quest</button>
                    {inspection?.game === target.game.id && inspection.epoch === target.epoch && inspection.value.id === quest.id && <div><p>Saved from {inspection.value.sourceId}, draft version {inspection.value.sourceVersion}, at {new Date(inspection.value.created).toLocaleString()}.</p><pre>{JSON.stringify(inspection.value.definition, null, 2)}</pre></div>}
                    </li>)}</ul></>}
            </>}
        </fieldset>
    </section>;
}
