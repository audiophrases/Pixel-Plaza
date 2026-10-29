import test from 'node:test';
import assert from 'node:assert/strict';
import { checkReport, reportCacheKey, reportVerdict, ReportChecks, REPORT_CHECK_TIMEOUT } from '../reportFeedback.ts';
import { DatabaseSync } from 'node:sqlite';
import { parseMission, missionJson } from '../../shared/missionSchema.ts';
import { checkQuest, questObjective } from '../../shared/sideQuests.ts';
import { castanyada, sideQuests } from './fixtures/season-1.mjs';

const input = { task: 'Recommend a meeting place with two reasons.', criteria: 'One place and two reasons.', level: 'A2', answer: 'We choose the library because it is quiet.' };
const response = (value, status = 'completed') => Response.json({ status, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });

test('one compact request checks task and language, with no history, tools, reasoning or stored response', async () => {
    const old = globalThis.fetch; let calls = 0;
    globalThis.fetch = async (url, init) => {
        calls++;
        assert.equal(url, 'https://api.openai.com/v1/responses');
        const body = JSON.parse(init.body);
        assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.store, false);
        assert.deepEqual(body.reasoning, { effort: 'none' }); assert.equal(body.max_output_tokens, 100);
        assert.deepEqual(JSON.parse(body.input), input);
        assert.equal(body.text.format.strict, true); assert.equal(body.tools, undefined);
        assert.deepEqual(Object.keys(body.text.format.schema.properties), ['status', 'feedback']);
        return response({ status: 'revise', feedback: 'Add a second reason for your choice.' });
    };
    try {
        assert.deepEqual(await checkReport(input, { OPENAI_API_KEY: 'test' }), { status: 'revise', feedback: 'Add a second reason for your choice.' });
        assert.equal(calls, 1);
    } finally { globalThis.fetch = old; }
});

test('failures, refusals, incomplete and invalid model responses stay ungraded with no paid retry', async () => {
    const old = globalThis.fetch; let calls = 0;
    try {
        globalThis.fetch = async () => { calls++; throw new Error('offline'); };
        assert.equal((await checkReport(input, {})).status, 'unavailable'); assert.equal(calls, 0);
        assert.equal((await checkReport(input, { OPENAI_API_KEY: 'test' })).status, 'unavailable'); assert.equal(calls, 1);
        for (const result of [new Response('', { status: 429 }), response({ status: 'pass', feedback: 'Quest complete.' }, 'incomplete'),
            response({ status: 'pass', feedback: 'word '.repeat(26) }), response({ status: 'incorrect', feedback: 'Wrong' }),
            Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] })]) {
            let attempts = 0; globalThis.fetch = async () => { attempts++; return result; };
            assert.equal((await checkReport(input, { OPENAI_API_KEY: 'test' })).status, 'unavailable'); assert.equal(attempts, 1);
        }
    } finally { globalThis.fetch = old; }
});

test('cache ignores whitespace but preserves meaning, model, level, task and success criteria', () => {
    const key = reportCacheKey(input, {});
    assert.equal(reportCacheKey({ ...input, answer: `  ${input.answer.replaceAll(' ', '\n ')} ` }, {}), key);
    for (const change of [{ answer: 'We choose the park because it is quiet.' }, { task: 'Give three reasons.' }, { criteria: 'Three reasons.' }, { level: 'B1' }]) {
        assert.notEqual(reportCacheKey({ ...input, ...change }, {}), key);
    }
    assert.notEqual(reportCacheKey(input, { OPENAI_REPORT_MODEL: 'other' }), key);
    assert.deepEqual(reportVerdict({ status: 'uncertain', feedback: 'Your teacher will check the evidence.' }), { status: 'uncertain', feedback: 'Your teacher will check the evidence.' });
    assert.deepEqual(reportVerdict({ status: 'pass', feedback: 'Quest complete. Use “we choose” for “we chooses”.' }), { status: 'pass', feedback: 'Use “we choose” for “we chooses”.' });
});

test('private report criteria survive mission and library round trips, with bounds and backwards compatibility', () => {
    const campaign = structuredClone(castanyada);
    const objective = campaign.chapters[0].objectives.find(o => o.kind === 'report');
    objective.successCriteria = 'A place and two reasons.'; objective.level = 'B1';
    const parsed = parseMission(missionJson(campaign));
    assert.deepEqual(parsed.errors, []); assert.deepEqual(parsed.campaign, campaign);
    objective.successCriteria = 'a'.repeat(601);
    assert.ok(parseMission(missionJson(campaign)).errors.length);
    const quest = { ...sideQuests.find(q => q.answer === 'report'), successCriteria: 'Two reasons.' };
    assert.equal(checkQuest(quest).quest.successCriteria, quest.successCriteria);
    assert.equal(questObjective(quest).successCriteria, quest.successCriteria);
    assert.equal(questObjective(quest).level, quest.level);
    assert.ok(checkQuest({ ...quest, successCriteria: 'a'.repeat(601) }).error);
});

test('SQL reservations share one check per group, isolate owners, preserve results and expire interrupted checks', () => {
    const db = new DatabaseSync(':memory:');
    const sql = { exec(query, ...args) {
        if (!args.length && query.includes(';')) { db.exec(query); return { toArray: () => [] }; }
        const statement = db.prepare(query);
        const rows = statement.columns().length ? statement.all(...args) : (statement.run(...args), []);
        return { toArray: () => rows };
    } };
    const checks = new ReportChecks(sql); checks.initialize();
    try {
        const one = checks.reserve('game', 'quest', 'group:1', 'input'); assert.equal(one.fresh, true);
        assert.equal(checks.reserve('game', 'quest', 'group:1', 'input').fresh, false);
        assert.notEqual(checks.reserve('game', 'quest', 'group:2', 'input').check.id, one.check.id);
        checks.finish(one.check.id, { status: 'pass', feedback: 'Quest complete.' });
        assert.equal(new ReportChecks(sql).get(one.check.id).status, 'pass');
        checks.finish(one.check.id, { status: 'revise', feedback: 'Late response' });
        assert.equal(checks.get(one.check.id).status, 'pass', 'a late response cannot overwrite a final verdict');
        const interrupted = checks.reserve('game', 'quest', 'student:1', 'other').check;
        sql.exec('UPDATE report_checks SET started = ? WHERE id = ?', Date.now() - REPORT_CHECK_TIMEOUT - 4000, interrupted.id);
        assert.equal(checks.get(interrupted.id).status, 'unavailable');
        assert.equal(checks.reserve('game', 'quest', 'student:1', 'other').fresh, false, 'interruption does not trigger another paid call');
        checks.clear('game'); assert.equal(checks.get(one.check.id), undefined);
    } finally { db.close(); }
});
