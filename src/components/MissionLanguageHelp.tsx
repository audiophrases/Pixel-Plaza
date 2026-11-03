import type { Campaign, TextHelp } from '../../shared/campaign';
import MissionField from './MissionField';
import LanguageHelp from './LanguageHelp';

type Field = { label: string; text: string; help?: TextHelp; path: (string | number)[] };
export function missionHelpFields(campaign: Campaign, chapterIndex?: number): Field[] {
    if (chapterIndex === undefined) return [
        { label: 'Mission ending', text: campaign.finale, help: campaign.help?.finale, path: ['help', 'finale'] },
        ...campaign.roles.flatMap((role, i) => (['card', 'clue'] as const).map(key => ({ label: `${role.name} · ${key === 'card' ? 'role card' : 'starting clue'}`,
            text: role[key], help: role.help?.[key], path: ['roles', i, 'help', key] }))),
    ];
    const c = campaign.chapters[chapterIndex]; if (!c) return [];
    const prefix = ['chapters', chapterIndex];
    return [
        ...(['intro', 'recap', 'ending'] as const).map(key => ({ label: { intro: 'Opening story', recap: 'Recap', ending: 'Chapter ending' }[key],
            text: c[key], help: c.help?.[key], path: [...prefix, 'help', key] })),
        ...Object.entries(c.roleClues ?? {}).map(([id, text]) => ({ label: `${campaign.roles.find(r => r.id === id)?.name ?? id} · chapter clue`, text,
            help: c.roleClueHelp?.[id], path: [...prefix, 'roleClueHelp', id] })),
        ...c.objectives.flatMap((o, i) => [
            { label: `Step ${i + 1}`, text: o.text, help: o.help, path: [...prefix, 'objectives', i, 'help'] },
            ...Object.entries(o.rewards ?? {}).map(([id, text]) => ({ label: `Step ${i + 1} · reward for ${campaign.roles.find(r => r.id === id)?.name ?? id}`, text,
                help: o.rewardHelp?.[id], path: [...prefix, 'objectives', i, 'rewardHelp', id] })),
        ]),
        ...c.discoveries.map((d, i) => ({ label: `Map clue ${i + 1} · ${d.zone}`, text: d.text, help: d.help, path: [...prefix, 'discoveries', i, 'help'] })),
        ...c.reveals.map((r, i) => ({ label: `Teacher news ${i + 1}`, text: r.text, help: r.help, path: [...prefix, 'reveals', i, 'help'] })),
        ...(c.thieves ? (['card', 'story'] as const).map(key => ({ label: `Secret thief · ${key}`, text: c.thieves![key], help: c.thieves!.help?.[key], path: [...prefix, 'thieves', 'help', key] })) : []),
    ];
}

export default function MissionLanguageHelp({ campaign, chapterIndex, onChange }: { campaign: Campaign; chapterIndex?: number; onChange: (next: Campaign) => void }) {
    const fields = missionHelpFields(campaign, chapterIndex).filter(field => field.text.trim());
    const change = (path: Field['path'], ca: string) => {
        const copy = structuredClone(campaign);
        let target = copy as unknown as Record<string, unknown>;
        for (const key of path.slice(0, -1)) {
            if (!target[key]) target[key] = {};
            target = target[key] as Record<string, unknown>;
        }
        const last = path.at(-1)!;
        if (ca.trim()) target[last] = { ca }; else delete target[last];
        onChange(copy);
    };
    return <section className="mission-card"><details className="mission-details" data-editor-section="language-help">
        <summary>Catalan help · {fields.filter(field => field.help?.ca?.trim()).length} of {fields.length} texts</summary>
        <p className="mission-muted">Students see English first. They can expand “Ajuda en català” beside each text in the Journal and instruction pop-ups. Translate only the matching English text; keep answers and later clues out of task translations. Update the translation when you edit the English.</p>
        {fields.map(field => <details className="mission-details" key={field.path.join('.')}><summary>{field.label}{field.help?.ca?.trim() ? ' · translated' : ''}</summary>
            <p lang="en">{field.text}</p>
            <MissionField label={`Catalan · ${field.label}`} multiline value={field.help?.ca ?? ''} onChange={text => change(field.path, text)} />
            <LanguageHelp help={field.help} />
        </details>)}
    </details></section>;
}
