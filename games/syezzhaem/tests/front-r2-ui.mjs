// Author integration smoke: actual main/Babylon/IDB; HTTP fixtures do not certify Auth/API.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
const {chromium}=await import(process.env.R2_PLAYWRIGHT_MODULE??'playwright');
import {createInitial} from '../src/core.ts';
import {toSnapshotV1,CURRENT_BUILD_CONTEXT} from '../src/snapshot-v1.ts';
process.env.BUILD_ID='r2-route-001';
const vite=await createServer({server:{host:'127.0.0.1',port:8198,strictPort:true}});await vite.listen();
const browser=await chromium.launch({...(process.env.R2_CHROMIUM_PATH?{executablePath:process.env.R2_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--disable-dev-shm-usage']});
await mkdir('test-evidence',{recursive:true});
const session={user:{id:'front-author',email:'author@example.invalid',emailVerified:true,name:'Автор'},session:{id:'fixture',expiresAt:'2027-01-01T00:00:00Z'}};
const requests=[],errors=[];let active=null,profile={profile_id:'front-author',revision:0,display_name:'Автор',sound_enabled:true,sound_volume:.7,quality:'low',controls_hint_seen:false};
const context=await browser.newContext({viewport:{width:1280,height:800},hasTouch:true});
await context.route('**/api/syezzhaem/**',async route=>{
 const request=route.request(),op=new URL(request.url()).pathname.split('/').at(-1),body=request.postDataJSON?.()??{};
 if(op==='get-session'){await route.fulfill({json:session});return;}
 requests.push({op,body,owner:request.headers()['x-syezzhaem-expected-user']});let data;
 if(op==='bootstrap_v1')data={user_id:session.user.id,profile,active_run:active,catalog:[],compatible_versions:['r2-route-001']};
 else if(op==='run_start_v1'){const runId=crypto.randomUUID();active={run_id:runId,revision:0,lifecycle:'active',checkpoint:toSnapshotV1(createInitial(runId,'r2-map-1'),CURRENT_BUILD_CONTEXT),updated_at:new Date().toISOString(),started_at:new Date().toISOString()};data=active;}
 else if(op==='checkpoint_save_v1'||op==='run_finish_v1'){active={...active,checkpoint:body.snapshot,revision:body.expected_revision+1,lifecycle:op==='run_finish_v1'?body.outcome:'active',updated_at:new Date().toISOString()};data={revision:active.revision,updated_at:active.updated_at};}
 else if(op==='profile_update_v1'){profile={...profile,...body.settings,revision:body.expected_revision+1};data=profile;}
 else if(op==='run_get_v1')data=active;
 else if(op==='history_list_v1')data={items:[],next_cursor:null};
 else throw new Error('Unexpected HTTP fixture '+op);
 await route.fulfill({json:{ok:true,data,error:null,request_id:body.request_id??null}});
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const state=()=>page.evaluate(()=>window.__r1.state());
const commandCount=()=>page.evaluate(()=>window.__r1.commands());
async function hoverActor(key){const p=await page.evaluate(key=>window.__r1.projectActor(key),key);await page.mouse.move(p.x,p.y);await page.waitForFunction(()=>Boolean(window.__r1.itemTarget()));return p;}
try{
 await page.goto('http://127.0.0.1:8198/?test=1');await page.locator('#menu-panel').waitFor({state:'visible'});await page.locator('#new-game').click();await page.locator('#game-panel').waitFor({state:'visible'});assert.equal((await state()).contentVersion,'r2-map-1');
 await page.locator('#resume').click();await page.waitForFunction(()=>!window.__r1.paused());
 const before=await state();await page.waitForTimeout(250);assert.equal((await state()).tick,0);assert.equal((await state()).lava.x,before.lava.x);
 await page.screenshot({path:'test-evidence/r2-ui-initial-desktop.png'});
 // A canceled touch issues no command; each item tap issues exactly one.
 const touchSession=await context.newCDPSession(page),touchStart=(p,id=1)=>touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y,id}]});
 await page.locator('[data-mode="item"]').click();const chest=await page.evaluate(()=>window.__r1.projectActor('chest:supplies')),touchCount=await commandCount();
 await touchStart(chest);await touchSession.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal(await commandCount(),touchCount);assert.equal((await state()).player.heldActorKey,null);
 await page.touchscreen.tap(chest.x,chest.y);assert.equal((await state()).player.heldActorKey,'chest:supplies');assert.equal(await commandCount(),touchCount+1);
 const chestFloor=await page.evaluate(()=>window.__r1.project({space:'house',x:3,y:0}));await page.touchscreen.tap(chestFloor.x,chestFloor.y);assert.equal((await state()).player.heldActorKey,null);assert.equal(await commandCount(),touchCount+2);
 const left=await page.locator('[data-move="left"]').boundingBox();await touchStart({x:left.x+left.width/2,y:left.y+left.height/2});assert.equal(await page.evaluate(()=>window.__r1.input().left),true);await touchSession.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal(await page.evaluate(()=>window.__r1.input().left),false);
 await page.locator('[data-mode="take"]').click();
 // Separate PC action can pick an item even while the bridge introduction is frozen.
 await hoverActor('cat:companion');await page.keyboard.press('KeyE');assert.equal((await state()).player.heldActorKey,'cat:companion');
 const floor=await page.evaluate(()=>window.__r1.project({space:'house',x:2,y:0}));await page.mouse.move(floor.x,floor.y);await page.keyboard.press('KeyE');assert.equal((await state()).player.heldActorKey,null);assert.equal((await state()).actors.find(a=>a.kind==='cat').support.x,2);
 // Reproduce a route cell under the informational banner without changing the core state.
 // Move only the banner in this fixture; the real cell is picked by trusted touch through it.
 const overlap=await page.evaluate(()=>{const d=window.__r1,p=d.project(d.guide().target),point={x:p.x,y:p.y+16},banner=document.getElementById('objective');banner.style.cssText=`left:${point.x-150}px;top:${point.y-16}px;width:300px;height:36px`;const r=banner.getBoundingClientRect();return{point,banner:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},hit:document.elementFromPoint(point.x,point.y)?.id,markerPointer:getComputedStyle(document.getElementById('tutorial-marker')).pointerEvents,itemStatusPointer:getComputedStyle(document.getElementById('item-status')).pointerEvents};});
 assert.ok(overlap.point.x>overlap.banner.left&&overlap.point.x<overlap.banner.right&&overlap.point.y>overlap.banner.top&&overlap.point.y<overlap.banner.bottom);assert.equal(overlap.hit,'scene');assert.equal(overlap.markerPointer,'auto');assert.equal(overlap.itemStatusPointer,'none');
 const c=await commandCount();await page.touchscreen.tap(overlap.point.x,overlap.point.y);assert.equal(await commandCount(),c+1);assert.equal((await state()).inventory.wood,1);await page.evaluate(()=>document.getElementById('objective').removeAttribute('style'));
 // The guide remains interactive, completing the other three commands with one release each.
 for(let i=0;i<3;i++)await page.locator('#tutorial-marker').click();assert.equal(await commandCount(),c+4);assert.equal((await state()).tutorialPlacements,2);await page.waitForFunction(()=>window.__r1.state().tick>0);
 await page.keyboard.press('Digit2');assert.equal(await page.evaluate(()=>window.__r1.material()),'stone');await page.keyboard.press('Digit3');assert.equal(await page.evaluate(()=>window.__r1.material()),'slime');await page.locator('[data-material="wood"]').click();assert.equal(await page.evaluate(()=>window.__r1.material()),'wood');
 await page.locator('#pause').click();const paused=await state();await page.waitForTimeout(150);assert.equal((await state()).tick,paused.tick);assert.deepEqual(await page.evaluate(()=>window.__r1.input()),{left:false,right:false,jump:false});
 // Profile choice disables UI guards, never alters saved tutorial progression.
 await page.locator('#to-menu').click();await page.locator('#settings').click();await page.locator('#setting-hints').uncheck();await page.locator('#settings-form .primary').click();await page.waitForFunction(()=>document.querySelector('#settings-status').textContent.includes('подтверждены'));assert.equal(profile.controls_hint_seen,true);assert.equal((await state()).tutorialPlacements,2);
 await page.locator('#settings-panel [data-menu]').click();await page.locator('#tutorial').click();await page.locator('#tutorial-repeat').click();assert.equal(await page.locator('#setting-hints').isChecked(),true);await page.locator('#settings-form .primary').click();await page.waitForFunction(()=>document.querySelector('#settings-status').textContent.includes('подтверждены'));assert.equal(profile.controls_hint_seen,false);assert.equal((await state()).tutorialPlacements,2);
 await page.locator('#settings-panel [data-menu]').click();await page.locator('#continue').click();await page.locator('#resume').click();await page.waitForFunction(()=>!window.__r1.paused());
 // Saved authoritative hazards: visual timers are tied to their own block/actor.
 await page.evaluate(()=>{const d=window.__r1,s=d.state();s.blocks.find(b=>b.id==='original:7:3').burnTicks=120;const mob=s.actors.find(a=>a.kind==='mob');mob.x=s.house.x+6;mob.y=s.house.y+.5;mob.vx=mob.vy=0;mob.support=null;mob.state='armed';mob.fuseTicks=84;s.lava.x+=.75*(1500-s.tick)/60;s.tick=1500;d.setState(s);});
 await page.waitForFunction(()=>document.querySelectorAll('.hazard-label').length>=2);await page.waitForFunction(()=>window.__r1.audio().played>0);assert.equal(await page.evaluate(()=>window.__r1.audio().contextState),'running');await page.locator('#pause').click();await page.screenshot({path:'test-evidence/r2-ui-hazards-desktop.png'});
 await page.setViewportSize({width:844,height:390});await page.locator('#resume').click();await page.waitForFunction(()=>!window.__r1.paused());await page.screenshot({path:'test-evidence/r2-ui-hazards-landscape.png'});
 const boxes=await page.evaluate(()=>['movement','mode','bottom','hud'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return{id,x:r.x,y:r.y,right:r.right,bottom:r.bottom}}));for(const b of boxes){assert.ok(b.x>=0&&b.right<=844&&b.y>=0&&b.bottom<=390,JSON.stringify(b));}
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>window.__r1.paused()&&!document.getElementById('portrait').hidden);const rotatedTick=(await state()).tick;await page.waitForTimeout(150);assert.equal((await state()).tick,rotatedTick);assert.deepEqual(await page.evaluate(()=>window.__r1.input()),{left:false,right:false,jump:false});
 assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.owner===session.user.id));
 console.log(JSON.stringify({browser:browser.version(),commands:await commandCount(),objectiveTouch:{...overlap,commandDelta:1},audio:await page.evaluate(()=>window.__r1.audio()),requests:requests.length,errors,scope:'author main/IDB/WebGL2/PC + trusted touch through objective/cancel + landscape/portrait; HTTP fixtures, software GPU, no physical phone/Auth/API evidence'}));
}finally{await context.close();await browser.close();await vite.close();}
