import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {buildApp} from '../../back/dist/app.js';
import {MemoryRepository} from '../../back/dist/profile/repository.js';
import {hashPassword} from '../../back/dist/profile/auth.js';
import {ProfileService} from '../../back/dist/profile/service.js';
import {RunSimulation} from '../../back/dist/combat/simulation.js';

// Explicit synthetic demo; no configuration files or real credentials are read.
const login='runner.preview',password='local-preview-only';
const repository=new MemoryRepository(),accountId=randomUUID(),clientId=randomUUID();
await repository.provision([{accountId,login,passwordHash:await hashPassword(password)}]);
const catalog=JSON.parse(readFileSync(new URL('../../back/content/equipment.json',import.meta.url),'utf8'));
await repository.transaction(accountId,tx=>{
 tx.profile.goldMilli='1000000000';tx.profile.components={steel:1000,ember:1000,core:1000};
 tx.profile.items=catalog.items.flatMap(d=>d.levels.map(l=>({id:randomUUID(),definitionId:d.id,level:l.level})));
 for(const [slot,id,level]of [['weapon','long_link',1],['body','conductor_cuffs',3],['legs','side_step_boots',3],['talisman','debt_clock',1]])tx.profile.loadouts.pudge[slot]=tx.profile.items.find(i=>i.definitionId===id&&i.level===level).id;
 tx.profile.consumables={slow_dust:5,collector_vial:5};tx.profile.loadouts.pudge.quick=['slow_dust','collector_vial'];
 tx.forge.counts={apprentice:1,smelter:1,press:1,alchemy:1};
});
const service=new ProfileService(repository);
await service.perform(accountId,{operationId:randomUUID(),clientId,expectedRevision:0,type:'start_run',payload:{}});
await repository.transaction(accountId,tx=>{const sim=RunSimulation.restore(tx.run.snapshot);sim.resume();const id=tx.run.runId+':preview-shop';sim.state.shopCandidates.push({id,x:0,z:0,at:0});if(!sim.enterShop(id))throw Error('Preview shop fixture');tx.run.snapshot=sim.exportSnapshot();});
const app=buildApp({profileRepository:repository,secureCookies:false});
const server=await createServer({plugins:[{name:'synthetic-preview-label',transformIndexHtml(html){return html.replace('</head>',`<script>sessionStorage.setItem('foxy-r34-client','${clientId}');</script></head>`).replace('</body>',`<aside style="position:fixed;top:72px;left:8px;z-index:50;padding:5px 8px;background:#15231ee8;color:#f4d3a1;font:11px sans-serif;pointer-events:none">Локальное демо · тестовые данные сбросятся после остановки</aside><script>window.addEventListener('load',()=>{document.querySelector('#login').value='${login}';document.querySelector('#password').value='${password}';});</script></body>`);}}],server:{host:'127.0.0.1',port:5173,strictPort:true}});
try{await app.listen({host:'127.0.0.1',port:3001});await server.listen();}catch(error){await server.close();await app.close();throw error;}
console.log('LOCAL_PREVIEW_READY http://127.0.0.1:5173/');
console.log('Synthetic login: '+login+' / '+password+'; MemoryRepository only; no production connection.');
let closing=false;const close=async()=>{if(closing)return;closing=true;await server.close();await app.close();process.exit(0);};
process.on('SIGINT',close);process.on('SIGTERM',close);
