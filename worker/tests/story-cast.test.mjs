// A mission's story characters: a Who's who for students, their names marked wherever the story mentions them, and a
// warning for the teacher when a character shares a name with a student.
import test from 'node:test';
import assert from 'node:assert/strict';
import { castanyada } from './fixtures/season-1.mjs';
import { castClashes, castForms, castParts, castWords } from '../../shared/cast.ts';
import { missionEnvelope, missionJson, validateMission } from '../../shared/missionSchema.ts';
import { importMission } from '../../shared/missionImport.ts';
import { buildMissionPrompt } from '../../shared/missionPrompt.ts';

const cast = [
    { name: 'Karina Gonzalvez', about: 'A student. She is missing after the storm.' },
    { name: 'Ms Awa Diop', about: 'The PE teacher.' },
    { name: 'Mr El Idrissi', about: 'The deputy head of the school.' },
    { name: 'Will', about: 'A delivery driver.' },
];
// What the marked text looks like: [name] for each character mentioned.
const marked = text => castParts(text, cast).map(part => typeof part === 'string' ? part : `[${part.text}=${part.member.name}]`).join('');

test('the story marks each character however it names them, as whole words, and nothing else', () => {
    assert.deepEqual(castForms(cast[1]), ['Ms Awa Diop', 'Awa Diop', 'Awa', 'Diop']);
    assert.deepEqual(castForms(cast[2]), ['Mr El Idrissi', 'El Idrissi', 'Idrissi'], 'a two-letter word is not a name on its own');
    assert.deepEqual(castForms(cast[3]), ['Will']);
    assert.equal(marked('CCTV links Ms Diop to Karina. Ms Ionescu defends her.'), 'CCTV links [Ms Diop=Ms Awa Diop] to [Karina=Karina Gonzalvez]. Ms Ionescu defends her.');
    assert.equal(marked('El Idrissi’s email and Karina Gonzalvez’s phone.'), '[El Idrissi=Mr El Idrissi]’s email and [Karina Gonzalvez=Karina Gonzalvez]’s phone.', 'the longest name wins');
    assert.equal(marked('Will says you will see Karinas and karina.'), '[Will=Will] says you will see Karinas and karina.', 'capitals count, and part of a word is not a name');
    assert.equal(marked('Dr. Diop? No: Awa.'), '[Dr. Diop=Ms Awa Diop]? No: [Awa=Ms Awa Diop].');
    assert.deepEqual(castParts('No characters here.', cast), ['No characters here.']);
    assert.deepEqual(castParts('Karina', []), ['Karina'], 'a mission without a cast marks nothing');
    assert.deepEqual(castParts('', cast), []);
    assert.ok(['Karina', 'Gonzalvez', 'Diop', 'Ms Awa Diop', 'Idrissi'].every(word => castWords(cast).includes(word)), 'characters can be named in English chat');
});

test('the teacher hears about a character who shares a name with a student here', () => {
    assert.deepEqual(castClashes(cast, ['Karina', 'Joan M.', 'Àwa', 'Will']), ['Karina Gonzalvez', 'Ms Awa Diop', 'Will'], 'without capitals or accents');
    assert.deepEqual(castClashes(cast, ['Alex', 'El']), [], 'a short word is not a clash');
    assert.deepEqual(castClashes(undefined, ['Karina']), []);
});

test('a cast is checked, saved and published with the mission, merged when chapters are appended, and asked of the AI', () => {
    const withCast = { ...structuredClone(castanyada), cast: [{ name: 'Mrs Puig', about: 'The festival planner’s neighbour.' }, { name: 'Pau', about: 'A boy who sells chestnuts.' }] };
    const valid = validateMission(missionEnvelope(withCast));
    assert.deepEqual(valid.errors, []); assert.deepEqual(valid.campaign.cast, withCast.cast);
    const issues = cast => validateMission(missionEnvelope({ ...structuredClone(castanyada), cast })).errors.map(error => `${error.path}: ${error.message}`);
    assert.match(issues([{ name: 'Pau', about: 'x' }, { name: 'pau ', about: 'y' }]).join(), /different name/);
    assert.match(issues(Array.from({ length: 21 }, (_, i) => ({ name: `Person ${i}`, about: 'x' }))).join(), /at most 20/);
    assert.match(issues([{ name: 'Pau', about: 'x', secret: 'y' }]).join(), /cast\[0\]\.secret: Unsupported/);
    assert.match(issues([{ name: 'Pau\nPuig', about: 'x' }]).join(), /one line/);
    assert.match(issues([{ name: 'Pau', about: 'x'.repeat(201) }]).join(), /200 characters/);
    assert.match(issues([{ name: '', about: 'x' }]).join(), /cast\[0\]\.name: Text is required/, 'a character needs a name to publish');
    assert.deepEqual(validateMission(missionEnvelope({ ...structuredClone(castanyada), cast: [{ name: '', about: '' }] }), 'draft').errors, [], 'a draft may hold a character still being written');

    // Appending chapters adds new characters and keeps what the teacher wrote about those already there.
    const incoming = { ...structuredClone(castanyada), cast: [{ name: 'pau', about: 'Changed.' }, { name: 'Laia', about: 'A new girl in town.' }] };
    incoming.chapters = [incoming.chapters[0]];
    const appended = importMission(withCast, missionJson(incoming), 'append');
    assert.deepEqual(appended.errors, []);
    assert.deepEqual(appended.campaign.cast, [...withCast.cast, { name: 'Laia', about: 'A new girl in town.' }]);
    assert.match(buildMissionPrompt(castanyada, 'A storm at school', 'A2', 'create'), /campaign cast: at most 20 story characters/);
});
