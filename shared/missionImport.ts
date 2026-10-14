import type { Campaign } from './campaign.ts';
import { missionEnvelope, parseMission, validateMission, type MissionValidation } from './missionSchema.ts';

export type MissionImport = MissionValidation & { changes: string[] };
// Replace or append chapters into a candidate. Never mutate the teacher's working draft.
export function importMission(current: Campaign, text: string, mode: 'replace' | 'append' | 'extend', chapterId?: string): MissionImport {
    const incoming = parseMission(text, mode === 'extend' ? 'draft' : 'publish');
    if (!incoming.campaign) return { ...incoming, changes: [] };
    if (mode === 'replace') {
        const campaign = { ...incoming.campaign, id: current.id };
        return { ...validateMission(missionEnvelope(campaign)), changes: [`Replace draft content with ${campaign.chapters.length} chapters and ${campaign.roles.length} roles. Existing games keep their published revision.`] };
    }
    const candidate = structuredClone(current);
    const changes: string[] = [];
    const target = mode === 'extend' ? candidate.chapters.find(c => c.id === chapterId) : undefined;
    if (mode === 'extend' && (!target || incoming.campaign.chapters.length !== 1)) return { campaign: null, errors: [{ path: 'chapters', message: 'To extend the selected chapter, import exactly one chapter containing the new quests, discoveries and news.' }], warnings: [], changes };
    // Matching role IDs deliberately refer to the existing role; do not silently overwrite its secrets.
    for (const role of incoming.campaign.roles) {
        const existing = candidate.roles.find(r => r.id === role.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(role)) return { campaign: null, errors: [{ path: `roles.${role.id}`, message: 'Existing role has different content. Match it or use a new role ID before appending.' }], warnings: [], changes };
        if (!existing) { candidate.roles.push(role); changes.push(`Add role: ${role.name}`); }
    }
    const taken = new Set(candidate.chapters.flatMap(c => [c.id, ...c.objectives.map(o => o.id), ...c.discoveries.map(d => d.id), ...c.reveals.map(r => r.id)]));
    const remap = new Map<string, string>();
    const allIncoming = incoming.campaign.chapters.flatMap(c => [...(target ? [] : [c.id]), ...c.objectives.map(o => o.id), ...c.discoveries.map(d => d.id), ...c.reveals.map(r => r.id)]);
    // Reserve incoming IDs too, so a generated suffix cannot collide with a later incoming ID.
    const reserved = new Set([...taken, ...allIncoming]);
    for (const original of allIncoming) {
        if (remap.has(original)) return { campaign: null, errors: [{ path: 'chapters', message: 'Chapter and item IDs must be distinct within an append batch.' }], warnings: [], changes };
        let next = original; let suffix = 2;
        if (taken.has(original)) {
            do { next = `${original.slice(0, 58)}-${suffix++}`; } while (reserved.has(next));
        }
        taken.add(next); reserved.add(next); remap.set(original, next);
        if (next !== original) changes.push(`Rename ${original} → ${next}`);
    }
    for (const chapter of incoming.campaign.chapters) {
        const copy = structuredClone(chapter);
        copy.id = target ? target.id : remap.get(copy.id)!;
        for (const objective of copy.objectives) { objective.id = remap.get(objective.id)!; if (objective.after) objective.after = remap.get(objective.after) ?? objective.after; }
        for (const item of [...copy.discoveries, ...copy.reveals]) item.id = remap.get(item.id)!;
        if (target) {
            target.objectives.push(...copy.objectives); target.discoveries.push(...copy.discoveries); target.reveals.push(...copy.reveals);
            changes.push(`Extend ${target.title}: add ${copy.objectives.length} quests, ${copy.discoveries.length} discoveries and ${copy.reveals.length} news items. Story, secret and starting clues stay as authored.`);
        } else { candidate.chapters.push(copy); changes.push(`Append chapter: ${copy.title}`); }
    }
    return { ...validateMission(missionEnvelope(candidate)), changes };
}
