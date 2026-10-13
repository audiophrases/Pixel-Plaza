// How students are shown: the first name, plus the start of the surname once a namesake is in the game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, firstName, shownNames } from '../../shared/names.ts';

const show = (...fulls) => [...shownNames(fulls.map((full, index) => ({ key: String(index), full }))).values()];

test('a first name nobody shares is shown alone', () => {
    assert.deepEqual(show('Roger Lopez Marti', 'Ana Puig', 'Berta Soler'), ['Roger', 'Ana', 'Berta']);
    assert.equal(firstName('  María   del Carmen García '), 'María');
    assert.deepEqual(show('Roger Lopez Marti', 'Roger Costa Vila'), ['Roger L', 'Roger C']);
    assert.equal(firstName(''), 'Student');
});

test('namesakes get the first letter of their surname', () => {
    assert.deepEqual(show('Roger Lopez', 'Roger Costa', 'Ana Puig'), ['Roger L', 'Roger C', 'Ana']);
    // The first surname is the one used, and capitals in the first name do not matter.
    assert.deepEqual(show('Maria García Puig', 'MARIA Ferrer'), ['Maria G', 'MARIA F']);
});

test('namesakes with the same initial get as many letters as it takes', () => {
    assert.deepEqual(show('Roger Lopez', 'Roger Lluch', 'Roger Costa'), ['Roger Lo', 'Roger Ll', 'Roger C']);
});

test('a name with no surname stays as it is, and odd characters are dropped', () => {
    assert.deepEqual(show('Roger', 'Roger Lopez'), ['Roger', 'Roger L']);
    assert.equal(cleanName('Roger <b>Lopez</b>!'), 'Roger b Lopez b');
});
