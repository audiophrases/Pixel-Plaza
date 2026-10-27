import type { Campaign, Chapter } from './campaign.ts';

export const mentionsQuestBoard = (chapter: Chapter) => /quest board/i.test([chapter.intro, chapter.ending, chapter.recap, ...chapter.objectives.map(o => o.text)].join(' '));
// A compact comparison key, not an identity or a security hash. Exclude extra activities
// and witness requirements so variants of the same main questions can be compared.
function questionKey(chapter: Chapter): string {
    const text = JSON.stringify(chapter.objectives.filter(o => !o.optional).map(o => [o.text, o.accept, o.answerRole, o.answerThief, o.kind]));
    let hash = 2166136261;
    for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return `${chapter.objectives.filter(o => !o.optional).length}:${text.length}:${hash >>> 0}`;
}
export function missionOverview(campaign: Campaign) {
    const tasks = campaign.chapters.flatMap(c => c.objectives);
    const main = tasks.filter(o => !o.optional);
    const board = tasks.filter(o => o.board);
    const starter = !board.length && campaign.chapters.some(mentionsQuestBoard) && main.every(o => o.kind === 'report');
    const mystery = tasks.some(o => o.answerThief);
    return {
        kind: starter ? 'Quest session starter' : mystery ? 'Clue-solving story' : 'Classroom activities',
        description: starter ? 'A short written check-in for each session. You choose and add the activities students play afterwards.'
            : mystery ? 'Students share private clues, answer questions and identify a classmate playing the secret thief.'
                : main.some(o => o.kind !== 'report') ? 'Students use their role information to complete questions in their Journal.' : 'Students complete written activities in their Journal; you review their responses.',
        main: main.length, bonus: tasks.filter(o => o.optional && !o.board).length, board: board.length,
        partners: board.filter(o => o.activity).length, witnesses: main.filter(o => o.conversation).length,
        teacherReleased: board.filter(o => o.board?.teacherReleased).length, roles: campaign.roles.length,
        needsQuests: campaign.chapters.filter(c => mentionsQuestBoard(c) && !c.objectives.some(o => o.board)).length,
        chapters: campaign.chapters.map(c => ({ title: c.title, questions: questionKey(c), main: c.objectives.filter(o => !o.optional).length, board: c.objectives.filter(o => o.board).length })),
    };
}
export type MissionOverview = ReturnType<typeof missionOverview>;
export function matchingChapters(a?: MissionOverview, b?: MissionOverview): number {
    if (!a || !b) return 0;
    let count = 0;
    while (count < a.chapters.length && count < b.chapters.length && a.chapters[count].main > 0 && a.chapters[count].questions === b.chapters[count].questions) count++;
    return count;
}
