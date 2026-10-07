import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {buildApp} from '../../back/dist/app.js';
import {MemoryRepository} from '../../back/dist/profile/repository.js';
import {hashPassword} from '../../back/dist/profile/auth.js';
import {ProfileService} from '../../back/dist/profile/service.js';
import {RunSimulation} from '../../back/dist/combat/simulation.js';
import {fullBrowserChecks} from './full-browser-checks.mjs';
import {performanceChecks} from './performance-checks.mjs';
import {renderBrowserChecks} from './render-browser-checks.mjs';

const full=process.argv.includes('--full');
const hardware=process.argv.includes('--hardware'),perf=process.argv.includes('--perf'),renderChecks=process.argv.includes('--render-checks');
const isolatedPorts=process.argv.includes('--isolated-ports'),frontendPort=isolatedPorts?5183:5173,apiPort=isolatedPorts?3003:3001;
const out=resolve(renderChecks?'../../docs/browser-render':hardware?'../../docs/browser-hardware':full?'../../docs/browser-full':'../../docs/browser-probe');mkdirSync(out,{recursive:true});
const repository=new MemoryRepository(),accountId=randomUUID(),clientId=randomUUID();
const password='local-browser-fixture-2026';
await repository.provision([{accountId,login:'browser.probe',passwordHash:await hashPassword(password)}]);
const service=new ProfileService(repository);
await service.perform(accountId,{operationId:randomUUID(),expectedRevision:0,clientId,type:'start_run',payload:{}});
const bootsA=randomUUID(),bootsB=randomUUID();
await repository.transaction(accountId,tx=>{
 tx.profile.goldMilli='100000000';tx.profile.components={steel:1000,ember:1000,core:1000};
 tx.profile.items=[{id:bootsA,definitionId:'side_step_boots',level:1},{id:bootsB,definitionId:'side_step_boots',level:1},...['fast_reel','conductor_cuffs','debt_clock'].map(definitionId=>({id:randomUUID(),definitionId,level:1}))];
 const sim=RunSimulation.restore(tx.run.snapshot);sim.resume();sim.state.shopCandidates.push({id:tx.run.runId+':shop:fixture',x:0,z:0,at:0});assert(sim.enterShop(tx.run.runId+':shop:fixture'));tx.run.snapshot=sim.exportSnapshot();
});
const app=buildApp({profileRepository:repository,secureCookies:false});
const server=await createServer({server:{host:'127.0.0.1',port:frontendPort,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:'+apiPort,changeOrigin:false}}}});
let browser;
const report={fixture:'In-memory test repository; actual R5 Fastify/ProfileService API; no PostgreSQL acceptance',checks:[],errors:[]};
try{
 await app.listen({host:'127.0.0.1',port:apiPort});await server.listen();
 browser=await chromium.launch({headless:true,executablePath:'C:/Users/rt/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',args:hardware?['--enable-gpu','--use-gl=angle','--use-angle=d3d11']:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 report.browser=browser.version();report.renderer='Chromium headless with SwiftShader; not target-device FPS acceptance';
 const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('requestfailed',r=>{const op=r.method()==='POST'?r.postDataJSON():null;if(op?.operationId&&op.operationId===report.expectedFailedOperationId){report.expectedTransportFailure={operationId:op.operationId,error:r.failure()?.errorText};return;}console.log('Failed request',r.url(),r.failure());report.errors.push(`${r.url()} ${r.failure()?.errorText}`);});
 page.on('response',r=>{if(r.status()===409&&r.request().postDataJSON()?.operationId===report.expectedConflictOperationId){report.expectedConflictResponse={operationId:report.expectedConflictOperationId,status:409};return;}if(r.status()>=400&&!r.url().endsWith('/favicon.ico')&&!(r.status()===401&&r.url().endsWith('/api/v1/session')))report.errors.push(`${r.status()} ${r.url()}`);});
 await page.addInitScript(id=>sessionStorage.setItem('foxy-r34-client',id),clientId);
 const coldStart=performance.now();await page.goto('http://127.0.0.1:'+frontendPort+'/?probe-qa');
 await page.locator('#login').fill('browser.probe');await page.locator('#password').fill(password);await page.locator('#login-submit').click();
 await page.waitForFunction(()=>document.body.dataset.phase==='SHOP');
 await page.waitForFunction(()=>window.runnerShopProbe?.ready,{},{timeout:60000});
 if(hardware)report.renderer=await page.evaluate(()=>{const gl=window.runnerWorldProbe.engine._gl,extension=gl.getExtension('WEBGL_debug_renderer_info');return extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
 await page.waitForFunction(()=>window.runnerShopProbe?.displays.has('side_step_boots'),{},{timeout:60000});
 report.coldLoadToUsableShopMs=performance.now()-coldStart;
 await page.locator('#shop-world').waitFor({state:'visible'});
 await page.waitForFunction(()=>!document.querySelector('#primary').disabled&&document.querySelector('#primary').textContent.includes('Выйти из магазина'),{},{timeout:60000});
 await page.waitForTimeout(250);await page.screenshot({path:resolve(out,'shop-loaded.png')});
 report.initialWear=await page.evaluate(()=>window.runnerShopProbe.hero.root.getChildMeshes().filter(m=>m.name.includes('wear_')).map(m=>({name:m.name,enabled:m.isEnabled(),parent:m.parent?.name})));
 report.actorNodes=await page.evaluate(()=>[...window.runnerShopProbe.hero.nodes.keys()]);
 assert(report.initialWear.every(m=>!m.enabled),'Unowned/unpreviewed equipment must be hidden');
 const before=await repository.getProfile(accountId),runBefore=await repository.getRun(accountId);
 const project=async name=>page.evaluate(async name=>{
  const q=window.runnerShopProbe,Vector3=q.camera.position.constructor,Matrix=q.scene.getTransformMatrix().constructor;
  const ownedId=name.startsWith('owned:')?name.slice(6):null;
  const root=name==='inspection'?q.inspector:ownedId?q.inventoryDisplays.get(ownedId).root:q.displays.get(name);root.computeWorldMatrix(true);
  for(const child of root.getChildMeshes())child.computeWorldMatrix(true);
  for(const mesh of root.getChildMeshes().filter(m=>m.isEnabled()&&m.isVisible&&m.getTotalVertices()>0)){
  const p=Vector3.Project(mesh.getBoundingInfo().boundingBox.centerWorld,Matrix.Identity(),q.scene.getTransformMatrix(),q.camera.viewport.toGlobal(q.engine.getRenderWidth(),q.engine.getRenderHeight()));
  const rect=q.canvas.getBoundingClientRect(),cx=p.x*q.canvas.clientWidth/q.engine.getRenderWidth(),cy=p.y*q.canvas.clientHeight/q.engine.getRenderHeight();
  // Hollow items can have an empty AABB center. Pick a rendered triangle.
  for(let radius=0;radius<=60;radius+=4)for(const dx of [-radius,0,radius])for(const dy of [-radius,0,radius]){
   const hit=q.scene.pick(cx+dx,cy+dy,m=>m.isEnabled()&&m.isVisible),meta=hit?.pickedMesh?.metadata;
   if(hit?.hit&&(name==='inspection'?meta?.inspection:ownedId?meta?.instanceId===ownedId:meta?.definitionId===name))return{x:rect.left+cx+dx,y:rect.top+cy+dy};
  }
  }
  throw new Error('No rendered pick surface '+name);
 },name);
 const bootPoint=await project('side_step_boots');report.bootPoint=bootPoint;report.hitElement=await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.id,bootPoint);console.log('Boot pick',bootPoint,report.hitElement);await page.mouse.click(bootPoint.x,bootPoint.y);
 await page.getByText('Примерка · имущество не изменено',{exact:true}).waitFor();
 assert.deepEqual(await repository.getProfile(accountId),before);report.checks.push('Direct mesh pick selects and previews without changing profile');
 const inspect=await project('inspection');const angle=await page.evaluate(()=>window.runnerShopProbe.inspector.rotation.y);
 await page.mouse.move(inspect.x,inspect.y);await page.mouse.down();await page.mouse.move(inspect.x+45,inspect.y,{steps:8});await page.mouse.up();
 assert.notEqual(await page.evaluate(()=>window.runnerShopProbe.inspector.rotation.y),angle);assert.deepEqual(await repository.getProfile(accountId),before);report.checks.push('Inspection drag rotates actual 3D geometry; no financial mutation');
 if(full){
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:inspect.x,y:inspect.y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:inspect.x,y:inspect.y,id:1},{x:inspect.x+70,y:inspect.y+15,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:inspect.x+35,y:inspect.y,id:1},{x:inspect.x+90,y:inspect.y+15,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  assert.deepEqual(await repository.getProfile(accountId),before);
  await page.locator('[data-choice="catalog-side_step_boots"]').focus();await page.keyboard.press('Space');
  assert.deepEqual(await repository.getProfile(accountId),before);report.checks.push('Chromium two-touch inspection gesture and keyboard selection preserve property; physical touchscreen not tested');
 }
 assert.deepEqual((await repository.getRun(accountId)).snapshot,runBefore.snapshot);
 await page.screenshot({path:resolve(out,'shop-wide-preview.png')});
 await page.locator('[data-choice="inventory"]').click();
 const ownedPoint=await project('owned:'+bootsB);await page.mouse.click(ownedPoint.x,ownedPoint.y);
 assert.equal(await page.locator(`[data-choice="inventory-${bootsB}"]`).getAttribute('aria-pressed'),'true');report.checks.push('Direct inventory mesh pick carries the exact instanceId of the second identical item');
 await page.locator('[data-choice="equip"]').click();await page.getByText('Реальная сборка',{exact:true}).waitFor();
 const after=await repository.getProfile(accountId);assert.equal(after.loadouts.pudge.legs,bootsB);assert.equal(after.goldMilli,before.goldMilli);assert.equal(after.revision,before.revision+1);
 report.checks.push('Explicit equip confirms the selected instance through the existing operation API');
 await page.screenshot({path:resolve(out,'shop-wide-equipped.png')});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
 await page.screenshot({path:resolve(out,'shop-portrait-equipped.png')});
 const layout=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth,canvas:document.querySelector('#shop-world').getBoundingClientRect().toJSON(),menu:document.querySelector('#menu').getBoundingClientRect().toJSON()}));
 assert(layout.scroll<=layout.viewport);report.layout=layout;
 // The exit stays outside the scrollable item details. It must never cover a
 // financial action on narrow screens, and the 3D Canvas keeps its own region.
 const remove=page.locator('[data-choice="unequip"]');
 await remove.scrollIntoViewIfNeeded();
 const narrow=await page.evaluate(()=>{
  const button=document.querySelector('[data-choice="unequip"]'),rect=button.getBoundingClientRect();
  const profile=document.querySelector('#profile-panel').getBoundingClientRect();
  const exit=document.querySelector('#primary').getBoundingClientRect(),canvas=document.querySelector('#shop-world').getBoundingClientRect(),menu=document.querySelector('#menu').getBoundingClientRect();
  return{button:rect.toJSON(),profile:profile.toJSON(),exit:exit.toJSON(),canvas:canvas.toJSON(),menu:menu.toJSON(),visible:document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)===button};
 });
 assert(narrow.visible,'Scrolled item action must have an unobstructed hit target');
 assert(narrow.button.top>=narrow.profile.top&&narrow.button.bottom<=narrow.profile.bottom+1);
 assert(narrow.profile.bottom<=narrow.exit.top);
 assert(narrow.canvas.bottom<=narrow.menu.top+1);
 report.narrowControls=narrow;report.checks.push('Narrow viewport keeps a scrollable item action unobstructed and exit outside the details, without covering the 3D Canvas');
 await page.screenshot({path:resolve(out,'shop-portrait-action.png')});
 // Confirmed equip changes the existing equipment modifiers. Combat state,
 // clocks, RNG and spawn counters must remain frozen.
 const equippedSnapshot=(await repository.getRun(accountId)).snapshot;
 for(const key of ['state','randomState','counters','generator','config','runtimeBalance'])assert.deepEqual(equippedSnapshot[key],runBefore.snapshot[key]);
 const enabledWear=await page.evaluate(()=>window.runnerShopProbe.hero.root.getChildMeshes().filter(m=>m.name.includes('wear_')&&m.isEnabled()).map(m=>m.name));
 assert(enabledWear.length&&enabledWear.every(n=>n.includes('wear_side_step_boots_')));report.enabledWear=enabledWear;
 report.checks.push('Combat clocks, positions, RNG and spawn counters frozen; only confirmed equipment modifiers change');
 await page.locator('#primary').click();await page.waitForFunction(()=>document.body.dataset.phase==='PAUSED');
 const runAfter=await repository.getRun(accountId);assert.equal(runAfter.snapshot.state.phase,'paused');assert.equal(runAfter.snapshot.state.time,runBefore.snapshot.state.time);assert.equal(runAfter.runId,runBefore.runId);report.checks.push('Exit preserves run and enters the existing pause');
 const battleWear=await page.evaluate(()=>{
  const engines=window.runnerShopProbe.engine.constructor.Instances,world=engines.flatMap(e=>e.scenes).find(s=>s.getNodeByName('hero'));
  return world.getNodeByName('hero').getChildMeshes().filter(m=>m.name.includes('wear_')&&m.isEnabled()).map(m=>m.name);
 });assert(battleWear.length&&battleWear.every(n=>n.includes('wear_side_step_boots_')));report.battleWear=battleWear;report.checks.push('Confirmed equipment carries into the actual WorldView hero after exiting the shop');
 if(full)await fullBrowserChecks({page,repository,accountId,clientId,report,out,RunSimulation});
 if(renderChecks)await renderBrowserChecks({page,report,out});
 if(perf)await performanceChecks({page,report,out});
 assert.equal(report.errors.length,0,report.errors.join('\n'));
 report.status=full?'LOCAL_BROWSER_FULL_PASS':'LOCAL_BROWSER_PROBE_PASS';
}catch(e){report.status='FAIL';report.failure=e.stack;process.exitCode=1;if(browser)try{await browser.contexts()[0].pages()[0].screenshot({path:resolve(out,'failure.png')});}catch{}console.error(e);}
finally{writeFileSync(resolve(out,'verification.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();await server.close();await app.close();await repository.close();}
