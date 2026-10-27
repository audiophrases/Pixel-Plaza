// Words a teacher blocks for one lesson, found however students write them, and what the plaza repeats, offered
// for blocking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { blockable, blockedIn, repeated, taskWordSet } from '../../shared/blockedWords.ts';
import { BlockedWords } from '../blockedWords.ts';

const terms = ['free a', 'andrei', 'loser', 'free sam'].map(blockable);
const hit = (text, accepted) => blockedIn(text, terms, accepted)?.words ?? null;
// On the laptop the English check takes real words and classmates' names; online there is no such check.
const english = new Set(['andrew', 'andreu', 'closer', 'lower', 'laser', 'free', 'sample']);
const accepted = word => english.has(word);

test('what the teacher types is read as messages are, and needs two letters', () => {
    assert.deepEqual(blockable('  Free   A! '), { key: 'free a', words: 'Free A!' });
    assert.deepEqual(blockable('Andréi'), { key: 'andrei', words: 'Andréi' });
    for (const words of ['a', '!!', '  ', 'x'.repeat(61)]) assert.equal(blockable(words), null, words);
    assert.equal(blockedIn('free andrei', []), null);
});

test('a blocked word or phrase is caught however it is written, and nothing else is', () => {
    for (const [text, words] of [['FREE A', 'free a'], ['free a!', 'free a'], ['free-a', 'free a'], ['#freeA', 'free a'], ['freeee aaa', 'free a'], ['f r e e a', 'free a'],
        ['Free Andrei', 'andrei'], ['ANDREIIII', 'andrei'], ['4ndr3i', 'andrei'], ['@ndrei', 'andrei'], ['a n d r e i', 'andrei'], ['a.n.d.r.e.i', 'andrei'],
        ['an drei', 'andrei'], ['and rei', 'andrei'], ['andréi', 'andrei'], ['ＡＮＤＲＥＩ', 'andrei'], ['аndrei', 'andrei'], ['𝓪𝓷𝓭𝓻𝓮𝓲', 'andrei'], ['ᴀɴᴅʀᴇɪ', 'andrei'],
        ['andreis', 'andrei'], ['andrei4ever', 'andrei'], ['losers', 'loser'], ['l0ser', 'loser'], ['I am a loser!!', 'loser'], ['L O S E R', 'loser'],
        ['fr33 s4m!!', 'free sam'], ['FREE SAMMM', 'free sam']]) {
        assert.equal(hit(text), words, text);
    }
    // A phrase is its words together: "free a" is not "free apples", nor "free as a bird".
    for (const text of ['free apples', 'I am free', 'free as a bird', 'a free afternoon', 'and reinforce', 'Andrew', 'come closer', 'lower', 'Sam is free', 'free samples']) {
        assert.equal(hit(text), null, text);
    }
});

test('on the laptop a blocked word is also found inside longer words and one letter off, never in an English word or a name', () => {
    for (const [text, words] of [['#freeandrei', 'free a'], ['teamandrei', 'andrei'], ['andrey', 'andrei'], ['free andre', 'andrei'], ['andrie', 'andrei'], ['loserz', 'loser']]) {
        assert.equal(hit(text, accepted), words, text);
        assert.equal(hit(text), null, `${text}: not without the English check, which tells words from disguises`);
    }
    for (const text of ['Andrew', 'Andreu', 'come closer', 'lower', 'laser', 'free samples']) assert.equal(hit(text, accepted), null, text);
});

test('what many students write to everyone at once is offered once, most widespread first, without everyday or task words', () => {
    const said = [['a', 'free andrei'], ['b', 'FREE ANDREI!!'], ['c', 'fr33 andreiii'], ['d', 'free andrei now'], ['d', 'free andrei'],
        ['a', 'hello everyone'], ['b', 'hello everyone'], ['e', 'hello'],
        ['a', 'the chestnut is here'], ['b', 'chestnut!'], ['c', 'I see the chestnut'],
        ['a', 'skibidi'], ['b', 'skibidi toilet'], ['e', 's k i b i d i']].map(([studentKey, text]) => ({ studentKey, text }));
    const task = taskWordSet(['Find the chestnuts and the chestnut seller.']);
    const found = repeated(said, 3, task, () => false);
    assert.deepEqual(found.map(item => [item.words, item.students.length]), [['free andrei', 4], ['skibidi', 3]], 'the phrase, not its words one by one');
    assert.deepEqual(found[0].examples, ['free andrei', 'FREE ANDREI!!', 'fr33 andreiii']);
    assert.deepEqual(repeated(said, 3, task, key => key === found[0].key).map(item => item.words), ['skibidi'], 'once let through, not offered again');
    assert.deepEqual(repeated(said, 5, task, () => false), [], 'fewer students than needed');
    assert.deepEqual(repeated([['a', 'pizza'], ['a', 'pizza!'], ['a', 'PIZZA']].map(([studentKey, text]) => ({ studentKey, text })), 2, task, () => false), [],
        'one student, however often, is not the class');
});

function store() {
    const db = new DatabaseSync(':memory:');
    const sql = { exec(query, ...args) {
        if (!args.length && query.includes(';')) { db.exec(query); return { toArray: () => [] }; }
        const statement = db.prepare(query);
        const rows = statement.columns().length ? statement.all(...args) : (statement.run(...args), []);
        return { toArray: () => rows };
    } };
    const blocked = new BlockedWords(sql); blocked.initialize();
    return { blocked, db };
}

test('blocked words last one lesson, count what they stopped and from whom, and the last lesson can be blocked again', t => {
    const { blocked, db } = store(); t.after(() => db.close());
    assert.deepEqual(blocked.block('game', 'lesson-1', ['free a', 'Andrei', 'andrei'], 1000).map(term => term.words), ['free a', 'Andrei'], 'each once, as first typed');
    assert.equal(typeof blocked.block('game', 'lesson-1', ['ok', 'a'], 1100), 'string', 'one letter is too little, and nothing is blocked');
    assert.deepEqual(blocked.terms('game', 'lesson-1').map(term => term.key), ['free a', 'andrei']);
    assert.deepEqual(blocked.block('game', 'lesson-1', ['FREE A'], 1200), [], 'already blocked');
    blocked.tried('game', 'lesson-1', 'andrei', 'stu_b'); blocked.tried('game', 'lesson-1', 'andrei', 'stu_a'); blocked.tried('game', 'lesson-1', 'andrei', 'stu_a');
    blocked.removed('game', 'lesson-1', 'free a', 3);
    assert.deepEqual(blocked.view('game', 'lesson-1'), [
        { key: 'free a', words: 'free a', removed: 3, stopped: 0, by: [] },
        { key: 'andrei', words: 'Andrei', removed: 0, stopped: 3, by: [{ studentKey: 'stu_a', count: 2 }, { studentKey: 'stu_b', count: 1 }] }]);
    blocked.letThrough('game', 'lesson-1', 'piza', 'pizza', 1300);
    assert.deepEqual([...blocked.letThroughKeys('game', 'lesson-1')], ['piza']);
    assert.equal(blocked.terms('game', 'lesson-1').length, 2, 'letting a repeat through blocks nothing');
    assert.equal(blocked.unblock('game', 'lesson-1', 'free a'), true);
    assert.equal(blocked.unblock('game', 'lesson-1', 'free a'), false);

    // The next lesson starts with nothing blocked; the last one's words can be blocked again.
    assert.deepEqual(blocked.terms('game', 'lesson-2'), []);
    assert.deepEqual(blocked.before('game', 'lesson-2'), ['Andrei']);
    blocked.block('game', 'lesson-2', ['andrei'], 2000);
    assert.deepEqual(blocked.before('game', 'lesson-2'), [], 'blocked again');
    // Only this lesson and the last one with blocked words are kept.
    blocked.block('game', 'lesson-3', ['skibidi'], 3000);
    assert.deepEqual(blocked.before('game', 'lesson-3'), ['andrei']);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM blocked_words WHERE lesson = 'lesson-1'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM blocked_tries WHERE lesson != 'lesson-3'").get().n, 0);
    assert.deepEqual(blocked.terms('other', 'lesson-3'), [], 'each game has its own');
    blocked.forget('game');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM blocked_words').get().n, 0);
});
