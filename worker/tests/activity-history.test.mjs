import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ActivityHistory } from '../activityHistory.ts';
import { assignedWarmupTasks, matchesPlayFilter, pairTaskId } from '../../shared/activityHistory.ts';
import { defaultWarmup } from '../../shared/warmupConfig.ts';

function storage() {
    const db = new DatabaseSync(':memory:');
    const sql = { exec(query, ...args) {
        if (!args.length && query.includes(';')) { db.exec(query); return { toArray: () => [] }; }
        const stmt = db.prepare(query), rows = stmt.columns().length ? stmt.all(...args) : (stmt.run(...args), []);
        return { toArray: () => rows };
    } };
    const history = new ActivityHistory(sql); history.initialize();
    return { db, sql, history, view: id => history.view({ id, name: id }, [{ id, name: id }]) };
}
test('class plays are deduplicated per run, independent across games, persistent and cleared only with their game', () => {
    const { db, sql, history, view } = storage();
    try {
        history.record('3a', 'quest', 'park', 'lesson1', 'Park plan', 100);
        history.record('3a', 'quest', 'park', 'lesson1', 'Park plan', 200);
        history.record('3a', 'quest', 'park', 'lesson2', 'A renamed plan', 300);
        history.record('3b', 'quest', 'park', 'lesson1', 'Park plan', 400);
        assert.deepEqual(view('3a').quests.park, { plays: 2, lastPlayed: 300, recovered: false });
        assert.equal(view('3b').quests.park.plays, 1);
        assert.deepEqual(new ActivityHistory(sql).view({ id: '3a', name: '3a' }, []).quests, view('3a').quests);
        assert.equal(view('3a').recent[0].title, 'A renamed plan');
        assert.equal(matchesPlayFilter(undefined, 'never'), true);
        assert.equal(matchesPlayFilter(view('3a').quests.park, 'never'), false);
        assert.equal(matchesPlayFilter(view('3a').quests.park, 'played'), true);
        history.clear('3b'); assert.deepEqual(view('3b').quests, {}); assert.equal(view('3a').quests.park.plays, 2);
    } finally { db.close(); }
});
test('warm-up counts include only assigned tasks, late additions share a run and restarted rounds add one play', () => {
    const { db, history, view } = storage();
    try {
        const identity = defaultWarmup('identity'); identity.identities = identity.identities.slice(0, 3);
        const players = identity.identities.slice(0, 2).map(row => ({ fact: row.id, targets: [] }));
        history.warmup('3a', 100, identity, players);
        history.warmup('3a', 100, identity, players);
        assert.equal(view('3a').warmups.identity.plays, 1);
        assert.equal(Object.keys(view('3a').tasks.identity).length, 2);
        assert.equal(view('3a').tasks.identity[identity.identities[2].id], undefined);
        history.warmup('3a', 100, identity, [...players, { fact: identity.identities[2].id, targets: [] }]);
        assert.equal(view('3a').warmups.identity.plays, 1); assert.equal(Object.keys(view('3a').tasks.identity).length, 3);
        history.warmup('3a', 200, identity, players);
        assert.equal(view('3a').warmups.identity.plays, 2);
        assert.equal(view('3a').tasks.identity[players[0].fact].plays, 2);
        assert.equal(view('3a').tasks.identity[identity.identities[2].id].plays, 1);
        const pairs = defaultWarmup('pairs');
        history.warmup('3a', 300, pairs, [{ fact: pairs.pairs[0][0], targets: [] }, { fact: pairs.pairs[0][1], targets: [] }]);
        assert.deepEqual(Object.keys(view('3a').tasks.pairs), [pairTaskId(pairs.pairs[0])]);
        assert.equal(pairTaskId([' Pepper ', 'SALT']), pairTaskId(['salt', 'pepper']));
        const facts = defaultWarmup('facts');
        const assigned = assignedWarmupTasks(facts, [{ fact: facts.facts[0].id, targets: [facts.facts[1].id] }]);
        assert.deepEqual(assigned.map(row => row.id), facts.facts.slice(0, 2).map(row => row.id));
    } finally { db.close(); }
});
test('legacy recovery is a labelled minimum, excludes waiting groups and does not replay during later startups', () => {
    const { db, sql, history, view } = storage();
    try {
        db.exec(`CREATE TABLE quest_assignments (game_id TEXT, objective TEXT, student_key TEXT, accepted INTEGER);
            CREATE TABLE game_side_quests (game_id TEXT, quest_id TEXT, content TEXT);
            CREATE TABLE side_quest_groups (game_id TEXT, group_id TEXT, objective TEXT, state TEXT);
            CREATE TABLE side_quest_members (game_id TEXT, group_id TEXT, student_key TEXT);
            CREATE TABLE side_quest_done (game_id TEXT, quest_id TEXT);
            CREATE TABLE warmups (game_id TEXT, started INTEGER, kind TEXT, definition TEXT);
            CREATE TABLE warmup_players (game_id TEXT, fact TEXT, targets TEXT);`);
        sql.exec('INSERT INTO game_side_quests VALUES (?, ?, ?)', '3a', 'solo', JSON.stringify({ text: 'Solo task' }));
        sql.exec("INSERT INTO quest_assignments VALUES ('3a', 'solo', 'alex', 200), ('3a', 'solo', 'sam', 210), ('3a', 'waiting', 'sam', 220)");
        sql.exec("INSERT INTO side_quest_groups VALUES ('3a', 'g1', 'waiting', 'open'), ('3a', 'g2', 'other', 'done')");
        sql.exec("INSERT INTO side_quest_members VALUES ('3a', 'g1', 'sam'), ('3a', 'g2', 'sam')");
        sql.exec("INSERT INTO side_quest_done VALUES ('3a', 'finished')");
        const definition = defaultWarmup('identity');
        sql.exec('INSERT INTO warmups VALUES (?, ?, ?, ?)', '3a', 250, 'identity', JSON.stringify(definition));
        sql.exec('INSERT INTO warmup_players VALUES (?, ?, ?)', '3a', definition.identities[0].id, '[]');
        history.recover({ game: '3a', session: 'current', opened: 100 });
        const snapshot = view('3a');
        assert.equal(snapshot.quests.solo.plays, 1); assert.equal(snapshot.quests.solo.recovered, true);
        assert.equal(snapshot.quests.waiting, undefined); assert.equal(snapshot.quests.finished.lastPlayed, null);
        assert.equal(snapshot.warmups.identity.plays, 1); assert.equal(snapshot.warmups.identity.recovered, true);
        history.record('3a', 'quest', 'solo', 'current', 'Solo task', 300);
        assert.equal(view('3a').quests.solo.plays, 1, 'deploying during a lesson does not invent another class play');
        sql.exec("INSERT INTO quest_assignments VALUES ('3a', 'later', 'alex', 500)");
        history.recover(); assert.equal(view('3a').quests.later, undefined);
    } finally { db.close(); }
});
