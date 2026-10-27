// The word checker the chat box uses, run against the real English dictionary.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createChecker } from '../../src/spelling.ts';

const read = (folder, file) => fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'node_modules', folder, file), 'utf8');
const check = createChecker(read('dictionary-en', 'index.aff'), read('dictionary-en', 'index.dic'),
    { aff: read('dictionary-en-gb', 'index.aff'), dic: read('dictionary-en-gb', 'index.dic') });
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

test('British spellings pass; suggestions are American', () => {
    assert.deepEqual(words('My favourite colour is grey. We organise the centre.'), []);
    assert.deepEqual(words('My favorite color is gray. We organize the center.'), []);
    // A typo of a British word is helped with the American spelling.
    const [typo] = check('colur');
    assert.ok(typo.suggestions.includes('color'));
    assert.ok(!typo.suggestions.includes('colour'));
});

test('stretched letters and a lower-case I are still English', () => {
    assert.deepEqual(words('HELLOOOO helloo nooo yesss broooo soooo coool pleaseee'), []);
    assert.deepEqual(words("i'm fine, i'll go, i've got it, i'd like that, i’m ok"), []);
    assert.deepEqual(words('hiii Youssef', ['Legendary Youssef']), []);
    // Stretching does not make another language English, nor fix a missing space or a misspelling.
    assert.deepEqual(words('siiiiii holaaaaaaa graciaaas'), ['siiiiii', 'holaaaaaaa', 'graciaaas']);
    assert.deepEqual(words('hello how areyou'), ['areyou']);
    assert.deepEqual(words('awnser ppopo'), ['awnser', 'ppopo']);
});

test("words from the class's own languages are stopped with the English word to use", () => {
    const suggestion = text => check(text).map(item => `${item.word}→${item.suggestions[0]}`);
    assert.deepEqual(suggestion('si'), ['si→yes']);
    assert.deepEqual(suggestion('siiii'), ['siiii→yes'], 'stretched too');
    assert.deepEqual(suggestion('Hola, gràcies'), ['Hola→hello', 'gràcies→thank you']);
    // "vale" is English too (a valley), so a dictionary cannot stop it.
    assert.deepEqual(suggestion('vale'), []);
});

test('famous names from "Who am I?" are fine, and a misspelt name is offered the name', async () => {
    const { IDENTITY_NAMES } = await import('../../shared/warmupKinds.ts');
    assert.deepEqual(words("it's Lamine Yamal? Are you Ronaldo or shakira? Einstein? Darth Vader!", IDENTITY_NAMES), []);
    const [mistake] = check("it's lamaine yamal", IDENTITY_NAMES);
    assert.deepEqual([mistake.word, mistake.suggestions[0]], ['lamaine', 'Lamine']);
    assert.equal(new Set(check('Einstien', IDENTITY_NAMES)[0].suggestions).size, check('Einstien', IDENTITY_NAMES)[0].suggestions.length, 'no repeats');
    assert.deepEqual(words('hola', IDENTITY_NAMES), ['hola'], 'other languages are still stopped');
});

test('classmates with or without accents, absent ones too, and places typed in lower case are English; Spanish is not', () => {
    const classmates = ['Àlvaro', 'Rubén', 'Andrei', 'Alexandra T'];
    assert.deepEqual(words('alvaro come back, ruben, andrei and alexandra', classmates), []);
    assert.deepEqual(words('in ohio, barcelona and miami, I play minecraft and roblox on youtube'), []);
    // Spanish words that are also English names with a capital ("Como", "Luna") still stop.
    assert.deepEqual(words('que como tu ella luna verde'), ['que', 'como', 'tu', 'ella', 'luna', 'verde']);
});
