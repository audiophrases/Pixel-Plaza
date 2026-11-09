import fs from 'node:fs';
import path from 'node:path';
import { validateWarmup } from '../../shared/warmupConfig.ts';
import { parseWarmupImport } from '../../shared/warmupImport.ts';
const dir=path.join(import.meta.dirname,'warmups');
const facts=(title,instructions,rows)=>({title,instructions,level:'A2',kind:'facts',rounds:3,
    facts:rows.map(([id,mine,find])=>({id,mine,find}))});
const identities=(title,instructions,words)=>({title,instructions,level:'A1',kind:'identity',
    identities:words.map(word=>({id:word.toLowerCase().replaceAll(' ','-'),name:word,accept:[word.toLowerCase()]}))});
const pairs=(title,instructions,entries)=>({title,instructions,level:'A1',kind:'pairs',pairs:entries});
export const activities=[
    ['01-bag-detectives',facts('Bag Detectives','Read your pretend card. Ask: “Do you have…?” Find each person. Type their name.',[
        ['key','🔑 You have a key.','has a key'],['apple','🍎 You have an apple.','has an apple'],['ball','⚽ You have a football.','has a football'],
        ['book','📚 You have a book.','has a book'],['umbrella','☂️ You have an umbrella.','has an umbrella'],['camera','📷 You have a camera.','has a camera'],
        ['pizza','🍕 You have a slice of pizza.','has a slice of pizza'],['sock','🧦 You have one sock.','has one sock'],['crown','👑 You have a crown.','has a crown'],
        ['banana','🍌 You have a banana.','has a banana'],['bell','🔔 You have a bell.','has a bell'],['pencil','✏️ You have a pencil.','has a pencil'],
    ]),'Describe an object; ask and answer with have.'],
    ['02-wild-weekend',facts('My Very Strange Weekend','These stories are pretend. Ask: “Did you…?” Answer from your card. Find each person. Type their name.',[
        ['moon','🌙 You visited the moon.','visited the moon'],['dragon','🐉 You fed a dragon.','fed a dragon'],['penguin','🐧 You danced with a penguin.','danced with a penguin'],
        ['pizza','🍕 You made a giant pizza.','made a giant pizza'],['fish','🐟 You talked to a fish.','talked to a fish'],['castle','🏰 You slept in a castle.','slept in a castle'],
        ['robot','🤖 You taught a robot to sing.','taught a robot to sing'],['cloud','☁️ You sat on a cloud.','sat on a cloud'],['dinosaur','🦕 You met a dinosaur.','met a dinosaur'],
        ['cake','🎂 You ate a blue cake.','ate a blue cake'],['cat','🐈 You played chess with a cat.','played chess with a cat'],['rocket','🚀 You flew a rocket.','flew a rocket'],
    ]),'Ask about past events; practise a short follow-up aloud.'],
    ['03-mystery-objects',identities('What Object Am I?','Keep your object secret. Ask your named classmate yes/no questions: “Are you small?” “Can I wear you?” Type your guess.',
        ['Umbrella','Pencil','Bicycle','Shoe','Clock','Camera','Spoon','Backpack','Guitar','Key','Book','Chair']),'Describe shape, size and use without saying the secret word.'],
    ['04-secret-animals',identities('Secret Animals','Keep your animal secret. Ask your named classmate: “Can you fly?” “Are you big?” Reply yes or no. Type your guess.',
        ['Elephant','Cat','Dog','Penguin','Shark','Giraffe','Butterfly','Frog','Snake','Horse','Lion','Octopus']),'Ask about abilities and appearance; narrow down a guess.'],
    ['05-perfect-pairs',pairs('Find My Other Half','Read your word. Ask: “What do you have?” Find the word that goes with yours. Type that classmate’s name.',[
        ['🔑 Key','🔒 Lock'],['🪥 Toothbrush','Toothpaste'],['Needle','Thread'],['Salt','Pepper'],['Bow','Arrow'],
        ['Cup','Saucer'],['Hammer','Nail'],['Knife','Fork'],['Bat','Ball'],['Letter','Envelope'],
    ]),'Ask for missing information and agree on a match.'],
    ['06-problem-solvers',pairs('Help Me!','Read your card. Ask: “What do you need?” or “Can this help?” Match a problem with its solution. Type that classmate’s name.',[
        ['It is raining.','☂️ An umbrella'],['My phone has no power.','A phone charger'],['I cannot see in the dark.','🔦 A torch'],
        ['My hands are dirty.','🧼 Soap'],['My trousers are falling down.','A belt'],['My hair is messy.','A hairbrush'],
        ['My pencil has no point.','A pencil sharpener'],['I need to cut paper.','✂️ Scissors'],['I am thirsty.','💧 A glass of water'],
        ['I need to know the time.','⌚ A watch'],
    ]),'Make a request, offer help and confirm a solution.'],
];
export function buildWarmups(){
    fs.mkdirSync(dir,{recursive:true});
    return activities.map(([slug,definition,goal])=>{
        const checked=validateWarmup(definition);if(!checked.definition)throw Error(`${slug}: ${checked.errors.join('; ')}`);
        const envelope={format:'pixel-plaza-warmup',schemaVersion:1,definition:checked.definition};
        const raw=JSON.stringify(envelope,null,2)+'\n';parseWarmupImport(raw,definition.kind);
        fs.writeFileSync(path.join(dir,`${slug}.json`),raw);
        return {file:`warmups/${slug}.json`,title:definition.title,kind:definition.kind,minutes:[3,5],goal};
    });
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename)console.log(`Built ${buildWarmups().length} warm-ups.`);
