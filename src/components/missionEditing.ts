import { prerequisiteIds, type Campaign, type Chapter, type Objective } from '../../shared/campaign';
import type { MissionIssue } from '../../shared/missionSchema';

export const stepTypes = [
    { id: 'text', name: 'Short answer', icon: 'Aa', description: 'Ask a question and choose the answers that count.' },
    { id: 'report', name: 'Written response', icon: '✎', description: 'Students write a few sentences for you to read.' },
    { id: 'role', name: 'Find a classmate', icon: '☏', description: 'Students find someone with a particular role.' },
    { id: 'thief', name: 'Solve the mystery', icon: '?', description: 'Students identify the secret thief in this chapter.' },
    { id: 'interview', name: 'Partner interview', icon: '↔', description: 'An optional quest: interview a partner, then write a report.' },
    { id: 'exchange', name: 'Compare information', icon: '⇄', description: 'An optional quest: exchange evidence with a partner and report.' },
] as const;
export type StepType = typeof stepTypes[number]['id'];
export const stepType = (objective: Objective): StepType => objective.activity ?? (objective.kind === 'report' ? 'report' : objective.answerRole ? 'role' : objective.answerThief ? 'thief' : 'text');
export const freshId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
export function moveItem<T>(items: T[], index: number, offset: number): T[] {
    const next = [...items]; const target = index + offset;
    if (target < 0 || target >= next.length) return next;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}
export function changeStepType(objective: Objective, type: StepType, roleId?: string): Objective {
    const social = type === 'interview' || type === 'exchange';
    return { ...objective, kind: type === 'report' || social ? 'report' : undefined,
        activity: social ? type : undefined, answerRole: type === 'role' ? roleId : undefined,
        answerThief: type === 'thief' ? true : undefined, accept: type === 'text' && stepType(objective) === 'text' ? objective.accept : [],
        board: type === 'thief' ? undefined : social ? { ...objective.board, minPlayers: Math.max(2, objective.board?.minPlayers ?? 2), afterMain: objective.board?.afterMain ?? true } : objective.board ? { ...objective.board, partnerRole: undefined, differentRole: undefined } : undefined,
        conversation: social ? undefined : objective.conversation,
        thiefKnows: social || objective.board ? undefined : objective.thiefKnows,
        optional: social ? true : objective.optional };
}
// Removing a step also removes its links, so a teacher never inherits a dangling prerequisite.
export function removeStep(chapter: Chapter, id: string): Chapter {
    return { ...chapter, objectives: chapter.objectives.filter(o => o.id !== id).map(o => {
        if (!prerequisiteIds(o).includes(id)) return o;
        const ids = prerequisiteIds(o).filter(value => value !== id);
        return { ...o, after: o.after ? undefined : o.after, requires: o.requires && ids.length ? { ...o.requires, objectives: ids } : undefined };
    }) };
}
export function issueLocation(campaign: Campaign, issue: MissionIssue) {
    const chapterIndex = Number(issue.path.match(/chapters\[(\d+)\]/)?.[1] ?? -1);
    const stepIndex = Number(issue.path.match(/objectives\[(\d+)\]/)?.[1] ?? -1);
    const roleIndex = Number(issue.path.match(/^roles\[(\d+)\]/)?.[1] ?? -1);
    const names: Record<string, string> = { title: 'Title', finale: 'Mission ending', intro: 'Opening story', recap: 'Recap', ending: 'Chapter ending', text: 'Student instructions', accept: 'Accepted answers', requires: 'When the step opens', answerRole: 'Classmate role', objectives: 'Steps', card: 'Role card', clue: 'Starting clue', name: 'Role name', thieves: 'Secret thief', share: 'Class readiness', rewards: 'Reward clues', roleClues: 'Chapter clues', discoveries: 'Map clues', reveals: 'Teacher news', conversation: 'Evidence exchanges', board: 'Quest board', activity: 'Step type' };
    const field = issue.path.includes('.requires') ? 'requires' : issue.path.includes('.rewards') ? 'rewards' : issue.path.includes('.roleClues') ? 'roleClues' : issue.path.split('.').at(-1)!.replace(/\[\d+\]/g, '');
    const location = chapterIndex >= 0 ? `Chapter ${chapterIndex + 1}${stepIndex >= 0 ? ` · Step ${stepIndex + 1}` : ''}` : roleIndex >= 0 ? campaign.roles[roleIndex]?.name || `Role ${roleIndex + 1}` : 'Mission setup';
    return { chapterIndex, stepId: campaign.chapters[chapterIndex]?.objectives[stepIndex]?.id, label: `${location} · ${names[field] ?? field}` };
}

export function missionIssueText(issue: MissionIssue) {
    const messages: Record<string, string> = {
        'Text is required.': 'Fill in this field.',
        'A main objective must be available at the start.': 'Make at least one main step available at the start of the chapter.',
        'Optional quests cannot gate the main story.': 'Main steps cannot wait for bonus or quest board tasks.',
        'Prerequisites contain a cycle.': 'These steps wait for each other. Let one open at the start, or change its required steps.',
        'This objective requires a thief chapter.': 'Enable a secret thief in this chapter’s details, or change the step type and thief options.',
    };
    return messages[issue.message] ?? issue.message.replace(/objectives/g, 'steps').replace(/objective/g, 'step').replace(/Prerequisite/g, 'Required step').replace(/prerequisite/g, 'required step');
}

// Open any folded settings before taking a teacher to the field that needs attention.
export function focusMissionIssue(path: string) {
    const editor = document.querySelector<HTMLElement>('.mission-editor');
    if (!editor) return;
    const role = path.match(/^roles\[(\d+)\]/);
    const discovery = path.match(/discoveries\[(\d+)\]/);
    const news = path.match(/reveals\[(\d+)\]/);
    const scope = role ? editor.querySelectorAll('.mission-role')[Number(role[1])]
        : discovery ? editor.querySelectorAll('[data-editor-section="map-clues"] fieldset')[Number(discovery[1])]
        : news ? editor.querySelectorAll('[data-editor-section="news"] fieldset')[Number(news[1])]
        : path.includes('.objectives[') ? editor.querySelector('.mission-step-panel') : editor;
    const field = path.includes('.requires') ? 'requires' : path.split('.').at(-1)!.replace(/\[\d+\]/g, '');
    const labels: Record<string, string> = { title: path.startsWith('chapters') ? 'Chapter title' : 'Mission title', finale: 'How does the mission end?', intro: 'Opening story', recap: 'Recap for returning', ending: 'Chapter ending', share: 'Class ready', text: discovery ? 'What do students discover?' : news ? 'News text' : 'What should students do?', accept: 'Accepted answers', name: 'Role name', card: path.includes('.thieves') ? 'Private instructions' : 'Role card', clue: 'Starting clue', story: 'Story the thief tells', label: 'Heading for the thief', answerRole: 'Which role', requires: 'When does this step', after: 'When does this step', activity: 'Step type', board: 'Where does this step', witnesses: 'Evidence exchanges', minPlayers: 'Minimum online', partnerRole: 'Partner role', zone: 'Location' };
    const label = labels[field];
    const target = [...(scope ?? editor).querySelectorAll('label')].find(el => label && el.querySelector('span')?.textContent?.startsWith(label))?.querySelector<HTMLElement>('input,textarea,select');
    let ancestor: HTMLElement | null = target ?? (scope as HTMLElement | null) ?? editor;
    while (ancestor && ancestor !== editor) { if (ancestor.tagName === 'DETAILS') (ancestor as HTMLDetailsElement).open = true; ancestor = ancestor.parentElement; }
    (target ?? editor).scrollIntoView?.({ block: 'center' });
    target?.focus({ preventScroll: true });
}
