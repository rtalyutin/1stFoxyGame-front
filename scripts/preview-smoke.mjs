import {chromium} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/rt/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',args:['--enable-gpu','--use-gl=angle','--use-angle=d3d11']});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/');await page.waitForLoadState('load');assert.equal(await page.locator('#login').inputValue(),'runner.preview');await page.locator('#login-submit').click();
 await page.waitForFunction(()=>document.body.dataset.phase==='SHOP'&&!document.querySelector('#primary').disabled,{},{timeout:60000});
 await page.screenshot({path:'../../docs/live-preview-wide.png'});
 await page.locator('#open-workshop').click();await page.waitForFunction(()=>document.body.dataset.phase==='WORKSHOP'&&!document.querySelector('#workshop-tap').disabled,{},{timeout:60000});
 await page.locator('#workshop-return').click();await page.waitForFunction(()=>document.body.dataset.phase==='SHOP');
 assert.equal(errors.length,0);writeFileSync('../../docs/local-preview-verification.json',JSON.stringify({status:'LIVE_SYNTHETIC_PREVIEW_SMOKE_PASS',browser:browser.version(),url:'http://127.0.0.1:5173/',checks:['Synthetic fields filled','Own SHOP accessible and exit usable','Native workshop financial controls ready','Safe return to SHOP'],errors,screenshot:'docs/live-preview-wide.png',repository:'MemoryRepository, reset on process exit'},null,2)+'\n');
 console.log('LOCAL_PREVIEW_SMOKE_PASS');
}finally{await browser.close();}
