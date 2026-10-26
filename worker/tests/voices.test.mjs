import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VOICE, isEnglishVoice, voiceFor } from '../../shared/voices.ts';

test('a student who has not chosen a voice gets one of their own, the same every time, and a class gets many', () => {
    const keys = Array.from({ length: 24 }, (_, index) => `usr_student${index}@school.cat`);
    for (const key of keys) {
        assert.ok(isEnglishVoice(voiceFor(key)));
        assert.equal(voiceFor(key), voiceFor(key), 'the same in every lesson');
    }
    const voices = new Set(keys.map(voiceFor));
    assert.ok(voices.size >= 12, `24 students share ${voices.size} voices`);
    assert.ok(keys.filter(key => voiceFor(key) === DEFAULT_VOICE).length <= 3, 'not everyone on the default');
});
