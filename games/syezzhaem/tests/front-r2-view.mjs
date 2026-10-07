import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
const {chromium}=await import(process.env.R2_PLAYWRIGHT_MODULE??'playwright');
const vite=await createServer({server:{host:'127.0.0.1',port:8197,strictPort:true}});await vite.listen();
const browser=await chromium.launch({...(process.env.R2_CHROMIUM_PATH?{executablePath:process.env.R2_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--disable-dev-shm-usage']});
await mkdir('test-evidence',{recursive:true});
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:8197/tests/fixtures/r2-view.html');await page.waitForFunction(()=>Boolean(window.fixture));
 const picks=await page.evaluate(()=>{const f=window.fixture,s=f.state();return s.actors.filter(a=>a.kind!=='mob').map(a=>{const p=f.projectActor(a.actorKey);return{key:a.actorKey,target:f.pickItem(p.x,p.y)}})});
 assert.ok(picks.length===2);for(const pick of picks)assert.equal(pick.target?.actorKey,pick.key);
 await page.screenshot({path:'test-evidence/r2-view-initial-desktop.png'});
 await page.evaluate(()=>{const f=window.fixture,s=f.state(),mob=s.actors.find(a=>a.kind==='mob');mob.x=s.house.x+7;mob.y=s.house.y+.5;mob.state='armed';mob.fuseTicks=60;s.lava.x=s.house.x+1;s.blocks.find(b=>b.portable&&b.material==='wood').burnTicks=90;f.set(s);f.render();});
 await page.screenshot({path:'test-evidence/r2-view-hazards-desktop.png'});await page.setViewportSize({width:844,height:390});await page.evaluate(()=>{window.fixture.view.resize();window.fixture.render();});await page.screenshot({path:'test-evidence/r2-view-hazards-landscape.png'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:browser.version(),picks,errors,environment:'author view-only WebGL2 fixture; software GPU, no Auth/API/phone evidence'}));
}finally{await browser.close();await vite.close();}
