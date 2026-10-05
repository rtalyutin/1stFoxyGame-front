import { defineConfig } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { validateCatalog, validateManifest } from './src/catalog.ts';
import { catalogSource } from './scripts/catalog-source.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
const release=process.env.HUB_BUILD_ID;
if(release&&!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(release))throw new Error('Unsafe HUB_BUILD_ID');
const base=release?`/hub/releases/${release}/`:'/hub/';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const games=validateCatalog(JSON.parse(catalogSource(root).bytes.toString('utf8')));
const config=JSON.parse(readFileSync(resolve(root,'config.json'),'utf8'));
if(!['url','event'].includes(config.entryMode)||config.hero!=='common-fox')throw new Error('Invalid entry configuration');
for(const game of games) {
  const manifest=validateManifest(JSON.parse(readFileSync(resolve(root,'public',game.scene),'utf8')));
  for(const asset of [game.poster.desktop,game.poster.mobile,manifest.model,manifest.hero])if(!existsSync(resolve(root,'public',asset)))throw new Error(`Missing asset: ${asset}`);
}
function markup(list: typeof games): string {
  return list.map(g=>`<article class="card" data-id="${g.id}" data-world="unloaded">
  <div class="machine"><img class="poster" src="${base+g.poster.desktop}" width="${g.poster.width}" height="${g.poster.height}" alt="" loading="lazy" />${g.status==='playable'?`<button class="machine-select" type="button" data-select="${g.id}" aria-label="Играть в ${escape(g.title)}"></button>`:''}</div>
  <div class="caption"><h2>${escape(g.title)}</h2><p class="description">${escape(g.description)}</p>${g.status==='playable'?`<a class="play" href="${escape(g.launchPath!)}" data-select="${g.id}">Играть</a>`:'<span class="soon">Скоро</span>'}
  <p class="world-error" hidden>Анимация мира недоступна.<button class="world-retry" type="button">Повторить</button></p></div></article>`).join('\n');
}
export default defineConfig(({command})=>({
  root,base,publicDir:resolve(root,'public'),
  plugins:[{name:'hub-static-catalog',transformIndexHtml(html,context){
    // Test catalogs are available only from the dev server, never in a release.
    const params=new URLSearchParams(context.originalUrl?.split('?')[1]??'');
    const count=command==='serve'?Number(params.get('fixture')):NaN;
    const list=command==='serve'&&[0,1,2,3,10,12].includes(count)&&params.has('fixture')
      ?Array.from({length:count},(_,i)=>({...games[i%games.length],id:i<3?games[i%games.length].id:`fixture-${i+1}`,status:i===0?'playable' as const:'soon' as const,launchPath:i===0?'/':null})):games;
    const data=JSON.stringify({games:list,...config,buildId:release??'dev'}).replace(/</g,'\\u003c');
    return html.replace('<!-- HUB_CATALOG -->',markup(list)).replace('<!-- HUB_DATA -->',`<script type="application/json" id="hub-data">${data}</script>`).replace('class="arcade"',`class="arcade" data-count="${list.length}"`);
  }}],
  server:{host:'0.0.0.0',port:5174,strictPort:true},
  preview:{host:'0.0.0.0',port:4174,strictPort:true},
  build:{outDir:release?resolve(root,'dist/releases',release):resolve(root,'dist'),emptyOutDir:true,target:'es2022',sourcemap:false},
}));
