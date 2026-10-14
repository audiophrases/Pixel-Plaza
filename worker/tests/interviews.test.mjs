import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Interviews } from '../interviews.ts';
import { castanyadaInvestigations, castanyadaComplete } from '../../shared/campaign.ts';
import { missionJson, parseMission, missionEnvelope, validateMission } from '../../shared/missionSchema.ts';

function repository() {
    const db = new DatabaseSync(':memory:');
    const sql = { exec(query, ...args) {
        if (!args.length && query.includes(';')) { db.exec(query); return { toArray: () => [] }; }
        const statement = db.prepare(query);
        const rows = statement.columns().length ? statement.all(...args) : (statement.run(...args), []);
        return { toArray: () => rows };
    } };
    const interviews = new Interviews(sql); interviews.initialize();
    return { interviews, db };
}

test('witness investigations roundtrip and require participation for all main conclusions', () => {
    assert.deepEqual(parseMission(missionJson(castanyadaInvestigations)).campaign, castanyadaInvestigations);
    for (const chapter of castanyadaInvestigations.chapters) {
        for (const objective of chapter.objectives.filter(o => !o.optional)) {
            assert.equal(objective.conversation.witnesses, objective.answerThief ? 2 : 1);
        }
    }
    assert.ok(castanyadaComplete.chapters.every(c => c.objectives.every(o => !o.conversation)), 'legacy template retains its previous main objectives');
    for (const witnesses of [0, 3, '2', null]) {
        const envelope = missionEnvelope(structuredClone(castanyadaInvestigations));
        envelope.campaign.chapters[0].objectives[0].conversation.witnesses = witnesses;
        assert.equal(validateMission(envelope).campaign, null);
    }
});

test('only approved, distinct witnesses for the same investigator, quest and chapter count', () => {
    const { interviews, db } = repository();
    const question = { id: 'one', game_id: 'game', chapter: 0, objective: 'mystery', investigator: 'alex', witness: 'sam', question_id: 'q1', question: 'Where did it go?', question_status: 'pending', shared: 'My private clue.' };
    interviews.ask(question);
    interviews.reply('one', 'a1', 'I saw it near the park.', 'A private witness clue.', 'pending');
    assert.equal(interviews.completed('game', 0, 'mystery', 'alex'), 0);
    interviews.review('q1', 'approved');
    assert.equal(interviews.completed('game', 0, 'mystery', 'alex'), 0);
    interviews.review('a1', 'approved');
    assert.equal(interviews.completed('game', 0, 'mystery', 'alex'), 1);
    assert.equal(interviews.completed('game', 1, 'mystery', 'alex'), 0);
    assert.equal(interviews.completed('game', 0, 'other', 'alex'), 0);
    assert.equal(interviews.completed('game', 0, 'mystery', 'chris'), 0);
    assert.equal(interviews.completed('game', 0, 'mystery', 'alex', 'chris'), 0, 'replacement partner requires a new exchange');
    interviews.ask({ ...question, id: 'two', witness: 'chris', question_id: 'q2', question_status: 'approved' });
    interviews.reply('two', 'a2', 'I saw it by the water.', 'The only water is the pond.', 'approved');
    assert.equal(interviews.completed('game', 0, 'mystery', 'alex'), 2);
    interviews.review('a1', 'removed');
    assert.equal(interviews.completed('game', 0, 'mystery', 'alex'), 1, 'removed replies do not unlock conclusions');
    const afterRestart = new Interviews(interviews.sql); afterRestart.initialize();
    assert.equal(afterRestart.completed('game', 0, 'mystery', 'alex'), 1);
    afterRestart.clear('game'); assert.deepEqual(afterRestart.rows('game', 0), []);
    db.close();
});

test('unapproved evidence and other students\' exchanges stay private', () => {
    const { interviews, db } = repository();
    const names = new Map([['alex', 'Alex'], ['sam', 'Sam']]); const tasks = new Map([['mystery', 'Find the box.']]);
    interviews.ask({ id: 'one', game_id: 'game', chapter: 0, objective: 'mystery', investigator: 'alex', witness: 'sam', question_id: 'q1', question: 'Where did it go?', question_status: 'pending', shared: 'Secret investigator clue.' });
    assert.deepEqual(interviews.view('game', 0, 'sam', names, tasks), []);
    interviews.review('q1', 'approved');
    assert.equal(interviews.view('game', 0, 'sam', names, tasks)[0].shared, 'Secret investigator clue.');
    interviews.reply('one', 'a1', 'I saw a delivery.', 'Secret witness clue.', 'pending');
    const pending = interviews.view('game', 0, 'alex', names, tasks)[0];
    assert.equal(pending.answer, null); assert.equal(pending.evidence, null);
    assert.deepEqual(interviews.view('game', 0, 'chris', names, tasks), []);
    interviews.review('a1', 'approved');
    assert.equal(interviews.view('game', 0, 'alex', names, tasks)[0].evidence, 'Secret witness clue.');
    db.close();
});
