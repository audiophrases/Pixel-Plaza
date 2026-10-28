import { prerequisiteIds, type Campaign, type Objective } from './campaign.ts';

// Teacher-only response data. Build from the actual published/live definition,
// never from a campaign title or a second, hard-coded answer key.
export type GuideTask = {
    id: string; title: string; task: string; answer: string; steps: string[]; prerequisites: string | null;
    witnesses: number; minimumPlayers: number; before: string[]; unlockedClues: { role: string; text: string }[];
};
export type GuideChapter = {
    id: string; title: string; mission: string; play: string[]; main: GuideTask[]; optional: GuideTask[];
    clues: { role: string; text: string }[]; discoveries: { place: string; text: string }[]; news: string[]; pacing: string;
    thiefBrief: { instructions: string; story: string; carry: boolean } | null;
};
export type TeacherGuide = {
    campaign: { id: string; title: string; revision: string }; game: { id: string; name: string } | null;
    currentChapter: number; summary: string; chapters: GuideChapter[];
};
export type GuideContext = {
    roleNames?: Record<string, string[]>;
    thiefNames?: string[][];
    clueText?: (text: string, chapter: number) => string;
};

const opening = (text: string) => text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
const short = (text: string, max = 200) => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

export function buildGuide(campaign: Campaign, context: GuideContext = {}): Pick<TeacherGuide, 'summary' | 'chapters'> {
    const objectives = campaign.chapters.flatMap(c => c.objectives);
    const main = objectives.filter(o => !o.optional);
    const witnesses = main.filter(o => o.conversation).length;
    const summary = [
        `${campaign.chapters.length} ${campaign.chapters.length === 1 ? 'chapter' : 'chapters'}.`,
        witnesses === 0 ? 'Students share clues in chat and answer in their Journal.'
            : `${witnesses === main.length ? 'Every main answer needs' : 'Marked questions need'} a witness exchange in the Journal.`,
        objectives.some(o => o.activity) ? 'Partner quests add an assigned-partner exchange and a report.' : '',
    ].filter(Boolean).join(' ');
    const roleName = (id: string) => campaign.roles.find(r => r.id === id)?.name ?? id;
    const roles = (clues: Record<string, string>, index: number) => Object.entries(clues).map(([id, text]) => ({
        role: roleName(id), text: context.clueText?.(text, index) ?? text.replace(/\{(?:hat|coat|glasses|hair)\}/g, '(matches the thief’s avatar when chosen)'),
    }));
    return { summary, chapters: campaign.chapters.map((chapter, index): GuideChapter => {
        const compulsory = chapter.objectives.filter(o => !o.optional);
        const requiredWitnesses = compulsory.filter(o => o.conversation);
        const task = (o: Objective): GuideTask => {
            const count = o.conversation?.witnesses ?? (o.activity ? 1 : 0);
            const steps: string[] = [];
            if (o.board) {
                if (o.board.teacherReleased) steps.push('If the task is hidden, use Release quest in Teacher controls to make it visible.');
                if (o.board.afterMain) steps.push(o.activity ? 'Both students finish the main mystery first.' : 'Finish the main mystery first.');
                if (o.board.roles?.length) steps.push(`Available to: ${o.board.roles.map(roleName).join(', ')}.`);
                steps.push(o.activity ? `Accept the quest on the quest board. The app assigns ${o.board.differentRole ? 'a partner with a different role' : o.board.partnerRole ? `a ${roleName(o.board.partnerRole)}` : 'a partner'}.`
                    : 'Accept the quest on the quest board.');
            }
            if (count) {
                if (!o.activity) steps.push(`Open this question in the Journal and choose ${count === 2 ? 'two different witnesses' : 'a witness'} from the online classmates.`);
                steps.push('Ask about this task and attach a private clue. Approve the question in the teacher queue.');
                steps.push('The witness replies in their Journal and attaches their own private clue. Approve the reply.');
                if (count === 2) steps.push('Repeat with a second, different witness for this same question.');
                steps.push(o.activity === 'exchange' ? 'Compare both contributions and agree on a response; each investigator submits their own report.'
                    : 'Compare the evidence, then submit the answer or report in the Journal.');
            } else steps.push('Read the private clues, ask classmates in chat, then submit the answer in the Journal.');

            let answer: string;
            if (o.kind === 'report') answer = 'A report of at least 5 words. The app records the attempt; you assess the reasoning and English.';
            else if (o.answerThief) {
                const names = context.thiefNames?.[index] ?? [];
                answer = names.length ? `A selected thief’s name: ${names.join(' / ')}.` : 'The name of a student selected as thief when this chapter starts.';
                steps.push('Combine the avatar descriptions and alibis to identify the thief. Thieves skip this question.');
            } else if (o.answerRole) {
                const names = context.roleNames?.[o.answerRole] ?? [];
                answer = `${roleName(o.answerRole)}: ${names.length ? names.join(' / ') : 'enter a classmate’s shown name'}.`;
                steps.push(`Find a classmate playing ${roleName(o.answerRole)} and use their shown name, not your own. If nobody else with that role is online, the role’s name is accepted.`);
            } else answer = o.accept.join(' / ');
            if (o.thiefKnows) steps.push('This answer is already completed for the thief.');
            const ids = prerequisiteIds(o);
            const prerequisites = ids.length ? `${o.requires?.mode === 'any' ? 'After either' : 'After'}: ${ids.map(id => short(chapter.objectives.find(p => p.id === id)?.text ?? id, 110)).join(o.requires?.mode === 'any' ? ' OR ' : ' + ')}` : null;
            // Send each clue once. The page follows prerequisite ids when a
            // teacher opens a task, instead of multiplying long role notes by
            // every question in a large/custom campaign.
            return { id: o.id, title: short(opening(o.text)), task: o.text, answer, steps, prerequisites, witnesses: count,
                minimumPlayers: Math.max(o.board?.minPlayers ?? 1, count ? count + 1 : 1),
                before: [...new Set([...ids, ...(o.board?.afterMain ? compulsory.map(main => main.id) : [])])], unlockedClues: roles(o.rewards ?? {}, index) };
        };
        const play = requiredWitnesses.length ? [
            'Read private clues and open the question in the Journal.',
            `${requiredWitnesses.length === compulsory.length ? 'For each main question' : 'For questions marked Witness'}: choose a witness → ask and attach a clue → the witness replies with a clue → the answer opens. You can take down a message afterwards.`,
            'Compare the evidence, then submit the answer.' + (compulsory.some(o => o.conversation?.witnesses === 2) ? ' The task marked “2 witnesses” needs two different classmates.' : ''),
        ] : ['Read the private role clue → ask classmates in chat → combine what they know → answer in the Journal.',
            ...(compulsory.some(o => o.rewards) ? ['Correct answers unlock more private clues; students share those to solve the next question.'] : [])];
        return { id: chapter.id, title: chapter.title, mission: short(chapter.intro, 300), play,
            main: compulsory.map(task), optional: chapter.objectives.filter(o => o.optional).map(task),
            clues: roles(Object.fromEntries(campaign.roles.map(r => [r.id, chapter.roleClues?.[r.id] ?? r.clue])), index),
            thiefBrief: chapter.thieves ? { instructions: chapter.thieves.card, story: chapter.thieves.story, carry: !!chapter.thieves.carry } : null,
            discoveries: chapter.discoveries.map(d => ({ place: d.zone, text: d.text })), news: chapter.reveals.map(r => r.text),
            pacing: `Ready when ${Number((chapter.share * 100).toFixed(2))}% of the class finishes every main task. Optional tasks do not hold up the chapter. You start the next chapter when ready.`,
        };
    }) };
}
