// First run on the teacher's laptop: asks for the teacher password and writes
// .dev.vars, so nobody has to make the hash by hand. The online hash is a
// Cloudflare secret and cannot be read back, hence the question.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(import.meta.dirname, '..', '.dev.vars');

if (fs.existsSync(file)) {
    console.log('.dev.vars already exists. Keeping its configuration and secrets unchanged.');
    process.exit(0);
}

// Typed characters show as *, as in a password box.
function askHidden(question) {
    return new Promise(resolve => {
        const stdin = process.stdin;
        process.stdout.write(question);
        stdin.setRawMode(true);
        stdin.setEncoding('utf8');
        stdin.resume();
        let value = '';
        const onData = chunk => {
            for (const character of chunk) {
                if (character === '\u0003') process.exit(1); // Ctrl+C
                if (character === '\r' || character === '\n') {
                    stdin.setRawMode(false);
                    stdin.pause();
                    stdin.off('data', onData);
                    process.stdout.write('\n');
                    return resolve(value);
                }
                if (character === '\b' || character === '\u007f') {
                    if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
                    continue;
                }
                value += character;
                process.stdout.write('*');
            }
        };
        stdin.on('data', onData);
    });
}

console.log('\nFirst time on this laptop. Enter the teacher password: the same one as');
console.log('online (and PinPlay). It is saved only as a hash, in .dev.vars.\n');

let password = '';
for (;;) {
    password = (await askHidden('Teacher password: ')).trim();
    if (!password) { console.log('The password cannot be empty.'); continue; }
    if ((await askHidden('Type it again:    ')).trim() === password) break;
    console.log('The two did not match. Try again.\n');
}

// The same scheme as worker/rules.ts and PinPlay.
const hash = crypto.createHash('sha256').update(password.normalize('NFC')).digest('hex');
fs.writeFileSync(file, [
    '# Made by classroom.bat. Preserve this file: it may contain other secrets.',
    `CREATE_PASSWORD_HASH=${hash}`,
    'PINPLAY_API_URL=https://api.pinplay.win',
    ''
].join('\n'), { flag: 'wx' });
console.log('\nSaved. Preserve .dev.vars when updating the password: it may contain other secrets.\n');
