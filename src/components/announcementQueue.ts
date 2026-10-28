import type { QuestView } from '../../shared/campaign';
import type { WarmupView } from '../../shared/warmup';
import { IDENTITY_CHAT_REMINDER } from '../../shared/activityChat.ts';

export type ActivityInstruction = { label: string; text: string };
export type ActivityAnnouncement = {
    id: string; acknowledge: string[]; kind: 'chapter' | 'warmup' | 'task' | 'board' | 'news' | 'ending';
    eyebrow: string; title: string; sections: ActivityInstruction[]; next: string;
};
const key = (...parts: unknown[]) => JSON.stringify(parts);
const witnessText = (count: number) => `In the Journal, use Choose a witness to exchange evidence with ${count === 1 ? 'one classmate' : `${count} different classmates`}. Your teacher approves the question and reply. Then submit your answer in the Journal.`;
const taskInstructions = (objective: QuestView['objectives'][number]): ActivityInstruction[] => [
    { label: objective.optional ? 'Optional task' : 'Your task', text: objective.text },
    ...(objective.conversation ? [{ label: 'Talk before answering', text: witnessText(objective.conversation.required) }] : []),
];

// Build only from the server's private view for this student. The browser never
// needs the campaign definition, answers, or another role's clues.
export function activityAnnouncements(quest: QuestView | null, warmup: WarmupView | null, seen: ReadonlySet<string>): ActivityAnnouncement[] {
    const result: ActivityAnnouncement[] = [];
    const add = (id: string, content: Omit<ActivityAnnouncement, 'id' | 'acknowledge'>, extra: string[] = []) => {
        if (!seen.has(id)) result.push({ id, acknowledge: [id, ...extra], ...content });
    };
    if (warmup) {
        const run = warmup.runId ?? `legacy:${warmup.kind}:${warmup.title ?? ''}`;
        const intro = key('warmup', run), step = key('warmup-task', run, warmup.step);
        const title = warmup.title ?? (warmup.kind === 'identity' ? 'Who am I?' : warmup.kind === 'pairs' ? 'Find your pair' : 'Find someone who…');
        const sections = [
            { label: 'How to play', text: warmup.instructions || 'Talk to your classmates to find the person described in your task.' },
            { label: warmup.kind === 'pairs' ? 'Your word' : 'Your private information', text: warmup.fact },
            ...(warmup.kind === 'identity' ? [{ label: 'Keep the secret', text: IDENTITY_CHAT_REMINDER }] : []),
            ...(warmup.task ? [{ label: `Your task · ${warmup.step + 1} of ${warmup.of}`, text: warmup.task }] : []),
        ];
        if (warmup.task && !seen.has(intro)) add(intro, { kind: 'warmup', eyebrow: 'WARM-UP STARTING', title, sections, next: 'Press OK to begin. Your task and answer box stay in the Warm-up panel.' }, [step]);
        else if (warmup.task) add(step, { kind: 'warmup', eyebrow: 'NEXT WARM-UP TASK', title, sections, next: 'Ask classmates, then enter the answer in the Warm-up panel.' });
        else add(key('warmup-done', run), { kind: 'ending', eyebrow: 'WARM-UP COMPLETE', title: 'You did it!', sections: [{ label: title, text: warmup.kind === 'identity' ? 'Keep helping with yes or no answers, without giving away your secret identity.' : 'You finished your tasks. Keep helping your classmates.' }], next: 'Your teacher will tell you what comes next.' }, [intro, step]);
    }
    if (!quest) return result;
    const run = key(quest.runId ?? quest.campaign.id, quest.chapter.index, quest.role.id);
    const intro = key('chapter', run);
    const taskKey = (id: string) => key('task', run, id);
    const current = quest.objectives.filter(o => !o.done);
    if (quest.status !== 'campaign_complete' && !seen.has(intro)) {
        add(intro, { kind: 'chapter', eyebrow: `CHAPTER ${quest.chapter.index + 1} OF ${quest.chapter.of}`, title: quest.chapter.title,
            sections: [
                ...(quest.recap ? [{ label: 'Previously', text: quest.recap }] : []),
                { label: 'The story', text: quest.chapter.intro },
                { label: `You are ${quest.role.name}`, text: quest.role.card },
                ...(quest.secret ? [{ label: quest.secret.title, text: quest.secret.text }] : []),
                ...quest.clues.filter(c => c.from === 'job').map(c => ({ label: 'Your private clue', text: c.text })),
                ...current.flatMap(taskInstructions),
            ], next: 'Press OK, then use chat to talk to classmates. Your clues, tasks and answer boxes are in the Journal.' }, current.map(o => taskKey(o.id)));
    } else if (quest.status !== 'campaign_complete') {
        const tasks = current.filter(o => !seen.has(taskKey(o.id)));
        if (tasks.length) add(taskKey(tasks[0].id), { kind: 'task', eyebrow: 'NEW TASK', title: tasks.length === 1 ? 'Your next task is ready' : `${tasks.length} new tasks are ready`, sections: tasks.flatMap(taskInstructions), next: 'Read your clues and talk to classmates. Submit your answers in the Journal.' }, tasks.slice(1).map(o => taskKey(o.id)));
    }
    if (quest.status !== 'campaign_complete') {
        const available = (quest.board ?? []).filter(o => o.state === 'available' && !seen.has(key('offer', run, o.id)));
        if (available.length) add(key('offer', run, available[0].id), { kind: 'board', eyebrow: 'OPTIONAL SIDE QUESTS', title: available.length === 1 ? 'A side quest is available' : `${available.length} side quests are available`,
            sections: available.map(o => ({ label: o.activity ? 'Partner activity' : 'Optional activity', text: o.text })),
            next: 'These are optional. Press OK, then open Journal → Quest board and choose Accept quest if you want to join. OK does not accept a quest.' }, available.slice(1).map(o => key('offer', run, o.id)));
        for (const item of quest.board ?? []) if (item.state === 'active') {
            add(key('accepted', run, item.id), { kind: 'board', eyebrow: 'SIDE QUEST ACCEPTED', title: item.partner ? `Work with ${item.partner.name}` : 'Your side quest is ready',
                sections: [{ label: 'What to do', text: item.text }, ...(item.partner ? [{ label: 'Your partner', text: `${item.partner.name}${item.partner.online ? '' : ' is away from the plaza. You can wait or choose Find another partner in the Journal.'}` }] : []),
                    ...(item.conversation ? [{ label: 'Exchange evidence', text: witnessText(item.conversation.required) }] : []),
                    ...(item.kind === 'report' ? [{ label: 'Your report', text: 'Write what you learned in the Journal. Your teacher will read your response.' }] : [])], next: 'Your side quest and its answer box are in Journal → Quest board.' }, [key('offer', run, item.id)]);
        }
        const news = quest.clues.filter(c => c.from === 'news' && !seen.has(key('news', run, c.id)));
        if (news.length) add(key('news', run, news[0].id), { kind: 'news', eyebrow: 'FROM YOUR TEACHER', title: 'New information for the class', sections: news.map(c => ({ label: 'Teacher announcement', text: c.text })), next: 'You can read this again in your Journal clues.' }, news.slice(1).map(c => key('news', run, c.id)));
    }
    if (quest.status === 'campaign_complete' && quest.finale) add(key('finale', run), { kind: 'ending', eyebrow: 'MISSION COMPLETE', title: quest.campaign.title, sections: [{ label: 'The ending', text: quest.finale }], next: 'Your Journal keeps the story and your discoveries.' });
    else if (quest.chapter.ending) add(key('ending', run), { kind: 'ending', eyebrow: 'CHAPTER COMPLETE', title: quest.chapter.title, sections: [{ label: 'What happens next', text: quest.chapter.ending }], next: 'You can keep helping classmates and doing optional quests until your teacher starts the next chapter.' });
    return result;
}

export function readAcknowledgements(storageKey: string): Set<string> {
    try { const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]'); return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(-1500) : []); }
    catch { return new Set(); }
}
export function saveAcknowledgements(storageKey: string, seen: ReadonlySet<string>) {
    // Store only IDs, never private clues, instructions or authentication tokens.
    try { localStorage.setItem(storageKey, JSON.stringify([...seen].slice(-1500))); } catch { /* Acknowledgement still works for this visit when browser storage is blocked. */ }
}
