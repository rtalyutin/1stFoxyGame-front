import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export async function performanceChecks({page,report,out}){
 const target=JSON.parse(readFileSync(resolve('../../docs/g-perf-target.json'),'utf8').replace(/^\uFEFF/,''));
 const hardware=await page.evaluate(()=>{
  const world=window.runnerWorldProbe,gl=world.engine._gl,ext=gl.getExtension('WEBGL_debug_renderer_info');
  return{renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),version:gl.getParameter(gl.VERSION),dpr:devicePixelRatio};
 });
 assert(!/swiftshader|llvmpipe|software|basic render/i.test(hardware.renderer),'Hardware acceptance cannot use '+hardware.renderer);
 assert.equal(hardware.dpr,1);report.renderer=hardware.renderer;
 const results=[];
 for(const viewport of target.viewports){
  await page.setViewportSize(viewport);
  for(const mode of ['combat-max','shop','workshop']){
   if(mode==='workshop'){
    await page.locator('#open-workshop').click();await page.waitForFunction(()=>window.runnerWorkshopProbe.ready&&!document.querySelector('#workshop-tap').disabled);
   }
   const metric=await page.evaluate(async({mode,duration})=>{
    const world=window.runnerWorldProbe,shop=window.runnerShopProbe,workshop=window.runnerWorkshopProbe;
    const originalPhase=document.body.dataset.phase,originalWorldHidden=document.querySelector('#world').hidden,originalShopHidden=document.querySelector('#shop-world').hidden;
    const callbacks=world.engine._activeRenderLoops.slice();world.engine.stopRenderLoop();
    let engine=mode==='combat-max'?world.engine:mode==='shop'?shop.engine:workshop.engine;
    let scene=mode==='combat-max'?world.scene:mode==='shop'?shop.scene:workshop.scene;
    let fixture=null;
    if(mode==='combat-max'){
     const {RunSimulation}=await import('/src/game/simulation.ts');
     const {computeModifiers}=await import('/src/game/equipment.ts');
     const state=window.runnerRuntimeProbe.session,p=structuredClone(state.profile),config=state.pinnedBalance.compiled.config;
     for(const [slot,id,level]of [['weapon','long_link',1],['body','conductor_cuffs',3],['legs','side_step_boots',3],['talisman','debt_clock',1]])p.loadouts.pudge[slot]=p.items.find(i=>i.definitionId===id&&i.level===level).id;
     world.setEquipment(p);world.setMode('run');
     const initialEnemies=Array.from({length:config.maxEnemies},(_,i)=>({id:'max-'+i,kind:i<config.maxBosses?'boss':i<config.maxBosses+config.maxShooters?'strong':'normal',x:(i%3-1)*2.4,z:8+i*2.4}));
     fixture=new RunSimulation('performance',19,{config:{...config,spawning:false},initialEnemies});fixture.setEquipment(computeModifiers(p,state.catalog,state.pinnedBalance.compiled.baseModifiers));fixture.resume();
     fixture.step([{type:'cast',aim:{x:0,z:35}}]);fixture.state.hero.z=10000;fixture.state.distance=10000;
     for(const enemy of fixture.state.enemies){enemy.z+=10000;if(enemy.shooting){enemy.shooting.phase='telegraph';enemy.shooting.remaining=1;enemy.shooting.directions=[{x:-.2,z:-1},{x:0,z:-1},{x:.2,z:-1}];}}
     fixture.state.hook.z=10000+fixture.state.hook.config.range-.1;fixture.state.hook.traveled=fixture.state.hook.config.range-.1;
     fixture.state.projectiles=Array.from({length:config.maxProjectiles},(_,i)=>({id:'max-bullet-'+i,sourceEnemyId:'max-0',x:(i%6-2.5)*1.2,z:10005+Math.floor(i/6)*4,velocity:{x:0,z:-8},radius:config.projectileRadius,lifetimeRemaining:8}));
     document.body.dataset.phase='RUNNING';document.querySelector('#world').hidden=false;document.querySelector('#shop-world').hidden=true;document.querySelector('#overlay').style.visibility='hidden';
    }
    const benchmarkId=crypto.randomUUID();
    engine.resize();let previous=performance.now(),start=previous,samples=[],cpu=[],draw=[],effectEpoch=0,lootMax=0;
    await new Promise(resolve=>{
     const frame=now=>{
      const delta=(now-previous)/1000;previous=now;
      const before=performance.now();
      engine.beginFrame();engine._drawCalls?.fetchNewFrame();
      if(mode==='combat-max'){
       fixture.state.time+=delta;fixture.state.tick++;
       const epoch=Math.floor((now-start)/900);if(epoch>effectEpoch){effectEpoch=epoch;world.confirmRewards('perf-receipt-fixture-'+benchmarkId+'-'+epoch,fixture.state.enemies.map((e,i)=>({enemyId:e.id,kind:e.kind,at:fixture.state.time,goldMilli:'5000',components:{steel:1,ember:1,core:0},...(i===0?{clockGoldMilli:'3000',clockSeconds:30}:{})})));}
       lootMax=Math.max(lootMax,world.rewardEffects.length);world.render(fixture,{x:0,z:10035},delta);
      }
      else if(mode==='shop')shop.render(delta);else workshop.renderFrame(delta);
      engine.endFrame();
      const elapsed=now-start;if(elapsed>3000){samples.push(delta*1000);cpu.push(performance.now()-before);draw.push(engine._drawCalls?.current??null);}
      if(elapsed<duration)requestAnimationFrame(frame);else resolve();
     };requestAnimationFrame(frame);
    });
    const percentile=(data,p)=>data.slice().sort((a,b)=>a-b)[Math.min(data.length-1,Math.ceil(data.length*p)-1)];
    const result={mode,samples:samples.length,p95Ms:percentile(samples,.95),p99Ms:percentile(samples,.99),maxMs:Math.max(...samples),framesWithinThreshold:samples.filter(n=>n<=33.3).length/samples.length,cpuP95Ms:percentile(cpu,.95),drawCallsMax:Math.max(...draw.filter(n=>n!==null)),renderBuffer:[engine.getRenderWidth(),engine.getRenderHeight()],meshes:scene.meshes.length,activeMeshes:scene.getActiveMeshes().length,textures:scene.textures.length,textureTexels:scene.textures.reduce((n,t)=>{const s=t.getSize();return n+s.width*s.height;},0),gpuTimings:'Not sampled; frame intervals and CPU submission measured',load:fixture?{enemies:fixture.state.enemies.length,shooters:fixture.state.enemies.filter(e=>e.kind==='strong').length,bosses:fixture.state.enemies.filter(e=>e.kind==='boss').length,projectiles:fixture.state.projectiles.length,chainLinks:world.links.filter(a=>a.root.isEnabled()).length,hookRange:fixture.state.hook.config.range,distance:fixture.state.distance,slots:4,lootEffectsMax:lootMax,receiptFixture:'Synthetic render-load receipt; does not change authoritative wallet; real clock API verified separately'}:null};
    window.restoreRunnerBenchmark=()=>{
     for(const cb of callbacks)world.engine.runRenderLoop(cb);
     if(fixture){window.runnerPerformanceSnapshot=fixture;document.querySelector('#overlay').style.visibility='';document.body.dataset.phase=originalPhase;document.querySelector('#world').hidden=originalWorldHidden;document.querySelector('#shop-world').hidden=originalShopHidden;world.setEquipment(window.runnerRuntimeProbe.session.profile);}
    };
    return result;
   },{mode,duration:13000});
   metric.viewport=viewport;metric.pass=metric.framesWithinThreshold>=.95;results.push(metric);
   if(mode==='combat-max')assert.equal(metric.load.lootEffectsMax,24,'Max-load acceptance must include native reward effects on each viewport');
   await page.screenshot({path:resolve(out,`hardware-${mode}-${viewport.width}.png`)});await page.evaluate(()=>window.restoreRunnerBenchmark());
   console.log('G-PERF',viewport,mode,metric.p95Ms,metric.framesWithinThreshold,metric.load);
   if(mode==='workshop'){await page.screenshot({path:resolve(out,`hardware-workshop-${viewport.width}.png`)});await page.locator('#workshop-return').click();await page.waitForFunction(()=>document.body.dataset.phase==='SHOP');}
  }
 }
 const perf={status:results.every(r=>r.pass)?'HARDWARE_G_PERF_PASS':'HARDWARE_G_PERF_FAIL',target,hardware,browser:report.browser,measurement:'requestAnimationFrame intervals after 3 s warm-up; 10 s sample per scene/viewport; actual WebGL renderer verified',results};
 writeFileSync(resolve('../../docs/g-perf-results.json'),JSON.stringify(perf,null,2)+'\n');report.performance=perf;
 assert(results.every(r=>r.pass),'G-PERF failed '+JSON.stringify(results.filter(r=>!r.pass)));
}
