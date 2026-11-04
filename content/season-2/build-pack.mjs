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
    ['media-analyst', 'Media analyst', 'Check screenshots and times. Ask classmates what their evidence shows.', 'Comprova les captures de pantalla i les hores. Pregunta als companys què mostren les seves proves.',
        'Laia saved two messages at 8:15: “Stay inside” and “Go to the sports hall.” Both use the school account.', 'La Laia va guardar dos missatges de les 8:15: «Quedeu-vos a dins» i «Aneu al pavelló». Tots dos utilitzen el compte de l’institut.'],
    ['witness-interviewer', 'Witness interviewer', 'Compare what people say. Ask a follow-up question before deciding who to trust.', 'Compara què diu cadascú. Fes una pregunta més abans de decidir de qui et fies.',
        'Youssef says, “I have not seen Karina.” Laia remembers them talking before lessons. You do not know when they last met.', 'En Youssef diu: «No he vist la Karina». La Laia recorda que parlaven abans de classe. No saps quan es van veure per última vegada.'],
    ['records-researcher', 'Records researcher', 'Check documents and their dates. Separate a fact from a guess.', 'Comprova els documents i les dates. Distingeix un fet d’una suposició.',
        'At 8:16, Karina was absent from roll call. The office calls its emergency plan “Protocol 8:15”. The messages disagree.', 'A les 8:16, la Karina no hi era quan van passar llista. El pla d’emergència de secretaria es diu «Protocol 8:15». Els missatges es contradiuen.'],
    ['site-observer', 'Site observer', 'Read evidence at the marked places. Stay outside the blocked passage and report risks to staff.', 'Llegeix les proves als llocs indicats. No entris al passadís tallat i comunica els riscos al professorat.',
        'Chidi saw a fallen roof panel blocking the covered passage. Ms Diop told everyone to stay away from the sports hall.', 'En Chidi va veure una placa del sostre caiguda que bloquejava el passadís cobert. La senyora Diop va dir a tothom que s’allunyés del pavelló.'],
].map(([id, name, card, cardCa, clue, clueCa]) => ({ id, name, card, clue, help: { card: help(cardCa), clue: help(clueCa) } }));

const chapters = [
    chapter('p815-missing-student', '1. The Missing Student',
        ['A storm hits Coma-ruga. At 8:15, two school messages give opposite instructions. Karina is missing. Compare evidence at safe locations; let staff handle the emergency.',
            'Una tempesta arriba a Coma-ruga. A les 8:15, dos missatges de l’institut donen instruccions contràries. La Karina ha desaparegut. Compareu proves en llocs segurs; deixeu l’emergència en mans del personal.'],
        ['Karina missed roll call. The 8:15 messages disagree. Check facts before blaming anyone.', 'La Karina no hi era quan van passar llista. Els missatges de les 8:15 es contradiuen. Comproveu els fets abans de culpar ningú.'],
        ['New CCTV: at 8:07, Ms Diop entered the sports hall with Karina. Ms Diop said she had not seen her. Why did she lie?',
            'Nova gravació de seguretat: a les 8:07, la senyora Diop va entrar al pavelló amb la Karina. Havia dit que no l’havia vista. Per què va mentir?'], {
        objectives: [
            question('p815-c1-messages', 'Compare the two messages. Which place do they disagree about?', 'Compara els dos missatges. Sobre quin lloc es contradiuen?', ['sports hall', 'the sports hall', 'gym']),
            question('p815-c1-passage', 'Ask about Chidi’s evidence. What blocked the covered passage?', 'Pregunta per les proves d’en Chidi. Què bloquejava el passadís cobert?', ['roof panel', 'fallen roof panel', 'a roof panel'], 'p815-c1-messages'),
            report('p815-c1-briefing', 'Exchange evidence with a classmate. Write two facts and one question you still cannot answer.',
                'Intercanvia proves amb un company. Escriu dos fets i una pregunta que encara no pots respondre.', 'p815-c1-passage',
                'Two supported facts from this chapter and one unresolved question. Valid facts include contradictory 8:15 messages, Karina missing at 8:16, a fallen roof panel, or Diop keeping students away. Do not require a culprit or Karina’s location.'),
            report('p815-c1-rumour', 'Write a short group-chat message that corrects a rumour without blaming anyone.',
                'Escriu un missatge breu per al xat del grup que corregeixi un rumor sense culpar ningú.', 'p815-c1-briefing',
                'A short English message distinguishing a confirmed fact from uncertainty; no invented accusation. This is a written exercise, not a message sent to another app.', true),
        ],
        discoveries: [
            discovery('p815-c1-office', 'admin-office', 'Office printout, 8:15: “Stay in classrooms. Do not go to the sports hall.” Another 8:15 message says, “Go to the sports hall.”',
                'Full de secretaria, 8:15: «Quedeu-vos a les aules. No aneu al pavelló». Un altre missatge de les 8:15 diu: «Aneu al pavelló». '),
            discovery('p815-c1-roof', 'sports-hall', 'Chidi’s statement: “A roof panel fell across the covered passage. I stayed outside and told a teacher.”',
                'Declaració d’en Chidi: «Una placa del sostre va caure al passadís cobert. Em vaig quedar a fora i vaig avisar un professor». '),
            discovery('p815-c1-register', 'courtyard', 'Roll call, 8:16: Karina Gonzalvez is missing. Staff are checking the safe rooms. Nobody has confirmed where she is.',
                'Llista d’assistència, 8:16: falta la Karina Gonzalvez. El personal està comprovant les sales segures. Ningú no ha confirmat on és.'),
            discovery('p815-c1-library', 'library', 'Laia: “I saved both messages before one disappeared. The same school account posted them.”',
                'La Laia: «Vaig guardar tots dos missatges abans que un desaparegués. Es van publicar des del mateix compte de l’institut». '),
        ],
        reveals: [
            news('p815-c1-news-a', 'Compare Laia’s screenshot with the office printout. The two messages disagree about the sports hall.',
                'Compara la captura de la Laia amb el full de secretaria. Els dos missatges es contradiuen sobre el pavelló.'),
            news('p815-c1-news-b', 'Chidi saw a fallen roof panel. A blocked route is a fact; an accusation is not proof.',
                'En Chidi va veure una placa del sostre caiguda. Que una ruta estigui tallada és un fet; una acusació no és una prova.'),
        ],
    }),
    chapter('p815-everyone-secret', '2. Everyone Has a Secret',
        ['CCTV links Ms Diop to Karina. Ms Ionescu defends her. Youssef admits Karina was investigating a safety problem. Find out what the school knew before the storm.',
            'Una gravació relaciona la senyora Diop amb la Karina. La senyora Ionescu la defensa. En Youssef admet que la Karina investigava un problema de seguretat. Esbrineu què sabia l’institut abans de la tempesta.'],
        ['Ms Diop entered the sports hall with Karina at 8:07, then denied seeing her. A camera shows where they went, not why.',
            'La senyora Diop va entrar al pavelló amb la Karina a les 8:07 i després va negar haver-la vista. Una càmera mostra on van anar, però no per què.'],
        ['8:28. Karina’s account sends: “I’m safe. But the person you should be afraid of isn’t Ms Diop. It’s the person who told her to keep quiet.”',
            '8:28. El compte de la Karina envia: «Estic bé. Però la persona que us hauria de fer por no és la senyora Diop. És qui li va dir que callés». '], {
        ...clueMap([
            ['media-analyst', 'Laia’s screenshot shows both 8:15 messages came from the office account. It does not identify who used that account.',
                'La captura de la Laia mostra que els dos missatges de les 8:15 provenien del compte de secretaria. No identifica qui el va utilitzar.'],
            ['witness-interviewer', 'Youssef admits: “Karina wanted to report the unsafe passage. She asked me to help. I got scared and left her alone.”',
                'En Youssef admet: «La Karina volia denunciar el mal estat del passadís. Em va demanar ajuda. Vaig tenir por i la vaig deixar sola». '],
            ['records-researcher', 'Ms Sokolova kept the warning: Friday, 09:20, signed Awa Diop. Office receipt: Friday, 09:45. The repair was delayed.',
                'La senyora Sokolova va conservar l’avís: divendres, 09:20, signat per l’Awa Diop. Rebut de secretaria: divendres, 09:45. La reparació es va ajornar.'],
            ['site-observer', 'Ms Ionescu says: “Awa warned us about the passage before the storm. She was trying to help Karina. I cannot say more yet.”',
                'La senyora Ionescu diu: «L’Awa ens va avisar del passadís abans de la tempesta. Intentava ajudar la Karina. Encara no puc dir res més». '],
        ]),
        objectives: [
            question('p815-c2-warning', 'Check the dated notice. Which teacher reported the danger before the storm?', 'Comprova l’avís amb data. Quina professora va informar del perill abans de la tempesta?', ['Ms Diop', 'Diop', 'Awa Diop', 'Ms Awa Diop']),
            question('p815-c2-receipt', 'Compare the notice and receipt. At what time on Friday did the office receive the warning?', 'Compara l’avís amb el rebut. A quina hora de divendres va rebre secretaria l’avís?', ['09:45', '9:45', 'quarter to ten', 'nine forty-five'], 'p815-c2-warning'),
            report('p815-c2-reconsider', 'Exchange evidence. Use two sources to explain why blaming Ms Diop may be too early.',
                'Intercanvia proves. Fes servir dues fonts per explicar per què pot ser massa aviat per culpar la senyora Diop.', 'p815-c2-receipt',
                'Use two sources, such as Sokolova’s dated warning, the office receipt, Youssef’s admission or Ionescu’s account. Explain uncertainty or evidence that Diop reported danger or tried to help. Do not demand knowledge of Karina’s location or the final confession.'),
            report('p815-c2-friend', 'Youssef left Karina alone. Write what he should say to her now, and why.',
                'En Youssef va deixar sola la Karina. Escriu què li hauria de dir ara i per què.', 'p815-c2-reconsider',
                'An English response acknowledging Youssef’s choice and offering a reasoned apology or next step. Accept different thoughtful opinions.', true),
        ],
        discoveries: [
            discovery('p815-c2-notice', 'library', 'Ms Sokolova’s copy: “Friday, 09:20. Covered-passage roof unsafe. Keep it closed until repaired. Reported by Awa Diop.”',
                'Còpia de la senyora Sokolova: «Divendres, 09:20. El sostre del passadís cobert és insegur. Manteniu-lo tancat fins que es repari. Avís de l’Awa Diop». '),
            discovery('p815-c2-office-log', 'admin-office', 'Receipt: “Friday, 09:45 — warning received by school management.” A later note says, “Repair delayed.” There is no completion record.',
                'Rebut: «Divendres, 09:45 — la direcció rep l’avís». Una nota posterior diu: «Reparació ajornada». No hi ha cap registre que indiqui que s’hagi reparat.'),
            discovery('p815-c2-clip', 'sports-hall', 'CCTV summary: 8:07, Ms Diop and Karina enter. The camera does not show the back exit. The clip alone cannot explain what happened next.',
                'Resum de la gravació: a les 8:07 entren la senyora Diop i la Karina. La càmera no mostra la sortida del darrere. Aquest fragment no explica què va passar després.'),
        ],
        reveals: [
            news('p815-c2-news-a', 'The notice is signed by Awa Diop. Its time is 09:20; the office receipt is 09:45. These are different events.',
                'L’avís està signat per l’Awa Diop. La seva hora és les 09:20; el rebut de secretaria és de les 09:45. Són dos fets diferents.'),
            news('p815-c2-news-b', 'A teacher can lie and still have tried to protect someone. Compare the warning, CCTV and witness accounts.',
                'Una professora pot haver mentit i, alhora, haver intentat protegir algú. Compara l’avís, la gravació i els testimonis.'),
        ],
    }),
    chapter('p815-truth', '3. The Truth',
        ['Karina says she is safe. Check where the message came from. Rebuild the timeline and send your findings to staff. Evidence matters more than rumours.',
            'La Karina diu que està bé. Comprova d’on ve el missatge. Reconstrueix la cronologia i envia les conclusions al professorat. Les proves compten més que els rumors.'],
        ['Ms Diop warned the school on Friday. The office delayed repairs. Karina’s message says someone ordered Ms Diop to stay quiet.',
            'La senyora Diop va avisar l’institut divendres. Secretaria va ajornar les reparacions. El missatge de la Karina diu que algú va ordenar a la senyora Diop que callés.'],
        ['Staff confirm Karina is safe and close the damaged passage. The evidence exposes Mr El Idrissi’s cover-up. Ms Diop and Ms Ionescu agree to tell the whole truth.',
            'El personal confirma que la Karina està bé i tanca el passadís danyat. Les proves destapen l’encobriment del senyor El Idrissi. Les senyores Diop i Ionescu accepten explicar tota la veritat.'], {
        ...clueMap([
            ['media-analyst', 'The 8:28 message came from a school laptop in the first-aid room. Karina logged in there after her wet phone stopped working.',
                'El missatge de les 8:28 es va enviar des d’un portàtil de l’institut a la infermeria. La Karina hi va iniciar sessió després que el mòbil, mullat, deixés de funcionar.'],
            ['witness-interviewer', 'Ms Ionescu admits: “Awa took Karina through the back exit to the first-aid room at 8:12. I knew, but I was afraid to challenge management.”',
                'La senyora Ionescu admet: «L’Awa va portar la Karina a la infermeria per la sortida del darrere a les 8:12. Ho sabia, però tenia por d’enfrontar-me a la direcció». '],
            ['records-researcher', 'An email from deputy head Mr El Idrissi says: “Delay the repair.” His Monday message says: “Do not mention Friday’s warning. Say it is new storm damage.”',
                'Un correu del cap d’estudis, el senyor El Idrissi, diu: «Ajorneu la reparació». El missatge de dilluns diu: «No esmenteu l’avís de divendres. Digueu que són danys nous de la tempesta». '],
            ['site-observer', 'Ms Diop admits: “I saw the danger and moved Karina to safety. El Idrissi told me to keep quiet. I lied because I was afraid of losing my job.”',
                'La senyora Diop admet: «Vaig veure el perill i vaig portar la Karina a un lloc segur. El Idrissi em va dir que callés. Vaig mentir perquè tenia por de perdre la feina». '],
        ]),
        objectives: [
            question('p815-c3-safe', 'Check the message record and staff statement. Where is Karina now?', 'Comprova el registre del missatge i la declaració del personal. On és ara la Karina?', ['first aid room', 'the first aid room', 'medical room', 'nurse room', 'nurses room']),
            question('p815-c3-order', 'Compare the email and Ms Diop’s account. Who ordered her to hide the warning?', 'Compara el correu amb la declaració de la senyora Diop. Qui li va ordenar que amagués l’avís?', ['El Idrissi', 'Mr El Idrissi', 'the deputy head', 'deputy head'], 'p815-c3-safe'),
            report('p815-c3-report', 'Exchange evidence. Report the unsafe place, two facts, and one safe next step for staff.',
                'Intercanvia proves. Informa del lloc insegur, de dos fets i d’un pas segur que ha de fer el personal.', 'p815-c3-order',
                'Identify the covered passage near the sports hall as unsafe; give two supported facts from the warning, receipt, email, CCTV, staff statements or Karina’s location; suggest a safe staff-led action such as keeping the passage closed, checking attendance or arranging repairs. Do not require entering the damaged area.'),
            report('p815-c3-trust', 'Choose Youssef, Ms Diop or Ms Ionescu. What should they do to rebuild trust? Give a reason.',
                'Tria en Youssef, la senyora Diop o la senyora Ionescu. Què hauria de fer per recuperar la confiança? Dona una raó.', 'p815-c3-report',
                'A reasoned English opinion about one named character, with an action and a reason. Accept different defensible views; no single moral answer.', true),
        ],
        discoveries: [
            discovery('p815-c3-confirmation', 'first-aid', 'Staff statement: “Karina is safe in the first-aid room. She arrived with Ms Diop at 8:12. Her phone was wet; we lent her a laptop.”',
                'Declaració del personal: «La Karina està bé a la infermeria. Va arribar amb la senyora Diop a les 8:12. Tenia el mòbil mullat; li vam deixar un portàtil». '),
            discovery('p815-c3-email', 'admin-office', 'Saved email — Mr El Idrissi, deputy head: “Delay the repair.” Monday, 8:14: “Do not mention Friday’s warning. Say it is new storm damage.”',
                'Correu guardat — senyor El Idrissi, cap d’estudis: «Ajorneu la reparació». Dilluns, 8:14: «No esmenteu l’avís de divendres. Digueu que són danys nous de la tempesta». '),
            discovery('p815-c3-timeline', 'library', 'Records: Friday 09:20 warning; 09:45 receipt. Monday 8:07 CCTV; 8:12 safe-room arrival; 8:14 concealment order; 8:15 conflicting messages; 8:16 roll call; 8:28 Karina’s message.',
                'Registres: divendres, 09:20 avís; 09:45 rebut. Dilluns, 8:07 gravació; 8:12 arribada a la sala segura; 8:14 ordre d’encobrir; 8:15 missatges contradictoris; 8:16 llista; 8:28 missatge de la Karina.'),
            discovery('p815-c3-route', 'sports-hall', 'Chidi’s photo matches Ms Diop’s warning: the damaged roof is over the covered passage. The safe back route to first aid does not use that passage.',
                'La foto d’en Chidi coincideix amb l’avís de la senyora Diop: el sostre danyat és el del passadís cobert. La ruta segura del darrere fins a la infermeria no passa per aquest passadís.'),
        ],
        reveals: [
            news('p815-c3-news-a', 'Karina’s phone failed, but her account still worked on the borrowed laptop. Check the first-aid statement and message record.',
                'El mòbil de la Karina no funcionava, però el compte sí que funcionava al portàtil que li van deixar. Comprova la declaració d’infermeria i el registre del missatge.'),
            news('p815-c3-news-b', 'El Idrissi’s email links the delayed repair to the attempt to hide the warning. Report evidence to staff and keep away from the blocked passage.',
                'El correu d’El Idrissi relaciona l’ajornament de la reparació amb l’intent d’amagar l’avís. Comunica les proves al personal i no t’acostis al passadís tallat.'),
        ],
    }),
];
const campaign = {
    id: 'protocol-815', title: 'Protocol 8:15 — The Missing Student', roles, chapters,
    vocabulary: ['Karina Gonzalvez', 'Youssef El Amrani', 'Awa Diop', 'Andreea Ionescu', 'El Idrissi', 'Laia Garcia', 'Chidi Okafor', 'Irina Sokolova', 'Coma-ruga', 'CCTV'],
    finale: 'Karina is safe. El Idrissi’s ignored warning and cover-up are exposed. Youssef apologises. Ms Diop and Ms Ionescu speak openly. Trust takes longer to repair. When telling the truth costs you something, will you still do it?',
    help: { finale: help('La Karina està bé. Queden al descobert l’avís ignorat i l’encobriment d’El Idrissi. En Youssef demana perdó. Les senyores Diop i Ionescu parlen obertament. Recuperar la confiança costa més. Si dir la veritat et fa perdre alguna cosa, la diràs igualment?') },
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
