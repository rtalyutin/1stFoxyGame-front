import type { Game } from './catalog';
import { validateCatalog } from './catalog';
import { visibleRange, residentSet, stepPosition, gameCount } from './geometry';
import { EntryController } from './entry';
import { ResourceManager } from './resources';
import type { LivingWorld } from './worlds';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const data=JSON.parse($('hub-data').textContent!);
document.body.dataset.js='true';
const games: Game[]=validateCatalog(data.games);
const rail=$<HTMLDivElement>('rail'), track=$('track'), arcade=rail.parentElement!;
const canvas=$<HTMLCanvasElement>('scene');
const cards=Array.from(track.querySelectorAll<HTMLElement>('.card'));
const previous=$<HTMLButtonElement>('previous'), next=$<HTMLButtonElement>('next');
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
let renderer: import('./renderer').ArcadeRenderer | undefined;
let manager: ResourceManager<LivingWorld> | undefined;
let initialization: Promise<void>, renderFailed=false;
let stageVisible=true, contextReady=true, navigationAway=false;
let raf=0, lastFrame=0, layoutFrame=0, lastRange:number[]=[];
let currentFirst=games[0]?.id, lastErrorId:string|null=null;
let resizeWidth=0;
const storageKey='foxygames.hub.first';
function remember(id: string): void { currentFirst=id; try { sessionStorage.setItem(storageKey,id); } catch { /* Storage is optional. */ } }
function readPosition(): string|undefined { try { return sessionStorage.getItem(storageKey)??undefined; } catch { return; } }
function indexOf(id: string): number { return games.findIndex(g=>g.id===id); }
function align(id: string): void {
  const card=cards[indexOf(id)]; if (!card) return;
  rail.scrollTo({left:Math.min(card.offsetLeft,rail.scrollWidth-rail.clientWidth),behavior:'instant'});
  syncLayout();
}
const entry=new EntryController({
  async prepare(id) {
    await initialization;
    const i=indexOf(id);
    if (!renderer || !manager || !contextReady || games[i]?.status!=='playable' || entry.state!=='PREPARING' || entry.id!==id) throw new Error('Entry unavailable');
    syncLayout(); // The selected slot is pinned from PREPARING, before awaiting.
    const world=await manager.ensure(i,true);
    if (!world || entry.id!==id || entry.state!=='PREPARING') throw new Error('Cancelled preparation');
    await renderer.prepareHero(world);
  },
  align,
  move(id,p) {
    const world=manager?.slots[indexOf(id)].value;
    if (world && renderer) renderer.enter(world,p);
  },
  reset() { renderer?.cancelHero(); },
  changed(state,id) {
    document.body.dataset.entry=state;
    const busy=state==='PREPARING'||state==='ENTERING'||state==='ENTRY_COMPLETE';
    previous.disabled=busy||rail.scrollLeft<1; next.disabled=busy||rail.scrollLeft>=rail.scrollWidth-rail.clientWidth-1;
    cards.forEach((c,i)=> { const b=c.querySelector<HTMLButtonElement>('.machine-select'); if(b)b.disabled=busy||!contextReady||manager?.slots[i].state==='error'; });
    $('entry-panel').hidden=state==='IDLE';
    $('entry-message').textContent=state==='PREPARING'?'Готовим вход в мир…':state==='ENTERING'?'Лис отправляется в приключение…':state==='ENTRY_COMPLETE'?'Открываем игру…':'Анимация входа недоступна. Можно повторить или открыть игру напрямую.';
    $('cancel').hidden=state==='ENTRY_COMPLETE'; $('retry').hidden=state!=='ERROR';
    const direct=$<HTMLAnchorElement>('direct'); direct.hidden=state!=='ERROR';
    if(id && games[indexOf(id)].launchPath) direct.href=games[indexOf(id)].launchPath!;
    if(state==='ERROR')lastErrorId=id;
    scheduleLayout();
  },
  complete(id) {
    remember(id);
    window.dispatchEvent(new CustomEvent('hub:entry-complete',{detail:{id}}));
    // Only the explicit development fixture turns completion into a test event.
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('entry-test')) { entry.cancel(); return; }
    if (data.entryMode==='event') { entry.cancel(); return; }
    navigationAway=true;
    location.assign(games[indexOf(id)].launchPath!);
  },
});
function worldChanged(index:number,state:string): void {
  const card=cards[index]; if (!card) return;
  card.dataset.world=state==='active'||state==='ready-paused'?'ready':state;
  const link=card.querySelector<HTMLAnchorElement>('.play');
  if(link)link.textContent=state==='error'?'Открыть игру':'Играть';
  const select=card.querySelector<HTMLButtonElement>('.machine-select');
  if(select)select.disabled=state==='error'||!contextReady||!['IDLE','ERROR'].includes(entry.state);
  const error=card.querySelector<HTMLElement>('.world-error')!;
  error.hidden=state!=='error';
  scheduleLayout();
}
function syncLayout(): void {
  const frame=rail.getBoundingClientRect();
  const bounds=cards.map(c=> {const r=c.getBoundingClientRect();return {left:r.left-frame.left,right:r.right-frame.left};});
  const fully=visibleRange(bounds,rail.clientWidth);
  if(fully.length) { lastRange=fully; if(entry.state==='IDLE')remember(games[fully[0]].id); }
  const overflow=rail.scrollWidth>rail.clientWidth+1;
  const locked=entry.state==='ENTERING'||entry.state==='ENTRY_COMPLETE'||entry.state==='PREPARING';
  previous.disabled=locked||rail.scrollLeft<=1; next.disabled=locked||rail.scrollLeft>=rail.scrollWidth-rail.clientWidth-1;
  $('position').textContent=overflow&&lastRange.length?`${lastRange[0]+1}–${lastRange.at(-1)!+1} из ${games.length}`:gameCount(games.length);
  $('navigation').hidden=games.length===0;
  previous.hidden=next.hidden=!overflow;
  if(!renderer||!manager||!contextReady)return;
  const visible=bounds.flatMap((b,i)=>b.right>0&&b.left<frame.width?[i]:[]);
  const pinned=entry.id&&(entry.state==='PREPARING'||entry.state==='ENTERING')?indexOf(entry.id):null;
  manager.reconcile(residentSet(visible,games.length,pinned),new Set(stageVisible&&!document.hidden?visible:[]));
  manager.slots.forEach((slot,i)=> {
    if(slot.value) { renderer!.place(slot.value,(bounds[i].left+bounds[i].right)/2,bounds[i].right-bounds[i].left); slot.value.root.setEnabled(visible.includes(i)); }
  });
  requestFrame();
}
function scheduleLayout(): void {
  if(!layoutFrame)layoutFrame=requestAnimationFrame(()=>{layoutFrame=0;syncLayout();});
}
function stop(): void { if(raf)cancelAnimationFrame(raf);raf=0;lastFrame=0; }
function canRender(): boolean { return !!renderer&&contextReady&&stageVisible&&!document.hidden&&games.length>0; }
function requestFrame(): void { if(canRender()&&!raf)raf=requestAnimationFrame(frame); }
function frame(now:number): void {
  raf=0; if(!canRender()) {lastFrame=0;return;}
  const dt=lastFrame?Math.min((now-lastFrame)/1000,.05):0; lastFrame=now;
  if(!reduced.matches) {
    manager?.slots.forEach(slot=> {if(slot.state==='active')slot.value?.update(dt);});
    entry.tick(dt);
  }
  renderer!.render();
  if(!reduced.matches)requestFrame(); else lastFrame=0;
}
function step(direction:number): void {
  if(entry.state!=='IDLE'&&entry.state!=='ERROR')return;
  rail.scrollTo({left:stepPosition(rail.scrollLeft,cards.map(c=>c.offsetLeft),rail.scrollWidth-rail.clientWidth,direction),behavior:reduced.matches?'instant':'smooth'});
}
previous.addEventListener('click',()=>step(-1)); next.addEventListener('click',()=>step(1));
rail.addEventListener('scroll',scheduleLayout,{passive:true});
rail.addEventListener('keydown',e=> {
  if(e.target!==rail)return;
  if(e.key==='ArrowLeft'||e.key==='ArrowRight') {e.preventDefault();step(e.key==='ArrowLeft'?-1:1);}
  if((e.key==='Home'||e.key==='End')&&(entry.state==='IDLE'||entry.state==='ERROR')) {e.preventDefault();rail.scrollTo({left:e.key==='Home'?0:rail.scrollWidth,behavior:reduced.matches?'instant':'smooth'});}
});
rail.addEventListener('focusin',e=> {
  const card=(e.target as HTMLElement).closest<HTMLElement>('.card');
  if(card&&entry.state==='IDLE') {
    const r=card.getBoundingClientRect(),v=rail.getBoundingClientRect();
    if(r.left<v.left||r.right>v.right)align(card.dataset.id!);
  }
});
// Native gestures own scrolling. Pointer tracking only distinguishes taps from drags.
const pointers=new Map<number,{x:number;y:number;scroll:number}>(); let suppressUntil=0;
rail.addEventListener('pointerdown',e=> {pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,scroll:rail.scrollLeft});if(pointers.size>1)suppressUntil=performance.now()+700;},{passive:true});
rail.addEventListener('pointermove',e=> {const p=pointers.get(e.pointerId);if(p&&(Math.hypot(e.clientX-p.x,e.clientY-p.y)>12||Math.abs(rail.scrollLeft-p.scroll)>12))suppressUntil=performance.now()+700;},{passive:true});
rail.addEventListener('pointerup',e=>pointers.delete(e.pointerId),{passive:true});
rail.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);suppressUntil=performance.now()+700;},{passive:true});
rail.addEventListener('click',e=> {
  const target=(e.target as HTMLElement).closest<HTMLElement>('[data-select]'); if(!target)return;
  const i=indexOf(target.dataset.select!); if(games[i]?.status!=='playable')return;
  const link=target instanceof HTMLAnchorElement;
  if(link&&(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||e.button!==0))return;
  if(e.detail!==0&&performance.now()<suppressUntil) {e.preventDefault();return;}
  if(reduced.matches||renderFailed||!contextReady||manager?.slots[i].state==='error') {
    if(!link) { e.preventDefault(); if(manager?.slots[i].state!=='error')location.assign(games[i].launchPath!); } return;
  }
  e.preventDefault(); void entry.select(games[i].id);
});
cards.forEach((card,i)=>card.querySelector('.world-retry')?.addEventListener('click',()=> {void manager?.ensure(i,true);scheduleLayout();}));
$('cancel').addEventListener('click',()=> {entry.cancel();syncLayout();});
$('retry').addEventListener('click',()=> {if(lastErrorId){const id=lastErrorId;entry.cancel();void entry.select(id);}});

function layoutSize(): void {
  const saved=entry.id??currentFirst;
  const capacity=window.innerWidth>=1280?3:window.innerWidth>=768?2:1;
  arcade.dataset.fit=String(games.length<=capacity);
  // CSS owns the slot size; renderer reads that geometry after resize.
  if(resizeWidth!==rail.clientWidth) {
    resizeWidth=rail.clientWidth; if(saved)align(saved);
  }
  renderer?.resize();
  if(renderer)document.body.style.setProperty('--floor-line',`${canvas.getBoundingClientRect().top+scrollY+renderer.floorLine()}px`);
  syncLayout();
}
new ResizeObserver(layoutSize).observe(arcade);
const observer=new IntersectionObserver(([e])=> {
  stageVisible=e.isIntersecting;
  if(!stageVisible)stop();syncLayout();
},{threshold:0});observer.observe($('scene').parentElement!);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();syncLayout();});
window.addEventListener('pagehide',()=> {stop();});
window.addEventListener('pageshow',e=> {
  if(e.persisted||navigationAway){navigationAway=false;entry.cancel();align(readPosition()??games[0]?.id);}
  scheduleLayout();
});
window.addEventListener('resize',layoutSize,{passive:true});
let dprQuery: MediaQueryList;
function watchDpr():void {
  dprQuery?.removeEventListener('change',watchDpr);
  dprQuery=matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  dprQuery.addEventListener('change',watchDpr,{once:true});
  layoutSize();
}
watchDpr();
reduced.addEventListener('change',()=>{entry.cancel();stop();scheduleLayout();});
function unavailable(message:string): void {
  renderFailed=true;
  $('render-note').textContent=message; $('render-note').hidden=false;
  document.body.dataset.render='fallback'; cards.forEach(c=>c.dataset.world='error');
}
async function start(): Promise<void> {
  if(!games.length) { $('empty').hidden=false; canvas.parentElement!.hidden=true;rail.hidden=true;return; }
  arcade.dataset.fit=String(games.length<=(window.innerWidth>=1280?3:window.innerWidth>=768?2:1));
  const saved=readPosition(); if(saved&&indexOf(saved)>=0)currentFirst=saved;
  if(currentFirst)align(currentFirst);
  try {
    const {ArcadeRenderer}=await import('./renderer');
    renderer=new ArcadeRenderer(canvas,()=> {
      contextReady=false;stop();entry.fail();manager?.dispose();
      unavailable('3D-контекст потерян. Игры доступны по ссылкам; восстанавливаем анимацию…');
    },()=> {
      contextReady=true;renderFailed=false;entry.cancel();$('render-note').hidden=true;document.body.dataset.render='ready';syncLayout();
    });
    manager=new ResourceManager(games.length,i=>renderer!.load(games[i]),worldChanged);
    renderer.resize(); document.body.dataset.render='ready';layoutSize();
    if(import.meta.env.DEV) {
      const context=canvas.getContext('webgl2')??canvas.getContext('webgl');
      const loss=context?.getExtension('WEBGL_lose_context');
      Object.assign(window,{hubDebug:{
        snapshot:()=>({entry:entry.state,selected:entry.id,rendering:!!raf,stageVisible,reduced:reduced.matches,
          states:manager!.slots.map(s=>s.state),...renderer!.stats()}),
        select:(id:string)=>entry.select(id),cancel:()=>entry.cancel(),
        project:(id:string,node:string)=> {const w=manager!.slots[indexOf(id)].value;return w?renderer!.project(w,node):null;},
        loseContext:()=>loss?.loseContext(),
        restoreContext:()=>loss?.restoreContext(),
      }});
    }
  } catch {renderer?.dispose();renderer=undefined;stop();unavailable('3D-анимация недоступна. Доступные игры можно открыть ссылкой «Играть».');}
}
initialization=start();
