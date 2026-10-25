import test from 'node:test';
import assert from 'node:assert/strict';
import { identityRevealProblem, IDENTITY_CHAT_REMINDER } from '../../shared/activityChat.ts';

test('the identity holder cannot reveal their name, even as a leading question or confirmation', () => {
    for (const text of ["I am Messi", 'My name is Lionel Messi.', 'Yes, Messi!', 'Messi?', 'Is it Messi?', 'MÉSSI', 'm.e.s.s.i', 'm e s s i', 'Me\u200bssi', 'Messiiii']) {
        assert.equal(identityRevealProblem(text, 'messi'), IDENTITY_CHAT_REMINDER, text);
    }
    assert.ok(identityRevealProblem('I am Cristiano', 'ronaldo'));
    assert.ok(identityRevealProblem('I am Spider-Man.', 'spiderman'));
    assert.ok(identityRevealProblem('Taylor Swift!', 'taylor'));
});

test('the guesser may ask the correct or wrong identity and helpers may answer yes/no', () => {
    for (const text of ['Is it Messi?', 'Are you Lionel Messi?', 'I think you are Messi.', 'Messi', 'Could you be Neymar?']) {
        assert.equal(identityRevealProblem(text, 'ronaldo'), null, text);
    }
    for (const text of ['Yes!', 'No.', 'Yes, I am.', 'No, I am not.', 'I play football.', 'Are you a singer?', 'Messiah is a longer word.']) {
        assert.equal(identityRevealProblem(text, 'messi'), null, text);
    }
    assert.equal(identityRevealProblem('An unrelated message.', 'missing-identity'), null);
});
