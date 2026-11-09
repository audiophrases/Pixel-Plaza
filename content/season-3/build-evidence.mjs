// Code-native clue diagrams. Keep labels editable and shapes readable at classroom size.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const dir = path.join(import.meta.dirname, 'art/evidence');
fs.mkdirSync(dir, { recursive: true });
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const text = (x, y, s, size = 28, fill = '#243d48') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}">${esc(s)}</text>`;
const box = (x, y, w, h, fill = '#e1ebe6') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${fill}"/>`;
const at = (x, y, svg, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})">${svg}</g>`;
const star = '<path d="M0 -30 9 -9 32 -9 14 6 20 30 0 16 -20 30 -14 6 -32 -9 -9 -9Z" fill="#fff3c4" stroke="#80571d" stroke-width="3"/>';
const cup = (badge = 'star') => `<path d="M-54 -45H54V-5Q54 60 0 70Q-54 60 -54 -5Z" fill="#e9b84f" stroke="#80571d" stroke-width="6"/><path d="M-54 -28H-86Q-86 32 -46 27M54 -28H86Q86 32 46 27" fill="none" stroke="#b57e23" stroke-width="12"/><path d="M0 70V100" stroke="#b57e23" stroke-width="15"/><rect x="-57" y="100" width="114" height="22" rx="4" fill="#243d48"/>${badge === 'star' ? at(0, 9, star, .65) : '<circle cx="0" cy="10" r="19" fill="#fff3c4" stroke="#80571d" stroke-width="3"/>'}`;
const duck = '<ellipse cx="0" cy="40" rx="93" ry="69" fill="#efc957" stroke="#80571d" stroke-width="5"/><circle cx="40" cy="-28" r="54" fill="#efc957" stroke="#80571d" stroke-width="5"/><path d="M87 -26 137 -13 87 2Z" fill="#df843d"/><circle cx="56" cy="-43" r="7" fill="#243d48"/><ellipse cx="-15" cy="37" rx="37" ry="22" fill="#d5a739"/><circle cx="-45" cy="110" r="17" fill="#243d48"/><circle cx="45" cy="110" r="17" fill="#243d48"/>';
const book = '<path d="M-65 -45Q-25 -60 0 -38Q25 -60 65 -45V45Q25 30 0 52Q-25 30 -65 45Z" fill="#f4e9c9" stroke="#315f65" stroke-width="7"/><path d="M0 -38V52" stroke="#315f65" stroke-width="5"/>';
const cross = '<path d="M-18 -55H18V-18H55V18H18V55H-18V18H-55V-18H-18Z" fill="#3e8062"/>';
const sun = '<circle r="31" fill="#e5b549" stroke="#80571d" stroke-width="4"/>' + Array.from({length:8},(_,i)=>`<path d="M0 -42V-61" transform="rotate(${i*45})" stroke="#b57e23" stroke-width="7"/>`).join('');
const ball = '<circle r="49" fill="#edf0e9" stroke="#315f65" stroke-width="5"/><path d="M-28 -40 28 40M-46 10 46 -10M-15 -47 15 47" stroke="#315f65" stroke-width="4"/>';
const mail = '<rect x="-62" y="-40" width="124" height="80" rx="6" fill="#f4e9c9" stroke="#315f65" stroke-width="5"/><path d="M-62 -40 0 9 62 -40" fill="none" stroke="#315f65" stroke-width="5"/>';
const arrow = '<path d="M0 0H100M78 -20 100 0 78 20" fill="none" stroke="#315f65" stroke-width="9"/>';
const hoodie = color => `<path d="M-45 -20 -80 10 -60 90 -38 80V130H38V80L60 90 80 10 45 -20Z" fill="${color}" stroke="#243d48" stroke-width="4"/><path d="M-40 -20Q-40 -90 0 -90Q40 -90 40 -20L0 0Z" fill="${color}" stroke="#243d48" stroke-width="4"/>`;
const drops = '<path d="M0 -40Q-34 8 0 14Q34 8 0 -40" fill="#74b7cb"/>';
const frame = (title, body, footer) => `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#243d48"/><rect x="20" y="20" width="860" height="560" rx="20" fill="#f6f3e9"/><g font-family="Arial,sans-serif" font-weight="600">${text(55,65,'THE TROPHY THAT WALKED · YOUR CLUE',16,'#617477')}${text(55,115,title,34)}${body}${text(55,546,footer,22,'#46676c')}</g></svg>`;
const signs = (items) => items.map(([icon,label],i)=>{const x=230+i%2*430,y=235+Math.floor(i/2)*190;return box(x-170,y-75,340,165)+at(x,y-5,icon,.7)+text(x-110,y+65,label,27);}).join('');
const cards = {
    'duck-door': ['A duck with a cup!', at(220,290,duck,1.15)+at(295,335,cup('circle'),.52)+at(425,330,arrow)+box(575,180,240,280,'#dce7ec')+at(695,290,book,1.1), 'Camera, 9:05 · The duck goes to this sign.'],
    'school-signs': ['Which place?', signs([[book,'LIBRARY'],[ball,'SPORTS HALL'],[mail,'OFFICE'],[cross,'FIRST AID']]), 'Tell your team which sign they need.'],
    'duck-label': ['A label under the duck', at(235,285,duck)+box(470,205,330,220)+text(530,280,'DUCK',32)+text(540,370,'D4',84), 'Who uses D4? Ask the People checker.'],
    'club-list': ['School robot club', box(70,160,760,310)+text(110,220,'NAME',24)+text(620,220,'ROBOT',24)+text(110,290,'Laia')+text(650,290,'D4',40)+text(110,365,'Chidi')+text(650,365,'B2',40)+text(110,440,'Ms Diop')+text(650,440,'A1',40), 'Match the label to a name.'],
    'fake-cup': ['The duck’s cup', at(450,300,cup('circle'),1.65)+text(90,460,'ROUND badge',30), 'Look at the badge. Ask about the school trophy.'],
    'real-cup': ['School trophy record', at(450,300,cup(),1.65)+text(90,460,'STAR badge',30), 'The real school trophy has this badge.'],
    'green-sleeve': ['Before the duck arrived', at(240,275,hoodie('#54866c'),1.15)+at(505,300,cup(),1.2)+text(640,240,'9:00',48), 'A green sleeve lifts the STAR trophy. Face not visible.'],
    'clothes': ['What are they wearing?', at(180,285,hoodie('#916da4'),.8)+at(450,285,hoodie('#54866c'),.8)+at(720,285,hoodie('#567f9e'),.8)+text(140,445,'Laia')+text(405,445,'Chidi')+text(660,445,'Ms Diop'), 'Purple jacket · Green hoodie · Blue top'],
    'leak': ['Above the trophy stand', '<path d="M100 185H800" stroke="#7a8890" stroke-width="24"/>'+at(300,260,drops)+at(480,290,drops)+at(660,250,drops)+box(280,380,340,90,'#b9c3c6')+at(450,330,cup(),.7), 'Water falls onto the trophy stand.'],
    'repair-note': ['A note from the office', box(70,160,760,315)+text(110,225,'LEAK ABOVE THE TROPHY.')+text(110,290,'Move the trophy somewhere dry.')+text(110,355,'Staff will repair the roof.')+text(110,430,'9:00 · Before the duck arrived',25), 'The note explains why the trophy needed moving.'],
    'chidi-route': ['Chidi’s message', at(180,270,hoodie('#54866c'),.8)+text(300,205,'“I moved the trophy')+text(300,250,'to the dry room')+text(300,295,'with this sign.”')+at(570,405,cross,.85), 'Which room is it? Ask the Place checker.'],
    'safe-rooms': ['Find the room', signs([[cross,'FIRST AID'],[book,'LIBRARY'],[ball,'SPORTS HALL'],[mail,'OFFICE']]), 'The trophy is in a blue box in the dry room.'],
    'talking-cup': ['The trophy speaks!', at(275,300,cup(),1.4)+box(450,180,365,220)+text(490,245,'“Find the SUN.”',30)+at(630,330,sun,.65)+'<path d="M360 405Q415 365 360 325M380 425Q455 365 380 305" fill="none" stroke="#315f65" stroke-width="7"/>', 'Where is the sun sign? Ask the Place checker.'],
    'party-signs': ['School event signs', signs([[sun,'COURTYARD'],[book,'LIBRARY'],[ball,'SPORTS HALL'],[cross,'FIRST AID']]), 'Follow the sign in the trophy’s message.'],
    'speaker-note': ['A note inside the base', box(70,160,760,315)+text(110,225,'I put a small SPEAKER here.')+text(110,290,'It plays my party message.')+text(110,355,'Surprise!')+text(110,430,'From: the PE teacher',32), 'Who is the PE teacher? Ask the People checker.'],
    'staff-list': ['Who works here?', box(70,160,760,315)+text(110,225,'PERSON',24)+text(465,225,'JOB',24)+text(110,300,'Ms Diop')+text(465,300,'PE teacher')+text(110,365,'Laia')+text(465,365,'Student')+text(110,430,'Chidi')+text(465,430,'Student'), 'Tell your team the teacher’s name.'],
};
for (const [name,[title,body,footer]] of Object.entries(cards)) {
    const svg=frame(title,body,footer);
    fs.writeFileSync(path.join(dir,`${name}.svg`),svg);
    await sharp(Buffer.from(svg)).webp({quality:82}).toFile(path.join(dir,`${name}.webp`));
}
console.log(`${Object.keys(cards).length} private picture clues built.`);
