// The word checker the chat box uses, run against the real English dictionary.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createChecker } from '../../src/spelling.ts';

const dictionary = path.join(import.meta.dirname, '..', '..', 'node_modules', 'dictionary-en');
const check = createChecker(fs.readFileSync(path.join(dictionary, 'index.aff'), 'utf8'), fs.readFileSync(path.join(dictionary, 'index.dic'), 'utf8'));
const words = (text, names) => check(text, names).map(item => item.word);

test('ordinary English passes', () => {
    assert.deepEqual(words('Hello! How are you today? I like the park.'), []);
    assert.deepEqual(words("I don't know, it's fine. We're going to the café."), []);
    assert.deepEqual(words('Well-known place, 3 cats, and 😀 too'), []);
    assert.deepEqual(words('lol ok hahaha wow'), []);
});

test('other languages are stopped', () => {
    assert.deepEqual(words('Hola, me gusta la plaza'), ['Hola', 'gusta']);
    assert.ok(words('Gracias por todo').includes('Gracias'));
    assert.deepEqual(words('你好'), ['你好']);
    assert.ok(words('Bonjour mon ami').includes('Bonjour'));
    // The limit of a dictionary: loanwords such as "amigo" are English words too.
    assert.deepEqual(words('amigo'), []);
});

test('spelling mistakes come with suggestions', () => {
    const [mistake] = check('I will recieve it');
    assert.equal(mistake.word, 'recieve');
    assert.ok(mistake.suggestions.includes('receive'), mistake.suggestions.join());
    assert.ok(check('I like the libary')[0].suggestions.includes('library'));
});

test('text-speak is stopped with the English fix', () => {
    assert.deepEqual(check('u r nice').map(item => [item.word, item.suggestions[0]]), [['u', 'you'], ['r', 'are']]);
    assert.equal(check('pls help')[0].suggestions[0], 'please');
    assert.equal(check('i dont know')[0].suggestions[0], "don't");
});

test("names of people in the Plaza are allowed, other names are not", () => {
    assert.deepEqual(words('Hi Takeshi and Mei Ling', ['Takeshi', 'Mei Ling']), []);
    assert.deepEqual(words('Hi Takeshi'), ['Takeshi']);
});

test('each wrong word is listed once', () => {
    assert.equal(check('gracias, gracias, GRACIAS').length, 1);
});
