import assert from 'node:assert/strict';
import { ammoProfile, areaGeometry, inBlast, intersects, rangedDV, coverOutcome, effectiveTargets, areaKindOf } from '../scripts/area-rules.js';
let checks = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
for (const [type, expected] of [['basic',2],['armorPiercing',2],['smart',2],['incendiary',1],['rubber',0]]) eq(ammoProfile({type},'blast').ablation,expected);
for (const [type,formula,dv] of [['biotoxin','3d6',15],['poison','2d6',13],['emp','0',15],['sleep','0',13],['flashbang','0',15],['teargas','0',13]]) {
  const p=ammoProfile({type},'blast'); eq(p.formula,formula); eq(p.resistance.dv,dv); eq(p.critical,false); eq(p.ablation,0);
}
eq(ammoProfile({type:'special'},'blast').mode,'manual');
eq(ammoProfile({type:'smoke'},'blast').formula,'0');
for (const distance of [1,2,5,10]) {
  const g={size:100,distance,units:'м'};
  for (const kind of ['blast','shot']) {
    const geometry=areaGeometry(kind,g,{x:1000,y:1000},0);
    eq(geometry.metres,kind==='shot'?6:10);
    eq(geometry.hit.size*distance/100,kind==='shot'?6:10);
  }
}
for (let angle=0;angle<360;angle+=45) {
  const g=areaGeometry('shot',{size:100,distance:2},{x:500,y:500},angle);
  eq(inBlast({x:500,y:500},g.hit),false);
  eq(g.metres,6);
}
const g=areaGeometry('blast',{size:100,distance:2},{x:500,y:500});
eq(inBlast({x:750,y:500},g.hit),false);
eq(intersects({document:{x:150,y:400,width:2,height:1,parent:{grid:{size:100}}}},g.hit),true);
const bounds=[6,12,25,50,100,200,400,800];
for (const [weaponType,values] of [['rocketLauncher',[17,16,15,15,20,20,25,30]],['grenadeLauncher',[16,15,15,17,20,22,25,null]]]) {
  bounds.forEach((d,i)=>eq(rangedDV(d,{weaponType}),values[i]));
  bounds.slice(0,-1).forEach((d,i)=>eq(rangedDV(d+.01,{weaponType}),values[i+1]));
}
eq(rangedDV(25.01,{thrown:true}),null); eq(rangedDV(25,{thrown:true}),15);
eq(rangedDV(6,{kind:'shot'}),13); eq(rangedDV(6.01,{kind:'shot'}),null);
eq(coverOutcome('blast',20,20),{blocked:false,remaining:0});
eq(coverOutcome('blast',19,20),{blocked:true,remaining:1});
eq(coverOutcome('shot',20,20),{blocked:true,remaining:0});
eq(coverOutcome('blast',20,null),{unresolved:true});
eq(coverOutcome('blast',30,1,true),{blocked:true,remaining:1});
eq(coverOutcome('blast',30,0,true),{blocked:false,remaining:0});
eq(effectiveTargets({targets:[{uuid:'A',defense:'dodged'},{uuid:'B',applied:true},{uuid:'C',excluded:true},{uuid:'D',defense:'hit'}]}).map(t=>t.uuid),['D']);
eq(areaKindOf({type:'weapon',system:{weaponType:'shotgun'},_getLoadedAmmoProp:()=> 'shotgunSlug',actor:{getFlag:()=>true}}),null);
eq(areaKindOf({type:'weapon',system:{weaponType:'shotgun'},_getLoadedAmmoProp:()=> 'shotgunShell'}),'shot');
console.log(JSON.stringify({pass:true,checks}));
