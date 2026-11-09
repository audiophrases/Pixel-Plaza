// Editable document artwork; generated CCTV source is kept separately.
// Run this before build-pack.mjs after editing the artwork below.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const directory = path.join(import.meta.dirname, 'art/evidence');
fs.mkdirSync(directory, { recursive: true });
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const text = (x, y, value, size = 26, color = '#263b44', weight = 400) => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${escape(value)}</text>`;
const rect = (x, y, w, h, fill, radius = 12) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}"/>`;
const lines = (x, y, values, size = 26, color) => values.map((line, i) => text(x, y + i * 38, line, size, color)).join('');
const frame = (label, title, body, footer) => `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><g font-family="Arial, sans-serif">${rect(0, 0, 900, 600, '#263b44', 0)}${rect(24, 24, 852, 552, '#f5f2e9', 16)}${rect(24, 24, 10, 552, '#b57c45', 0)}${text(62, 70, label, 16, '#617477', 700)}${text(62, 120, title, 36, '#263b44', 700)}<path d="M62 145H838" stroke="#ced5d0"/>${body}${text(62, 545, footer, 16, '#617477')}</g></svg>`;
const files = {
    messages: frame('SAVED MESSAGES · SCHOOL ACCOUNT', 'Two messages. Same time.',
        rect(62, 176, 776, 140, '#e0e9e6') + text(86, 211, '08:15 · School account', 19, '#3b6862', 700)
        + lines(86, 255, ['Stay in classrooms.', 'Do not go to the sports hall.'])
        + rect(62, 334, 776, 112, '#e6e8ed') + text(86, 371, '08:15 · School account', 19, '#4c5c72', 700)
        + text(86, 415, 'Go to the sports hall.'), 'Saved by Laia · Compare the instructions.'),
    warning: frame('MAINTENANCE · COPY KEPT BY MS SOKOLOVA', 'Safety warning',
        rect(62, 176, 776, 62, '#e0e9e6') + text(85, 218, 'FRIDAY · 09:20', 28, '#315d56', 700)
        + lines(62, 295, ['The passage roof is dangerous.', 'Close the passage. Repair the roof.'])
        + text(62, 445, 'Reported by Awa Diop', 27, '#263b44', 700), 'Original report · Keep with the office receipt.'),
    receipt: frame('SCHOOL OFFICE · RECEIPT', 'Warning received',
        rect(62, 176, 776, 62, '#e0e9e6') + text(85, 218, 'FRIDAY · 09:45', 28, '#315d56', 700)
        + lines(62, 295, ['Received by school management.', 'Subject: covered-passage roof.'])
        + rect(62, 390, 430, 68, '#f0dec7') + text(86, 434, 'Later note: Repair delayed.', 25, '#805125', 700), 'No completion record is attached.'),
    'karina-message': frame('NEW MESSAGE · KARINA’S ACCOUNT', '08:28',
        rect(62, 176, 776, 287, '#e0e9e6') + lines(88, 222, ['I’m safe.', 'Someone told Ms Diop', 'to keep quiet.'], 28), 'Where is Karina? Who told Ms Diop to keep quiet?'),
    email: frame('SAVED EMAIL · SCHOOL MANAGEMENT', 'The instruction',
        text(62, 194, 'From: Mr El Idrissi · Deputy head', 23, '#617477')
        + rect(62, 218, 776, 72, '#e6e8ed') + text(86, 265, '“Delay the repair.”', 30, '#263b44', 700)
        + text(62, 335, 'MONDAY · 08:14', 20, '#805125', 700)
        + lines(62, 385, ['“Do not mention Friday’s warning.', 'Say it is new storm damage.”'], 28), 'Compare this with Friday’s warning and receipt.'),
    timeline: frame('RECORDS · FRIDAY AND MONDAY', 'What happened?',
        rect(62, 169, 776, 50, '#e0e9e6') + text(82, 203, 'FRI  09:20  Warning      →      09:45  Receipt', 23, '#315d56', 700)
        + '<path d="M90 252V485" stroke="#b57c45" stroke-width="3"/>'
        + [['08:07', 'Ms Diop and Karina enter the hall'], ['08:12', 'Karina arrives at first aid'], ['08:14', 'El Idrissi says: hide the warning'], ['08:15', 'Two different school messages'], ['08:16', 'Karina is not in class'], ['08:28', 'Karina sends: “I’m safe”']].map(([time, event], i) => `<circle cx="90" cy="${253 + i * 43}" r="5" fill="#b57c45"/>${text(112, 261 + i * 43, time, 23, '#315d56', 700)}${text(215, 261 + i * 43, event, 23)}`).join(''), 'Tell a classmate what happened first. What happened next?'),
};
for (const [name, svg] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, `${name}.svg`), svg);
    await sharp(Buffer.from(svg)).png({ palette: true, colours: 32 }).toFile(path.join(directory, `${name}.png`));
}
const original = path.join(directory, 'cctv-original.png');
if (fs.existsSync(original)) await sharp(original).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 62, mozjpeg: true }).toFile(path.join(directory, 'cctv.jpg'));
console.log('Evidence document cards rebuilt. CCTV original preserved.');
