import test from 'node:test';
import assert from 'node:assert/strict';
import {MATERIALS, R2_RULES, type Actor, type Material, type Snapshot} from '../src/contracts.js';
import {actorSaved, canPickActor, canPlace, canPutActor, createInitial, damageBlock, inventoryTotal, pickActor, place, putActor, resolveBlock, restore, retainedFraction, snapshot, step, take, targetAt} from '../src/core.js';
import {CURRENT_BUILD_CONTEXT, fromSnapshotV1, scoreSnapshot, toSnapshotV1, validateSnapshotV1} from '../src/snapshot-v1.js';
const idle = {left:false,right:false,jump:false};
const ticks = (s:Snapshot,n:number,input=idle) => {for(let i=0;i<n;i++)step(s,input);};
const initial = () => createInitial(undefined,'r2-map-1');
function ok(result:{ok:boolean;reason?:string}):void {assert.equal(result.ok,true,result.reason ?? "");}
function intro():Snapshot {
 const s=initial();
 ok(take(s,targetAt(s,'house',7,1)));ok(place(s,targetAt(s,'world',9,0)));
 ok(take(s,targetAt(s,'house',7,2)));ok(place(s,targetAt(s,'world',10,0)));
 assert.equal(s.tutorialPlacements,2);return s;
}
function harvest(s:Snapshot,x:number,y:number):void {ticks(s,11);const t=targetAt(s,'house',x,y);const result=take(s,t);assert.equal(result.ok,true,`harvest ${x},${y}: ${!result.ok ? result.reason : ''}`);}
const mobOf=(s:Snapshot)=>s.actors!.find(a=>a.kind==='mob')!;
function armedFixture(s:Snapshot):Actor {
 const mob=mobOf(s);Object.assign(mob,{x:s.house.x+3.3,y:s.house.y-1.35,vx:0,vy:0,hp:1,support:null,state:'armed',fuseTicks:1,explosionApplied:false});return mob;
}

test('R2 intro freezes all simulation hazards until two actual reachable transfers; legacy is not relabeled',()=>{
 const s=initial(),before=snapshot(s);ticks(s,18000);assert.deepEqual(s,before);
 ok(take(s,targetAt(s,'house',7,1)));ok(place(s,targetAt(s,'world',9,0)));ticks(s,900);
 assert.equal(s.tick,0);assert.equal(s.lava!.x,-17);assert.equal(mobOf(s).state,'patrol');
 const resumed=fromSnapshotV1(toSnapshotV1(s));assert.equal(resumed.tutorialPlacements,1);
 ok(take(resumed,targetAt(resumed,'house',7,2)));ok(place(resumed,targetAt(resumed,'world',10,0)));
 step(resumed);assert.equal(resumed.tick,1);assert.ok(resumed.house.x>2);assert.ok(resumed.lava!.x>-17);
 assert.equal(createInitial().contentVersion,'r1-map-1');
 assert.deepEqual(validateSnapshotV1(toSnapshotV1(resumed)),toSnapshotV1(resumed));
});

test('three materials transfer exact type, total cap applies, repair never restores original identity',()=>{
 const s=initial();const fraction=retainedFraction(s);
 ok(take(s,targetAt(s,'house',4,0)));assert.equal(s.inventory.stone,1);
 ok(place(s,targetAt(s,'world',9,0),'stone'));assert.equal(s.inventory.stone,0);assert.equal(resolveBlock(s,{space:'world',x:9,y:0})!.durability,2);
 ok(take(s,targetAt(s,'house',2,3)));assert.equal(s.inventory.slime,1);
 ok(place(s,targetAt(s,'world',10,0),'slime'));assert.equal(s.inventory.slime,0);
 assert.equal(resolveBlock(s,{space:'world',x:10,y:0})!.material,'slime');assert.ok(retainedFraction(s)<fraction);
 assert.deepEqual(fromSnapshotV1(toSnapshotV1(s)),{...snapshot(s),player:{...s.player,jumpHeld:false}});
 const full=initial();full.inventory={wood:10,stone:2,slime:0};const frozen=snapshot(full);
 assert.equal(take(full,targetAt(full,'house',7,1)).ok,false);assert.deepEqual(full,frozen);assert.equal(inventoryTotal(full.inventory),12);
});

test('AT-03: lava continues while house stops at a later gap, then resumes after bridge',()=>{
 const s=intro();ticks(s,2500);assert.equal(s.house.motion,'gap');
 const houseX=s.house.x,lavaX=s.lava!.x;ticks(s,60);assert.equal(s.house.x,houseX);assert.ok(s.lava!.x>lavaX+.74);
 harvest(s,4,5);ticks(s,11);ok(place(s,targetAt(s,'world',34,0)));ticks(s,30);assert.ok(s.house.x>houseX);
});

test('AT-04: removing item floor clears exact support and starts falling, independent from house chassis timer',()=>{
 const s=intro();ticks(s,11);ok(take(s,targetAt(s,'house',4,0)));ticks(s,11);
 const chest=s.actors!.find(a=>a.kind==='chest')!;
 ok(take(s,targetAt(s,'house',3,0)));assert.equal(chest.support,null);assert.equal(chest.state,'falling');
 const saved=fromSnapshotV1(toSnapshotV1(s));ticks(s,8);ticks(saved,8);
 assert.ok(chest.y<3.5);assert.equal(s.house.supportTimer,1.5);assert.deepEqual(toSnapshotV1(saved),toSnapshotV1(s));
});

test('G-10: carry exactly one item, forbid block placement, require free actor destination',()=>{
 const s=intro();ticks(s,11);ok(pickActor(s,'chest:supplies'));assert.equal(s.player.heldActorKey,'chest:supplies');
 assert.equal(canPickActor(s,'cat:companion').ok,false);assert.equal(canPlace(s,targetAt(s,'world',34,0)).ok,false);
 ticks(s,11);assert.equal(canPutActor(s,targetAt(s,'house',1,0)).ok,false,'cat occupies destination');
 ok(putActor(s,targetAt(s,'house',2,0)));assert.equal(s.player.heldActorKey,null);
 assert.equal(s.actors!.find(a=>a.kind==='chest')!.support!.blockId,'original:2:0');
 assert.deepEqual(validateSnapshotV1(toSnapshotV1(s)),toSnapshotV1(s));
});

test('slime bounce uses data configuration and flight remains restorable',()=>{
 const s=initial();ok(take(s,targetAt(s,'house',4,0)));ok(place(s,targetAt(s,'world',9,0),'stone'));
 ok(take(s,targetAt(s,'house',2,3)));ok(place(s,targetAt(s,'world',10,0),'slime'));
 Object.assign(s.player,{x:10,y:1.5,vx:0,vy:-4,support:null});
 for(let i=0;i<30&&s.player.vy<=0;i++)step(s);
 assert.equal(s.player.vy,R2_RULES.slimeBounceSpeed);assert.equal(s.player.support,null);
 const r=fromSnapshotV1(toSnapshotV1(s));ticks(s,10);ticks(r,10);assert.deepEqual(toSnapshotV1(r),toSnapshotV1(s));
 assert.equal(MATERIALS.stone.durability,2);
});

test('AT-05/16: saved armed fuse applies one explosion to each object, even after reload',()=>{
 const s=intro();ticks(s,11);armedFixture(s);const r=fromSnapshotV1(toSnapshotV1(s));
 step(s);step(r);assert.deepEqual(toSnapshotV1(r),toSnapshotV1(s));
 assert.equal(s.house.heartHp,70);assert.equal(s.player.hp,2);assert.equal(mobOf(s).state,'exploded');assert.equal(mobOf(s).explosionApplied,true);
 assert.equal(resolveBlock(s,{space:'house',x:4,y:0})!.durability,1);assert.equal(resolveBlock(s,{space:'house',x:2,y:0}),undefined);
 const hp=s.house.heartHp,playerHp=s.player.hp,deadWood=s.destroyedMaterials!.wood;
 ticks(s,120);assert.equal(s.house.heartHp,hp);assert.equal(s.player.hp,playerHp);assert.equal(s.destroyedMaterials!.wood,deadWood);assert.equal(mobOf(s).state,'removed');
});

test('AT-16: burning wood saves remaining ticks; stone never ignites and destruction preserves material budget',()=>{
 const s=intro();const bridge=resolveBlock(s,{space:'world',x:9,y:0})!;
 for(let i=0;i<2200&&bridge.burnTicks===0;i++)step(s);
 assert.equal(bridge.burnTicks,180);assert.equal(resolveBlock(s,{space:'world',x:8,y:0})!.burnTicks,0);
 ticks(s,37);const r=fromSnapshotV1(toSnapshotV1(s));assert.equal(resolveBlock(r,{space:'world',x:9,y:0})!.burnTicks,143);
 ticks(s,143);ticks(r,143);assert.equal(resolveBlock(s,{space:'world',x:9,y:0}),undefined);assert.equal(s.destroyedMaterials!.wood,1);
 assert.deepEqual(toSnapshotV1(r),toSnapshotV1(s));
});

test('AT-06/27: lost cat does not lose run; portal player predicate and held-chest bonus are derived',()=>{
 const s=intro();s.house.x=122;s.player.x=126.6;s.house.motion='portal';
 const cat=s.actors!.find(a=>a.kind==='cat')!,chest=s.actors!.find(a=>a.kind==='chest')!,mob=mobOf(s);
 Object.assign(cat,{x:110,y:.5,support:{space:'world',x:110,y:0,blockId:'terrain:110'},state:'idle'});
 Object.assign(chest,{x:s.player.x,y:s.player.y+.65,vx:0,vy:0,support:null,state:'held'});s.player.heldActorKey=chest.actorKey;
 Object.assign(mob,{hp:0,state:'removed',support:null,vx:0,vy:0,fuseTicks:0});
 s.player.support=null;s.player.vy=1;step(s);assert.equal(s.outcome,'playing','airborne player cannot finish');
 s.player.y=3.5;s.player.vy=0;s.player.support={space:'house',x:4,y:0,blockId:'original:4:0'};step(s);assert.equal(s.outcome,'won');
 const score=scoreSnapshot(toSnapshotV1(s));assert.equal(score.cat_saved,false);assert.equal(score.chest_saved,true);assert.equal(actorSaved(s,'cat'),false);
 assert.equal(score.score,1000+300+Math.floor(400*21/23)+300);
 const lostCat=intro();const item=lostCat.actors!.find(a=>a.kind==='cat')!;Object.assign(item,{hp:0,state:'destroyed',support:null});step(lostCat);assert.equal(lostCat.outcome,'playing');
});

test('AT-29: same-tick portal entry and fatal blast resolves only to loss and stays terminal',()=>{
 const s=intro(),delta=R2_RULES.houseSpeed/R2_RULES.tickRate;s.house.x=122-delta;s.player.x=s.house.x+4.6;s.house.heartHp=30;
 for(const actor of s.actors!.filter(a=>a.kind!=='mob'))actor.x=s.house.x+actor.support!.x;
 armedFixture(s);step(s);assert.equal(s.house.x,122);assert.equal(s.outcome,'lost');assert.match(s.reason!,/взрыв/);
 const end=snapshot(s);ticks(s,60);assert.deepEqual(s,end);assert.equal(scoreSnapshot(toSnapshotV1(s)).score,0);
});

test('R2 validation rejects missing timer, resurrected identity, forged actor/reference and slot overfill',()=>{
 const base=toSnapshotV1(intro(),CURRENT_BUILD_CONTEXT),reject=(fn:(v:any)=>void)=>{const bad=structuredClone(base);fn(bad);assert.throws(()=>fromSnapshotV1(bad));};
 reject(v=>delete v.player.timers.action_cooldown_ticks);reject(v=>v.actors[0].support.block_id='wrong');reject(v=>v.actors.push({...v.actors[0]}));
 reject(v=>v.house_cells[0].original_block_id='original:7:1');reject(v=>v.house_cells[0].durability=0);reject(v=>v.inventory.stone=13);
 reject(v=>v.lava.x=99);reject(v=>v.actors.find((a:any)=>a.kind==='mob').explosion_applied=true);reject(v=>v.counters.destroyed_slime=1);
});

test('full 120-cell R2 route is completed with physical carry, bridge placement and live hazards, then restores score',()=>{
 const s=intro();
 for(const [x,y] of [[4,5],[5,5],[6,5],[7,3],[7,4],[7,5],[2,3],[1,3],[3,5],[2,5],[1,5],[0,5]])harvest(s,x,y);
 assert.equal(inventoryTotal(s.inventory),12);
 let placements=0;
 for(let i=0;i<18000&&s.outcome==='playing';i++) {
  if(s.house.motion==='gap' && s.player.actionCooldownTicks===0) {
   const cell=[34,35,36,66,67,68,69,96,97,98,99,100].find(x=>x>s.house.x+6&&!resolveBlock(s,{space:'world',x,y:0}));
   if(cell!==undefined) {
    const material:Material=(s.inventory.wood??0)>0?'wood':'slime',target=targetAt(s,'world',cell,0);
    if(canPlace(s,target,material).ok){ok(place(s,target,material));placements++;}
   }
  }
  step(s);
  if(i%600===0)validateSnapshotV1(toSnapshotV1(s));
 }
 assert.equal(s.outcome,'won',`tick=${s.tick} house=${s.house.x} hp=${s.player.hp} core=${s.house.heartHp} reason=${s.reason}`);
 assert.equal(placements,12);assert.equal(s.house.x-2,120);assert.ok(s.tick>10000&&s.tick<15000);
 assert.ok(s.lava!.x>100);assert.equal(inventoryTotal(s.inventory),0);assert.equal(mobOf(s).explosionApplied,true,'route exercises actual armed/explosion states');
 const restored=fromSnapshotV1(toSnapshotV1(s));assert.deepEqual(scoreSnapshot(toSnapshotV1(restored)),scoreSnapshot(toSnapshotV1(s)));
});

test('AT-04/16: R2 chassis warning uses saved ticks, restoration and repair before deadline save house',()=>{
 const s=intro();ticks(s,2500);harvest(s,4,5);ticks(s,11);ok(place(s,targetAt(s,'world',34,0)));ticks(s,100);
 ok(take(s,targetAt(s,'world',34,0)));ticks(s,30);assert.equal(s.house.motion,'unsupported');assert.equal(s.house.supportTimer,1);
 const dto=toSnapshotV1(s);assert.equal(dto.house.support_loss_ticks,60);const r=fromSnapshotV1(dto);
 ticks(s,10);ticks(r,10);assert.deepEqual(toSnapshotV1(r),toSnapshotV1(s));
 ok(place(s,targetAt(s,'world',34,0)));step(s);assert.equal(s.house.supportTimer,1.5);assert.equal(s.outcome,'playing');
});

test('lava interval counters restore without duplicated HP tick and accurate terminal cause',()=>{
 const s=intro();Object.assign(s.player,{x:-10,y:.5,vx:0,vy:0,support:{space:'world',x:-10,y:0,blockId:'terrain:-10'}});
 while(s.lava!.playerDamageTicks<35)step(s);
 assert.equal(s.player.hp,3);const r=fromSnapshotV1(toSnapshotV1(s));
 ticks(s,25);ticks(r,25);assert.equal(s.player.hp,2);assert.equal(s.lava!.playerDamageTicks,0);assert.deepEqual(toSnapshotV1(r),toSnapshotV1(s));
 ticks(s,120);assert.equal(s.outcome,'lost');assert.match(s.reason!,/лаве/);
 const house=intro();while(house.house.heartHp===100)step(house);
 assert.equal(house.house.heartHp,75);assert.equal(house.lava!.coreDamageTicks,0);ticks(house,180);
 assert.equal(house.outcome,'lost');assert.match(house.reason!,/Лава/);
});

test('AT-16: stone/slime seam landing is unchanged after sorted snapshot overrides',()=>{
 const s=intro();ticks(s,11);ok(take(s,targetAt(s,'house',4,0)));ticks(s,11);ok(take(s,targetAt(s,'house',2,3)));
 ticks(s,11);ok(place(s,targetAt(s,'world',10,1),'stone'));ticks(s,11);ok(place(s,targetAt(s,'world',9,1),'slime'));
 // Physical airborne phase above two real placed blocks: creation order differs from transport order.
 Object.assign(s.player,{x:9.5,y:1.51,vx:0,vy:-.8,support:null,jumpHeld:false});
 const saved=toSnapshotV1(s),r=fromSnapshotV1(saved);assert.deepEqual(toSnapshotV1(r),saved);
 step(s);step(r);assert.equal(s.player.vy,R2_RULES.slimeBounceSpeed);assert.equal(s.player.support,null);
 assert.deepEqual(toSnapshotV1(r),toSnapshotV1(s));
 for(let i=0;i<40;i++){step(s);step(r);assert.deepEqual(toSnapshotV1(r),toSnapshotV1(s));}
});

test('AT-16: damaged same-base override cannot reorder player or item support choice at a seam',()=>{
 const s=intro();ticks(s,11);damageBlock(s,'original:3:0',1);
 Object.assign(s.player,{x:s.house.x+3.5,y:3.51,vx:0,vy:-.8,support:null,jumpHeld:false});
 const chest=s.actors!.find(actor=>actor.kind==='chest')!;
 Object.assign(chest,{x:s.house.x+3.5,y:3.51,vx:0,vy:-.8,support:null,state:'falling'});
 const saved=toSnapshotV1(s),r=fromSnapshotV1(saved);assert.deepEqual(toSnapshotV1(r),saved);
 step(s);step(r);assert.equal(s.player.support!.blockId,'original:3:0');assert.equal(chest.support!.blockId,'original:3:0');
 assert.deepEqual(toSnapshotV1(r),toSnapshotV1(s));
 for(let i=0;i<40;i++){step(s);step(r);assert.deepEqual(toSnapshotV1(r),toSnapshotV1(s));}
});
