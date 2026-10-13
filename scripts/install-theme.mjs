// Puts a theme downloaded from the studio into the project: checks it, writes it in the usual form, and says what
// changed. With no file given it takes the newest <id>.json from your Downloads folder.
//
//   npm run theme -- plaza                 (the newest plaza.json in Downloads)
//   npm run theme -- C:\path\to\plaza.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatTheme, validateTheme } from '../shared/theme.ts';
import { walkReport } from '../shared/walk.ts';

const root = path.join(import.meta.dirname, '..');
const argument = process.argv[2];
if (!argument) {
    console.error('Say which theme: npm run theme -- plaza   (or give the path of the downloaded file)');
    process.exit(1);
}

// A path, or the id of a theme whose newest download is wanted
let source = argument;
if (!/[\\/]|\.json$/i.test(argument)) {
    const downloads = path.join(os.homedir(), 'Downloads');
    // Browsers add (1), (2) to repeat downloads: plaza.json, plaza (1).json
    const matches = fs.readdirSync(downloads).filter(name => new RegExp(`^${argument}( \\(\\d+\\))?\\.json$`, 'i').test(name))
        .map(name => path.join(downloads, name)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (matches.length === 0) {
        console.error(`No ${argument}.json in ${downloads}. Download it from the studio first.`);
        process.exit(1);
    }
    source = matches[0];
}

const theme = JSON.parse(fs.readFileSync(source, 'utf8'));
const { errors, warnings } = validateTheme(theme);
if (errors.length) {
    console.error(`Not installed. ${path.basename(source)} has problems:`);
    for (const error of errors) console.error('  - ' + error);
    process.exit(1);
}
for (const warning of warnings) console.warn('  note: ' + warning);
const report = walkReport(theme);
for (const problem of report.problems) console.warn('  walking: ' + problem);

const target = path.join(root, 'shared', 'themes', `${theme.id}.json`);
const before = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;
fs.writeFileSync(target, formatTheme(theme));
const count = (value) => ({ blocks: value?.blocked?.length ?? 0, behind: value?.walkBehind?.length ?? 0, zones: value?.zones?.length ?? 0 });
console.log(`Installed ${path.basename(source)} as shared/themes/${theme.id}.json`);
console.log('  before:', before ? JSON.stringify(count(before)) : 'new theme', '  now:', JSON.stringify(count(theme)));
console.log('Restart classroom.bat (or tester.bat) to play it. To undo, run: git checkout shared/themes/' + theme.id + '.json');
