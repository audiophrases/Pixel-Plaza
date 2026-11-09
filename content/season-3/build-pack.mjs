// Optional authored content, never imported by the application. Rebuild evidence first.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { missionEnvelope, validateMission, parseMission, MISSION_MAX_BYTES } from '../../shared/missionSchema.ts';
import { parseTheme } from '../../shared/theme.ts';
import { walkReport } from '../../shared/walk.ts';
import { zipFiles } from '../../shared/zip.ts';
import { buildWarmups } from './build-warmups.mjs';
import { buildPreview } from './build-preview.mjs';

const dir=import.meta.dirname;
const help=ca=>({ca});
const line=(text,ca)=>({text,help:help(ca)});
const roleIds=['picture-checker','message-checker','people-checker','place-checker'];
const roles=roleIds.map((id,i)=>({id,name:['Picture checker','Message checker','People checker','Place checker'][i],
    card:'Look at your picture. Tell your team: “I can see…” Ask: “What can you see?”',
    help:{card:help('Mira la teva imatge. Digues al teu equip: «Hi veig…» Pregunta: «Què hi veus?»')}}));
const image=async(name,alt,story=false)=>{
    const file=path.join(dir,'art',story?'story':'evidence',`${name}.${story?'png':'webp'}`);
    const bytes=await sharp(file).resize({width:story?600:760,withoutEnlargement:true}).webp({quality:story?52:78}).toBuffer();
    return {src:`data:image/webp;base64,${bytes.toString('base64')}`,alt};
};
const pictures=async rows=>({
    roleClues:Object.fromEntries(rows.map(([role,,en])=>[roleIds[role],en])),
    roleClueHelp:Object.fromEntries(rows.map(([role,,,ca])=>[roleIds[role],help(ca)])),
    roleClueImages:Object.fromEntries(await Promise.all(rows.map(async([role,name,en])=>[roleIds[role],await image(name,en)]))),
});
const question=(id,en,ca,accept,after)=>({id,...line(en,ca),accept,...(after?{after}:{})});
const report=(id,en,ca,after,successCriteria)=>({id,...line(en,ca),accept:[],kind:'report',level:'A2',after,successCriteria});
const discovery=(id,zone,en,ca)=>({id,zone,...line(en,ca)});
const news=(id,en,ca)=>({id,...line(en,ca)});
const steps='Look at your picture. Tell your team. Answer together.';
const stepsCa='Mira la teva imatge. Explica-la al teu equip. Responeu junts.';
const chapter=(n,title,intro,introCa,recap,recapCa,ending,endingCa,rest)=>({id:`trophy-c${n}`,title:`${n}. ${title}`,intro:`${intro} ${steps}`,recap,ending,
    help:{intro:help(`${introCa} ${stepsCa}`),recap:help(recapCa),ending:help(endingCa)},share:.7,...rest});

const chapters=[
    chapter(1,'A Duck Took It?',
        'The school trophy is missing! A camera saw a giant duck carrying a cup. Where did it go?',
        'Ha desaparegut el trofeu de l’institut! Una càmera ha vist un ànec gegant portant una copa. On ha anat?',
        'The trophy is missing. A duck carried a cup away. Follow the picture clues.',
        'Falta el trofeu. Un ànec s’ha endut una copa. Seguiu les pistes de les imatges.',
        'You found the duck in the library. Surprise: it is Laia’s ROBOT! Nobody is inside. Laia says, “Wait… that cup is not the school trophy!”',
        'Heu trobat l’ànec a la biblioteca. Sorpresa: és el ROBOT de la Laia! No hi ha ningú a dins. La Laia diu: «Un moment… aquesta copa no és el trofeu de l’institut!»',{
        ...await pictures([
            [0,'duck-door','Camera, 9:05: a duck carries a cup towards a door with a BOOK sign.','Càmera, 9:05: un ànec porta una copa cap a una porta amb el dibuix d’un LLIBRE.'],
            [1,'duck-label','The label under the duck says D4. Who uses D4?','L’etiqueta sota l’ànec diu D4. Qui fa servir el D4?'],
            [2,'club-list','Robot club list: Laia uses D4. Chidi uses B2. Ms Diop uses A1.','Llista del club de robots: la Laia fa servir el D4. En Chidi, el B2. La senyora Diop, l’A1.'],
            [3,'school-signs','School signs: BOOK = library. BALL = sports hall. ENVELOPE = office. CROSS = first aid.','Rètols de l’institut: LLIBRE = biblioteca. PILOTA = pavelló. SOBRE = secretaria. CREU = infermeria.'],
        ]),
        introImage:await image('opening','An empty trophy stand. A giant yellow duck rolls away carrying a cup with a round badge.',true),
        objectives:[
            question('trophy-c1-place','Where did the duck go? Ask the Picture checker and Place checker. Write the place.','On ha anat l’ànec? Pregunta al Picture checker i al Place checker. Escriu el lloc.',['library','the library']),
            question('trophy-c1-owner','Who uses the duck? Ask the Message checker and People checker. Match the code. Write the name.','Qui fa servir l’ànec? Pregunta al Message checker i al People checker. Compara el codi. Escriu el nom.',['Laia','Laia Garcia'],'trophy-c1-place'),
            report('trophy-c1-chat','Ask in Team chat: “What did you see?” Then write together: “The duck went to… It belongs to…”','Pregunta al xat d’equip: «Què has vist?» Després escriviu junts: «L’ànec ha anat a… És de…»','trophy-c1-owner',
                'Two short statements: the duck went to the library and belongs to/is used by Laia. Accept simple English. Do not require robot mechanics, fake trophy, or later story facts.'),
        ],
        discoveries:[
            discovery('trophy-c1-office','admin-office','An empty trophy stand. A sign says: “School trophy.” Where has it gone?','Un suport buit. Un rètol diu: «Trofeu de l’institut». On ha anat?'),
            discovery('trophy-c1-library','library','You hear “QUACK!” behind the library door. Tell your team what you heard.','Sents «QUAC!» darrere la porta de la biblioteca. Explica al teu equip què has sentit.'),
        ],
        reveals:[
            news('trophy-c1-tip1','Picture checker: describe the door sign. Place checker: say which place uses that sign.','Picture checker: descriu el rètol de la porta. Place checker: digues quin lloc té aquest rètol.'),
            news('trophy-c1-tip2','Message checker: say the code. People checker: find that code on your list.','Message checker: digues el codi. People checker: busca aquest codi a la teva llista.'),
        ],
    }),
    chapter(2,'Two Trophies!',
        'The duck is Laia’s robot. She says its cup is fake. Which cup is real? Who moved it?',
        'L’ànec és el robot de la Laia. Diu que la seva copa és falsa. Quina copa és l’autèntica? Qui l’ha mogut?',
        'Laia controls the duck robot. Its cup may be a copy. Compare the badges.',
        'La Laia controla el robot ànec. Potser la copa és una còpia. Compareu els símbols.',
        'Two cups! The duck carried a cardboard copy. Chidi moved the REAL trophy at 9:00—before the duck arrived. Why?',
        'Dues copes! L’ànec portava una còpia de cartró. En Chidi va moure el trofeu AUTÈNTIC a les 9:00, abans que arribés l’ànec. Per què?',{
        ...await pictures([
            [0,'fake-cup','The duck’s cup has a ROUND badge. Compare it with the school trophy record.','La copa de l’ànec té un símbol RODÓ. Compara-la amb la fitxa del trofeu de l’institut.'],
            [1,'real-cup','School trophy record: the REAL trophy has a STAR badge.','Fitxa del trofeu de l’institut: el trofeu AUTÈNTIC té una ESTRELLA.'],
            [2,'green-sleeve','Camera, 9:00: someone in GREEN lifts the STAR trophy. You cannot see their face.','Càmera, 9:00: algú vestit de VERD agafa el trofeu amb l’ESTRELLA. No se li veu la cara.'],
            [3,'clothes','Today’s clothes: Laia wears purple. Chidi wears a green hoodie. Ms Diop wears blue.','Roba d’avui: la Laia va de lila. En Chidi porta una dessuadora verda. La senyora Diop va de blau.'],
        ]),
        endingImage:await image('robot-reveal','The duck’s open hatch shows a battery and gears. Beside it, a torn cup with a round badge reveals cardboard.',true),
        objectives:[
            question('trophy-c2-badge','Which badge is on the real trophy? Ask the Picture checker and Message checker. Write the shape.','Quin símbol té el trofeu autèntic? Pregunta al Picture checker i al Message checker. Escriu la forma.',['star','a star','the star']),
            question('trophy-c2-person','Who moved the real trophy? Ask the People checker and Place checker. Match the clothes. Write the name.','Qui ha mogut el trofeu autèntic? Pregunta al People checker i al Place checker. Compara la roba. Escriu el nom.',['Chidi','Chidi Okafor'],'trophy-c2-badge'),
            report('trophy-c2-chat','Ask in Team chat: “Are the cups the same?” Then write together: “One has… The other has… We think…”','Pregunta al xat d’equip: «Les copes són iguals?» Després escriviu junts: «Una té… L’altra té… Pensem…»','trophy-c2-person',
                'Compare the round badge on the duck’s cup with the star badge on the real school trophy. Conclude they are different cups/the duck has a copy. Simple sentences are enough. Do not require knowing why Chidi moved the real trophy.'),
        ],
        discoveries:[
            discovery('trophy-c2-craft','library','Laia: “I made a cardboard cup for my robot show. I did not take the real trophy.”','La Laia: «Vaig fer una copa de cartró per a l’espectacle del robot. No vaig agafar el trofeu autèntic». '),
            discovery('trophy-c2-clock','courtyard','Two camera times: someone moved a trophy at 9:00. The duck arrived at 9:05. Which happened first?','Dues hores de la càmera: algú va moure un trofeu a les 9:00. L’ànec va arribar a les 9:05. Què va passar primer?'),
        ],
        reveals:[
            news('trophy-c2-tip1','Describe the badge: “Mine is round.” “Mine is a star.” Are these the same cup?','Descriviu el símbol: «El meu és rodó». «El meu és una estrella». És la mateixa copa?'),
            news('trophy-c2-tip2','People checker: say the colour. Place checker: say who wears that colour.','People checker: digues el color. Place checker: digues qui porta aquest color.'),
        ],
    }),
    chapter(3,'A Thief—or a Helper?',
        'Chidi moved the real trophy. Did he steal it or help? Find where it went and why.',
        'En Chidi ha mogut el trofeu autèntic. L’ha robat o ha ajudat? Descobriu on l’ha portat i per què.',
        'The duck’s cup was fake. Chidi moved the real trophy before the duck arrived.',
        'La copa de l’ànec era falsa. En Chidi va moure el trofeu autèntic abans que arribés l’ànec.',
        'Chidi SAVED the trophy from a leak! It is safe in the blue box at first aid. Then the trophy speaks: “Find the SUN.” A talking trophy?!',
        'En Chidi ha SALVAT el trofeu d’una gotera! És a la caixa blava de la infermeria. De sobte, el trofeu parla: «Busqueu el SOL». Un trofeu que parla?!',{
        ...await pictures([
            [0,'leak','Water is falling from the roof onto the trophy stand. The trophy is getting wet.','Cau aigua del sostre sobre el suport del trofeu. El trofeu s’està mullant.'],
            [1,'repair-note','Office note, 9:00: “LEAK above the trophy. Move it somewhere dry. Staff will repair the roof.”','Nota de secretaria, 9:00: «GOTERA sobre el trofeu. Porteu-lo a un lloc sec. El personal repararà el sostre». '],
            [2,'chidi-route','Chidi: “I moved the trophy to the dry room with the CROSS sign.”','En Chidi: «Vaig portar el trofeu a la sala seca amb el rètol de la CREU». '],
            [3,'safe-rooms','CROSS = first aid. BOOK = library. BALL = sports hall. ENVELOPE = office. A blue box waits in the dry room.','CREU = infermeria. LLIBRE = biblioteca. PILOTA = pavelló. SOBRE = secretaria. Hi ha una caixa blava a la sala seca.'],
        ]),
        endingImage:await image('rescue','Chidi, wearing green, lifts the star trophy away from dripping water. A blue box waits in the dry first-aid room.',true),
        objectives:[
            question('trophy-c3-room','Where is the real trophy? Ask the People checker and Place checker. Match the sign. Write the room.','On és el trofeu autèntic? Pregunta al People checker i al Place checker. Compara el rètol. Escriu la sala.',['first aid','first aid room','the first aid room','medical room','nurse room']),
            question('trophy-c3-why','Why move the trophy? Ask the Picture checker and Message checker. What was falling onto it?','Per què cal moure el trofeu? Pregunta al Picture checker i al Message checker. Què li queia a sobre?',['water','rain','rainwater'],'trophy-c3-room'),
            report('trophy-c3-chat','Ask in Team chat: “Was Chidi helping?” Then write together: “Chidi moved it because… It is safe in…”','Pregunta al xat d’equip: «En Chidi estava ajudant?» Després escriviu junts: «En Chidi l’ha mogut perquè… És segur a…»','trophy-c3-why',
                'Explain that Chidi moved the trophy to protect it from water/a roof leak, and it is safe in first aid. Accept short simple sentences. No need to know about the speaker or party yet.'),
        ],
        discoveries:[
            discovery('trophy-c3-box','first-aid','A blue box is here. A note says: “Keep dry.” Tell your team what you found.','Aquí hi ha una caixa blava. Una nota diu: «Manteniu-la seca». Explica al teu equip què has trobat.'),
            discovery('trophy-c3-staff','admin-office','Staff are fixing the leak. Stay outside the blocked passage.','El personal està arreglant la gotera. No entreu al passadís tallat.'),
        ],
        reveals:[
            news('trophy-c3-tip1','People checker: describe the sign. Place checker: find that sign on your picture.','People checker: descriu el rètol. Place checker: busca aquest rètol a la teva imatge.'),
            news('trophy-c3-tip2','Picture checker: what is falling? Message checker: what does the note say to do?','Picture checker: què està caient? Message checker: què diu la nota que cal fer?'),
        ],
    }),
    chapter(4,'The Trophy Talks!',
        'The trophy is safe. Now it says: “Find the SUN.” Who made it talk? Where should we go?',
        'El trofeu està segur. Ara diu: «Busqueu el SOL». Qui l’ha fet parlar? On hem d’anar?',
        'Chidi saved the trophy. A voice inside it says: “Find the SUN.” Follow the last clues.',
        'En Chidi ha salvat el trofeu. Una veu de dins diu: «Busqueu el SOL». Seguiu les últimes pistes.',
        'SURPRISE! Ms Diop put a speaker in the trophy. Her message leads to a school party! Laia’s duck throws confetti. Chidi brings the real trophy. You solved it together!',
        'SORPRESA! La senyora Diop va posar un altaveu al trofeu. El missatge us porta a una festa de l’institut! L’ànec de la Laia llança confeti. En Chidi porta el trofeu autèntic. Ho heu resolt junts!',{
        ...await pictures([
            [0,'talking-cup','The voice in the trophy says: “Find the SUN.”','La veu del trofeu diu: «Busqueu el SOL». '],
            [1,'speaker-note','A note in the trophy base: “I put a small SPEAKER here. It plays my party message. From: the PE teacher.”','Una nota a la base del trofeu: «Hi he posat un petit ALTAVEU. Reprodueix el meu missatge de la festa. De: la professora d’educació física». '],
            [2,'staff-list','School list: Ms Diop = PE teacher. Laia = student. Chidi = student.','Llista de l’institut: senyora Diop = professora d’educació física. Laia = alumna. Chidi = alumne.'],
            [3,'party-signs','Event signs: SUN = courtyard. BOOK = library. BALL = sports hall. CROSS = first aid.','Rètols de l’acte: SOL = pati. LLIBRE = biblioteca. PILOTA = pavelló. CREU = infermeria.'],
        ]),
        endingImage:await image('finale','The star trophy has a speaker in its base. A sun invitation and a duck robot throwing confetti mark a courtyard celebration.',true),
        objectives:[
            question('trophy-c4-place','Where does the message send us? Ask the Picture checker and Place checker. Match the sign. Write the place.','On ens envia el missatge? Pregunta al Picture checker i al Place checker. Compara el rètol. Escriu el lloc.',['courtyard','the courtyard','school courtyard']),
            question('trophy-c4-teacher','Who put the speaker in the trophy? Ask the Message checker and People checker. Write the name.','Qui va posar l’altaveu al trofeu? Pregunta al Message checker i al People checker. Escriu el nom.',['Ms Diop','Diop','Awa Diop','Ms Awa Diop'],'trophy-c4-place'),
            report('trophy-c4-chat','Ask in Team chat: “Where shall we go?” Then write together: “Come to… The message is from… It plays through…”','Pregunta al xat d’equip: «On anem?» Després escriviu junts: «Vine a… El missatge és de… Sona per…»','trophy-c4-teacher',
                'A short invitation naming the courtyard, Ms Diop as the message’s author, and the speaker in the trophy as the source of the voice. Simple A2 phrases are enough. The note already mentions a party; no requirement to guess confetti or other ending-only facts.'),
        ],
        discoveries:[
            discovery('trophy-c4-sound','first-aid','The voice plays again. It sounds exactly the same. Is it a recording? Ask your team.','La veu torna a sonar. Sona exactament igual. És una gravació? Pregunta-ho al teu equip.'),
            discovery('trophy-c4-music','courtyard','You hear music. Something is about to start!','Sents música. Alguna cosa està a punt de començar!'),
        ],
        reveals:[
            news('trophy-c4-tip1','Picture checker: say the symbol. Place checker: match it to a place.','Picture checker: digues el símbol. Place checker: relaciona’l amb un lloc.'),
            news('trophy-c4-tip2','Message checker: who signed the note? People checker: what is that teacher’s name?','Message checker: qui ha signat la nota? People checker: com es diu aquesta professora?'),
        ],
    }),
];
for(const role of roles){role.clue=chapters[0].roleClues[role.id];role.help.clue=chapters[0].roleClueHelp[role.id];}
const campaign={id:'the-trophy-that-walked',title:'The Trophy That Walked',roles,chapters,
    vocabulary:['Laia Garcia','Chidi Okafor','Awa Diop','Ms Diop','D4','B2','A1','PE','QUACK'],
    cast:[{name:'Laia Garcia',about:'A student who builds robots. She wears purple.'},{name:'Chidi Okafor',about:'A student. He wears a green hoodie.'},{name:'Ms Awa Diop',about:'The PE teacher. She wears blue.'}],
    finale:'Case solved! Laia’s robot carried a fake cup. Chidi saved the real trophy from water. Ms Diop hid a party message in its speaker. Your clues made sense when you shared them. Tell your team: which surprise was the best?',
    help:{finale:help('Cas resolt! El robot de la Laia portava una copa falsa. En Chidi va salvar el trofeu autèntic de l’aigua. La senyora Diop va amagar un missatge de festa al seu altaveu. Heu entès les pistes quan les heu compartit. Digueu al vostre equip: quina sorpresa us ha agradat més?')}};
const write=(file,value)=>fs.writeFileSync(path.join(dir,file),JSON.stringify(value,null,2)+'\n');
const theme=parseTheme(JSON.parse(fs.readFileSync(path.join(dir,'theme.json'),'utf8')));
const routes=walkReport(theme);if(routes.problems.length)throw Error(routes.problems.join('\n'));
const zones=new Set(theme.zones.map(z=>z.id));
function validate(c){const checked=validateMission(missionEnvelope(c),'publish',zones);if(!checked.campaign)throw Error(JSON.stringify(checked.errors));return missionEnvelope(checked.campaign);}
const envelope=validate(campaign);write('campaign.json',envelope);
const raw=fs.readFileSync(path.join(dir,'campaign.json'),'utf8');
if(Buffer.byteLength(raw)>MISSION_MAX_BYTES||!parseMission(raw).campaign)throw Error('Exported campaign exceeds import limits.');
fs.mkdirSync(path.join(dir,'chapters'),{recursive:true});
for(const [i,c] of chapters.entries()){
    const standalone={...campaign,id:`${campaign.id}-${i+1}`,title:`The Trophy That Walked · ${c.title}`,chapters:[c],
        roles:roles.map(r=>({...r,clue:c.roleClues[r.id],help:{...r.help,clue:c.roleClueHelp[r.id]}})),
        finale:i===chapters.length-1?campaign.finale:c.ending,help:{finale:i===chapters.length-1?campaign.help.finale:c.help.ending}};
    write(`chapters/0${i+1}.json`,validate(standalone));
}
const warmups=buildWarmups();
buildPreview(campaign,warmups);
write('manifest.json',{format:'pixel-plaza-season-pack',version:2,id:campaign.id,season:3,title:campaign.title,level:'A1–A2',minutesPerChapter:[15,20],
    campaign:'campaign.json',chapters:chapters.map((_,i)=>`chapters/0${i+1}.json`),theme:'theme.json',background:'art/campus.png',
    instructions:'README.md',teacherGuide:'teacher-guide.md',source:'storyline.txt',languages:['en','ca'],warmups,
    installation:'Use the existing Season 2 map. Import the campaign ZIP in Mission Studio. Import warm-up JSONs separately in the matching Warm-up editor type.'});
// Keep the delivery ZIP comfortably below the importer limit. Full-size art stays in the source folder.
const files=['manifest.json','campaign.json','theme.json','art/campus.png','README.md','teacher-guide.md','teacher-preview.html','storyline.txt','warmups/README.md',
    ...chapters.map((_,i)=>`chapters/0${i+1}.json`),...warmups.map(w=>w.file)];
fs.writeFileSync(path.join(dir,'the-trophy-that-walked-season-3.zip'),zipFiles(Object.fromEntries(files.map(file=>[file,new Uint8Array(fs.readFileSync(path.join(dir,file)))]))));
console.log(`Season 3: ${chapters.length} chapters, 12 tasks, 16 private picture clues, ${warmups.length} warm-ups. Campaign: ${Buffer.byteLength(raw)} bytes. Validation and map routes pass.`);
