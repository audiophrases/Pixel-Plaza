import { missionEnvelope, missionId, validateMission, type MissionIssue } from './missionSchema.ts';
import type { Campaign, Objective } from './campaign.ts';

export function liveMissionCandidate(base: Campaign, source: Campaign, chapterId: string, ids: string[], reserved: readonly string[] = []): { campaign: Campaign | null; quests: Objective[]; errors: MissionIssue[] } {
    const error = (path: string, message: string) => ({ campaign: null, quests: [], errors: [{ path, message }] });
    if (!ids.length || ids.length > 10 || new Set(ids).size !== ids.length || ids.some(id => !missionId(id))) return error('quests', 'Select between 1 and 10 distinct quest IDs.');
    const chapter = base.chapters.find(c => c.id === chapterId); const draftChapter = source.chapters.find(c => c.id === chapterId);
    if (!chapter || !draftChapter) return error('chapter', 'Choose the same chapter as the running game.');
    const taken = new Set([...reserved, ...base.chapters.flatMap(c => [c.id, ...c.objectives.map(o => o.id), ...c.discoveries.map(d => d.id), ...c.reveals.map(r => r.id)])]);
    const quests: Objective[] = [];
    for (const id of ids) {
        const quest = draftChapter.objectives.find(o => o.id === id);
        if (!quest?.optional || !quest.board || quest.answerThief || quest.thiefKnows) return error(`quests.${id}`, 'Live additions must be optional board quests without thief-specific exclusions.');
        if (taken.has(id)) return error(`quests.${id}`, 'This ID already exists in the game, including withdrawn quests. Duplicate the quest to give it a new ID.');
        taken.add(id); quests.push(structuredClone(quest));
    }
    const candidate = structuredClone(base);
    candidate.chapters.find(c => c.id === chapterId)!.objectives.push(...quests);
    // Only the additions enter the game. Source roles, answers, stories and existing objectives are ignored.
    const checked = validateMission(missionEnvelope(candidate));
    return { campaign: checked.campaign, quests: checked.campaign?.chapters.find(c => c.id === chapterId)?.objectives.filter(o => ids.includes(o.id)) ?? [], errors: checked.errors };
}
