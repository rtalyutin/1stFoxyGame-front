import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const output=resolve('test-results/hub');mkdirSync(output,{recursive:true});
const server=await createServer({configFile:'hub/vite.config.ts',server:{host:'127.0.0.1',port:5174}});
await server.listen();
const custom=process.env.HUB_BROWSER_EXECUTABLE_PATH;
const browser=await chromium.launch({headless:true,...(custom?{executablePath:custom,args:['--single-process','--no-zygote','--use-gl=angle','--use-angle=swiftshader']}:{})});
const results={browser:browser.version(),environment:'headless Linux; software GPU if using custom SwiftShader binary; not physical mobile QA',checks:[],measurements:[]};
const errors=[];
const page=await browser.newPage({viewport:{width:1920,height:1080},recordVideo:{dir:output,size:{width:1440,height:810}}});
page.on('pageerror',e=>errors.push(e.message));
const url='http://127.0.0.1:5174/hub/';
const ready=()=>page.waitForFunction(()=>window.hubDebug&&document.querySelectorAll('.card[data-world="ready"]').length>0);
const snapshot=()=>page.evaluate(()=>window.hubDebug.snapshot());
try {
  await page.goto(url+'?entry-test');await ready();
  await page.waitForFunction(()=>document.querySelectorAll('.card[data-world="ready"]').length===3);
  const centers=await page.evaluate(()=>[...document.querySelectorAll('.card')].map(c=>({
    id:c.dataset.id,dom:(c.getBoundingClientRect().left+c.getBoundingClientRect().right)/2-document.querySelector('canvas').getBoundingClientRect().left,
    projected:window.hubDebug.project(c.dataset.id,'screen_opening').x
  })));
  centers.forEach(c=>assert(Math.abs(c.dom-c.projected)<1,`3D/DOM center ${c.id}`));
  const before=await page.evaluate(()=>window.hubDebug.project('runner-forge','npc_runner'));
  await page.waitForTimeout(400);
  const after=await page.evaluate(()=>window.hubDebug.project('runner-forge','npc_runner'));
  assert(Math.abs(after.x-before.x)>1,'visible NPC moves without hover');
  await page.screenshot({path:resolve(output,'desktop.png'),fullPage:true});
  results.checks.push('Three actual living GLB worlds; NPC movement without interaction');
  results.measurements.push({scenario:'three visible worlds',...await snapshot()});
  let completed=0;await page.exposeFunction('recordEntry',()=>completed++);
  await page.evaluate(()=>window.addEventListener('hub:entry-complete',window.recordEntry));
  await page.getByRole('link',{name:'Играть',exact:true}).click();
  await page.waitForFunction(()=>document.body.dataset.entry==='ENTERING');
  await page.waitForTimeout(1300);await page.screenshot({path:resolve(output,'entering.png'),fullPage:true});
  await page.waitForFunction(()=>document.body.dataset.entry==='IDLE',null,{timeout:90000});
  assert.equal(completed,1);results.checks.push('One physical GLB entry, one completion, reset in test fixture');

  for(const width of [320,390,768,1024,1280,1920,2560]) {
    await page.setViewportSize({width,height:1080});await page.goto(url+'?fixture=10&entry-test');await ready();
    await page.waitForTimeout(100);
    const layout=await page.evaluate(()=> {
      const rail=document.getElementById('rail'),r=rail.getBoundingClientRect();
      const cards=[...document.querySelectorAll('.card')].map(c=>c.getBoundingClientRect());
      return {full:cards.filter(c=>c.left>=r.left-.75&&c.right<=r.right+.75).length,
        partial:cards.filter(c=>c.left<r.right&&c.right>r.right+.75).length,
        overflow:document.documentElement.scrollWidth>innerWidth,
        text:document.getElementById('position').textContent};
    });
    assert.equal(layout.full,width>=1280?3:width>=768?2:1,`full cards at ${width}`);
    assert.equal(layout.partial,1);assert.equal(layout.overflow,false);
    results.checks.push({width,...layout});
    if(width===390||width===1920)await page.screenshot({path:resolve(output,`catalog-10-${width}.png`),fullPage:true});
  }
  for(const count of [0,1,2,3,12]) {
    await page.goto(url+`?fixture=${count}&entry-test`);
    assert.equal(await page.locator('.card').count(),count);
    if(count)await ready();else assert(await page.getByText('Игры пока не добавлены.').isVisible());
  }
  await page.setViewportSize({width:1920,height:1080});await page.goto(url+'?fixture=12&entry-test');await ready();
  for(let pass=0;pass<2;pass++) {
    for(const key of ['End','Home']) {
      await page.locator('#rail').press(key);
      await page.waitForFunction(key=>Math.abs(rail.scrollLeft-(key==='End'?rail.scrollWidth-rail.clientWidth:0))<1,key);
      await page.waitForFunction(()=>!window.hubDebug.snapshot().states.includes('loading'));
      const s=await snapshot();assert(s.states.filter(x=>x==='active'||x==='ready-paused'||x==='loading').length<=6);
      results.measurements.push({scenario:`12 worlds pass ${pass} ${key}`,...s});
    }
  }
  results.checks.push('Two catalog sweeps: bounded resident worlds, no second engine');
  await page.route('**/models/hero.glb',async route=> {await new Promise(r=>setTimeout(r,1000));await route.continue();});
  await page.getByRole('link',{name:'Играть',exact:true}).click();
  await page.waitForFunction(()=>document.body.dataset.entry==='PREPARING');
  await page.locator('#rail').evaluate(el=>el.scrollTo({left:el.scrollWidth,behavior:'instant'}));
  assert.equal((await snapshot()).selected,'runner-forge');
  await page.getByRole('button',{name:'Отмена',exact:true}).click();
  await page.waitForTimeout(1400);assert.equal((await snapshot()).entry,'IDLE');
  await page.unroute('**/models/hero.glb');results.checks.push('Preparing pin + cancel ignores late hero load');
  await page.goto(url+'?entry-test');await ready();
  await page.waitForFunction(()=>document.querySelectorAll('.card[data-world="ready"]').length===3);
  await page.evaluate(()=>window.hubDebug.loseContext());
  await page.waitForFunction(()=>document.body.dataset.render==='fallback');
  await page.evaluate(()=>window.hubDebug.restoreContext());
  await page.waitForFunction(()=>document.body.dataset.render==='ready');await ready();
  assert.equal((await snapshot()).entry,'IDLE');results.checks.push('Context loss/restore recovers control without completion');
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);
  const still=await page.evaluate(()=>window.hubDebug.project('runner-forge','npc_runner'));await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(()=>window.hubDebug.project('runner-forge','npc_runner')),still);
  assert.equal((await snapshot()).rendering,false);results.checks.push('Reduced motion renders a static scene and stops the loop');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1280,height:320});
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
  await page.waitForFunction(()=>!window.hubDebug.snapshot().stageVisible);
  assert.equal((await snapshot()).rendering,false);results.checks.push('Scene completely outside viewport stops the loop');
  const noJs=await browser.newPage({javaScriptEnabled:false,viewport:{width:390,height:844}});
  await noJs.goto(url);assert.equal(await noJs.locator('.card').count(),3);assert.equal(await noJs.getByRole('link',{name:'Играть',exact:true}).getAttribute('href'),'/');
  await noJs.close();results.checks.push('No-JS HTML catalog with real launch link');
  assert.deepEqual(errors,[]);console.log(JSON.stringify(results,null,2));
} catch(error) {
  results.failure={message:error.message,snapshot:await snapshot().catch(()=>null)};
  throw error;
} finally {
  writeFileSync(resolve(output,'runtime.json'),JSON.stringify({...results,errors},null,2)+'\n');
  await page.close();await browser.close();await server.close();
}
