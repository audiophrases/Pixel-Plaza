import test from 'node:test';
import assert from 'node:assert/strict';
import { activityAnnouncements } from '../../src/components/announcementQueue.ts';

const quest = () => ({ runId: 'lesson:run1', campaign: { id: 'mystery', title: 'The mystery' }, status: 'active',
    chapter: { index: 0, of: 2, title: 'Missing chestnuts', intro: 'Talk to the villagers.', ending: null },
    role: { id: 'baker', name: 'Baker', card: 'You work at the bakery.' },
    clues: [{ id: 'own', from: 'job', text: 'You saw a blue bag.' }], secret: null, thieves: null,
    objectives: [{ id: 'first', text: 'Where is the bag?', kind: 'text', done: false, optional: false }],
    board: [], team: { done: 0, total: 3 }, recap: null, finale: null });
const warmup = () => ({ runId: 'lesson:round1', kind: 'identity', title: 'Secret identities', instructions: 'Ask yes/no questions.',
    fact: 'You are a dragon.', task: 'Find your partner’s identity.', step: 0, of: 2, team: { done: 0, total: 4 } });
const acknowledge = (seen, announcement) => announcement.acknowledge.forEach(id => seen.add(id));

test('chapter instructions cover visible tasks once; newly unlocked tasks and restarted stories announce again', () => {
    const q = quest(), seen = new Set();
    const first = activityAnnouncements(q, null, seen);
    assert.equal(first.length, 1);
    assert.equal(first[0].kind, 'chapter');
    assert.match(JSON.stringify(first[0].sections), /You saw a blue bag/);
    acknowledge(seen, first[0]);
    q.team.done++;
    assert.deepEqual(activityAnnouncements(structuredClone(q), null, seen), [], 'progress and reconnects are quiet');
    q.objectives.push({ id: 'second', text: 'Ask two witnesses.', kind: 'text', optional: false, done: false,
        conversation: { required: 2, completed: 0, witnesses: [] } });
    const unlocked = activityAnnouncements(q, null, seen);
    assert.equal(unlocked.length, 1); assert.equal(unlocked[0].kind, 'task');
    assert.match(JSON.stringify(unlocked[0].sections), /2 different classmates/);
    acknowledge(seen, unlocked[0]);
    q.chapter.index++;
    assert.equal(activityAnnouncements(q, null, seen)[0].kind, 'chapter');
    q.chapter.index--; q.runId = 'lesson:run2';
    assert.equal(activityAnnouncements(q, null, seen)[0].kind, 'chapter');
});

test('side quests are offered separately from accepting, waiting quests stay quiet, news and endings announce once', () => {
    const q = quest(), seen = new Set();
    acknowledge(seen, activityAnnouncements(q, null, seen)[0]);
    q.board.push({ id: 'side', text: 'Interview a classmate.', kind: 'report', activity: 'interview', state: 'waiting', reason: 'Wait', partner: null });
    assert.deepEqual(activityAnnouncements(q, null, seen), []);
    q.board[0].state = 'available';
    const offered = activityAnnouncements(q, null, seen)[0];
    assert.match(offered.next, /OK does not accept/);
    acknowledge(seen, offered);
    q.board[0].state = 'active'; q.board[0].partner = { name: 'Sam', online: true };
    const accepted = activityAnnouncements(q, null, seen)[0];
    assert.match(accepted.title, /Sam/); acknowledge(seen, accepted);
    q.board[0].partner.online = false;
    assert.deepEqual(activityAnnouncements(q, null, seen), []);
    q.clues.push({ id: 'news1', from: 'news', text: 'The cellar is open.' });
    const news = activityAnnouncements(q, null, seen)[0];
    assert.equal(news.kind, 'news'); acknowledge(seen, news);
    q.chapter.ending = 'The chestnuts are safe.';
    const ending = activityAnnouncements(q, null, seen)[0];
    assert.equal(ending.kind, 'ending'); acknowledge(seen, ending);
    assert.deepEqual(activityAnnouncements(q, null, seen), []);
    q.status = 'campaign_complete'; q.finale = 'Happy festival!';
    const finale = activityAnnouncements(q, null, seen);
    assert.equal(finale.length, 1); assert.equal(finale[0].eyebrow, 'MISSION COMPLETE');
    acknowledge(seen, finale[0]); assert.deepEqual(activityAnnouncements(q, null, seen), []);
});

test('a student free for side quests is asked to choose one, again after each one finished; side quests are not offered twice', () => {
    const q = quest(), seen = new Set();
    acknowledge(seen, activityAnnouncements(q, null, seen)[0]);
    q.sideQuests = { state: 'locked', reason: 'Side quests open when you finish your main questions.', waiting: 2 };
    assert.deepEqual(activityAnnouncements(q, null, seen), [], 'locked side quests stay quiet');
    q.board.push({ id: 'riddle', text: 'Riddle: what has keys?', kind: 'text', activity: null, state: 'available', reason: null, partner: null, sideQuest: true },
        { id: 'chat', text: 'Chat: ask about hobbies.', kind: 'report', activity: null, state: 'available', reason: null, partner: null, sideQuest: true });
    q.sideQuests = { state: 'choose', reason: null, waiting: 2 };
    const choose = activityAnnouncements(q, null, seen);
    assert.equal(choose.length, 1, 'one prompt, not an offer as well');
    assert.equal(choose[0].title, 'Choose a side quest'); assert.equal(choose[0].sections.length, 2);
    acknowledge(seen, choose[0]);
    assert.deepEqual(activityAnnouncements(q, null, seen), []);
    q.board[0].state = 'active'; q.board.pop(); q.sideQuests = { state: 'active', reason: null, waiting: 1 };
    acknowledge(seen, activityAnnouncements(q, null, seen)[0]);
    q.board[0].state = 'done'; q.board.push({ id: 'chat', text: 'Chat: ask about hobbies.', kind: 'report', activity: null, state: 'available', reason: null, partner: null, sideQuest: true });
    q.sideQuests = { state: 'choose', reason: null, waiting: 1 };
    assert.equal(activityAnnouncements(q, null, seen)[0].title, 'Choose a side quest', 'asked again once free');
});

test('warm-up instructions precede chapters; progress, completion and new rounds have distinct acknowledgements', () => {
    const w = warmup(), q = quest(), seen = new Set();
    let pending = activityAnnouncements(q, w, seen);
    assert.deepEqual(pending.map(item => item.kind), ['warmup', 'chapter']);
    assert.match(JSON.stringify(pending[0].sections), /Keep your secret identity hidden/);
    pending.forEach(item => acknowledge(seen, item));
    w.team.done++;
    assert.deepEqual(activityAnnouncements(q, structuredClone(w), seen), []);
    w.step++; w.task = 'Ask the next partner.';
    pending = activityAnnouncements(q, w, seen);
    assert.equal(pending.length, 1); assert.equal(pending[0].eyebrow, 'NEXT WARM-UP TASK');
    acknowledge(seen, pending[0]);
    w.task = null;
    const done = activityAnnouncements(q, w, seen)[0];
    assert.equal(done.eyebrow, 'WARM-UP COMPLETE'); acknowledge(seen, done);
    assert.deepEqual(activityAnnouncements(q, w, seen), []);
    w.runId = 'lesson:round2'; w.step = 0; w.task = warmup().task;
    assert.equal(activityAnnouncements(q, w, seen)[0].eyebrow, 'WARM-UP STARTING');
    assert.deepEqual(activityAnnouncements(null, null, seen), [], 'stopped activities have no stale announcements');
});
