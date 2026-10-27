import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { harmFrom, slurIn } from '../../shared/safety.ts';
import { SafetyIncidents } from '../incidents.ts';

test('slurs are caught however they are spelt, and ordinary words are not', () => {
    for (const text of ['nigga', 'N1GGA', 'niggas', 'nigg', 'nigge', 'niga', 'nigus', 'niggus', 'nigger nigger nigger', 'HEllo juan nigh',
        'secret name nigga', 'n i g g e r', 'n.i.g.g.a', 'H̶̢̧E̴ nigga', 'faggot', 'fag', 'tranny', 'retard', 'maricón', 'sudaca', 'moro', 'nibba']) {
        assert.ok(slurIn(text), `caught: ${text}`);
    }
    for (const text of ['Niger', 'Nigeria', 'night', 'nightmare', 'snigger', 'Kike', 'negro', 'Morocco', 'Moroccan food', 'black', 'figure',
        "I don't know", 'e-mail', 'U.S.A.', 'Is it Lamine Yamal?', 'Rafa Nadal', 'a b c', 'I am fine!']) {
        assert.equal(slurIn(text), null, `not a slur: ${text}`);
    }
});

test("OpenAI's categories are read as the most serious harm", () => {
    assert.equal(harmFrom(['self-harm/intent', 'harassment']), 'self-harm');
    assert.equal(harmFrom(['harassment', 'harassment/threatening']), 'threat');
    assert.equal(harmFrom(['sexual']), 'sexual');
    assert.equal(harmFrom(['hate']), 'hate');
    assert.equal(harmFrom(['harassment']), 'harassment');
    assert.equal(harmFrom(['violence/graphic']), 'violence');
});

function incidents() {
    const db = new DatabaseSync(':memory:');
    const sql = { exec(query, ...args) {
        if (!args.length && query.includes(';')) { db.exec(query); return { toArray: () => [] }; }
        const statement = db.prepare(query);
        const rows = statement.columns().length ? statement.all(...args) : (statement.run(...args), []);
        return { toArray: () => rows };
    } };
    const store = new SafetyIncidents(sql); store.initialize();
    return { store, db };
}

test('incidents group per student and kind, count each attempt once, and leave the list when seen', t => {
    const { store, db } = incidents(); t.after(() => db.close());
    const names = new Map([['david', 'David']]);
    assert.equal(store.record('game', 'david', 'David', 'hate', 'nigg', 'a1', 1000), true);
    assert.equal(store.record('game', 'david', 'David', 'hate', 'nigg', 'a1', 1100), false, 'the same attempt, met twice, counts once');
    store.record('game', 'david', 'David', 'hate', 'nigge', 'a2', 1200);
    store.record('game', 'david', 'David', 'hate', 'niggas', 'a3', 1300);
    store.record('game', 'david', 'David', 'hate', 'nigga', 'a4', 1400);
    store.record('game', 'david', 'David', 'threat', 'I will dox you', 'a5', 1500);
    store.record('other-game', 'david', 'David', 'hate', 'nigga', 'a6', 1600);
    const [threat, hate] = store.open('game', names);
    assert.deepEqual([threat.harm, threat.count], ['threat', 1]);
    assert.deepEqual([hate.harm, hate.count, hate.texts, hate.firstTs, hate.lastTs], ['hate', 4, ['nigga', 'niggas', 'nigge'], 1000, 1400]);
    assert.equal(store.seen('game', hate.id), true);
    assert.equal(store.seen('game', hate.id), false);
    assert.deepEqual(store.open('game', names).map(item => item.harm), ['threat']);
    // A new attempt after the teacher has seen it starts a new incident.
    store.record('game', 'david', 'David', 'hate', 'nigga', 'a7', 1700);
    assert.equal(store.open('game', names).find(item => item.harm === 'hate').count, 1);
    store.forget('game');
    assert.deepEqual(store.open('game', names), []);
    assert.equal(store.open('other-game', names).length, 1);
});
