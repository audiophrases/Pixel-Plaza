// The rules that sort chat into a student's conversations and decide who hears what.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL, HEARING_RANGE, NEAR, STILL_TALKING_MS, TEACHER, conversationOf, inEarshot, opensItself, partnerOf, privateChat, renamed } from '../../shared/chat.ts';

test('each message lands in one conversation, seen from the student reading it', () => {
    assert.equal(conversationOf({ sender: 'Sam', text: 'Hi' }, 'Alex'), NEAR);
    assert.equal(conversationOf({ sender: 'Sam', all: true }, 'Alex'), ALL);
    assert.equal(conversationOf({ sender: 'Sam', whisper: true, to: 'Alex' }, 'Alex'), privateChat('Sam'), 'a whisper to me is in the chat with its sender');
    assert.equal(conversationOf({ sender: 'Alex', whisper: true, to: 'Sam' }, 'Alex'), privateChat('Sam'), 'my whisper is in the chat with who it is for');
    assert.equal(conversationOf({ sender: 'Alex', whisper: true, to: 'Teacher' }, 'Alex'), TEACHER);
    assert.equal(conversationOf({ sender: 'Teacher', teacher: true }, 'Alex'), TEACHER);
    assert.equal(conversationOf({ sender: 'System', text: 'Sam has joined the Plaza.' }, 'Alex'), ALL, 'arrivals concern the whole plaza');
    assert.equal(conversationOf({ sender: 'System Warning', conv: privateChat('Sam') }, 'Alex'), privateChat('Sam'), 'a notice stays with the conversation it answers');
    assert.equal(partnerOf(privateChat('Ana Maria')), 'Ana Maria');
    assert.equal(partnerOf(NEAR), null);
});

test('nearby chat is heard within range, nearest first, never by the speaker', () => {
    const me = { id: 'me', x: 1000, y: 1000 };
    const heard = inEarshot(me, [me, { id: 'far', x: 1000 + HEARING_RANGE + 1, y: 1000 }, { id: 'edge', x: 1000, y: 1000 + HEARING_RANGE },
        { id: 'close', x: 1010, y: 1000 }]);
    assert.deepEqual(heard.map(player => player.id), ['close', 'edge']);
});

test('a rename carries the messages and the private chat with it', () => {
    const lines = [{ sender: 'Roger', text: 'Hi', whisper: true, to: 'Alex' }, { sender: 'Alex', text: 'Hello', whisper: true, to: 'Roger' },
        { sender: 'System Warning', text: 'Roger is not in the Plaza now.', conv: privateChat('Roger') }, { sender: 'Sam', text: 'Hey' }];
    const after = renamed(lines, 'Roger', 'Roger L.');
    assert.deepEqual(after.map(line => conversationOf(line, 'Alex')), [privateChat('Roger L.'), privateChat('Roger L.'), privateChat('Roger L.'), NEAR]);
    assert.equal(after[3], lines[3], 'messages with nothing to change stay as they were');
    assert.equal(renamed(lines, 'Roger', 'Roger'), lines);
});

test('a private message opens by itself only when nothing is being written and the open chat has gone quiet', () => {
    const now = 100_000;
    const quiet = now - STILL_TALKING_MS;
    assert.equal(opensItself({ from: privateChat('Sam'), open: NEAR, writing: false, lastInOpen: 0, now }), true);
    assert.equal(opensItself({ from: privateChat('Sam'), open: NEAR, writing: false, lastInOpen: quiet, now }), true);
    assert.equal(opensItself({ from: privateChat('Sam'), open: NEAR, writing: true, lastInOpen: 0, now }), false, 'never under a draft');
    assert.equal(opensItself({ from: privateChat('Sam'), open: privateChat('Chris'), writing: false, lastInOpen: quiet + 1, now }), false, 'never in the middle of a conversation');
    assert.equal(opensItself({ from: privateChat('Sam'), open: privateChat('Sam'), writing: false, lastInOpen: 0, now }), false);
});
