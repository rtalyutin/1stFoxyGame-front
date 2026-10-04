import './style.css';
import {BUILD_ID,RULES,rulesFor,type Snapshot,type Input,type Target} from './contracts';
import {createInitial,step,snapshot,restore,take,place,retainedFraction,randomId} from './core';
import {GameView} from './view';
import {tutorialGuide,tutorialAction} from './tutorial';
import {CURRENT_BUILD_CONTEXT as BUILD_CONTEXT,toSnapshotV1,fromSnapshotV1,type SnapshotV1} from './snapshot-v1';
import type {RunDto} from './r1-contracts';
import {read,write,writeMany,remove,probeStorage,mutate,list} from './storage';
import {auth,getUser,rpc,CloudError,type SessionUser} from './cloud';
import {chooseResume} from './resume';
import {Outbox,fromServer,browserStore,runKey,resumeMetadata,type DurableRun} from './outbox';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=$<HTMLCanvasElement>('scene'),input:Input={left:false,right:false,jump:false},keys=new Set<string>();
const moves=new Map<number,keyof Input>(),gestures=new Map<number,{mode:'take'|'place';target:Target|null;x:number;y:number}>();
const markerGestures=new Map<number,{action:'take'|'place';target:Target}>();
let state:Snapshot=createInitial(),view:GameView,paused=true,mode:'take'|'place'='take',target:Target|null=null,targetMode:'take'|'place'=mode,lastFrame=0,accumulator=0,lastSaveTick=-1;
let localFailure=false,ready=false,busy=false,toastTimer=0,screen='boot',user:SessionUser|null=null,active:RunDto|null=null,profile:any=null,queue:Outbox|null=null,conflictRun:RunDto|null=null,authMode='login',authExpired=false,historyCursor:unknown=null;
let saveQueue=Promise.resolve(),frameTimes:number[]=[];let localReplay=false,terminalView=false;let guidePhase='';
const callbackURL=()=>`${location.origin}${location.pathname}`;
function notify(message:string){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>$('toast').classList.remove('show'),3500);}
function show(next:string){screen=next;document.body.dataset.screen=next;$('overlay').hidden=false;for(const panel of document.querySelectorAll<HTMLElement>('#overlay > section'))panel.hidden=panel.id!==`${next}-panel`;if(next!=='game'){paused=true;resetInput();}$('portrait').hidden=next!=='game'||!portrait();}
function resetInput(){keys.clear();moves.clear();gestures.clear();markerGestures.clear();input.left=input.right=input.jump=false;state.player.jumpHeld=false;target=null;document.querySelectorAll('.pressed').forEach(b=>b.classList.remove('pressed'));accumulator=0;lastFrame=0;}
function syncInput(){const held=new Set(moves.values());input.left=held.has('left')||keys.has('KeyA')||keys.has('ArrowLeft');input.right=held.has('right')||keys.has('KeyD')||keys.has('ArrowRight');input.jump=held.has('jump')||keys.has('Space');document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(b=>b.classList.toggle('pressed',input[b.dataset.move as keyof Input]));}
function panel(title:string,text:string,label='ПРОДОЛЖИТЬ →'){$('panel-title').textContent=title;$('panel-text').textContent=text;$('resume').textContent=label;}
function pause(title='Дом подождёт.',text='Снимок хранит положение дома, игрока и опору. Продолжение — по твоей команде.'){
  if((!queue&&!localReplay)||screen==='conflict')return;paused=true;resetInput();show('game');panel(title,text);$('instructions').hidden=true;if(ready&&!localFailure)void saveLocal();
}
async function resume(){
  if(!ready||portrait()||(!queue&&!localReplay)||screen!=='game')return;
  if(terminalView){await menu();return;}
  if(localReplay){if(state.outcome!=='playing'){await menu();return;}if(localFailure){await saveLocal();return;}paused=false;resetInput();$('overlay').hidden=true;canvas.focus({preventScroll:true});return;}
  if(localFailure){await saveLocal();if(localFailure)return;queue!.allow();void queue!.flush();panel('Сохранение восстановлено.','Очередь снова записана на устройстве. Нажми «Продолжить».');return;}
  const record=await queue!.record();if(record?.conflict){await showConflict();return;}
  if(state.outcome!=='playing'){queue!.allow();await queue!.flush();await newRun();return;}
  authExpired=false;paused=false;resetInput();$('overlay').hidden=true;canvas.focus({preventScroll:true});queue!.allow();void queue!.flush();
}
function portrait(){return matchMedia('(pointer:coarse)').matches&&innerHeight>innerWidth;}
function orientation(){const rotated=portrait();$('portrait').hidden=!rotated||screen!=='game';if(rotated&&ready&&!paused)pause();resetInput();view?.resize();}
function storageFailed(error:unknown){localFailure=true;paused=true;queue?.hold();resetInput();show('game');panel('Не удалось сохранить на устройстве.','Забег остаётся в памяти этой вкладки. После её закрытия прогресс после последней записи может потеряться. Освободи место и нажми «Повторить сохранение».','Повторить сохранение');$('save-status').textContent='Ошибка локального сохранения';$('cloud-status').textContent='Новые команды не отправляются до надёжной записи.';notify(error instanceof Error?error.message:'Хранилище недоступно');}
function saveLocal():Promise<void>{
  if(localReplay){const captured=toSnapshotV1(snapshot(state)),owner=user?.id;saveQueue=saveQueue.then(async()=>{try{if(!owner)throw new Error('Нужен аккаунт владельца копии');await write(`replay:${owner}:${captured.run_id}`,captured);if(!localReplay||user?.id!==owner)return;localFailure=false;lastSaveTick=captured.sim_tick;$('save-status').textContent='Локальный повтор · серверная история не меняется';}catch(error){if(localReplay&&user?.id===owner)storageFailed(error);}});return saveQueue;}
  if(!queue)return Promise.resolve();const captured=toSnapshotV1(snapshot(state)),currentQueue=queue;
  saveQueue=saveQueue.then(async()=>{try{await currentQueue.capture(captured);if(currentQueue!==queue)return;lastSaveTick=captured.sim_tick;localFailure=false;currentQueue.allow();void currentQueue.flush();}catch(error){if(currentQueue===queue)storageFailed(error);}});return saveQueue;
}
async function scopedRpc<T=any>(owner:string,operation:string,body:unknown):Promise<T>{
  const verified=await getUser();if(!verified||!verified.emailVerified||verified.id!==owner)throw new CloudError('AUTH_REQUIRED','Сессия изменилась. Войди снова перед отправкой очереди.');
  const result=await rpc<T>(operation,body,owner),current=await getUser();
  if(!current?.emailVerified||current.id!==owner)throw new CloudError('AUTH_REQUIRED','Аккаунт сменился во время запроса. Его исход сохранён для повтора в прежнем аккаунте.');
  return result;
}
function queueEvent(type:string,value?:unknown){
  if(type==='durable'){$('save-status').textContent=`На устройстве · ${Math.floor((value as DurableRun).snapshot.sim_tick/60)} с · ожидает сервер`;$('cloud-status').textContent='Локальная копия записана. Ожидает подтверждения сервера.';}
  if(type==='ack'){const row=value as DurableRun;$('save-status').textContent=`Подтверждено сервером · ${Math.floor(row.confirmed_tick/60)} с · r${row.revision}`;$('cloud-status').textContent=row.terminal_ack?'Результат подтверждён сервером.':'Снимок подтверждён сервером.';if(row.terminal_ack)active=null;}
  if(type==='offline'){$('save-status').textContent='Офлайн · копия на устройстве';$('cloud-status').textContent=(value as Error)?.message??'Нет ответа. Повторим тот же запрос.';}
  if(type==='storage')storageFailed(value);if(type==='error'){paused=true;resetInput();show('game');panel('Сервер отклонил сохранение.',(value as Error).message+' Очередь и локальная копия сохранены.');$('cloud-status').textContent='Ошибка. Автоматической перезаписи нет.';}
  if(type==='conflict')void showConflict();
  if(type==='auth'){authExpired=true;queue?.hold();paused=true;resetInput();showAuth('login','Вход истёк. Очередь сохранена на устройстве. После входа нажми «Продолжить и синхронизировать».');}
}
function bindQueue(record:DurableRun){const owner=record.owner_id;queue?.hold();const next=new Outbox(owner,record.run_id,browserStore,(operation,body)=>scopedRpc(owner,operation,body),(type,value)=>{if(queue===next&&user?.id===owner)queueEvent(type,value);});queue=next;queue.hold();}
function checkBuild(checkpoint:SnapshotV1){if(checkpoint.client_build_id!==BUILD_CONTEXT.client_build_id||checkpoint.content_version!==BUILD_CONTEXT.content_version||checkpoint.rules_version!==BUILD_CONTEXT.rules_version)throw new CloudError('CONTENT_INCOMPATIBLE','Сохранение требует другой сборки. Открой launcher для продолжения.');}
async function adopt(record:DurableRun,title='Дом ждал тебя.'){
  localReplay=false;terminalView=record.terminal_ack;const requestedUrl=new URL(location.href);requestedUrl.searchParams.set('resume',record.run_id);history.replaceState(null,'',requestedUrl);$('abandon').hidden=false;$('retry-sync').textContent='Повторить сохранение';checkBuild(record.snapshot);$('save-status').textContent=`Серверная revision ${record.revision} · копия на устройстве`;state=fromSnapshotV1(record.snapshot);guidePhase='';syncTutorialMode();bindQueue(record);lastSaveTick=state.tick;localFailure=false;ensureView();show('game');paused=true;resetInput();panel(title,`Сохранено ${Math.floor(state.tick/60)} с. Продолжение запустится только по твоей команде.`);$('instructions').hidden=true;
  if(record.conflict){await showConflict();return;}
  if(terminalView){$('abandon').hidden=true;state.outcome==='playing'?panel('Забег оставлен.','Это завершённый серверный забег. Он открыт только для просмотра.','В МЕНЮ →'):renderOutcome();$('resume').textContent='В МЕНЮ →';$('cloud-status').textContent='Результат подтверждён сервером. История не изменится.';return;}
  if(state.outcome!=='playing'){renderOutcome();queue?.allow();void queue?.flush();}else{$('cloud-status').textContent=record.inflight||record.pending?'Очередь на устройстве. После продолжения повторим сохранённый запрос.':`Серверная revision ${record.revision}.`;$('resume').textContent=authExpired?'ПРОДОЛЖИТЬ И СИНХРОНИЗИРОВАТЬ →':'ПРОДОЛЖИТЬ →';}
}
interface StartRecord{owner_id:string;body:{client_build_id:string;level_id:string;content_version:string;request_id:string};created_at:string}
async function newRun(){
  if(busy||!user)return;busy=true;show('loading');try{
    await probeStorage();const owner=user.id,key=`start:${owner}`;let pending=await read<StartRecord>(key);
    if(!pending){
      const boot=await scopedRpc<any>(owner,'bootstrap_v1',{client_build:BUILD_ID});active=boot.active_run;
      if(active){show('menu');$('menu-status').textContent='У тебя уже есть активный забег. Продолжи его или явно откажись от него.';return;}
      const row=queue?await queue.record():null;if(row&&!row.terminal_ack&&(row.inflight||row.pending)){show('game');$('cloud-status').textContent='Новый забег ждёт подтверждения предыдущего результата. Нажми «Повторить сохранение». ';return;}
      pending={owner_id:owner,body:{client_build_id:BUILD_CONTEXT.client_build_id,level_id:BUILD_CONTEXT.level_id,content_version:BUILD_CONTEXT.content_version,request_id:randomId()},created_at:new Date().toISOString()};pending=await mutate<StartRecord>(key,existing=>existing??pending!);
    }
    if(pending.owner_id!==owner)throw new Error('Аккаунт запроса не совпадает');
    const run=await scopedRpc<RunDto>(owner,'run_start_v1',pending.body),record=fromServer(owner,run);
    await writeMany([[runKey(owner,run.run_id),record],[`resume:${owner}`,resumeMetadata(record)]],[key]);active=run;await adopt(record,'Первый мост — вместе.');$('instructions').hidden=false;panel('Первый мост — вместе.','Сначала возьми зелёный блок стены, затем поставь его в голубую клетку. Дом будет ждать первого переноса. Мосту нужны всего два блока.','НАЧАТЬ →');
  }catch(error){const e=error as Error&{code?:string};if(e.code==='GPU_UNAVAILABLE'){fatal(e.message);return;}if(e.code==='CLIENT_UPDATE_REQUIRED'){if(user)await remove(`start:${user.id}`);notify(e.message);location.assign('/games/syezzhaem/?new=1');return;}if(e.code==='AUTH_REQUIRED'){showAuth('login',e.message);return;}if(e.code==='ACTIVE_RUN_EXISTS'){if(user)await remove(`start:${user.id}`);await menu();return;}if(e.code==='VALIDATION_FAILED'||e.code==='CONTENT_INCOMPATIBLE'){if(user)await remove(`start:${user.id}`);}show('menu');$('menu-status').textContent=e.message+' Новый старт не подтверждён. Повтор кнопки повторит тот же request_id.';}finally{busy=false;}
}
async function continueRun(){
  if(busy||!user)return;busy=true;show('loading');try{
    const owner=user.id,requestedId=new URLSearchParams(location.search).get('resume'),meta=await read<{owner_id:string;run_id:string}>(`resume:${owner}`);
    const localId=requestedId??(meta?.owner_id===owner?meta.run_id:null),local=localId?await read<DurableRun>(runKey(owner,localId)):null;
    const boot=await scopedRpc<any>(owner,'bootstrap_v1',{client_build:BUILD_ID});active=boot.active_run;profile=boot.profile;
    const selected=await chooseResume(owner,requestedId,local,active,id=>scopedRpc<RunDto>(owner,'run_get_v1',{run_id:id}));
    if(selected){checkBuild(selected.record.snapshot);if(selected.persist)await browserStore.commit(selected.record);await adopt(selected.record);return;}
    show('menu');$('menu-status').textContent='Сохранённых забегов пока нет. Начни новый.';
  }catch(error){handleError(error,'menu-status');}finally{busy=false;}
}
function renderOutcome(){paused=true;resetInput();show('game');$('instructions').hidden=true;const kept=Math.round(retainedFraction(state)*100),won=state.outcome==='won';panel(won?'Дом добрался!':'Забег окончен.',won?`Сохранность дома ${kept}%. Счёт: 1000 за портал + ${Math.floor(400*retainedFraction(state))} за дом + ${Math.max(0,300-Math.floor(state.tick/60))} за время.`:(state.reason??'Дом потерял опору.')+' Счёт: 0.',localReplay?'В МЕНЮ →':'ЕЩЁ РАЗ →');}
function outcome(){renderOutcome();void saveLocal();}
function selectMode(next:'take'|'place'){
  mode=next;target=null;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',(b as HTMLElement).dataset.mode===mode));
}
function syncTutorialMode(){
  const guide=tutorialGuide(state),phase=guide?.phase??'';
  if(phase!==guidePhase){guidePhase=phase;if(guide&&guide.phase!=='ride')selectMode(guide.action);}
}
function hud(){
  const rules=rulesFor(state),guide=tutorialGuide(state);
  $('wood').textContent=String(state.inventory.wood);$('distance').textContent=`${Math.max(0,Math.ceil(rules.portalX-(state.house.x+3)))} м`;$('heart-fill').style.width=`${state.house.heartHp}%`;
  const objective=state.house.motion==='unsupported'?`Опора потеряна! Восстанови за ${state.house.supportTimer.toFixed(1)} с`:guide?.title??(state.house.motion==='gap'?'Дом ждёт мост. Поставь дерево в следующую клетку пропасти.':'Разбери часть дома. Построй мост. Доедь до портала.');
  if($('objective').textContent!==objective)$('objective').textContent=objective;
  const tutorial=$('tutorial-hint');tutorial.hidden=paused||!guide;
  if(guide){if($('tutorial-detail').textContent!==guide.instruction)$('tutorial-detail').textContent=guide.instruction;$('tutorial-progress').textContent=`ПЕРВЫЙ МОСТ · ${guide.filled}/2`;}
  const mark=$('tutorial-marker');mark.hidden=paused||!guide?.target;
  if(guide?.target){const p=view.project(guide.target);mark.textContent=guide.action==='take'?'↓ ВЗЯТЬ':guide.phase==='wait'?'↓ СКОРО':'↓ ПОСТАВИТЬ';$<HTMLButtonElement>('tutorial-marker').disabled=guide.phase==='wait';mark.setAttribute('aria-label',guide.action==='take'?'Взять отмеченный блок стены':'Поставить блок в отмеченную клетку моста');mark.dataset.action=guide.action;mark.style.left=`${Math.max(75,Math.min(innerWidth-75,p.x))}px`;mark.style.top=`${Math.max(110,p.y-43)}px`;}
  const caption=$('target-caption');if(target){const p=view.project(target);caption.textContent=`${targetMode==='take'?'ВЗЯТЬ':'ПОСТАВИТЬ'} · ${target.space==='house'?'ДОМ':'МИР'}`;caption.style.display='block';caption.style.left=`${Math.max(8,Math.min(innerWidth-160,p.x-55))}px`;caption.style.top=`${Math.max(90,p.y-48)}px`;}else caption.style.display='none';
}
function frame(time:number){if(lastFrame){const elapsed=Math.min((time-lastFrame)/1000,.1);if(!paused){accumulator+=elapsed;frameTimes.push(time-lastFrame);if(frameTimes.length>3600)frameTimes.shift();}}lastFrame=time;if(!paused){let steps=0;while(accumulator>=1/RULES.tickRate&&steps<6){step(state,input);accumulator-=1/RULES.tickRate;steps++;if(state.outcome!=='playing'){outcome();break;}}if(state.tick-lastSaveTick>=300){lastSaveTick=state.tick;void saveLocal();}}if(view){syncTutorialMode();const guide=tutorialGuide(state);view.render(state,target,targetMode,!paused&&guide?.target?{target:guide.target,mode:guide.action}:undefined);hud();}requestAnimationFrame(frame);}
function ensureView(){if(view)return;const probe=document.createElement('canvas').getContext('webgl2');if(!probe)throw new CloudError('GPU_UNAVAILABLE','Браузер не создаёт WebGL2. Проверь аппаратное ускорение.');probe.getExtension('WEBGL_lose_context')?.loseContext();try{view=new GameView(canvas);}catch(error){throw new CloudError('GPU_UNAVAILABLE',`Не удалось создать игровой мир: ${(error as Error).message}`);}view.engine.setHardwareScalingLevel(profile?.quality==='low'?Math.max(1,devicePixelRatio):Math.max(1,devicePixelRatio/1.5));canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();pause('Отображение потеряло GPU-контекст.','Забег остановлен, снимок сохраняется. После восстановления нажми «Продолжить».');});canvas.addEventListener('webglcontextrestored',()=>{paused=true;resetInput();view.scene.dispose();view.engine.dispose();(view as unknown)=undefined;ensureView();panel('Отображение восстановлено.','Игровой мир сохранён. Нажми «Продолжить».');});}
function coords(e:PointerEvent){const rect=canvas.getBoundingClientRect();return{x:e.clientX-rect.left,y:e.clientY-rect.top};}
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
  if(paused||!ready||e.button>2)return;
  e.preventDefault();canvas.setPointerCapture(e.pointerId);
  const action=e.pointerType==='mouse'?(e.button===2?'place':mode):mode;
  const {x,y}=coords(e);const selected=view.pick(x,y,state,action,e.pointerType!=='mouse');
  gestures.set(e.pointerId,{mode:action,target:selected,x,y});target=selected;targetMode=action;
});
canvas.addEventListener('pointermove',e=>{
  if(paused)return;const {x,y}=coords(e),gesture=gestures.get(e.pointerId);
  if(gesture){
    // Motion of the house cannot retarget an unmoved finger. Only drag changes selection.
    if(Math.hypot(x-gesture.x,y-gesture.y)<4)return;
    gesture.x=x;gesture.y=y;gesture.target=view.pick(x,y,state,gesture.mode,e.pointerType!=='mouse');target=gesture.target;targetMode=gesture.mode;
  }else if(e.pointerType==='mouse'){target=view.pick(x,y,state,mode);targetMode=mode;}
});
function cancelPointer(e:PointerEvent){gestures.delete(e.pointerId);moves.delete(e.pointerId);syncInput();target=null;}
canvas.addEventListener('pointerup',e=>{
  const gesture=gestures.get(e.pointerId);gestures.delete(e.pointerId);
  const rect=canvas.getBoundingClientRect();
  const outside=e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom;
  const onControl=document.elementFromPoint(e.clientX,e.clientY)?.closest('button');
  if(!paused&&!outside&&!onControl&&gesture?.target){
    applyAction(gesture.mode,gesture.target);
  }
  target=null;
});
function applyAction(action:'take'|'place',selected:Target){
  if(paused||!ready)return;
  const result=tutorialAction(state,action,selected);
  if(!result.ok)notify(result.reason);else{notify(action==='take'?'Блок стены в рюкзаке. Теперь поставь его на мост.':'Блок стал дорогой для дома.');syncTutorialMode();void saveLocal();}
}
const marker=$<HTMLButtonElement>('tutorial-marker');
marker.addEventListener('contextmenu',e=>e.preventDefault());
marker.addEventListener('pointerdown',e=>{
  const guide=tutorialGuide(state);
  if(paused||!ready||!guide?.target||guide.phase==='wait'||(e.button!==0&&!(e.button===2&&guide.action==='place')))return;
  e.preventDefault();marker.setPointerCapture(e.pointerId);markerGestures.set(e.pointerId,{action:guide.action,target:{...guide.target}});
});
marker.addEventListener('pointerup',e=>{
  const gesture=markerGestures.get(e.pointerId);markerGestures.delete(e.pointerId);
  const rect=marker.getBoundingClientRect();
  if(gesture&&e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom)applyAction(gesture.action,gesture.target);
});
for(const event of ['pointercancel','lostpointercapture'])marker.addEventListener(event,e=>markerGestures.delete((e as PointerEvent).pointerId));
// Keyboard activation is semantic HTML; pointer commands execute once on release.
marker.addEventListener('click',e=>{
  if(e.detail!==0)return;
  const guide=tutorialGuide(state);
  if(guide?.target&&guide.phase!=='wait')applyAction(guide.action,guide.target);
});
canvas.addEventListener('pointercancel',cancelPointer);
canvas.addEventListener('lostpointercapture',e=>{if(gestures.has(e.pointerId))cancelPointer(e);});
canvas.addEventListener('pointerleave',e=>{if(!gestures.has(e.pointerId))target=null;});
document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button=>{
  button.addEventListener('pointerdown',e=>{if(paused)return;e.preventDefault();button.setPointerCapture(e.pointerId);moves.set(e.pointerId,button.dataset.move as keyof Input);syncInput();});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,e=>{moves.delete((e as PointerEvent).pointerId);syncInput();});
});
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
  selectMode(button.dataset.mode as typeof mode);
}));
window.addEventListener('keydown',e=>{
  if(screen!=='game'||(e.target as HTMLElement)?.closest('input,textarea,select'))return;
  if(e.code==='Escape'){e.preventDefault();screen==='game'?(paused?resume():pause()):undefined;return;}
  if((e.target as HTMLElement)?.closest('button,a'))return;
  if(['KeyA','KeyD','ArrowLeft','ArrowRight','Space'].includes(e.code)){e.preventDefault();if(!paused){keys.add(e.code);syncInput();}}
  if(['Digit1','Digit2','Digit3'].includes(e.code))notify('В R1 один материал — дерево');
});
window.addEventListener('keyup',e=>{keys.delete(e.code);syncInput();});
window.addEventListener('blur',()=>{if(ready&&!paused)pause();else resetInput();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&ready&&!paused)pause();});
window.addEventListener('resize',orientation);
window.addEventListener('orientationchange',()=>{if(ready&&!paused)pause();orientation();});
function showAuth(next='login',message=''){
  authMode=next;show('auth');$('auth-title').textContent=next==='register'?'Создать аккаунт':next==='reset'?'Восстановить пароль':next==='password'?'Новый пароль':'Войти в игру';
  $('auth-status').textContent=message;$('name-label').hidden=next!=='register';$('email-label').hidden=next==='password';$('password-label').hidden=next==='reset';
  $('auth-password').setAttribute('autocomplete',next==='login'?'current-password':'new-password');$<HTMLInputElement>('auth-password').required=next!=='reset';$<HTMLInputElement>('auth-email').required=next!=='password';
  $('auth-submit').textContent=next==='register'?'СОЗДАТЬ →':next==='reset'?'ОТПРАВИТЬ ПИСЬМО →':next==='password'?'СОХРАНИТЬ ПАРОЛЬ →':'ВОЙТИ →';
  $('auth-register').hidden=next!=='login';$('auth-reset').hidden=next!=='login';$('auth-login').hidden=next==='login';$('auth-verify').hidden=true;$('auth-refresh').hidden=true;
}
async function authSubmit(e:Event){
  e.preventDefault();if(busy)return;busy=true;$<HTMLButtonElement>('auth-submit').disabled=true;$('auth-status').textContent='Подключаемся…';
  try{
    const email=$<HTMLInputElement>('auth-email').value.trim(),password=$<HTMLInputElement>('auth-password').value;let result:any;
    if(authMode==='register')result=await auth.signUp.email({email,password,name:$<HTMLInputElement>('auth-name').value.trim()||'Игрок',callbackURL:callbackURL()});
    else if(authMode==='reset')result=await auth.requestPasswordReset({email,redirectTo:callbackURL()});
    else if(authMode==='password'){const token=new URLSearchParams(location.search).get('token');if(!token)throw new Error('Ссылка восстановления не содержит токен. Запроси новое письмо.');result=await auth.resetPassword({newPassword:password,token});}
    else result=await auth.signIn.email({email,password,callbackURL:callbackURL()});
    if(result.error){if(result.error.code==='EMAIL_NOT_VERIFIED'){showAuth('login','Подтверди email по ссылке в письме. После подтверждения войди снова.');$('auth-verify').hidden=false;$('auth-refresh').hidden=false;return;}throw new Error(result.error.message||'Не удалось выполнить вход.');}
    $<HTMLInputElement>('auth-password').value='';
    if(authMode==='reset'){$('auth-status').textContent='Если аккаунт существует, письмо восстановления отправлено. Проверь входящие и спам.';return;}
    if(authMode==='password'){history.replaceState(null,'',location.pathname);showAuth('login','Пароль изменён. Войди с новым паролем.');return;}
    if(authMode==='register'){showAuth('login','Проверь письмо подтверждения. Подтверди адрес, затем войди.');$('auth-verify').hidden=false;$('auth-refresh').hidden=false;return;}
    user=await getUser();if(!user?.emailVerified){showAuth('login','Подтверди адрес в письме, затем войди.');$('auth-verify').hidden=false;$('auth-refresh').hidden=false;return;}await menu();
  }catch(error){$('auth-status').textContent=(error as Error).message;}finally{busy=false;$<HTMLButtonElement>('auth-submit').disabled=false;}
}
function fatal(message:string){paused=true;resetInput();$('fatal').hidden=false;$('fatal-message').textContent=message+' Снимок сохранён; нажми «Повторить».';}
function handleError(error:unknown,id='menu-status'){const e=error as Error&{code?:string};if(e.code==='GPU_UNAVAILABLE'){fatal(e.message);return;}if(screen==='loading')show('menu');if(e.code==='AUTH_REQUIRED'){authExpired=true;queue?.hold();showAuth('login',e.message);}else{$(id).textContent=e.message;notify(e.message);}}
async function menu(){
  localReplay=false;paused=true;resetInput();show('menu');$('menu-status').textContent='Проверяем аккаунт и сохранения…';
  try{
    const verified=await getUser();if(!verified?.emailVerified){queue?.hold();user=null;showAuth('login','Войди с подтверждённым email.');return;}if(user&&user.id!==verified.id){queue?.hold();queue=null;}user=verified;
    const result=await scopedRpc<any>(user.id,'bootstrap_v1',{client_build:BUILD_ID});active=result.active_run;profile=result.profile;
    $('menu-account').textContent=`${profile.display_name||'Игрок'} · серверный аккаунт`;
    const pendingStart=await read<StartRecord>(`start:${user.id}`),meta=await read<{owner_id:string;run_id:string}>(`resume:${user.id}`),local=meta?.owner_id===user.id?await read<DurableRun>(runKey(user.id,meta.run_id)):null;
    $<HTMLButtonElement>('continue').disabled=!active&&!local&&!new URLSearchParams(location.search).has('resume');
    $('new-game').textContent=pendingStart?'Повторить неподтверждённый старт':'Новый забег';
    $('menu-status').textContent=pendingStart?'Старт ещё не подтверждён. Повтор отправит прежний request_id.':local?.inflight||local?.pending?'На устройстве есть очередь сохранений. Продолжи, чтобы отправить её.':active?'Дом ждёт. Можно продолжить на этом устройстве.':'Начни первый забег.';
  }catch(error){handleError(error);}
}
async function showConflict(){
  if(!queue||!user)return;paused=true;resetInput();queue.hold();show('conflict');$('conflict-status').textContent='Загружаем сведения о серверной версии…';
  try{conflictRun=await scopedRpc<RunDto>(user.id,'run_get_v1',{run_id:queue.runId});const local=await queue.record();$('conflict-text').textContent=`На этом устройстве: ${Math.floor((local?.snapshot.sim_tick??0)/60)} с. На сервере: ${Math.floor(conflictRun.checkpoint.sim_tick/60)} с, revision ${conflictRun.revision}, подтверждено ${new Date(conflictRun.updated_at).toLocaleString('ru')}. Забег ${conflictRun.lifecycle==='active'?'активен':'уже завершён'}.`;$<HTMLButtonElement>('conflict-local').disabled=conflictRun.lifecycle!=='active';$('conflict-status').textContent='Мир остановлен. Локальная копия сохранится при загрузке серверной.';}
  catch(error){handleError(error,'conflict-status');}
}
async function serverChoice(){if(!queue||!conflictRun)return;try{await queue.replaceServer(conflictRun);const row=await queue.record();if(row)await adopt(row,'Серверный дом загружен.');}catch(error){handleError(error,'conflict-status');}}
async function localChoice(){if(!queue||!user)return;if(!confirm('Заменить активный серверный дом локальной копией? Мир другого устройства будет заменён, если его revision не изменилась.'))return;try{const latest=await scopedRpc<RunDto>(user.id,'run_get_v1',{run_id:queue.runId});await queue.replaceLocal(latest);show('game');panel('Локальная копия выбрана.','Заменяем серверный снимок отдельной CAS-командой. Забег пока на паузе.');void queue.flush();}catch(error){handleError(error,'conflict-status');}}
async function historyPage(more=false){
  if(!user)return;show('history');$('history-status').textContent='Загружаем…';if(!more){$('history-list').replaceChildren();historyCursor=null;}
  try{const result=await scopedRpc<any>(user.id,'history_list_v1',{page_size:10,...(more&&historyCursor?{cursor:historyCursor}:{})});for(const item of result.items as RunDto[]){const article=document.createElement('article');article.className='history-item';const title=document.createElement('strong'),detail=document.createElement('p'),date=document.createElement('small');title.textContent=item.lifecycle==='won'?'Дом добрался':item.lifecycle==='lost'?'Забег окончен':'Забег оставлен';detail.textContent=`${item.result?.score??0} очков · ${Math.floor(item.result?.elapsed_seconds??item.checkpoint.sim_tick/60)} с · сохранность ${Math.round((item.result?.retained_fraction??0)*100)}%`;date.textContent=new Date(item.finished_at??item.updated_at).toLocaleString('ru');article.append(title,detail,date);$('history-list').append(article);}historyCursor=result.next_cursor;$('history-more').hidden=!historyCursor;if(!more){const copies=await list<DurableRun>(`conflict:${user.id}:`);for(const copy of copies){const article=document.createElement('article');article.className='history-item';const button=document.createElement('button');button.className='secondary';button.textContent=`Локальная копия · ${Math.floor(copy.snapshot.sim_tick/60)} с · ${new Date(copy.updated_at).toLocaleString('ru')}`;button.addEventListener('click',()=>void replayCopy(copy));article.append(button);$('history-list').append(article);}}$('history-status').textContent=$('history-list').childElementCount?'':'Завершённых забегов пока нет.';}
  catch(error){handleError(error,'history-status');}
}
async function replayCopy(copy:DurableRun){
  if(!user||copy.owner_id!==user.id)return;
  try{checkBuild(copy.snapshot);queue?.hold();queue=null;localReplay=true;terminalView=false;state=fromSnapshotV1(copy.snapshot);ensureView();show('game');paused=true;resetInput();$('abandon').hidden=true;$('retry-sync').textContent='Сохранить локальную копию';$('instructions').hidden=true;panel('Копия конфликтного дома.','Это локальный повтор. Серверные забег и история не изменяются.',state.outcome==='playing'?'ИГРАТЬ ЛОКАЛЬНО →':'В МЕНЮ →');$('cloud-status').textContent='Локальная копия этого аккаунта. Серверные команды отключены.';}
  catch(error){handleError(error,'history-status');}
}
function settings(){show('settings');$<HTMLInputElement>('setting-name').value=profile?.display_name??'';$<HTMLInputElement>('setting-sound').checked=profile?.sound_enabled??false;$<HTMLSelectElement>('setting-quality').value=profile?.quality??'low';$('settings-status').textContent='';}
async function settingsSave(e:Event){
  e.preventDefault();if(!user||busy)return;busy=true;try{const key=`profile-pending:${user.id}`;let body=await read<any>(key);if(!body){body={request_id:randomId(),expected_revision:profile.revision,settings:{display_name:$<HTMLInputElement>('setting-name').value.trim(),sound_enabled:$<HTMLInputElement>('setting-sound').checked,quality:$<HTMLSelectElement>('setting-quality').value}};body=await mutate<any>(key,current=>current??body);}profile=await scopedRpc<any>(user.id,'profile_update_v1',body);await remove(key);if(view)view.engine.setHardwareScalingLevel(profile.quality==='low'?Math.max(1,devicePixelRatio):Math.max(1,devicePixelRatio/1.5));$('settings-status').textContent='Настройки подтверждены сервером.';}
  catch(error){if((error as CloudError).code==='REVISION_CONFLICT'&&user){await remove(`profile-pending:${user.id}`);const result=await scopedRpc<any>(user.id,'bootstrap_v1',{client_build:BUILD_ID});profile=result.profile;$('settings-status').textContent='Настройки изменились на другом устройстве. Проверь поля и снова нажми «Сохранить» для замены по новой revision.';}else handleError(error,'settings-status');}finally{busy=false;}
}
async function logout(){
  const row=queue?await queue.record():null;if(row&&(row.inflight||row.pending)&&!confirm('Выйти, оставив неподтверждённую копию на этом устройстве? Для отправки позже войди в этот же аккаунт.'))return;
  queue?.hold();paused=true;resetInput();const result=await auth.signOut();if(result.error){handleError(new Error(result.error.message??'Не удалось выйти.'));return;}user=null;active=null;profile=null;queue=null;state=createInitial();showAuth('login','Ты вышел. Локальные копии сохранены для своих аккаунтов.');
}
async function abandon(){
  if(!queue||!user)return;if(!confirm('Отказаться от этого активного забега? Серверная история останется, активный слот освободится.'))return;paused=true;resetInput();try{await saveLocal();if(localFailure)return;await queue.abandon();queue.allow();await queue.flush();const row=await queue.record();if(row?.terminal_ack)await menu();else $('cloud-status').textContent='Отказ записан на устройстве. Новый забег ждёт его ACK.';}catch(error){storageFailed(error);}
}
$('pause').addEventListener('click',()=>pause());$('resume').addEventListener('click',()=>void resume());$('to-menu').addEventListener('click',()=>{void saveLocal().then(()=>{if(!localFailure)void menu();});});$('new-game').addEventListener('click',()=>void newRun());$('continue').addEventListener('click',()=>void continueRun());
$('tutorial').addEventListener('click',()=>show('tutorial'));$('menu-version').addEventListener('click',()=>location.assign('/games/syezzhaem/'));
$('history').addEventListener('click',()=>void historyPage());$('history-more').addEventListener('click',()=>void historyPage(true));$('settings').addEventListener('click',settings);$('logout').addEventListener('click',()=>void logout());document.querySelectorAll('[data-menu]').forEach(button=>button.addEventListener('click',()=>void menu()));
$('retry-sync').addEventListener('click',()=>void saveLocal().then(()=>{if(!localFailure){queue?.allow();void queue?.flush();}}));$('abandon').addEventListener('click',()=>void abandon());$('fresh-version').addEventListener('click',()=>{void saveLocal().then(()=>{if(!localFailure)location.assign('/games/syezzhaem/?new=1');});});
$('conflict-server').addEventListener('click',()=>void serverChoice());$('conflict-keep').addEventListener('click',()=>{queue?.hold();show('game');panel('Локальная копия сохранена.','Серверный мир не изменён. Забег остаётся на паузе. Выбор доступен через «Продолжить».');});$('conflict-local').addEventListener('click',()=>void localChoice());
$('auth-form').addEventListener('submit',e=>void authSubmit(e));$('auth-register').addEventListener('click',()=>showAuth('register'));$('auth-reset').addEventListener('click',()=>showAuth('reset'));$('auth-login').addEventListener('click',()=>showAuth('login'));$('auth-verify').addEventListener('click',()=>{void auth.sendVerificationEmail({email:$<HTMLInputElement>('auth-email').value.trim(),callbackURL:callbackURL()}).then(result=>{$('auth-status').textContent=result.error?.message??'Письмо подтверждения отправлено.';});});$('auth-refresh').addEventListener('click',()=>void menu());$('settings-form').addEventListener('submit',e=>void settingsSave(e));
$('build-label').textContent=BUILD_ID;$('fatal-retry').addEventListener('click',()=>location.reload());
window.addEventListener('online',()=>{if(queue&&user&&!authExpired&&!localFailure&&screen!=='auth')void queue.flush();});
async function boot(){
  ready=true;requestAnimationFrame(frame);
  if(new URLSearchParams(location.search).has('test')){(window as any).__r1={state:()=>snapshot(state),input:()=>({...input}),paused:()=>paused,screen:()=>screen,user:()=>user?.id??null,project:(cell:any)=>view.project(cell),setState:(s:unknown)=>{state=restore(s);resetInput();},pause,resume,saveLocal,newRun,continueRun,menu,outbox:()=>queue?.record(),record:()=>queue?.record(),flush:()=>queue?.flush(),target:()=>target?{...target}:null,guide:()=>tutorialGuide(state),toSnapshotV1,stats:()=>{const sorted=[...frameTimes].sort((a,b)=>a-b);return{samples:sorted.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],meshes:view?.scene.meshes.length,drawCallsLastFrame:view?.drawCallsLastFrame};}};}
  try{const query=new URLSearchParams(location.search);if(query.get('token')){showAuth('password');return;}user=await getUser();if(user?.emailVerified)await menu();else showAuth('login',query.has('error')?'Ссылка не подтверждена или истекла. Запроси новое письмо.':'');}catch(error){showAuth('login',(error as Error).message);}
}
void boot();
