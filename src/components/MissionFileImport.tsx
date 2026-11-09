import { useEffect, useRef, useState } from 'react';
import type { Campaign } from '../../shared/campaign';
import type { Theme } from '../../shared/theme';
import { clueZones, missionEnvelope, validateMission } from '../../shared/missionSchema';
import MissionField from './MissionField';

export type MissionFilePreview = { campaign: Campaign; source: string };
export default function MissionFileImport({ preview, maps, mapsReady, mapsFailed, onRefreshMaps, duplicate, busy, onImport, onCancel }: {
    preview: MissionFilePreview; maps: Theme[]; mapsReady: boolean; mapsFailed: boolean; onRefreshMaps: () => void; duplicate: boolean; busy: boolean;
    onImport: (campaign: Campaign, publish: boolean) => void; onCancel: () => void;
}) {
    const [title, setTitle] = useState(preview.campaign.title);
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => { heading.current?.focus(); heading.current?.scrollIntoView?.({ block: 'nearest' }); }, []);
    useEffect(() => { setTitle(preview.campaign.title); }, [preview]);
    const campaign = { ...preview.campaign, title };
    const zones = new Set(maps.flatMap(map => map.zones.map(zone => zone.id)));
    const draft = validateMission(missionEnvelope(campaign), 'draft');
    const checked = validateMission(missionEnvelope(campaign), 'publish', zones);
    const needed = clueZones(campaign);
    const missing = needed.filter(zone => !zones.has(zone));
    const matching = maps.filter(map => needed.every(zone => map.zones.some(place => place.id === zone)));
    const objectives = campaign.chapters.flatMap(chapter => chapter.objectives);
    const pictures = new Set(campaign.chapters.flatMap(chapter => [chapter.introImage, chapter.endingImage, ...chapter.discoveries.map(clue => clue.image), ...chapter.reveals.map(news => news.image), ...Object.values(chapter.roleClueImages ?? {})]).filter(Boolean).map(image => image!.src)).size;
    return <section className="mission-card mission-file-preview" aria-labelledby="mission-import-heading">
        <p className="mission-eyebrow">READY TO IMPORT</p><h2 id="mission-import-heading" ref={heading} tabIndex={-1}>Import {preview.campaign.title || 'mission'}</h2>
        <p className="mission-muted mission-import-source">{preview.source}</p>
        <MissionField label="Imported mission name" value={title} maxLength={120} onChange={setTitle} />
        <div className="mission-included-counts"><span><strong>{campaign.chapters.length}</strong> chapters</span><span><strong>{objectives.length}</strong> tasks</span><span><strong>{campaign.roles.length}</strong> roles</span><span><strong>{pictures}</strong> pictures</span></div>
        <ol className="mission-import-chapters" role="list" aria-label="Chapters in order">{campaign.chapters.map(chapter => <li key={chapter.id}>{chapter.title}</li>)}</ol>
        {duplicate && <p className="mission-notice">This mission is already in your library or Trash. The import will be saved as a separate copy. Give it a different name above if you want.</p>}
        {mapsFailed ? <p role="status">Could not check available maps. Refresh maps to retry, or save a draft now.</p> : !mapsReady ? <p role="status">Checking available maps…</p> : missing.length ? <p className="mission-preparation">Import the matching map to publish this mission. Missing places: {missing.join(', ')}. You can save a draft now.</p>
            : needed.length > 0 && matching.length > 0 ? <p className="mission-notice">Map ready: {matching.map(map => map.name).join(', ')}.</p>
                : <p className="mission-muted">{needed.length ? 'All required map places are available.' : 'This mission has no map clues.'}</p>}
        <button type="button" className="mission-button" disabled={busy || (!mapsReady && !mapsFailed)} onClick={onRefreshMaps}>Refresh maps</button>
        {!!checked.errors.length && <details className="mission-details"><summary>{checked.errors.length} {checked.errors.length === 1 ? 'item' : 'items'} to fix before publishing</summary><ul className="mission-error">{checked.errors.map(issue => <li key={`${issue.path}:${issue.message}`}>{issue.path}: {issue.message}</li>)}</ul></details>}
        <div className="mission-toolbar"><button type="button" className="mission-button primary" disabled={busy || !mapsReady || !checked.campaign} onClick={() => onImport(campaign, true)}>Import &amp; publish</button>
            <button type="button" className="mission-button" disabled={busy || !draft.campaign} onClick={() => onImport(campaign, false)}>Save as draft</button>
            <button type="button" className="mission-button" disabled={busy} onClick={onCancel}>Cancel import</button></div>
        <p className="mission-muted">Publishing makes this mission available in Teacher controls. You can edit it in Mission Studio afterwards.</p>
    </section>;
}
