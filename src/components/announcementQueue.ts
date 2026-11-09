import type { BoardView, QuestView, TextHelp } from '../../shared/campaign';
import type { WarmupView } from '../../shared/warmup';
import { IDENTITY_CHAT_REMINDER } from '../../shared/activityChat.ts';
import type { EvidenceImage } from '../../shared/evidence';

export type ActivityInstruction = { label: string; text: string; help?: TextHelp; image?: EvidenceImage; answer?: boolean };
export type ActivityAnnouncement = {
    id: string; acknowledge: string[]; kind: 'chapter' | 'warmup' | 'task' | 'board' | 'news' | 'ending';
    eyebrow: string; title: string; sections: ActivityInstruction[]; next: string;
};
const key = (...parts: unknown[]) => JSON.stringify(parts);
const witnessText = (count: number) => `In the Journal, use Choose a witness to exchange evidence with ${count === 1 ? 'one classmate' : `${count} different classmates`}. When they have replied, submit your answer in the Journal.`;
const taskInstructions = (objective: QuestView['objectives'][number]): ActivityInstruction[] => [
    { label: objective.optional ? 'Optional task' : 'Your task', text: objective.text, help: objective.help, answer: true },
    ...(objective.conversation ? [{ label: 'Talk before answering', text: witnessText(objective.conversation.required),
        ...(objective.help?.ca ? { help: { ca: `Al Journal, prem «Choose a witness» i intercanvia proves amb ${objective.conversation.required === 1 ? 'un company' : `${objective.conversation.required} companys diferents`}. Quan hagin respost, envia la teva resposta en anglès.` } } : {}) }] : []),
];

// Build only from the server's private view for this student. The browser never
// needs the campaign definition, answers, or another role's clues. `board`: the quest board, with or without a campaign.
export function activityAnnouncements(quest: QuestView | null, warmup: WarmupView | null, seen: ReadonlySet<string>, board: BoardView | null = null): ActivityAnnouncement[] {
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
    const run = quest ? key(quest.runId ?? quest.campaign.id, quest.chapter.index, quest.role.id) : '';
    const intro = key('chapter', run);
    const taskKey = (id: string) => key('task', run, id);
    const current = quest?.objectives.filter(o => !o.done) ?? [];
    // In a campaign played in teams, the student works with their team, not the whole class.
    const team = quest?.myTeam;
    const mates = team?.members.filter(member => !member.me).map(member => `${member.name} (${member.role})`) ?? [];
    if (quest && quest.status !== 'campaign_complete' && !seen.has(intro)) {
        add(intro, { kind: 'chapter', eyebrow: `CHAPTER ${quest.chapter.index + 1} OF ${quest.chapter.of}`, title: quest.chapter.title,
            sections: [
                ...(quest.recap ? [{ label: 'Previously', text: quest.recap, help: quest.recapHelp, image: quest.recapImage }] : []),
                { label: 'The story', text: quest.chapter.intro, help: quest.chapter.help?.intro, image: quest.chapter.introImage },
                // The story's characters, marked 📖, are never classmates.
                ...(quest.cast?.length ? [{ label: '📖 Story characters', text: `${quest.cast.map(member => member.name).join(', ')}. They are people in the story, not your classmates. Who’s who in your Journal says who they are.` }] : []),
                { label: `You are ${quest.role.name}`, text: quest.role.card, help: quest.role.help },
                ...(quest.secret ? [{ label: quest.secret.title, text: quest.secret.text, help: quest.secret.help }] : []),
                ...quest.clues.filter(c => c.from === 'job').map(c => ({ label: 'Your private clue', text: c.text, help: c.help })),
                ...(team ? [{ label: `Your team: ${team.name}`, text: `${mates.length ? `You work with ${mates.join(', ')}. ` : ''}Each of you has a different clue. Share yours in the 🤝 Team chat and answer together: one answer counts for the whole team.` }] : []),
                ...current.flatMap(taskInstructions),
            ], next: team ? 'Press OK, then tell your team your clue in the 🤝 Team chat. Your clues, tasks and answer boxes are in the Journal.'
                : 'Press OK, then use chat to talk to classmates. Your clues, tasks and answer boxes are in the Journal.' }, current.map(o => taskKey(o.id)));
    } else if (quest && quest.status !== 'campaign_complete') {
        const tasks = current.filter(o => !seen.has(taskKey(o.id)));
        if (tasks.length) add(taskKey(tasks[0].id), { kind: 'task', eyebrow: 'NEW TASK', title: tasks.length === 1 ? 'Your next task is ready' : `${tasks.length} new tasks are ready`, sections: tasks.flatMap(taskInstructions), next: team ? 'Read your clues and talk to your team in the 🤝 Team chat. One answer in the Journal counts for the whole team.' : 'Read your clues and talk to classmates. Submit your answers in the Journal.' }, tasks.slice(1).map(o => taskKey(o.id)));
    }
    // The quest board belongs to the game: its announcements do not depend on a mission.
    if (board) {
        const items = board.board.filter(o => !o.ended);
        // Nothing else to do: choose a side quest. Asked again each time, after finishing one.
        if (board.sideQuests.state === 'choose') {
            const open = items.filter(o => o.sideQuest && o.state === 'available');
            add(key('choose', 'board', items.filter(o => o.sideQuest && o.state === 'done').length), { kind: 'board', eyebrow: 'TIME FOR A SIDE QUEST', title: 'Choose a side quest',
                sections: open.slice(0, 5).map(o => ({ label: 'Side quest', text: o.text, help: o.help, answer: true })), next: `Press OK, then accept one in the Journal${open.length > 5 ? ` (${open.length} to choose from)` : ''}. You do one side quest at a time.` });
        }
        const available = items.filter(o => o.state === 'available' && !o.sideQuest && !seen.has(key('offer', run, o.id)));
        if (available.length) add(key('offer', run, available[0].id), { kind: 'board', eyebrow: 'OPTIONAL SIDE QUESTS', title: available.length === 1 ? 'A side quest is available' : `${available.length} side quests are available`,
            sections: available.map(o => ({ label: o.activity ? 'Partner activity' : 'Optional activity', text: o.text, help: o.help, answer: true })),
            next: 'These are optional. Press OK, then open Journal → Quest board and choose Accept quest if you want to join. OK does not accept a quest.' }, available.slice(1).map(o => key('offer', run, o.id)));
        for (const item of items) if (item.state === 'active') {
            add(key('accepted', 'board', item.id), { kind: 'board', eyebrow: 'SIDE QUEST ACCEPTED', title: item.partner ? `Work with ${item.partner.name}` : 'Your side quest is ready',
                sections: [{ label: 'What to do', text: item.text, help: item.help, answer: true }, ...(item.partner ? [{ label: 'Your partner', text: `${item.partner.name}${item.partner.online ? '' : ' is away from the plaza. You can wait or choose Find another partner in the Journal.'}` }] : []),
                    ...(item.conversation ? [{ label: 'Exchange evidence', text: witnessText(item.conversation.required) }] : []),
                    ...(item.kind === 'report' ? [{ label: 'Your report', text: 'Write what you learned in the Journal. Your teacher will read your response.' }] : [])], next: 'Your side quest and its answer box are in the Journal.' }, [key('offer', run, item.id)]);
        }
        for (const item of items) if (item.state === 'active' && item.group?.state === 'playing') {
            add(key('group', 'board', item.id), { kind: 'board', eyebrow: item.group.size === 2 ? 'YOUR PAIR IS READY' : 'YOUR GROUP IS READY', title: `Work with ${item.group.members.join(', ')}`,
                sections: [{ label: 'What to do', text: item.text, help: item.help, answer: true }, { label: 'Together', text: 'Find each other in the plaza and talk. One answer in the Journal counts for everyone.' }],
                next: 'The quest and its answer box are in the Journal.' });
        }
    }
    if (!quest) return result;
    if (quest.status !== 'campaign_complete') {
        const news = quest.clues.filter(c => c.from === 'news' && !seen.has(key('news', run, c.id)));
        if (news.length) add(key('news', run, news[0].id), { kind: 'news', eyebrow: 'FROM YOUR TEACHER', title: 'New information for the class', sections: news.map(c => ({ label: 'Teacher announcement', text: c.text, help: c.help, image: c.image })), next: 'You can read this again in your Journal clues.' }, news.slice(1).map(c => key('news', run, c.id)));
    }
    if (quest.status === 'campaign_complete' && quest.endedEarly) add(key('ended', run), { kind: 'ending', eyebrow: 'STORY ENDED', title: quest.campaign.title, sections: [{ label: 'The story ends here', text: 'Your teacher ended this story. Your Journal keeps what you found, and you keep your XP.' }], next: 'You can do side quests until your teacher tells you what comes next.' });
    else if (quest.status === 'campaign_complete' && quest.finale) add(key('finale', run), { kind: 'ending', eyebrow: 'MISSION COMPLETE', title: quest.campaign.title, sections: [{ label: 'The ending', text: quest.finale, help: quest.finaleHelp }], next: 'Your Journal keeps the story and your discoveries.' });
    else if (quest.chapter.ending) add(key('ending', run), { kind: 'ending', eyebrow: 'CHAPTER COMPLETE', title: quest.chapter.title, sections: [{ label: 'What happens next', text: quest.chapter.ending, help: quest.chapter.help?.ending, image: quest.chapter.endingImage }], next: 'You can keep helping classmates and doing optional quests until your teacher starts the next chapter.' });
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
