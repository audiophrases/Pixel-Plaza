import test from 'node:test';
import assert from 'node:assert/strict';
import { SPAWN, chatProblem, clampPosition, isBlocked, laptopOrigin, plazaName, sanitizeAvatar, secretsMatch, sha256Hex, teacherPasswordMatches } from '../rules.ts';

test('chat validation blocks invalid content and caps length', () => {
    assert.match(chatProblem('nobody likes you'), /rewrite/);
    assert.match(chatProblem('shit'), /rewrite/);
    assert.match(chatProblem('x'.repeat(201)), /1–200/);
    assert.equal(chatProblem('Hello class!'), null);
});

test('nameplates come from the roster name, cleaned', () => {
    assert.equal(plazaName('Alex'), 'Alex');
    assert.equal(plazaName('  Ana <María>  '), 'Ana María');
    assert.equal(plazaName('shit'), 'Student');
    assert.equal(plazaName('!'), 'Student');
});

test('avatars must use existing parts', () => {
    assert.deepEqual(sanitizeAvatar({ skin: 2, hair: 28 }), { head: 0, skin: 2, hairColor: 0, hair: 28, eyes: 0, mouth: 0, glasses: 0, shirt: 0, hat: 0 });
    assert.equal(sanitizeAvatar({ head: 16 }).head, 16);
    assert.equal(sanitizeAvatar({ head: 17 }), null);
    assert.equal(sanitizeAvatar({ hair: 29 }), null);
    assert.equal(sanitizeAvatar({ skin: 1.5 }), null);
    assert.equal(sanitizeAvatar({ skin: '1' }), null);
    assert.equal(sanitizeAvatar([1]), null);
    assert.equal(sanitizeAvatar(null), null);
});

test('positions stay on the map', () => {
    assert.deepEqual(clampPosition(10.4, 2048), { x: 10, y: 2048 });
    assert.equal(clampPosition(-1, 5), null);
    assert.equal(clampPosition(5, Infinity), null);
    assert.equal(clampPosition('5', 5), null);
});

test('class PIN and teacher password must match exactly', async () => {
    assert.equal(secretsMatch('123456', '123456'), true);
    assert.equal(secretsMatch('1234567', '123456'), false);
    assert.equal(secretsMatch(undefined, '123456'), false);
    assert.equal(secretsMatch('', ''), false);
    const hash = await sha256Hex('correct horse');
    assert.equal(await teacherPasswordMatches('  correct horse ', hash), true);
    assert.equal(await teacherPasswordMatches('correct horse', hash.toUpperCase()), true);
    assert.equal(await teacherPasswordMatches('wrong', hash), false);
    assert.equal(await teacherPasswordMatches('correct horse', ''), false);
});

test('a laptop address is reduced to its http(s) origin', () => {
    assert.equal(laptopOrigin('http://192.168.1.20:8787/teacher?x=1#y'), 'http://192.168.1.20:8787');
    assert.equal(laptopOrigin('javascript:alert(1)'), null);
    assert.equal(laptopOrigin('http://user:pass@192.168.1.20'), null);
    assert.equal(laptopOrigin(42), null);
});

test('walls block the hotel and fountain but not the street or the spawn', () => {
    assert.equal(isBlocked(600, 300), true);
    assert.equal(isBlocked(600, 1100), true);
    assert.equal(isBlocked(1100, 740), false);
    assert.equal(isBlocked(SPAWN.x, SPAWN.y), false);
});
