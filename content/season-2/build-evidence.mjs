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
// What a person says: a speech bubble beside a simple figure.
const person = (x, y, colour) => `<circle cx="${x}" cy="${y}" r="34" fill="${colour}"/><rect x="${x - 48}" y="${y + 42}" width="96" height="110" rx="40" fill="${colour}"/>`;
const says = (who, colour, words, footer) => frame('WHAT PEOPLE SAY', who,
    person(140, 270, colour)
    + rect(232, 186, 606, 46 + words.length * 46, '#ffffff', 22) + `<path d="M234 ${226 + words.length * 23}L196 ${250 + words.length * 23}L240 ${208 + words.length * 23}Z" fill="#ffffff"/>`
    + lines(262, 238, words, 31, '#263b44'), footer);
const files = {
    'storm-plan': frame('SCHOOL RULES · STORM PLAN', 'In a storm',
        [['1', 'Stay in your classroom.'], ['2', 'Wait for your teacher.'], ['3', 'Never use the covered passage.']].map(([n, rule], i) =>
            rect(62, 176 + i * 92, 776, 74, i === 0 ? '#e0e9e6' : '#ece9df') + `<circle cx="104" cy="${213 + i * 92}" r="22" fill="#315d56"/>`
            + text(96, 222 + i * 92, n, 24, '#ffffff', 700) + text(146, 224 + i * 92, rule, 30, '#263b44', i === 0 ? 700 : 400)).join(''),
        'Every classroom has this plan on the wall.'),
    youssef: says('Youssef, Karina’s friend', '#5b7fa6', ['“Karina went to take a photo', 'of the broken roof.”'], 'Monday, 8:05 · Youssef did not go with her.'),
    'roof-photo': `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><g font-family="Arial, sans-serif">${rect(0, 0, 900, 600, '#263b44', 0)}${rect(24, 24, 852, 552, '#f5f2e9', 16)}`
        + text(62, 70, 'PHOTO · MONDAY 8:10', 16, '#617477', 700) + text(62, 110, 'The broken roof', 32, '#263b44', 700)
        + rect(62, 130, 776, 360, '#56646e', 8)
        + Array.from({ length: 26 }, (_, i) => `<path d="M${80 + i * 30} ${140 + (i % 3) * 18}l-14 34" stroke="#9fb4c2" stroke-width="2"/>`).join('')
        + rect(560, 220, 250, 250, '#c9b48a', 4) + text(598, 262, 'SPORTS HALL', 24, '#4a3b22', 700) + rect(640, 360, 70, 110, '#7a5a35', 4)
        + '<path d="M90 260H540" stroke="#d8dde0" stroke-width="14"/>' + rect(100, 262, 16, 208, '#b8c0c6', 2) + rect(330, 262, 16, 208, '#b8c0c6', 2) + rect(520, 262, 16, 208, '#b8c0c6', 2)
        + '<path d="M150 470L300 300L322 318L172 488Z" fill="#8f9aa2" stroke="#3b444b" stroke-width="3"/>'
        + rect(380, 380, 120, 56, '#d64545', 6) + text(394, 417, 'DANGER', 24, '#ffffff', 700)
        + rect(62, 490, 776, 0, '#000') + text(62, 530, 'The covered passage, next to the sports hall. A roof panel is on the ground.', 20, '#263b44', 700)
        + text(62, 560, 'Photo by Chidi.', 16, '#617477') + '</g></svg>',
    ionescu: says('Ms Ionescu, a teacher', '#8a6aa8', ['“Ms Diop took Karina out', 'by the back door at 8:12.”'], 'She was scared to say it before.'),
    route: frame('MAP · SCHOOL GROUNDS', 'The safe way',
        rect(70, 180, 230, 170, '#c9b48a', 8) + text(98, 272, 'SPORTS HALL', 24, '#4a3b22', 700)
        + rect(300, 238, 230, 52, '#d8dde0', 4) + text(316, 272, 'Covered passage', 20, '#3b444b') + '<path d="M330 236L500 292M500 236L330 292" stroke="#d64545" stroke-width="6"/>'
        + rect(560, 180, 278, 170, '#cfe3d4', 8) + text(590, 260, 'FIRST-AID', 26, '#24543a', 700) + text(590, 292, 'ROOM', 26, '#24543a', 700)
        + rect(170, 350, 54, 14, '#7a5a35', 3) + text(150, 392, 'back door', 18, '#4a3b22', 700)
        + '<path d="M197 364V450H700V350" stroke="#2f8f5b" stroke-width="7" fill="none" stroke-dasharray="16 10"/>' + '<path d="M684 368L700 346L716 368Z" fill="#2f8f5b"/>'
        + text(330, 486, 'safe path', 20, '#2f8f5b', 700),
        'From the back door of the sports hall, the safe path goes to the first-aid room.'),
    'diop-quote': says('Ms Diop, the PE teacher', '#b5654a', ['“The deputy head told me', 'to keep quiet. I was scared.”'], 'She helped Karina, but she lied.'),
    staff: frame('SCHOOL STAFF', 'Who is who',
        [['Deputy head', 'Mr El Idrissi'], ['PE teacher', 'Ms Diop'], ['Maths teacher', 'Ms Sokolova'], ['Teacher', 'Ms Ionescu']].map(([job, name], i) =>
            rect(62, 172 + i * 84, 776, 68, i === 0 ? '#e0e9e6' : '#ece9df') + text(90, 215 + i * 84, job, 26, '#617477', 700) + text(400, 215 + i * 84, name, 30, '#263b44', 700)).join(''),
        'From the school website.'),
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
