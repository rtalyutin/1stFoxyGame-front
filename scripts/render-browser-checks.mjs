import assert from 'node:assert/strict';
import {resolve} from 'node:path';

/** Pure simulation fixtures in the actual hardware WorldView; no API rewards. */
export async function renderBrowserChecks({page,report,out}){
 const original=await page.evaluate(()=>JSON.stringify(window.runnerRuntimeProbe.session.profile));
 await page.setViewportSize({width:1600,height:1000});
 await page.evaluate(async()=>{
  const {RunSimulation}=await import('/src/game/simulation.ts'),world=window.runnerWorldProbe;
  const saved={callbacks:world.engine._activeRenderLoops.slice(),phase:document.body.dataset.phase,worldHidden:document.querySelector('#world').hidden,shopHidden:document.querySelector('#shop-world').hidden};
  world.engine.stopRenderLoop();world.setMode('run');document.body.dataset.phase='RUNNING';document.querySelector('#world').hidden=false;document.querySelector('#shop-world').hidden=true;document.querySelector('#overlay').style.visibility='hidden';
  const profile=structuredClone(window.runnerRuntimeProbe.session.profile);for(const [slot,id]of [['weapon','fast_reel'],['body','conductor_cuffs'],['legs','side_step_boots'],['talisman','debt_clock']])profile.loadouts.pudge[slot]=profile.items.find(i=>i.definitionId===id).id;world.setEquipment(profile);
  const qa={world,RunSimulation,saved,sim:new RunSimulation('boss-visual-qa',42,{config:{spawning:false},initialEnemies:[{id:'boss-visual',kind:'boss',x:0,z:25,shooting:null}]})};
  qa.sim.resume();qa.draw=()=>{world.engine.beginFrame();world.render(qa.sim,{x:0,z:qa.sim.state.hero.z+20},0);world.engine.endFrame();};
  world.engine.runRenderLoop(qa.draw);window.runnerRenderQA=qa;
 });
 try{
  const stages=[];
  for(let cast=0;cast<3;cast++){
   const result=await page.evaluate(()=>{
    const q=window.runnerRenderQA;let events=[];
    const tick=commands=>{q.sim.step(commands);events.push(...q.sim.state.events);q.world.engine.beginFrame();q.world.render(q.sim,{x:0,z:q.sim.state.hero.z+20},1/60);q.world.engine.endFrame();};
    for(let n=0;!q.sim.canCast&&n<240;n++)tick([]);
    const boss=q.sim.state.enemies.find(e=>e.id==='boss-visual');tick([{type:'cast',aim:{x:boss.x,z:boss.z}}]);
    for(let n=0;!events.some(e=>e.type==='hit')&&n<120;n++)tick([]);
    const hits=events.filter(e=>e.type==='hit'),enemy=q.sim.state.enemies.find(e=>e.id==='boss-visual');
    return{hits,marks:q.world.threats.enemies.get('boss-visual').marks.filter(m=>m.isEnabled()).length,status:enemy.status,remaining:enemy.hitsRemaining,clip:q.world.timeline.enemy(enemy,q.sim.state.time,q.sim.config.bossTelegraph,clip=>q.world.enemies.get(enemy.id).clipDuration(clip))};
   });
   assert.equal(result.hits.length,1);assert.equal(result.hits[0].lethal,cast===2);assert.equal(result.marks,cast===2?0:2-cast);stages.push(result);
   await page.screenshot({path:resolve(out,`boss-hit-${cast+1}.png`)});
  }
  assert.equal(new Set(stages.map(s=>s.hits[0].castId)).size,3);assert.equal(stages[2].status,'captured');report.bossVisual=stages;
  const shooter=await page.evaluate(()=>{
   const q=window.runnerRenderQA;q.sim=new q.RunSimulation('shooter-visual-qa',42,{config:{spawning:false},initialEnemies:[{id:'shooter-visual',kind:'strong',x:0,z:20,shooting:{phase:'cooldown',remaining:0,directions:[]}}]});q.sim.resume();
   const tick=commands=>{q.sim.step(commands);q.world.engine.beginFrame();q.world.render(q.sim,{x:0,z:q.sim.state.hero.z+20},1/60);q.world.engine.endFrame();};
   for(let n=0;n<49;n++)tick([]);const bullet=q.sim.state.projectiles[0].id,enemy=q.sim.state.enemies[0];tick([{type:'cast',aim:{x:enemy.x,z:enemy.z}}]);for(let n=0;n<30;n++)tick([]);
   return{kills:q.sim.state.kills.strong,bulletExists:q.sim.state.projectiles.some(p=>p.id===bullet),bulletRendered:q.world.threats.bullets.get(bullet)?.isEnabled()===true,native:q.world.threats.native.size};
  });
  assert.equal(shooter.kills,1);assert(shooter.bulletExists&&shooter.bulletRendered);report.shooterVisual=shooter;await page.screenshot({path:resolve(out,'shooter-released-projectile.png')});
  const seams=await page.evaluate(()=>{
   const q=window.runnerRenderQA;q.sim=new q.RunSimulation('seams-visual-qa',42,{config:{spawning:false}});q.sim.resume();
   return[0,11.999,12,107.999,108,10000,10000000].map(distance=>{
    q.sim.state.hero.z=distance;q.sim.state.distance=distance;q.draw();
    const roads=q.world.staticActors.filter(a=>a.root.name.startsWith('road-')&&a.root.parent?.name.startsWith('section-'));
    const ranges=roads.map(a=>{a.root.computeWorldMatrix(true);const b=a.root.getHierarchyBoundingVectors();return{min:b.min.z,max:b.max.z,y:[b.min.y,b.max.y]};}).sort((a,b)=>a.min-b.min);
    return{distance,sections:q.world.scenery.length,gaps:ranges.slice(1).map((r,i)=>r.min-ranges[i].max),ranges};
   });
  });
  for(const s of seams){assert.equal(s.sections,9);assert.equal(s.ranges.length,9);for(const gap of s.gaps)assert(Math.abs(gap)<1e-5,'Road gap '+gap);assert(s.ranges.every(r=>Math.abs(r.y[1])<1e-5));}
  report.longRoute=seams;await page.screenshot({path:resolve(out,'route-10000000m.png')});
  report.checks.push('Hardware WorldView: three real separate boss casts remove exactly one mark per hit and final capture differs from the nonlethal reaction');
  report.checks.push('Hardware WorldView: a projectile released by the shooter remains rendered after the shooter is killed');
  report.checks.push('Nine actual native road modules meet at zero gap and constant surface height through recycling boundaries and a 10000000 m coordinate fixture');
 }finally{
  await page.evaluate(()=>{const q=window.runnerRenderQA;q.world.engine.stopRenderLoop(q.draw);q.world.setEquipment(window.runnerRuntimeProbe.session.profile);document.body.dataset.phase=q.saved.phase;document.querySelector('#world').hidden=q.saved.worldHidden;document.querySelector('#shop-world').hidden=q.saved.shopHidden;document.querySelector('#overlay').style.visibility='';for(const callback of q.saved.callbacks)q.world.engine.runRenderLoop(callback);delete window.runnerRenderQA;});
 }
 assert.equal(await page.evaluate(()=>JSON.stringify(window.runnerRuntimeProbe.session.profile)),original,'Render QA must not mutate the authoritative profile');
}
