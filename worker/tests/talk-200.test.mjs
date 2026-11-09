import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { checkQuestFile, questObjective, groupSize, questFit, searchQuests } from '../../shared/sideQuests.ts';
import { boardWait } from '../../shared/campaign.ts';
import { missionEnvelope, validateMission } from '../../shared/missionSchema.ts';
import { liveMissionCandidate } from '../../shared/missionLive.ts';
const root=new URL('../../content/side-quests-talk-200/',import.meta.url);
const read=name=>JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));
const all=read('side-quests-talk-200.json');
const previous=JSON.parse(fs.readFileSync(new URL('./fixtures/side-quests.json',import.meta.url),'utf8')).quests;

test('all 200 new quests import unchanged, with stable disjoint pair and group files',()=>{
    assert.equal(all.length,200);
    assert.deepEqual(checkQuestFile(all),{quests:all});
    const pair=read('pairs-100.json'),group=read('groups-100.json');
    assert.equal(pair.length,100);assert.equal(group.length,100);
    assert.deepEqual(checkQuestFile(pair),{quests:pair});assert.deepEqual(checkQuestFile(group),{quests:group});
    assert.deepEqual([...pair,...group],all,'split imports use identical records and IDs');
    assert.equal(new Set(all.map(q=>q.id)).size,200);
    assert.equal(new Set(all.map(q=>q.title.toLowerCase())).size,200);
    assert.equal(new Set(all.map(q=>q.text.toLowerCase())).size,200);
    for(const q of all)assert.ok(!previous.some(old=>old.id===q.id||old.title.toLowerCase()===q.title.toLowerCase()),q.title);
    assert.ok(!checkQuestFile([...previous,...all]).error,'new quests coexist with the existing library');
});

test('quest-board projections form pairs or trios and need no campaign, map clues or story roles',()=>{
    const emptyChapter={id:'unrelated-session',title:'Open session',intro:'Talk together.',recap:'Talk together.',ending:'Well done.',share:.7,
        objectives:[{id:'check-in',text:'Say hello.',accept:[],kind:'report',level:'A1',successCriteria:'A simple greeting.'}],discoveries:[],reveals:[]};
    const unrelated={id:'unrelated',title:'Any session',roles:[{id:'visitor',name:'Visitor',card:'Say hello.',clue:'Welcome.'}],chapters:[emptyChapter],finale:'Thanks.'};
    for(const q of all){
        assert.equal(q.chapter,null);assert.equal(q.theme,'social');
        for(const k of ['roles','after','afterMain'])assert.equal(q[k],undefined);
        const objective=questObjective(q),size=q.format==='pair'?2:3;
        assert.equal(groupSize(objective),size);assert.deepEqual(objective.board,{minPlayers:size});
        assert.equal(objective.optional,true);assert.equal(objective.kind,'report');
        assert.equal(objective.successCriteria,q.successCriteria);
        assert.equal(questFit(q,unrelated,emptyChapter.id,[]),null);
        assert.equal(boardWait(objective,emptyChapter,'visitor',[],true,size),null);
        assert.match(boardWait(objective,emptyChapter,'visitor',[],true,size-1),/more classmates/);
    }
    // Real mission release path, in small batches as a teacher would select them.
    for(let i=0;i<all.length;i+=10){
        const batch=all.slice(i,i+10),source=structuredClone(unrelated);
        source.chapters[0].objectives.push(...batch.map(questObjective));
        assert.deepEqual(validateMission(missionEnvelope(source)).errors,[]);
        const released=liveMissionCandidate(unrelated,source,emptyChapter.id,batch.map(q=>q.id));
        assert.deepEqual(released.errors,[]);assert.equal(released.quests.length,10);
    }
});

test('instructions stay brief and library filters find every intended level and format',()=>{
    const expected={A1:60,A2:104,B1:36};
    for(const q of all){
        assert.ok(q.text.trim().split(/\s+/).length<=30,q.title);
        assert.ok(q.minutes>=3&&q.minutes<=6);assert.equal(q.answer,'report');assert.deepEqual(q.accept,[]);
        assert.ok(q.successCriteria.length>30&&q.successCriteria.length<=600);
        assert.ok(!/\b(?:Pixel Plaza|Castanyada|Karina|Diop|Laia|Chidi|walk to|avatar|screenshot)\b/i.test(q.text),q.title);
    }
    assert.equal(searchQuests(all,'talk-200').length,200);
    assert.equal(searchQuests(all,'talk-200',{formats:['pair'],kind:'generic'}).length,100);
    assert.equal(searchQuests(all,'talk-200',{formats:['group'],kind:'generic'}).length,100);
    for(const [level,count] of Object.entries(expected))assert.equal(searchQuests(all,'',{levels:[level]}).length,count);
    assert.deepEqual(read('manifest.json').levels,expected);
});

test('offline preview renders every task and filters search words, format and level together',async()=>{
    const dom=new JSDOM(fs.readFileSync(new URL('teacher-preview.html',root),'utf8'),{runScripts:'dangerously'});
    try{
        const {document,Event}=dom.window;
        const shown=()=>[...document.querySelectorAll('article')].filter(el=>!el.hidden);
        assert.equal(shown().length,200);
        const select=(id,value)=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
        select('format','pair');assert.equal(shown().length,100);
        select('search','TINY   HELPFUL');assert.equal(shown().length,1);assert.match(shown()[0].textContent,/The Tiny Helpful Machine/);
        select('level','B1');assert.equal(shown().length,0);
        document.getElementById('filters').reset();
        await new Promise(resolve=>dom.window.setTimeout(resolve,10));
        assert.equal(shown().length,200);
        for(const q of all)assert.ok(document.body.textContent.includes(q.text));
        assert.match(document.getElementById('count').textContent,/200 of 200/);
    }finally{dom.window.close();}
});
