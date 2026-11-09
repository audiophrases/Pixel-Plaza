// Authoring source for this optional content pack. Nothing in the application imports this file.
// Run from any directory: node content/season-2/build-pack.mjs
import fs from 'node:fs';
import path from 'node:path';
import { missionEnvelope, validateMission } from '../../shared/missionSchema.ts';
import { parseTheme } from '../../shared/theme.ts';
import { walkReport } from '../../shared/walk.ts';
import { zipFiles } from '../../shared/zip.ts';

const directory = import.meta.dirname;
const help = ca => ({ ca: ca.trim() });
const line = (text, ca) => ({ text, help: help(ca) });
const clueMap = entries => ({ roleClues: Object.fromEntries(entries.map(([id, en]) => [id, en])), roleClueHelp: Object.fromEntries(entries.map(([id, , ca]) => [id, help(ca)])) });
const question = (id, en, ca, accept, after) => ({ id, ...line(en, ca), accept, ...(after ? { after } : {}) });
const report = (id, en, ca, after, successCriteria, optional = false) => ({ id, ...line(en, ca), accept: [], kind: 'report', level: 'A2', after, successCriteria,
    ...(optional ? { optional: true } : { conversation: { witnesses: 1 } }) });
const discovery = (id, zone, en, ca) => ({ id, zone, ...line(en, ca) });
const news = (id, en, ca) => ({ id, ...line(en, ca) });
const chapter = (id, title, intro, recap, ending, rest) => ({ id, title, intro: intro[0], recap: recap[0], ending: ending[0],
    help: { intro: help(intro[1]), recap: help(recap[1]), ending: help(ending[1]) }, share: 0.7, ...rest });

const roles = [
    ['media-analyst', 'Message checker', 'Read your clue. Tell a classmate: “My clue says…” Ask: “What does yours say?”', 'Llegeix la teva pista. Digues a un company: «La meva pista diu…» Pregunta: «Què diu la teva?»',
        'Laia saved two messages at 8:15: “Stay inside” and “Go to the sports hall.” Both use the school account.', 'La Laia va guardar dos missatges de les 8:15: «Quedeu-vos a dins» i «Aneu al pavelló». Tots dos utilitzen el compte de l’institut.'],
    ['witness-interviewer', 'People checker', 'Read your clue. Tell a classmate: “My clue says…” Ask: “What does yours say?”', 'Llegeix la teva pista. Digues a un company: «La meva pista diu…» Pregunta: «Què diu la teva?»',
        'Youssef is Karina’s friend. He says, “I have not seen her.” Laia says they talked before class.', 'En Youssef és amic de la Karina. Diu: «No l’he vista». La Laia diu que van parlar abans de classe.'],
    ['records-researcher', 'Document checker', 'Read your clue. Tell a classmate: “My clue says…” Ask: “What does yours say?”', 'Llegeix la teva pista. Digues a un company: «La meva pista diu…» Pregunta: «Què diu la teva?»',
        'At 8:16, teachers checked who was in class. Karina was not there. Nobody knew where she was.', 'A les 8:16, el professorat va comprovar qui era a classe. La Karina no hi era. Ningú sabia on era.'],
    ['site-observer', 'Place checker', 'Read your clue. Tell a classmate: “My clue says…” Ask: “What does yours say?”', 'Llegeix la teva pista. Digues a un company: «La meva pista diu…» Pregunta: «Què diu la teva?»',
        'Chidi saw a roof panel fall and block the passage near the sports hall. Ms Diop said, “Stay away.”', 'En Chidi va veure caure una placa del sostre que va bloquejar el passadís prop del pavelló. La senyora Diop va dir: «No us hi acosteu».'],
].map(([id, name, card, cardCa, clue, clueCa]) => ({ id, name, card, clue, help: { card: help(cardCa), clue: help(clueCa) } }));

const chapters = [
    chapter('p815-missing-student', '1. The Missing Student',
        ['A storm hits the school. Karina, a student, is missing. Two school messages say different things. Your mission: find out what happened. First, read your clue in the Journal. Tell a classmate: “My clue says…”',
            'Hi ha una tempesta a l’institut. Falta la Karina, una alumna. Dos missatges de l’institut diuen coses diferents. Missió: descobrir què ha passat. Primer, llegeix la teva pista al Journal. Digues a un company: «La meva pista diu…»'],
        ['Karina is missing. The school messages disagree. What do we know so far?', 'Falta la Karina. Els missatges de l’institut diuen coses diferents. Què sabem fins ara?'],
        ['A security video shows Ms Diop, the PE teacher, with Karina at 8:07. Ms Diop said she had not seen her. Why did she lie?',
            'Un vídeo de seguretat mostra la senyora Diop, professora d’educació física, amb la Karina a les 8:07. Havia dit que no l’havia vista. Per què va mentir?'], {
        objectives: [
            question('p815-c1-messages', 'Go to the office. Read both messages. Which place is in both? Write the place.', 'Ves a secretaria. Llegeix els dos missatges. Quin lloc surt a tots dos? Escriu el lloc.', ['sports hall', 'the sports hall', 'gym']),
            question('p815-c1-passage', 'Go outside the sports hall. Read Chidi’s clue. What fell from the roof?', 'Ves a fora del pavelló. Llegeix la pista d’en Chidi. Què va caure del sostre?', ['roof panel', 'fallen roof panel', 'a roof panel'], 'p815-c1-messages'),
            report('p815-c1-briefing', 'Use “Choose a witness”. Ask: “What do you know?” After their reply, write: “We know… Also… Our question is…”',
                'Fes servir «Choose a witness». Pregunta: «Què saps?» Quan respongui, escriu: «Sabem… També… La nostra pregunta és…»', 'p815-c1-passage',
                'Two supported facts from this chapter and one unresolved question. Valid facts include contradictory 8:15 messages, Karina missing at 8:16, a fallen roof panel, or Diop keeping students away. Do not require a culprit or Karina’s location.'),
            report('p815-c1-rumour', 'Bonus: someone says, “Karina is in the sports hall.” We do not know that. Write: “We only know…”',
                'Extra: algú diu: «La Karina és al pavelló». No ho sabem. Escriu: «Només sabem…»', 'p815-c1-briefing',
                'A short English message distinguishing a confirmed fact from uncertainty; no invented accusation. This is a written exercise, not a message sent to another app.', true),
        ],
        discoveries: [
            discovery('p815-c1-office', 'admin-office', 'Office printout, 8:15: “Stay in classrooms. Do not go to the sports hall.” Another 8:15 message says, “Go to the sports hall.”',
                'Full de secretaria, 8:15: «Quedeu-vos a les aules. No aneu al pavelló». Un altre missatge de les 8:15 diu: «Aneu al pavelló». '),
            discovery('p815-c1-roof', 'sports-hall', 'Chidi: “A roof panel fell. It blocked this passage. I stayed outside and told a teacher.”',
                'En Chidi: «Va caure una placa del sostre. Va bloquejar aquest passadís. Em vaig quedar a fora i vaig avisar un professor». '),
            discovery('p815-c1-register', 'courtyard', 'Class list, 8:16: Karina is not in class. Teachers are looking for her.',
                'Llista de classe, 8:16: la Karina no és a classe. El professorat la busca.'),
            discovery('p815-c1-library', 'library', 'Laia: “I saved both messages before one disappeared. The same school account posted them.”',
                'La Laia: «Vaig guardar tots dos missatges abans que un desaparegués. Es van publicar des del mateix compte de l’institut». '),
        ],
        reveals: [
            news('p815-c1-news-a', 'Need help? Read the two messages at the office. Ask a classmate: “Which place is in both?”',
                'Necessites ajuda? Llegeix els dos missatges a secretaria. Pregunta a un company: «Quin lloc surt a tots dos?»'),
            news('p815-c1-news-b', 'Chidi saw what fell. Read his clue outside the sports hall. Stay out of the blocked passage.',
                'En Chidi va veure què va caure. Llegeix la seva pista a fora del pavelló. No entris al passadís tallat.'),
        ],
    }),
    chapter('p815-everyone-secret', '2. Why Did Ms Diop Lie?',
        ['Ms Diop was with Karina. She said she was not. Was she helping Karina? Check the clues. First, read your new clue in the Journal. Ask a classmate: “What do you know about Ms Diop?”',
            'La senyora Diop era amb la Karina. Va dir que no. Estava ajudant la Karina? Comprova les pistes. Primer, llegeix la teva nova pista al Journal. Pregunta a un company: «Què saps de la senyora Diop?»'],
        ['Ms Diop lied about seeing Karina. We do not know why. Look for more clues.',
            'La senyora Diop va mentir sobre haver vist la Karina. No sabem per què. Busca més pistes.'],
        ['8:28. A message from Karina’s account: “I’m safe. Someone told Ms Diop to keep quiet.” Who told her to hide the truth?',
            '8:28. Un missatge del compte de la Karina: «Estic bé. Algú va dir a la senyora Diop que callés». Qui li va dir que amagués la veritat?'], {
        ...clueMap([
            ['media-analyst', 'Both messages came from the office account. We do not know who sent them.',
                'Els dos missatges venien del compte de secretaria. No sabem qui els va enviar.'],
            ['witness-interviewer', 'Youssef: “Karina wanted to tell a teacher about the dangerous roof. I was scared. I left her alone.”',
                'En Youssef: «La Karina volia avisar un professor del sostre perillós. Vaig tenir por. La vaig deixar sola». '],
            ['records-researcher', 'Friday: Ms Diop wrote a warning at 09:20. The office got it at 09:45. The roof was not repaired.',
                'Divendres: la senyora Diop va escriure un avís a les 09:20. Secretaria el va rebre a les 09:45. No van reparar el sostre.'],
            ['site-observer', 'Ms Ionescu, a teacher: “Ms Diop told us the roof was dangerous. She was trying to help Karina.”',
                'La senyora Ionescu, professora: «La senyora Diop ens va dir que el sostre era perillós. Intentava ajudar la Karina». '],
        ]),
        objectives: [
            question('p815-c2-warning', 'Go to the library. Read the warning. Which teacher wrote it? Write the name.', 'Ves a la biblioteca. Llegeix l’avís. Quina professora el va escriure? Escriu el nom.', ['Ms Diop', 'Diop', 'Awa Diop', 'Ms Awa Diop']),
            question('p815-c2-receipt', 'Go to the office. Read the receipt. When did the office get the warning? Write the time.', 'Ves a secretaria. Llegeix el rebut. Quan va rebre secretaria l’avís? Escriu l’hora.', ['09:45', '9:45', 'quarter to ten', 'nine forty-five'], 'p815-c2-warning'),
            report('p815-c2-reconsider', 'Use “Choose a witness”. Ask: “Did Ms Diop help?” After their reply, write: “One clue says… Another says… We think…”',
                'Fes servir «Choose a witness». Pregunta: «La senyora Diop va ajudar?» Quan respongui, escriu: «Una pista diu… Una altra diu… Pensem…»', 'p815-c2-receipt',
                'Use two sources, such as Sokolova’s dated warning, the office receipt, Youssef’s admission or Ionescu’s account. Explain uncertainty or evidence that Diop reported danger or tried to help. Do not demand knowledge of Karina’s location or the final confession.'),
            report('p815-c2-friend', 'Bonus: Youssef left Karina alone. Help him say sorry. Write: “Sorry I… Next time I will…”',
                'Extra: en Youssef va deixar sola la Karina. Ajuda’l a demanar perdó. Escriu: «Em sap greu haver… La pròxima vegada…»', 'p815-c2-reconsider',
                'A short English apology acknowledging that Youssef left Karina alone, plus a helpful next step. Accept simple sentences and different thoughtful suggestions.', true),
        ],
        discoveries: [
            discovery('p815-c2-notice', 'library', 'Warning by Awa Diop. Friday, 09:20: “The passage roof is dangerous. Close the passage. Repair the roof.”',
                'Avís de l’Awa Diop. Divendres, 09:20: «El sostre del passadís és perillós. Tanqueu el passadís. Repareu el sostre». '),
            discovery('p815-c2-office-log', 'admin-office', 'Office receipt: “Warning received: Friday, 09:45.” Later note: “Repair delayed.” The roof was not repaired.',
                'Rebut de secretaria: «Avís rebut: divendres, 09:45». Nota posterior: «Reparació ajornada». No van reparar el sostre.'),
            discovery('p815-c2-clip', 'sports-hall', 'Security video, 8:07: Ms Diop and Karina enter the sports hall. The camera cannot see the back door.',
                'Vídeo de seguretat, 8:07: la senyora Diop i la Karina entren al pavelló. La càmera no veu la porta del darrere.'),
        ],
        reveals: [
            news('p815-c2-news-a', 'Two times: Ms Diop wrote the warning at 09:20. The office got it at 09:45.',
                'Dues hores: la senyora Diop va escriure l’avís a les 09:20. Secretaria el va rebre a les 09:45.'),
            news('p815-c2-news-b', 'Ms Diop lied. But did she also help? Ask a classmate what their clue says about her.',
                'La senyora Diop va mentir. Però també va ajudar? Pregunta a un company què diu la seva pista sobre ella.'),
        ],
    }),
    chapter('p815-truth', '3. The Truth',
        ['Karina’s message says: “I’m safe.” Someone told Ms Diop to hide the truth. Find where Karina is and who gave that order. First, read your new clue. Ask a classmate: “What did you find?”',
            'El missatge de la Karina diu: «Estic bé». Algú va dir a la senyora Diop que amagués la veritat. Descobreix on és la Karina i qui va donar l’ordre. Primer, llegeix la teva nova pista. Pregunta a un company: «Què has trobat?»'],
        ['Ms Diop warned the school. The roof was not repaired. Someone told her to keep quiet. Who?',
            'La senyora Diop va avisar l’institut. No van reparar el sostre. Algú li va dir que callés. Qui?'],
        ['You solved it! Karina is safe. Ms Diop helped her. Mr El Idrissi delayed the roof repair and told Ms Diop to hide the truth. Staff close the dangerous passage.',
            'Ho heu resolt! La Karina està bé. La senyora Diop la va ajudar. El senyor El Idrissi va ajornar la reparació del sostre i va dir a la senyora Diop que amagués la veritat. El personal tanca el passadís perillós.'], {
        ...clueMap([
            ['media-analyst', 'Karina sent her message from a laptop in the first-aid room. Her phone was wet and did not work.',
                'La Karina va enviar el missatge des d’un portàtil de la infermeria. El mòbil estava mullat i no funcionava.'],
            ['witness-interviewer', 'Ms Ionescu: “Ms Diop took Karina to first aid at 8:12. They used the back door. I knew, but I was scared to speak.”',
                'La senyora Ionescu: «La senyora Diop va portar la Karina a la infermeria a les 8:12. Van sortir per la porta del darrere. Ho sabia, però tenia por de parlar». '],
            ['records-researcher', 'An email from deputy head Mr El Idrissi says: “Delay the repair.” His Monday message says: “Do not mention Friday’s warning. Say it is new storm damage.”',
                'Un correu del cap d’estudis, el senyor El Idrissi, diu: «Ajorneu la reparació». El missatge de dilluns diu: «No esmenteu l’avís de divendres. Digueu que són danys nous de la tempesta». '],
            ['site-observer', 'Ms Diop: “I helped Karina. Mr El Idrissi told me to keep quiet. I lied because I was scared of losing my job.”',
                'La senyora Diop: «Vaig ajudar la Karina. El senyor El Idrissi em va dir que callés. Vaig mentir perquè tenia por de perdre la feina». '],
        ]),
        objectives: [
            question('p815-c3-safe', 'Go to first aid. Read the clue. Where is Karina now? Write the room.', 'Ves a la infermeria. Llegeix la pista. On és ara la Karina? Escriu la sala.', ['first aid room', 'the first aid room', 'medical room', 'nurse room', 'nurses room']),
            question('p815-c3-order', 'Go to the office. Read the email. Who told Ms Diop to hide the truth? Write the name.', 'Ves a secretaria. Llegeix el correu. Qui va dir a la senyora Diop que amagués la veritat? Escriu el nom.', ['El Idrissi', 'Mr El Idrissi', 'the deputy head', 'deputy head'], 'p815-c3-safe'),
            report('p815-c3-report', 'Use “Choose a witness”. Ask: “What happened?” After their reply, write: “Dangerous place: … Fact 1: … Fact 2: … Teachers should…”',
                'Fes servir «Choose a witness». Pregunta: «Què va passar?» Quan respongui, escriu: «Lloc perillós: … Fet 1: … Fet 2: … El professorat hauria de…»', 'p815-c3-order',
                'Identify the covered passage near the sports hall as unsafe; give two supported facts from the warning, receipt, email, CCTV, staff statements or Karina’s location; suggest a safe staff-led action such as keeping the passage closed, checking attendance or arranging repairs. Do not require entering the damaged area.'),
            report('p815-c3-trust', 'Bonus: choose Youssef or Ms Diop. How can they help now? Write: “… should… because…”',
                'Extra: tria en Youssef o la senyora Diop. Com pot ajudar ara? Escriu: «… hauria de… perquè…»', 'p815-c3-report',
                'A reasoned English opinion about one named character, with an action and a reason. Accept different defensible views; no single moral answer.', true),
        ],
        discoveries: [
            discovery('p815-c3-confirmation', 'first-aid', 'Staff: “Karina is safe here in the first-aid room. Ms Diop brought her at 8:12. We gave her a laptop to send a message.”',
                'El personal: «La Karina està bé aquí, a la infermeria. La senyora Diop la va portar a les 8:12. Li vam donar un portàtil per enviar un missatge». '),
            discovery('p815-c3-email', 'admin-office', 'Saved email — Mr El Idrissi, deputy head: “Delay the repair.” Monday, 8:14: “Do not mention Friday’s warning. Say it is new storm damage.”',
                'Correu guardat — senyor El Idrissi, cap d’estudis: «Ajorneu la reparació». Dilluns, 8:14: «No esmenteu l’avís de divendres. Digueu que són danys nous de la tempesta». '),
            discovery('p815-c3-timeline', 'library', 'Friday: Ms Diop warned the school about the roof. Monday: she took Karina to first aid. Then Mr El Idrissi told staff to hide the warning.',
                'Divendres: la senyora Diop va avisar l’institut del sostre. Dilluns: va portar la Karina a la infermeria. Després, el senyor El Idrissi va dir al personal que amagués l’avís.'),
            discovery('p815-c3-route', 'sports-hall', 'The passage near the sports hall is dangerous. Ms Diop used a different, safe route to take Karina to first aid.',
                'El passadís prop del pavelló és perillós. La senyora Diop va fer servir un altre camí segur per portar la Karina a la infermeria.'),
        ],
        reveals: [
            news('p815-c3-news-a', 'How did Karina send a message? Her phone was broken. Staff gave her a laptop at first aid.',
                'Com va enviar un missatge la Karina? Tenia el mòbil espatllat. A la infermeria li van donar un portàtil.'),
            news('p815-c3-news-b', 'Read the email at the office. Who sent it? Tell a classmate: “The email says…”',
                'Llegeix el correu a secretaria. Qui el va enviar? Digues a un company: «El correu diu…»'),
        ],
    }),
];
const campaign = {
    id: 'protocol-815', title: 'Protocol 8:15 — The Missing Student', roles, chapters,
    vocabulary: ['Karina Gonzalvez', 'Youssef El Amrani', 'Awa Diop', 'Andreea Ionescu', 'El Idrissi', 'Laia Garcia', 'Chidi Okafor', 'Irina Sokolova', 'Coma-ruga', 'CCTV'],
    // The story's people, as students may know them from the start: shown as a Who's who and marked 📖 in the story.
    cast: [
        { name: 'Karina Gonzalvez', about: 'A student. She is missing after the storm.' },
        { name: 'Youssef El Amrani', about: 'A student, Karina’s best friend.' },
        { name: 'Laia Garcia', about: 'A student who saved the 8:15 messages on her phone.' },
        { name: 'Chidi Okafor', about: 'A student who was near the sports hall that morning.' },
        { name: 'Ms Awa Diop', about: 'The PE teacher.' },
        { name: 'Ms Andreea Ionescu', about: 'A teacher, Ms Diop’s colleague.' },
        { name: 'Ms Irina Sokolova', about: 'The maths teacher.' },
        { name: 'Mr El Idrissi', about: 'The deputy head of the school.' },
    ],
    finale: 'Case solved! Ms Diop took Karina to first aid. Mr El Idrissi delayed the roof repair and told Ms Diop to hide the truth. You shared clues and found out what happened. Discuss: was Ms Diop right to lie?',
    help: { finale: help('Cas resolt! La senyora Diop va portar la Karina a la infermeria. El senyor El Idrissi va ajornar la reparació del sostre i va dir a la senyora Diop que amagués la veritat. Heu compartit pistes i descobert què va passar. Parleu-ne: va fer bé de mentir, la senyora Diop?') },
};
const evidence = (name, alt) => {
    const extension = name === 'cctv' ? 'jpg' : 'png';
    const bytes = fs.readFileSync(path.join(directory, `art/evidence/${name}.${extension}`));
    return { src: `data:image/${extension === 'jpg' ? 'jpeg' : 'png'};base64,${bytes.toString('base64')}`, alt };
};
chapters[0].discoveries[0].image = evidence('messages', 'Two messages from the school account at 08:15 give conflicting instructions about the sports hall.');
chapters[0].endingImage = evidence('cctv', 'CCTV at 08:07 shows a teacher and a student entering the sports hall. The back exit is outside the frame.');
chapters[1].discoveries[0].image = evidence('warning', 'Awa Diop’s safety warning, Friday 09:20, says to close the unsafe covered passage until repaired.');
chapters[1].discoveries[1].image = evidence('receipt', 'The office receipt is stamped Friday 09:45. A later note says repair delayed.');
chapters[1].discoveries[2].image = chapters[0].endingImage;
chapters[1].endingImage = evidence('karina-message', 'At 08:28, Karina’s account says she is safe and points to the person who told Ms Diop to stay quiet.');
chapters[2].discoveries[1].image = evidence('email', 'El Idrissi’s saved email delays the repair; his Monday 08:14 message orders staff to hide Friday’s warning.');
chapters[2].discoveries[2].image = evidence('timeline', 'The records list Friday’s warning and receipt, then Monday’s CCTV, safe-room arrival, concealment order, conflicting messages, roll call and Karina’s message.');
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
console.log(`Protocol 8:15: ${chapters.length} chapters, ${chapters.reduce((n, c) => n + c.objectives.length, 0)} tasks; mission validation and map paths pass.`);
