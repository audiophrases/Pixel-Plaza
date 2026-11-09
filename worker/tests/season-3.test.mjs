import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseMission, validateMission, MISSION_MAX_BYTES } from '../../shared/missionSchema.ts';
import { readMissionFile, MISSION_PACK_MAX_BYTES } from '../../shared/missionFile.ts';
import { absentRoleClues, isUnlocked } from '../../shared/campaign.ts';
import { evidenceSource } from '../../shared/evidence.ts';
import { parseTheme } from '../../shared/theme.ts';
import { walkReport } from '../../shared/walk.ts';
import { parseWarmupImport } from '../../shared/warmupImport.ts';
import { assignWarmup } from '../../shared/warmup.ts';
import { assignIdentities, assignPairs } from '../../shared/warmupKinds.ts';
const file=name=>new URL(`../../content/season-3/${name}`,import.meta.url);
const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
const envelope=read('campaign.json'),campaign=envelope.campaign,manifest=read('manifest.json');
const words=s=>s.trim().split(/\s+/).length;

test('Season 3 imports from its actual delivery ZIP, fits limits, and reuses the Season 2 campus exactly',async()=>{
    const raw=fs.readFileSync(file('campaign.json'),'utf8');
    assert.ok(Buffer.byteLength(raw)<MISSION_MAX_BYTES);
    assert.deepEqual(parseMission(raw).campaign,campaign);
    const bytes=fs.readFileSync(file('the-trophy-that-walked-season-3.zip'));
    assert.ok(bytes.length<MISSION_PACK_MAX_BYTES);
    assert.deepEqual((await readMissionFile(new File([bytes],'season-3.zip'))).campaign,campaign);
    assert.deepEqual(fs.readFileSync(file('theme.json')),fs.readFileSync(new URL('../../content/season-2/theme.json',import.meta.url)));
    assert.deepEqual(fs.readFileSync(file('art/campus.png')),fs.readFileSync(new URL('../../content/season-2/art/campus.png',import.meta.url)));
    const theme=parseTheme(read('theme.json'));
    assert.deepEqual(walkReport(theme).problems,[]);
    assert.deepEqual(validateMission(envelope,'publish',new Set(theme.zones.map(z=>z.id))).errors,[]);
});

test('each chapter has short bilingual tasks, four accessible private picture clues and a simple team-chat report',()=>{
    assert.equal(campaign.chapters.length,4);
    const roles=campaign.roles.map(r=>r.id).sort();
    const allPictures=[];
    for(const c of campaign.chapters){
        assert.ok(words(c.intro)<=40,c.title);
        assert.deepEqual(Object.keys(c.roleClueImages).sort(),roles);
        assert.equal(new Set(Object.values(c.roleClueImages).map(p=>p.src)).size,4);
        for(const r of roles){assert.ok(c.roleClues[r]);assert.ok(c.roleClueHelp[r].ca);}
        for(const key of ['intro','recap','ending'])assert.ok(c.help[key].ca);
        for(const item of [...c.objectives,...c.discoveries,...c.reveals])assert.ok(item.help.ca,item.id);
        assert.equal(c.objectives.length,3);
        for(const o of c.objectives)assert.ok(words(o.text)<25,`${o.id}: ${words(o.text)}`);
        const [first,second,report]=c.objectives;
        assert.ok(isUnlocked(first,[]));assert.ok(!isUnlocked(second,[]));assert.ok(isUnlocked(second,[first.id]));
        assert.ok(!isUnlocked(report,[first.id]));assert.ok(isUnlocked(report,[first.id,second.id]));
        assert.equal(report.kind,'report');assert.equal(report.optional,undefined);
        assert.equal(report.conversation,undefined,'use the existing Season 2 Team chat flow');
        assert.match(report.text,/Ask in Team chat/);assert.ok(report.successCriteria);
        allPictures.push(...Object.values(c.roleClueImages),...[c.introImage,c.endingImage].filter(Boolean));
    }
    assert.equal(allPictures.length,20);
    assert.ok(allPictures.every(p=>evidenceSource(p.src)&&p.alt.trim()));
});

test('standalone lessons retain current private clues and early lessons do not expose the final chapter',()=>{
    for(const [i,chapter] of campaign.chapters.entries()){
        const module=read(`chapters/0${i+1}.json`);
        assert.deepEqual(validateMission(module,'publish').errors,[]);
        assert.deepEqual(module.campaign.chapters,[chapter]);
        for(const role of module.campaign.roles){
            assert.equal(role.clue,chapter.roleClues[role.id]);
            assert.deepEqual(role.help.clue,chapter.roleClueHelp[role.id]);
        }
        if(i<3){
            assert.equal(module.campaign.finale,chapter.ending);
            assert.ok(!JSON.stringify(module).includes(campaign.chapters[3].roleClueImages['message-checker'].src));
        }
    }
});

test('small classes receive missing-role pictures without revealing present classmates’ private pictures',()=>{
    const [a,b,...missing]=campaign.roles.map(r=>r.id);
    for(const chapter of campaign.chapters){
        const clues=absentRoleClues(campaign,chapter,a,[],[a,b],[a,b]);
        assert.equal(clues.length,2);
        for(const role of missing)assert.ok(clues.some(c=>c.image?.src===chapter.roleClueImages[role].src));
        assert.ok(!clues.some(c=>c.image?.src===chapter.roleClueImages[b].src));
        assert.deepEqual(absentRoleClues(campaign,chapter,a,[],campaign.roles.map(r=>r.id),campaign.roles.map(r=>r.id)),[]);
    }
});

test('all six warm-ups import and assign reachable chat partners in small, odd and large classes',()=>{
    assert.equal(manifest.warmups.length,6);
    assert.deepEqual(manifest.warmups.map(w=>w.kind).sort(),['facts','facts','identity','identity','pairs','pairs']);
    for(const w of manifest.warmups){
        const d=parseWarmupImport(fs.readFileSync(file(w.file),'utf8'),w.kind);
        assert.ok(words(d.instructions)<=30);
        for(const size of [2,3,4,15,30]){
            const students=Array.from({length:size},(_,i)=>`Student ${i+1}`);
            const assignments=d.kind==='facts'?assignWarmup(students,()=>.4,d.facts,d.rounds):d.kind==='pairs'?assignPairs(students,()=>.4,d.pairs):assignIdentities(students,()=>.4,d.identities);
            assert.equal(assignments.size,size);
            for(const [student,a] of assignments){
                assert.ok(a.targets.length);
                for(const target of a.targets){
                    if(d.kind==='identity'){assert.notEqual(student,target);assert.ok(assignments.has(target));}
                    else assert.ok([...assignments].some(([other,b])=>other!==student&&b.fact===target),`${w.title}: ${student} has a reachable target`);
                }
            }
        }
    }
});
