// Optional Side Quest Library imports. No built-in registration or live server changes.
import fs from 'node:fs';
import path from 'node:path';
import { pairSets } from './pairs.mjs';
import { groupSets } from './groups.mjs';
import { checkQuestFile, questObjective, groupSize } from '../../shared/sideQuests.ts';

const dir=import.meta.dirname;
const words=text=>text.trim().split(/\s+/).length;
const quests=[];
for(const [format,sets] of [['pair',pairSets],['group',groupSets]]){
    for(const set of sets){
        if(set.quests.length!==10)throw Error(`${format}/${set.id}: expected ten authored quests.`);
        set.quests.forEach(([title,level,text,criteria],i)=>{
            const id=`sq-talk200-${format==='pair'?'p':'g'}-${set.id}-${String(i+1).padStart(2,'0')}`;
            if(words(text)>30)throw Error(`${id}: ${words(text)} instruction words; shorten to 30 or fewer.`);
            quests.push({id,title,theme:'social',category:set.category,chapter:null,level,format,answer:'report',
                minutes:(format==='pair'?3:4)+(level==='A1'?0:level==='A2'?1:2),focus:set.focus,
                tags:['talk-200','any-map','conversation',format==='pair'?'pairs':'small groups',set.id],text,accept:[],
                teacherNote:`Use the assigned ${format==='pair'?'partner':'group of three'}. Let each person contribute before one member submits the shared answer. Talk in game chat or aloud. No map clues, pictures, props or outside participants are needed. Spoken participation is teacher-observed; the written answer alone does not prove who spoke.`,
                successCriteria:`${criteria} Accept short, simple English appropriate to ${level}. Do not require a chat transcript or extra facts.`,
            });
        });
    }
}
if(quests.length!==200)throw Error(`Expected 200 quests, got ${quests.length}.`);
const checked=checkQuestFile(quests);if('error' in checked)throw Error(checked.error);
const key=s=>s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
if(new Set(quests.map(q=>key(q.title))).size!==200)throw Error('Duplicate title in the new pack.');
if(new Set(quests.map(q=>key(q.text))).size!==200)throw Error('Duplicate instructions in the new pack.');
const priorFile=path.join(dir,'../../worker/tests/fixtures/side-quests.json');
if(fs.existsSync(priorFile)){
    const previous=JSON.parse(fs.readFileSync(priorFile,'utf8')).quests;
    for(const q of quests)if(previous.some(p=>p.id===q.id||key(p.title)===key(q.title)))throw Error(`${q.title}: collides with the existing quest fixture.`);
}
for(const q of checked.quests){
    const objective=questObjective(q);
    if(groupSize(objective)!==(q.format==='pair'?2:3)||!objective.optional||objective.after||objective.board.roles)throw Error(`${q.id}: unexpected grouping or story gate.`);
}
const write=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data,null,2)+'\n');
write('side-quests-talk-200.json',checked.quests);
write('pairs-100.json',checked.quests.filter(q=>q.format==='pair'));
write('groups-100.json',checked.quests.filter(q=>q.format==='group'));
const counts=Object.fromEntries(['A1','A2','B1'].map(level=>[level,quests.filter(q=>q.level===level).length]));
write('manifest.json',{format:'pixel-plaza-side-quest-content-pack',version:1,title:'Talk Together — 200 Side Quests',
    total:200,formats:{pair:100,group:100},levels:counts,minutes:[3,6],
    imports:{all:'side-quests-talk-200.json',pairs:'pairs-100.json',groups:'groups-100.json'},guide:'README.md',preview:'teacher-preview.html',
    categories:[...pairSets.map(s=>({format:'pair',category:s.category,count:10})),...groupSets.map(s=>({format:'group',category:s.category,count:10}))]});

const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const options=items=>items.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
const cards=quests.map((q,i)=>`<article data-format="${q.format}" data-level="${q.level}" data-category="${esc(q.category)}"><div class="meta">${String(i+1).padStart(3,'0')} · ${q.format==='pair'?'PAIR · 2 people':'GROUP · 3 people'} · ${q.level} · ${q.minutes} min</div><h2>${esc(q.title)}</h2><p class="task">${esc(q.text)}</p><p class="category">${esc(q.category)}</p><details><summary>Teacher notes and answer guide</summary><p>${esc(q.successCriteria)}</p><p>${esc(q.teacherNote)}</p><small>${esc(q.id)}</small></details></article>`).join('');
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Talk Together · 200 side quests</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f4f1e8;color:#253e47;font:17px/1.55 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:28px}header{padding:32px;background:#253e47;color:#fff8df;border-radius:18px}h1{font-size:clamp(30px,5vw,50px);margin:8px 0;line-height:1.15}header a{color:#ffe29b}nav{display:flex;gap:20px;flex-wrap:wrap}form{display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px;padding:24px 0}label{display:flex;flex-direction:column;gap:5px}input,select,button{padding:11px;border:1px solid #80969b;border-radius:7px;font:inherit;background:white;color:inherit}.wide{grid-column:span 2}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}article{background:#fffdf7;border:1px solid #d6ddd7;border-radius:14px;padding:22px}h2{font-size:23px;margin:8px 0}.meta,.category,small{font-size:14px;color:#527079}.task{font-size:19px}summary{cursor:pointer;font-weight:650}details{font-size:15px;border-top:1px solid #d6ddd7;padding-top:12px}[hidden]{display:none!important}#count{font-weight:650}@media(max-width:700px){main{padding:14px}.grid,form{grid-template-columns:1fr}.wide{grid-column:auto}}@media print{form,nav{display:none}article{break-inside:avoid}.grid{display:block}article{margin-bottom:20px}header{background:white;color:#253e47}}
    </style><main><header><p>TEACHER CONTENT PACK · WORKS ON ANY MAP</p><h1>Talk Together</h1><p>200 standalone side quests. 100 pairs. 100 groups. Short instructions; conversation first.</p><p>A1: ${counts.A1} · A2: ${counts.A2} · B1: ${counts.B1} · 3–6 minutes</p><nav><a href="side-quests-talk-200.json" download>All 200 · import JSON</a><a href="pairs-100.json" download>Pairs · 100</a><a href="groups-100.json" download>Groups · 100</a><a href="README.md">Setup guide</a></nav></header>
    <form id="filters"><label>Search<input id="search" type="search" placeholder="Try listening, robot, compare…"></label><label>Format<select id="format"><option value="">All formats</option><option value="pair">Pairs</option><option value="group">Groups of three</option></select></label><label>Level<select id="level"><option value="">All levels</option>${options(['A1','A2','B1'])}</select></label><label class="wide">Category<select id="category"><option value="">All categories</option>${options([...new Set(quests.map(q=>q.category))])}</select></label><button type="reset">Clear filters</button></form>
    <p id="count" role="status" aria-live="polite">Showing 200 of 200 quests</p><div class="grid">${cards}</div><p>Import a JSON file through the Side Quest Library. The same quest IDs appear in the combined and split files. One submitted answer completes a quest for its assigned pair or group.</p></main><script>
    const form=document.getElementById('filters'),cards=[...document.querySelectorAll('article')];
    function filter(){const terms=document.getElementById('search').value.toLowerCase().trim().split(/\\s+/).filter(Boolean);const format=document.getElementById('format').value,level=document.getElementById('level').value,category=document.getElementById('category').value;let n=0;for(const card of cards){const visible=(!format||card.dataset.format===format)&&(!level||card.dataset.level===level)&&(!category||card.dataset.category===category)&&terms.every(t=>card.textContent.toLowerCase().includes(t));card.hidden=!visible;if(visible)n++;}document.getElementById('count').textContent='Showing '+n+' of 200 quests';}
    form.addEventListener('input',filter);form.addEventListener('change',filter);form.addEventListener('submit',e=>e.preventDefault());form.addEventListener('reset',()=>setTimeout(filter,0));
    </script></html>`;
fs.writeFileSync(path.join(dir,'teacher-preview.html'),html);
console.log(`Built ${quests.length} quests: 100 pairs, 100 groups. Levels: ${JSON.stringify(counts)}. Longest instructions: ${Math.max(...quests.map(q=>words(q.text)))} words. Imports and grouping valid.`);
