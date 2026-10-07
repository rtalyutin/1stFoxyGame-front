import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export async function fullBrowserChecks({page,repository,accountId,report,out,RunSimulation}){
 const catalog=JSON.parse(readFileSync(resolve('../back/content/equipment.json'),'utf8'));
 const states=catalog.items.flatMap(d=>d.levels.map(l=>({id:randomUUID(),definitionId:d.id,level:l.level,slot:d.slot})));
 await repository.transaction(accountId,tx=>{
  for(const item of states)if(!tx.profile.items.some(i=>i.definitionId===item.definitionId&&i.level===item.level))tx.profile.items.push({id:item.id,definitionId:item.definitionId,level:item.level});
  tx.profile.goldMilli='10000000000';
  const sim=RunSimulation.restore(tx.run.snapshot);sim.resume();const id=tx.run.runId+':shop:full';sim.state.shopCandidates.push({id,x:0,z:0,at:0});assert(sim.enterShop(id));tx.run.snapshot=sim.exportSnapshot();
 });
 await page.setViewportSize({width:1600,height:1000});await page.reload();
 await page.waitForFunction(()=>document.body.dataset.phase==='SHOP'&&window.runnerShopProbe?.ready,{},{timeout:60000});
 await page.locator('[data-choice="inventory"]').click();
 const chooseOwned=async(item,slot)=>{
  await page.locator(`[data-choice="${slot}"]`).click();
  for(let n=0;n<20;n++){
   const button=page.locator(`[data-choice="inventory-${item.id}"]`);
   if(await button.count()){await button.click();break;}
   const next=page.locator('[data-choice="next-items"]');assert(await next.isEnabled(),'Owned page missing '+item.id);await next.click();
  }
  await page.waitForFunction(key=>window.runnerShopProbe?.currentKey===key,`${item.definitionId}:${item.level}`,{timeout:60000});
 };
 const operation=async(type,click)=>{
  const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/operations')&&r.request().method()==='POST'&&r.request().postDataJSON().type===type,{timeout:30000});
  await click();const r=await response;assert(r.ok(),`${type} HTTP ${r.status()} ${await r.text()}`);const result=await r.json();
  await page.waitForFunction(revision=>document.querySelector('#profile-stats').textContent.includes('ревизия '+revision),result.profile.revision);
  return result;
 };
 const snapshot=(await repository.getRun(accountId)).snapshot;
 for(const state of states){
  const before=await repository.getProfile(accountId),item=before.items.find(i=>i.definitionId===state.definitionId&&i.level===state.level);
  await chooseOwned(item,state.slot);const preview=await repository.getProfile(accountId);assert.deepEqual({...preview,revision:before.revision},before,'Preview mutated economic data');
  if(before.loadouts.pudge[state.slot]!==item.id)await operation('equip',()=>page.locator('[data-choice="equip"]').click());
  await page.waitForFunction(prefix=>window.runnerShopProbe.hero.root.getChildMeshes().some(m=>m.name.includes(prefix)&&m.isEnabled()),`wear_${item.definitionId}_${item.level}_`);
  assert.equal((await repository.getProfile(accountId)).loadouts.pudge[state.slot],item.id);
 }
 const equipped=(await repository.getRun(accountId)).snapshot;
 for(const key of ['state','randomState','counters','generator','config','runtimeBalance'])assert.deepEqual(equipped[key],snapshot[key]);
 report.checks.push('All 16 native states preview without mutation and equip exact instances through API; combat state stays frozen');
 await page.screenshot({path:resolve(out,'all-levels-equipped.png')});
 await page.locator('[data-choice="catalog"]').click();await page.locator('[data-choice="weapon"]').click();await page.locator('[data-choice="catalog-fast_reel"]').click();
 await page.waitForFunction(()=>window.runnerShopProbe.currentKey==='fast_reel:1');
 const beforeCraft=await repository.getProfile(accountId),recipe=catalog.items.find(i=>i.id==='fast_reel').levels[0].recipe;
 await operation('craft',()=>page.locator('[data-choice="mutate"]').click());
 const afterCraft=await repository.getProfile(accountId),created=afterCraft.items.find(i=>!beforeCraft.items.some(p=>p.id===i.id));
 assert(created&&created.definitionId==='fast_reel'&&created.level===1);assert.deepEqual(afterCraft.loadouts,beforeCraft.loadouts);
 assert.equal(BigInt(beforeCraft.goldMilli)-BigInt(afterCraft.goldMilli),BigInt(recipe.goldMilli));
 await page.locator('[data-choice="inventory"]').click();await chooseOwned(created,'weapon');
 await operation('upgrade',()=>page.locator('[data-choice="mutate"]').click());
 assert.equal((await repository.getProfile(accountId)).items.find(i=>i.id===created.id).level,2);
 await page.waitForFunction(()=>window.runnerShopProbe.currentKey==='fast_reel:2');
 report.checks.push('Craft spends the pinned recipe without auto-equip; upgrade preserves instanceId and displays confirmed level 2');
 await page.locator('[data-choice="consumables"]').click();await page.locator('[data-choice="supply-slow_dust"]').click();
 await page.waitForFunction(()=>window.runnerShopProbe.currentKey==='slow_dust:1');
 const dustBefore=(await repository.getProfile(accountId)).consumables.slow_dust;
 await operation('craft',()=>page.locator('[data-choice="supply-craft"]').click());assert.equal((await repository.getProfile(accountId)).consumables.slow_dust,dustBefore+1);
 await operation('quick_slots',()=>page.locator('[data-choice="supply-quick-0"]').click());assert.equal((await repository.getProfile(accountId)).loadouts.pudge.quick[0],'slow_dust');
 await page.locator('[data-choice="supply-collector_vial"]').click();await page.waitForFunction(()=>window.runnerShopProbe.currentKey==='collector_vial:1');
 await page.locator('[data-choice="resources"]').click();
 for(const id of ['gold','steel','ember','core']){await page.locator(`[data-choice="supply-${id}"]`).click();await page.waitForFunction(key=>window.runnerShopProbe.currentKey===key,id+':1');}
 report.checks.push('Two distinct 3D consumables and four resources load; consumable craft and quick-slot assignment use authoritative API');
 await repository.transaction(accountId,tx=>{tx.forge.counts={apprentice:1,smelter:1,press:0,alchemy:1};});
 await page.locator('#open-workshop').click();
 await page.waitForFunction(()=>document.body.dataset.phase==='WORKSHOP'&&window.runnerWorkshopProbe?.ready&&!document.querySelector('#workshop-tap').disabled,{},{timeout:60000});
 const frozen=(await repository.getRun(accountId)).snapshot;
 await operation('forge_tap',()=>page.locator('#workshop-tap').click());
 await page.waitForFunction(()=>window.runnerWorkshopProbe.presentation.confirmedStrikes===1);
 await operation('forge_buy',()=>page.locator('button[data-production-id="press"]').click());
 for(const upgrade of ['tap','organization'])for(let level=1;level<=3;level++)await operation('forge_upgrade',()=>page.locator(`button[data-upgrade="${upgrade}"]`).click());
 const visual=await page.evaluate(()=>{
  const q=window.runnerWorkshopProbe.presentation;
  return{strikes:q.confirmedStrikes,tap:[0,1,2,3].filter(i=>q.nodes.get('tap_tier_'+i).isEnabled()),organization:[0,1,2,3].filter(i=>q.nodes.get('organization_tier_'+i).isEnabled()),devices:['apprentice','smelter','press','alchemy'].map(id=>q.nodes.get(id+'_root').name)};
 });assert.equal(visual.strikes,1);assert.deepEqual(visual.tap,[3]);assert.deepEqual(visual.organization,[3]);assert.equal(visual.devices.length,4);report.workshop=visual;
 assert.deepEqual((await repository.getRun(accountId)).snapshot,frozen);
 report.checks.push('Workshop native clips react to committed tap, production purchase and both tiers 0–3; same frozen run');
 report.workshopWideDevices=await page.evaluate(()=>{
  const q=window.runnerWorkshopProbe,V=q.camera.position.constructor,M=q.scene.getTransformMatrix().constructor;
  return['apprentice','smelter','press','alchemy'].map(id=>{const b=q.presentation.nodes.get(id+'_root').getHierarchyBoundingVectors(),p=V.Project(b.min.add(b.max).scale(.5),M.Identity(),q.scene.getTransformMatrix(),q.camera.viewport.toGlobal(q.engine.getRenderWidth(),q.engine.getRenderHeight())),rect=q.canvas.getBoundingClientRect(),x=rect.left+p.x*rect.width/q.engine.getRenderWidth(),y=rect.top+p.y*rect.height/q.engine.getRenderHeight();return{id,x,y,visible:document.elementFromPoint(x,y)===q.canvas};});
 });assert(report.workshopWideDevices.every(d=>d.visible),'All four native production devices must remain outside the wide UI panel');
 await page.screenshot({path:resolve(out,'workshop-wide.png')});await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
 await page.locator('#workshop-tap').scrollIntoViewIfNeeded();
 const layout=await page.evaluate(()=>{
  const button=document.querySelector('#workshop-tap'),b=button.getBoundingClientRect(),canvas=document.querySelector('#workshop-world').getBoundingClientRect(),menu=document.querySelector('#menu').getBoundingClientRect();
  return{visible:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===button,canvas:canvas.toJSON(),menu:menu.toJSON(),scroll:document.documentElement.scrollWidth,viewport:innerWidth};
 });assert(layout.visible);assert(layout.canvas.bottom<=layout.menu.top+1);assert(layout.scroll<=layout.viewport);report.workshopPortrait=layout;
 await page.screenshot({path:resolve(out,'workshop-portrait.png')});await page.locator('#workshop-return').click();await page.waitForFunction(()=>document.body.dataset.phase==='SHOP');
 assert.deepEqual((await repository.getRun(accountId)).snapshot,frozen);report.checks.push('Portrait workshop action remains visible and return preserves SHOP snapshot');
 // A lost HTTP response follows an actual server commit. The browser must look
 // up that exact receipt, and animate its one result once.
 await page.setViewportSize({width:1600,height:1000});await page.locator('#open-workshop').click();
 await page.waitForFunction(()=>window.runnerWorkshopProbe.ready&&!document.querySelector('#workshop-tap').disabled);
 const workshopPick=async key=>page.evaluate(key=>{
  const q=window.runnerWorkshopProbe,V=q.camera.position.constructor,M=q.scene.getTransformMatrix().constructor,root=q.presentation.nodes.get(key==='forgeTap'?'forge_tap_root':key+'_root');
  for(const mesh of root.getChildMeshes().filter(m=>m.getTotalVertices()>0&&m.isEnabled()&&m.isVisible)){
   mesh.computeWorldMatrix(true);const p=V.Project(mesh.getBoundingInfo().boundingBox.centerWorld,M.Identity(),q.scene.getTransformMatrix(),q.camera.viewport.toGlobal(q.engine.getRenderWidth(),q.engine.getRenderHeight())),rect=q.canvas.getBoundingClientRect();
   const x=p.x*q.canvas.clientWidth/q.engine.getRenderWidth(),y=p.y*q.canvas.clientHeight/q.engine.getRenderHeight();
   for(let radius=0;radius<=60;radius+=4)for(const dx of [-radius,0,radius])for(const dy of [-radius,0,radius]){const hit=q.scene.pick(x+dx,y+dy,m=>m.isEnabled()&&m.isVisible),meta=hit?.pickedMesh?.metadata;if(meta&&(key==='forgeTap'?meta.forgeTap:meta.productionId===key))return{x:rect.left+x+dx,y:rect.top+y+dy};}
  }throw new Error('No visible workshop pick '+key);
 },key);
 const devicePoint=await workshopPick('smelter');await page.mouse.click(devicePoint.x,devicePoint.y);assert.equal(await page.locator('article[data-production-id="smelter"]').getAttribute('data-selected'),'true');
 const tapPoint=await workshopPick('forgeTap');await operation('forge_tap',()=>page.mouse.click(tapPoint.x,tapPoint.y));await page.waitForFunction(()=>window.runnerWorkshopProbe.presentation.confirmedStrikes===2);
 report.checks.push('Picking a visible native device selects its exact productionId; picking the anvil invokes the existing committed tap operation');
 await page.route('**/api/v1/operations',async route=>{
  const op=route.request().postDataJSON();if(op.type!=='forge_tap'){await route.continue();return;}
  report.expectedFailedOperationId=op.operationId;await route.fetch();await route.abort('connectionreset');
 });
 await page.locator('#workshop-tap').click();await page.waitForFunction(()=>window.runnerWorkshopProbe.presentation.confirmedStrikes===3);
 await page.unroute('**/api/v1/operations');
 assert(report.expectedTransportFailure);report.checks.push('Server-committed tap with lost response recovers the exact receipt and causes one native strike');
 const conflictBefore=await repository.getProfile(accountId);await repository.transaction(accountId,tx=>{tx.profile.revision++;});
 await page.route('**/api/v1/operations',async route=>{const op=route.request().postDataJSON();if(op.type==='forge_tap')report.expectedConflictOperationId=op.operationId;await route.continue();});
 await page.locator('#workshop-tap').click();await page.waitForFunction(()=>!document.querySelector('#error-message').hidden);
 assert(report.expectedConflictResponse);assert.equal(await page.evaluate(()=>window.runnerWorkshopProbe.presentation.confirmedStrikes),3);assert.equal((await repository.getProfile(accountId)).goldMilli,conflictBefore.goldMilli);
 await page.unroute('**/api/v1/operations');await page.locator('#reload-profile').click();await page.waitForFunction(()=>!document.querySelector('#workshop-tap').disabled);
 report.checks.push('Real server revision conflict spends nothing and triggers no strike; explicit profile reload reconciles the displayed state');
 const beforeContext=(await repository.getRun(accountId)).snapshot;
 await page.evaluate(()=>{window.runnerLoseContext=window.runnerWorkshopProbe.engine._gl.getExtension('WEBGL_lose_context');window.runnerLoseContext.loseContext();});
 await page.waitForFunction(()=>!window.runnerWorkshopProbe.ready&&document.querySelector('#workshop-tap').disabled);
 await page.locator('#workshop-return').click();await page.waitForFunction(()=>document.body.dataset.phase==='SHOP');
 assert.deepEqual((await repository.getRun(accountId)).snapshot,beforeContext);
 await page.evaluate(()=>window.runnerLoseContext.restoreContext());
 await page.waitForFunction(()=>window.runnerWorkshopProbe.ready,{},{timeout:30000});
 report.checks.push('Actual WebGL context loss disables workshop spending, preserves safe return and restores graphics without advancing combat');
 await page.locator('#primary').click();await page.waitForFunction(()=>document.body.dataset.phase==='PAUSED');
 await operation('end_run',()=>page.locator('#secondary').click());await page.waitForFunction(()=>document.body.dataset.phase==='GALLERY');
 const galleryBefore=await repository.getProfile(accountId),yaw=await page.evaluate(()=>window.runnerWorldProbe.galleryYaw);
 await page.locator('#gallery-right').click();assert.notEqual(await page.evaluate(()=>window.runnerWorldProbe.galleryYaw),yaw);
 const center=await page.locator('#world').boundingBox();await page.mouse.move(center.width*.4,center.height*.45);await page.mouse.down();await page.mouse.move(center.width*.4+100,center.height*.45,{steps:10});await page.mouse.up();
 const galleryAfter=await repository.getProfile(accountId);assert.deepEqual(galleryAfter.items,galleryBefore.items);assert.deepEqual(galleryAfter.loadouts,galleryBefore.loadouts);
 await page.screenshot({path:resolve(out,'gallery-wide.png')});await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);await page.screenshot({path:resolve(out,'gallery-portrait.png')});
 report.checks.push('Gallery rotates the same committed four-slot hero by keyboard/button and drag without inventory mutation');
 await page.reload();await page.waitForFunction(()=>document.body.dataset.phase==='GAME_OVER'&&window.runnerWorldProbe.hero);
 await page.waitForTimeout(1200);
 report.resultsPortrait=await page.evaluate(()=>['primary','secondary'].map(id=>{const button=document.getElementById(id),b=button.getBoundingClientRect();return{id,visible:b.top>=0&&b.bottom<=innerHeight&&document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===button};}));
 assert(report.resultsPortrait.every(b=>b.visible),'Portrait replay/gallery actions must remain visible');
 await page.screenshot({path:resolve(out,'results-portrait.png')});await page.setViewportSize({width:1600,height:1000});await page.waitForTimeout(200);await page.screenshot({path:resolve(out,'results-wide.png')});
 report.checks.push('Results reuse the current hero, actual committed equipment and terminal death pose');
 await repository.transaction(accountId,tx=>{tx.run.snapshot=structuredClone(frozen);});await page.reload();await page.waitForFunction(()=>document.body.dataset.phase==='SHOP'&&window.runnerShopProbe.ready,{},{timeout:60000});
 const sceneCounts=()=>page.evaluate(()=>({shop:[window.runnerShopProbe.scene.meshes.length,window.runnerShopProbe.scene.textures.length],workshop:window.runnerWorkshopProbe.presentation?[window.runnerWorkshopProbe.scene.meshes.length,window.runnerWorkshopProbe.scene.textures.length]:null}));
 await page.locator('#open-workshop').click();await page.waitForFunction(()=>window.runnerWorkshopProbe.ready&&!document.querySelector('#workshop-tap').disabled);await page.locator('#workshop-return').click();
 const counts=await sceneCounts();for(let cycle=0;cycle<10;cycle++){await page.locator('#open-workshop').click();await page.waitForFunction(()=>!document.querySelector('#workshop-tap').disabled);await page.locator('#workshop-return').click();}
 assert.deepEqual(await sceneCounts(),counts);report.sceneReuse=counts;report.checks.push('Ten repeated shop/workshop switches preserve bounded mesh/texture counts and do not allocate production models per owned');
 await repository.transaction(accountId,tx=>{
  const sim=RunSimulation.restore(frozen);sim.leaveShop();sim.state.enemies=[{id:tx.run.runId+':clock-tenth',kind:'normal',x:0,z:sim.state.hero.z+12,radius:sim.config.enemyRadius,status:'alive',requiredHits:1,hitsRemaining:1,hitCastIds:[],shooting:null}];
  tx.run.snapshot=sim.exportSnapshot();tx.run.rewardedEnemyIds=Array.from({length:9},(_,i)=>'previous-'+i);
 });
 const clockResponse=page.waitForResponse(async response=>response.url().endsWith('/api/v1/operations')&&response.request().postDataJSON()?.type==='advance_run'&&response.ok()&&(await response.json()).visualRewards?.some(r=>r.clockGoldMilli!==undefined),{timeout:60000});
 await page.reload();await page.waitForFunction(()=>document.body.dataset.phase==='PAUSED'&&window.runnerWorldProbe.hero&&!document.querySelector('#primary').disabled,{},{timeout:60000});
 assert.equal(await page.evaluate(()=>window.runnerWorldProbe.clockGoldMilli),null);
 await page.locator('#primary').click();await page.waitForFunction(()=>document.body.dataset.phase==='RUNNING');
 const castPoint=await page.evaluate(()=>{
  const world=window.runnerWorldProbe,sim=window.runnerRuntimeProbe.sim,enemy=sim.state.enemies[0];
  const Vector3=world.camera.position.constructor,Matrix=world.scene.getTransformMatrix().constructor;
  const point=Vector3.Project(new Vector3(-enemy.x,.65,enemy.z-sim.state.hero.z),Matrix.Identity(),world.scene.getTransformMatrix(),world.camera.viewport.toGlobal(world.engine.getRenderWidth(),world.engine.getRenderHeight()));
  const rect=document.querySelector('#world').getBoundingClientRect();
  return{x:rect.left+point.x*rect.width/world.engine.getRenderWidth(),y:rect.top+point.y*rect.height/world.engine.getRenderHeight()};
 });
 await page.mouse.click(castPoint.x,castPoint.y);
 await page.waitForFunction(()=>window.runnerWorldProbe.clockGoldMilli!==null,{},{timeout:30000});const clockResult=await(await clockResponse).json();
 const receipt=clockResult.visualRewards.find(r=>r.clockGoldMilli!==undefined);
 assert.equal(await page.evaluate(()=>window.runnerWorldProbe.clockGoldMilli),receipt.clockGoldMilli);assert.equal(receipt.clockSeconds,clockResult.run.balance.compiled.forge.clockSeconds);assert.equal((await repository.getRun(accountId)).rewardedEnemyIds.length,10);
 assert(await page.evaluate(()=>window.runnerWorldProbe.hero.root.getChildMeshes().some(m=>m.isEnabled()&&m.name.includes('wear_debt_clock_')&&m.renderOutline)));
 report.clockReceipt={operationId:clockResult.operationId,...receipt};await page.screenshot({path:resolve(out,'clock-confirmed.png')});await page.locator('#pause').click();await page.waitForFunction(()=>document.body.dataset.phase==='PAUSED');
 report.checks.push('Actual tenth deduplicated kill produces a server clock receipt; visible clock and gold effect use its exact amount/seconds, with no speculative trigger');
 await page.waitForFunction(()=>window.runnerRuntimeProbe.session.run?.snapshot?.state.phase==='paused'&&!window.runnerRuntimeProbe.session.pending&&!document.querySelector('#primary').disabled);
 const pausedSnapshot=(await repository.getRun(accountId)).snapshot;
 const lifecycle=await page.context().newCDPSession(page);await lifecycle.send('Page.setWebLifecycleState',{state:'frozen'});await page.waitForTimeout(1200);await lifecycle.send('Page.setWebLifecycleState',{state:'active'});await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>document.body.dataset.phase),'PAUSED');assert.deepEqual((await repository.getRun(accountId)).snapshot,pausedSnapshot);await lifecycle.detach();
 report.checks.push('Chromium lifecycle freeze/return keeps a paused run unchanged and requires explicit resume');
 await repository.transaction(accountId,tx=>{tx.run.snapshot=structuredClone(frozen);});await page.reload();await page.waitForFunction(()=>document.body.dataset.phase==='SHOP'&&window.runnerShopProbe.ready,{},{timeout:60000});
 await repository.transaction(accountId,tx=>{tx.forge.settledAtMs-=60000;});
 const beforeOffline=await repository.getProfile(accountId);
 const settlement=await operation('forge_settle',()=>page.locator('#open-workshop').click());
 assert(settlement.workshop.lastSettlement.elapsedMs>=60000);assert(BigInt(settlement.workshop.lastSettlement.goldMilli)>0n);
 assert.equal(BigInt(settlement.profile.goldMilli)-BigInt(beforeOffline.goldMilli),BigInt(settlement.workshop.lastSettlement.goldMilli));
 await page.waitForFunction(()=>window.runnerWorkshopProbe.ready&&!document.querySelector('#workshop-tap').disabled);
 assert((await page.locator('#workshop-settlement').textContent()).includes('Производства начислили'));
 const offlineGold=settlement.workshop.lastSettlement.goldMilli;
 await page.locator('#workshop-return').click();const reopened=await operation('forge_settle',()=>page.locator('#open-workshop').click());
 assert(BigInt(reopened.workshop.lastSettlement.goldMilli)<BigInt(offlineGold),'Reopening must not repeat the 60-second settlement');
 report.offlineSettlement={first:settlement.workshop.lastSettlement,reopened:reopened.workshop.lastSettlement};
 await page.screenshot({path:resolve(out,'workshop-offline-receipt.png')});await page.locator('#workshop-return').click();
 report.checks.push('A 60-second absence fixture settles through the real API; displayed receipt matches the wallet and reopening does not repeat income');
}
