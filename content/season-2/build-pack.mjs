// Authoring source for this optional content pack. Nothing in the application imports this file.
// Run from any directory: node content/season-2/build-evidence.mjs && node content/season-2/build-pack.mjs
//
// How the season plays: each student (or each member of a case team) holds one private picture. Every question needs
// two pictures held by two different roles, so the team has to tell each other what their pictures show. The same
// three steps every chapter: look at your picture, tell your team, answer together.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { missionEnvelope, validateMission } from '../../shared/missionSchema.ts';
import { parseTheme } from '../../shared/theme.ts';
import { walkReport } from '../../shared/walk.ts';
import { zipFiles } from '../../shared/zip.ts';

const directory = import.meta.dirname;
const help = ca => ({ ca: ca.trim() });
const line = (text, ca) => ({ text, help: help(ca) });
// Pictures travel inside the mission, so they are small WebP copies of the artwork in art/evidence.
const evidence = async (name, alt) => {
    const file = ['cctv', 'opening-story'].includes(name) ? `${name}.jpg` : `${name}.png`;
    const bytes = await sharp(path.join(directory, 'art/evidence', file)).resize({ width: 760, withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
    return { src: `data:image/webp;base64,${bytes.toString('base64')}`, alt };
};
// Each role's private clue for a chapter: the English text, its Catalan help and the picture only that role sees.
const pictures = async entries => ({
    roleClues: Object.fromEntries(entries.map(([id, en]) => [id, en])),
    roleClueHelp: Object.fromEntries(entries.map(([id, , ca]) => [id, help(ca)])),
    roleClueImages: Object.fromEntries(await Promise.all(entries.map(async ([id, , , picture, alt]) => [id, await evidence(picture, alt)]))),
});
const question = (id, en, ca, accept, after) => ({ id, ...line(en, ca), accept, ...(after ? { after } : {}) });
const together = (id, en, ca, after, successCriteria) => ({ id, ...line(en, ca), accept: [], kind: 'report', level: 'A2', after, successCriteria });
const discovery = (id, zone, en, ca) => ({ id, zone, ...line(en, ca) });
const news = (id, en, ca) => ({ id, ...line(en, ca) });
const chapter = (id, title, intro, recap, ending, rest) => ({ id, title, intro: intro[0], recap: recap[0], ending: ending[0],
    help: { intro: help(intro[1]), recap: help(recap[1]), ending: help(ending[1]) }, share: 0.7, ...rest });

const roles = [
    ['media-analyst', 'Message checker', 'You check messages. Look at your picture. Tell your team what it says.', 'Comproves missatges. Mira la teva imatge. Explica al teu equip què diu.'],
    ['witness-interviewer', 'People checker', 'You listen to people. Look at your picture. Tell your team who said what.', 'Escoltes la gent. Mira la teva imatge. Explica al teu equip qui va dir què.'],
    ['records-researcher', 'Document checker', 'You read papers. Look at your picture. Tell your team what it says.', 'Llegeixes documents. Mira la teva imatge. Explica al teu equip què diu.'],
    ['site-observer', 'Place checker', 'You look at places. Look at your picture. Tell your team what you see.', 'Mires llocs. Mira la teva imatge. Explica al teu equip què hi veus.'],
].map(([id, name, card, cardCa]) => ({ id, name, card, help: { card: help(cardCa) } }));

const steps = 'Look at your picture. Tell your team what it shows. Answer together.';
const stepsCa = 'Mira la teva imatge. Explica al teu equip què mostra. Responeu junts.';
const chapters = [
    chapter('p815-missing-student', '1. Karina Is Missing',
        [`A storm. Karina is missing. Each of you has one picture. ${steps}`,
            `Hi ha una tempesta. Falta la Karina. Cadascú té una imatge. ${stepsCa}`],
        ['Karina is missing. Two school messages say different things.', 'Falta la Karina. Dos missatges de l’institut diuen coses diferents.'],
        ['A camera saw Karina at 8:07. A teacher was with her. Who is the teacher?',
            'Una càmera va veure la Karina a les 8:07. Hi havia una professora amb ella. Qui és?'], {
        ...await pictures([
            ['media-analyst', 'Your picture: two school messages at 8:15. One says “Stay in classrooms.” One says “Go to the sports hall.”',
                'La teva imatge: dos missatges de l’institut a les 8:15. Un diu «Quedeu-vos a les aules». L’altre diu «Aneu al pavelló».',
                'messages', 'Two messages from the school account at 8:15: “Stay in classrooms. Do not go to the sports hall.” and “Go to the sports hall.”'],
            ['records-researcher', 'Your picture: the school storm plan. In a storm: stay in your classroom.',
                'La teva imatge: el pla de tempesta de l’institut. Si hi ha tempesta: queda’t a l’aula.',
                'storm-plan', 'The storm plan: 1. Stay in your classroom. 2. Wait for your teacher. 3. Never use the covered passage.'],
            ['witness-interviewer', 'Your picture: Youssef says, “Karina went to take a photo of the broken roof.”',
                'La teva imatge: en Youssef diu: «La Karina va anar a fer una foto del sostre trencat».',
                'youssef', 'Youssef, Karina’s friend, says: “Karina went to take a photo of the broken roof.”'],
            ['site-observer', 'Your picture: a photo of the broken roof. It is over the covered passage, next to the sports hall.',
                'La teva imatge: una foto del sostre trencat. És sobre el passadís cobert, al costat del pavelló.',
                'roof-photo', 'A photo of the covered passage next to the sports hall in the rain. A roof panel is on the ground and a sign says DANGER.'],
        ]),
        objectives: [
            question('p815-c1-wrong', 'Which message is wrong? Ask the Message checker and the Document checker.',
                'Quin missatge està malament? Pregunta al Message checker i al Document checker.',
                ['go to the sports hall', 'sports hall', 'the second message', 'second message', 'the second one']),
            question('p815-c1-where', 'Where did Karina go? Ask the People checker and the Place checker.',
                'On va anar la Karina? Pregunta al People checker i al Place checker.',
                ['covered passage', 'the passage', 'passage'], 'p815-c1-wrong'),
            together('p815-c1-note', 'Write together: “The wrong message says… Karina went to…”',
                'Escriviu junts: «El missatge equivocat diu… La Karina va anar a…»', 'p815-c1-where',
                'Says that the wrong 8:15 message is “Go to the sports hall” (it breaks the storm plan) and that Karina went to the covered passage with the broken roof. Simple A2 sentences are fine.'),
        ],
        discoveries: [
            discovery('p815-c1-register', 'courtyard', 'Class list, 8:16: Karina is not in class.', 'Llista de classe, 8:16: la Karina no és a classe.'),
            discovery('p815-c1-library', 'library', 'Laia: “I saved the two messages on my phone.”', 'La Laia: «Vaig guardar els dos missatges al mòbil».'),
        ],
        reveals: [
            news('p815-c1-news-a', 'Tip: Message checker and Document checker, compare your pictures. Which message breaks the storm plan?',
                'Pista: Message checker i Document checker, compareu les vostres imatges. Quin missatge no compleix el pla de tempesta?'),
            news('p815-c1-news-b', 'Tip: People checker and Place checker, compare your pictures. Where is the broken roof?',
                'Pista: People checker i Place checker, compareu les vostres imatges. On és el sostre trencat?'),
        ],
    }),
    chapter('p815-everyone-secret', '2. Why Did Ms Diop Lie?',
        [`The camera saw Ms Diop with Karina. But Ms Diop says, “I did not see her.” You have a new picture. ${steps}`,
            `La càmera va veure la senyora Diop amb la Karina. Però ella diu: «No l’he vista». Tens una imatge nova. ${stepsCa}`],
        ['A camera saw Ms Diop with Karina. Ms Diop said she did not see her.', 'Una càmera va veure la senyora Diop amb la Karina. Ella va dir que no l’havia vista.'],
        ['8:28. A message from Karina: “I’m safe. Someone told Ms Diop to keep quiet.”',
            '8:28. Un missatge de la Karina: «Estic bé. Algú va dir a la senyora Diop que callés».'], {
        ...await pictures([
            ['records-researcher', 'Your picture: Ms Diop’s warning. Friday, 9:20: “The passage roof is dangerous.”',
                'La teva imatge: l’avís de la senyora Diop. Divendres, 9:20: «El sostre del passadís és perillós».',
                'warning', 'A safety warning from Friday 9:20: “The passage roof is dangerous. Close the passage. Repair the roof.” Reported by Awa Diop.'],
            ['media-analyst', 'Your picture: the office receipt. The office got a warning on Friday at 9:45. A note says “Repair delayed.”',
                'La teva imatge: el rebut de secretaria. Secretaria va rebre un avís divendres a les 9:45. Una nota diu «Reparació ajornada».',
                'receipt', 'The office receipt: warning received Friday 9:45. A later note says: Repair delayed.'],
            ['witness-interviewer', 'Your picture: Ms Ionescu says, “Ms Diop took Karina out by the back door at 8:12.”',
                'La teva imatge: la senyora Ionescu diu: «La senyora Diop va treure la Karina per la porta del darrere a les 8:12».',
                'ionescu', 'Ms Ionescu, a teacher, says: “Ms Diop took Karina out by the back door at 8:12.”'],
            ['site-observer', 'Your picture: a map. From the back door of the sports hall, the safe path goes to the first-aid room.',
                'La teva imatge: un mapa. Des de la porta del darrere del pavelló, el camí segur va a la infermeria.',
                'route', 'A map: the covered passage is closed. A safe path goes from the back door of the sports hall to the first-aid room.'],
        ]),
        introImage: await evidence('cctv', 'Security camera at 8:07: a teacher and a student go into the sports hall.'),
        objectives: [
            question('p815-c2-first', 'Who warned the school about the roof first? Ask the Document checker and the Message checker.',
                'Qui va avisar primer l’institut del sostre? Pregunta al Document checker i al Message checker.',
                ['Ms Diop', 'Diop', 'Awa Diop', 'Ms Awa Diop']),
            question('p815-c2-took', 'Where did Ms Diop take Karina? Ask the People checker and the Place checker.',
                'On va portar la senyora Diop la Karina? Pregunta al People checker i al Place checker.',
                ['first aid room', 'first aid', 'first-aid room', 'medical room', 'nurse room'], 'p815-c2-first'),
            together('p815-c2-note', 'Write together: “Ms Diop lied, but she… She took Karina to…”',
                'Escriviu junts: «La senyora Diop va mentir, però… Va portar la Karina a…»', 'p815-c2-took',
                'Says that Ms Diop lied but helped: she warned the school about the roof on Friday, and/or she took Karina to the first-aid room by the safe path. Simple A2 sentences are fine.'),
        ],
        discoveries: [
            discovery('p815-c2-clip', 'sports-hall', 'Security video, 8:07: Ms Diop and Karina go into the sports hall.',
                'Vídeo de seguretat, 8:07: la senyora Diop i la Karina entren al pavelló.'),
            discovery('p815-c2-copy', 'library', 'Ms Sokolova: “I kept a copy of Ms Diop’s warning.”', 'La senyora Sokolova: «Vaig guardar una còpia de l’avís de la senyora Diop».'),
        ],
        reveals: [
            news('p815-c2-news-a', 'Tip: Document checker and Message checker, compare your pictures. Who wrote the warning?',
                'Pista: Document checker i Message checker, compareu les vostres imatges. Qui va escriure l’avís?'),
            news('p815-c2-news-b', 'Tip: People checker and Place checker, compare your pictures. Where does the safe path go?',
                'Pista: People checker i Place checker, compareu les vostres imatges. On va el camí segur?'),
        ],
    }),
    chapter('p815-truth', '3. Who Said “Keep Quiet”?',
        [`Karina is safe. But someone told Ms Diop to keep quiet. Who? You have a new picture. ${steps}`,
            `La Karina està bé. Però algú va dir a la senyora Diop que callés. Qui? Tens una imatge nova. ${stepsCa}`],
        ['Karina is safe in the first-aid room. Someone told Ms Diop to keep quiet.', 'La Karina està bé a la infermeria. Algú va dir a la senyora Diop que callés.'],
        ['You solved it! Karina is safe. Ms Diop helped her. Mr El Idrissi delayed the repair and told Ms Diop to keep quiet. Now the passage is closed.',
            'Ho heu resolt! La Karina està bé. La senyora Diop la va ajudar. El senyor El Idrissi va ajornar la reparació i va dir a la senyora Diop que callés. Ara el passadís està tancat.'], {
        ...await pictures([
            ['witness-interviewer', 'Your picture: Ms Diop says, “The deputy head told me to keep quiet. I was scared.”',
                'La teva imatge: la senyora Diop diu: «El cap d’estudis em va dir que callés. Tenia por».',
                'diop-quote', 'Ms Diop, the PE teacher, says: “The deputy head told me to keep quiet. I was scared.”'],
            ['records-researcher', 'Your picture: the school staff list. The deputy head is Mr El Idrissi.',
                'La teva imatge: la llista del personal. El cap d’estudis és el senyor El Idrissi.',
                'staff', 'School staff: Deputy head, Mr El Idrissi. PE teacher, Ms Diop. Maths teacher, Ms Sokolova. Teacher, Ms Ionescu.'],
            ['media-analyst', 'Your picture: an email from Mr El Idrissi: “Do not mention Friday’s warning. Say it is new storm damage.”',
                'La teva imatge: un correu del senyor El Idrissi: «No esmenteu l’avís de divendres. Digueu que són danys nous de la tempesta».',
                'email', 'An email from Mr El Idrissi, deputy head: “Delay the repair.” Monday 8:14: “Do not mention Friday’s warning. Say it is new storm damage.”'],
            ['site-observer', 'Your picture: what happened, in order. First, on Friday: a warning about the roof. Then, on Monday: the storm.',
                'La teva imatge: què va passar, en ordre. Primer, divendres: un avís sobre el sostre. Després, dilluns: la tempesta.',
                'timeline', 'A timeline: Friday 9:20 warning, 9:45 receipt. Monday: 8:07 Ms Diop and Karina enter the hall, 8:12 first aid, 8:14 hide the warning, 8:15 two messages, 8:16 Karina not in class, 8:28 “I’m safe”.'],
        ]),
        introImage: await evidence('karina-message', 'A message from Karina’s account at 8:28: “I’m safe. Someone told Ms Diop to keep quiet.”'),
        objectives: [
            question('p815-c3-who', 'Who told Ms Diop to keep quiet? Write the name. Ask the People checker and the Document checker.',
                'Qui va dir a la senyora Diop que callés? Escriu el nom. Pregunta al People checker i al Document checker.',
                ['El Idrissi', 'Mr El Idrissi', 'Idrissi']),
            question('p815-c3-when', 'When did the school first know about the broken roof? Ask the Message checker and the Place checker.',
                'Quan va saber l’institut, per primer cop, que el sostre estava trencat? Pregunta al Message checker i al Place checker.',
                ['Friday', 'on Friday', 'last Friday'], 'p815-c3-who'),
            together('p815-c3-note', 'Write a note to the head teacher: “The roof was dangerous since… Ms Diop… Mr El Idrissi…”',
                'Escriviu una nota a la directora: «El sostre era perillós des de… La senyora Diop… El senyor El Idrissi…»', 'p815-c3-when',
                'A short note saying the roof was dangerous since Friday, that Ms Diop warned the school and helped Karina, and that Mr El Idrissi delayed the repair and told her to keep quiet. Simple A2 sentences are fine.'),
        ],
        discoveries: [
            discovery('p815-c3-safe', 'first-aid', 'Karina: “I am OK. Ms Diop brought me here at 8:12.”', 'La Karina: «Estic bé. La senyora Diop em va portar aquí a les 8:12».'),
            discovery('p815-c3-closed', 'admin-office', 'A note on the office door: “Passage closed. Repair it now.”', 'Una nota a la porta de secretaria: «Passadís tancat. Repareu-lo ara».'),
        ],
        reveals: [
            news('p815-c3-news-a', 'Tip: People checker and Document checker, compare your pictures. What is the deputy head’s name?',
                'Pista: People checker i Document checker, compareu les vostres imatges. Com es diu el cap d’estudis?'),
            news('p815-c3-news-b', 'Tip: Message checker and Place checker, compare your pictures. Which day was the warning?',
                'Pista: Message checker i Place checker, compareu les vostres imatges. Quin dia va ser l’avís?'),
        ],
    }),
];
// The story's pictures around the chapters: the storm at the start, and the hook at the end of each chapter.
chapters[0].introImage = await evidence('opening-story', 'A storm over the school. Students look out of a classroom window at the dark sky.');
chapters[0].endingImage = await evidence('cctv', 'Security camera at 8:07: a teacher and a student go into the sports hall.');
chapters[1].endingImage = await evidence('karina-message', 'A message from Karina’s account at 8:28: “I’m safe. Someone told Ms Diop to keep quiet.”');
// A role's usual clue, before any chapter's: the first chapter's.
for (const role of roles) { role.clue = chapters[0].roleClues[role.id]; role.help.clue = chapters[0].roleClueHelp[role.id]; }

const campaign = {
    id: 'protocol-815', title: 'Protocol 8:15 — The Missing Student', roles, chapters,
    vocabulary: ['Karina Gonzalvez', 'Youssef El Amrani', 'Awa Diop', 'Andreea Ionescu', 'El Idrissi', 'Laia Garcia', 'Chidi Okafor', 'Irina Sokolova', 'Coma-ruga', 'CCTV'],
    // The story's people, as students may know them from the start: shown as a Who's who and marked 📖 in the story.
    cast: [
        { name: 'Karina Gonzalvez', about: 'A student. She is missing after the storm.' },
        { name: 'Youssef El Amrani', about: 'A student, Karina’s best friend.' },
        { name: 'Laia Garcia', about: 'A student who saved the 8:15 messages on her phone.' },
        { name: 'Chidi Okafor', about: 'A student who took a photo near the sports hall.' },
        { name: 'Ms Awa Diop', about: 'The PE teacher.' },
        { name: 'Ms Andreea Ionescu', about: 'A teacher, Ms Diop’s colleague.' },
        { name: 'Ms Irina Sokolova', about: 'The maths teacher.' },
        { name: 'Mr El Idrissi', about: 'The deputy head of the school.' },
    ],
    finale: 'Case solved! Ms Diop took Karina to safety. Mr El Idrissi delayed the repair and told Ms Diop to keep quiet. You shared your pictures and found the truth. Talk about it: was Ms Diop right to lie?',
    help: { finale: help('Cas resolt! La senyora Diop va portar la Karina a un lloc segur. El senyor El Idrissi va ajornar la reparació i va dir a la senyora Diop que callés. Heu compartit les vostres imatges i heu descobert la veritat. Parleu-ne: va fer bé de mentir, la senyora Diop?') },
};
const writeJson = (file, value) => fs.writeFileSync(path.join(directory, file), JSON.stringify(value, null, 2) + '\n');
const theme = parseTheme(JSON.parse(fs.readFileSync(path.join(directory, 'theme.json'), 'utf8')));
const paths = walkReport(theme);
if (paths.problems.length) throw new Error(paths.problems.join('\n'));
const checked = validateMission(missionEnvelope(campaign), 'publish', new Set(theme.zones.map(z => z.id)));
if (!checked.campaign) throw new Error(JSON.stringify(checked.errors));
writeJson('campaign.json', missionEnvelope(checked.campaign));
fs.mkdirSync(path.join(directory, 'chapters'), { recursive: true });
for (const [i, chapter] of chapters.entries()) {
    const standalone = { ...campaign, id: `${campaign.id}-chapter-${i + 1}`, title: `Protocol 8:15 · ${chapter.title}`, chapters: [chapter],
        finale: i === 2 ? campaign.finale : chapter.ending, help: { finale: i === 2 ? campaign.help.finale : chapter.help.ending } };
    const validated = validateMission(missionEnvelope(standalone), 'publish', new Set(theme.zones.map(z => z.id)));
    if (!validated.campaign) throw new Error(JSON.stringify(validated.errors));
    writeJson(`chapters/0${i + 1}.json`, missionEnvelope(validated.campaign));
}
writeJson('manifest.json', { format: 'pixel-plaza-season-pack', version: 2, id: 'protocol-815', season: 2,
    title: campaign.title, level: 'A2–B1', minutesPerChapter: [20, 25], campaign: 'campaign.json', chapters: ['chapters/01.json', 'chapters/02.json', 'chapters/03.json'],
    theme: 'theme.json', background: 'art/campus.png', instructions: 'README.md', teacherGuide: 'teacher-guide.md', source: 'storyline.txt', languages: ['en', 'ca'],
    installation: 'Import the map and background through Map Studio; import the campaign or separate chapters through Mission Studio. No runtime registration or built-in content.' });
const files = ['manifest.json', 'campaign.json', 'theme.json', 'chapters/01.json', 'chapters/02.json', 'chapters/03.json', 'art/campus.png', 'art/layout.png', 'art/prompt.md', 'README.md', 'teacher-guide.md', 'storyline.txt', 'build-pack.mjs', 'build-evidence.mjs',
    ...fs.readdirSync(path.join(directory, 'art/evidence')).map(file => `art/evidence/${file}`)];
if (files.every(file => fs.existsSync(path.join(directory, file)))) {
    fs.writeFileSync(path.join(directory, 'protocol-815-season-2.zip'), zipFiles(Object.fromEntries(files.map(file => [file, new Uint8Array(fs.readFileSync(path.join(directory, file)))]))));
}
const size = fs.statSync(path.join(directory, 'campaign.json')).size;
console.log(`Protocol 8:15: ${chapters.length} chapters, ${chapters.reduce((n, c) => n + c.objectives.length, 0)} tasks, campaign.json ${Math.round(size / 1024)} KB; mission validation and map paths pass.`);
