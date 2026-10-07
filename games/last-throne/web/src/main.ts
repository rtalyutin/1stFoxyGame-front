import './style.css';
import { CORE_VERSION, SNAPSHOT_VERSION, parseContentProjection } from '../../core/content-r3.ts';
import type { GameContent, BuildingKind, Point, ExpeditionKind } from '../../core/content-r3.ts';
import { createGame, submitCommand, advanceTicks, drainEvents, createSnapshot, restoreSnapshot, validateSnapshot, getFinishResult } from '../../core/game-core-r3.ts';
import type { GameState, GameSnapshot, FinishResult, CommandType, GameEvent } from '../../core/game-core-r3.ts';
import { createRenderer } from './renderer';
import type { RendererPick } from './renderer';
import { IndexedRunStore, SaveManager, api, ApiError, branchRecord, tabBranchId } from './save-client';
import type { LocalRun, RunPins, SaveStatus } from './save-client';
import { createAudio } from './audio';
import {inventoryHtml,itemPurchaseHtml,expeditionHtml,pendingRewardsHtml,heroStateText,expeditionReward,destinationIcon} from './r3-panels';
import type {ItemChoice,RewardChoice} from './r3-panels';

declare const __RELEASE_ID__: string;
interface Versions { core: string; content: string; metadataSchema: string; saveFormat: number; api: number }
interface Bootstrap { clientReleaseId: string; apiReleaseId: string; versions: Versions; contentUrl: string; capabilities: { battle: boolean; profiles: boolean; cloudSaves: boolean } }
interface Manifest { releaseId: string; versions: Versions }
interface Settings { soundEnabled: boolean; volume: number; quality: 'low'|'medium'|'high'; controlScheme: string; autoPause: boolean }
interface Profile { id: string; revision: number; settings: Settings }
interface RunResponse { id: string; revision: number; status: string; seed: number; coreVersion:string; contentVersion:string; metadataSchemaVersion:string; snapshotSchemaVersion:number; clientReleaseId: string; result?: FinishResult }
const app = document.querySelector<HTMLDivElement>('#app')!;
const launchId = location.pathname.match(/\/td\/releases\/([A-Za-z0-9._-]+)\/web\//)?.[1] ?? __RELEASE_ID__;
const canonicalJson=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonicalJson).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson((value as Record<string,unknown>)[key])}`).join(',')}}`:JSON.stringify(value);
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const store = new IndexedRunStore();
let bootstrap: Bootstrap, content: GameContent, profile: Profile;
let game: GameState | null = null;
let renderer: ReturnType<typeof createRenderer> | null = null;
let saves: SaveManager<GameSnapshot,FinishResult> | null = null;
let record: LocalRun<GameSnapshot,FinishResult> | null = null;
let selection: {kind: string; id: string} | null = null;
let aim: 'cast'|'teleport'|null = null, teleportTarget: string|null = null, previewKind: BuildingKind|null = null;
let expeditionDraft:ExpeditionKind|null=null,itemChoice:ItemChoice|null=null,rewardChoice:RewardChoice|null=null,discardRewardId:string|null=null;
let checkpointTasks=0,startingWave=false;
const preparationMutationActions=new Set(['expedition-confirm','item-confirm','reward-confirm','reward-discard-confirm','build-confirm','priority','upgrade','sell','buy-scroll','teleport-confirm']);
let recentEvents: GameEvent[] = [];
let eventTotals:Record<string,number>={};
let seq = 0, frame = 0, previousTime = 0, accumulator = 0, lastUiTime = 0;
let savingLocal = false, contextLost = false, usedAbility = false, cloudMessage = '', saveStatus: SaveStatus = 'device';
let lastFocus: HTMLElement|null = null;
let modalOpen = false, panelSignature = '', barSignature = '', waveSignature = '', saveSignature = '', toastTimer: ReturnType<typeof setTimeout> | null = null;
let audio = createAudio();
let localCandidates: LocalRun<GameSnapshot,FinishResult>[] = [];
let cloudCandidates: RunResponse[] = [];
const reasons: Record<string,string> = {
  ITEM_INCOMPATIBLE:'Этот предмет не подходит герою.',ITEM_DUPLICATE:'Эффект этого предмета уже экипирован.',INVALID_SLOT:'Выберите один из двух слотов.',UNKNOWN_ITEM:'Предмет отсутствует в этом наборе.',REWARD_NOT_FOUND:'Эта награда уже выбрана.',REWARD_ITEM_INVALID:'Выберите предмет из полученной награды.',REWARD_PENDING:'Сначала выберите или явно отклоните награду лавки.',EXPEDITION_ACTIVE:'Другой герой уже в вылазке.',ACTOR_ABSENT:'Герой отсутствует в обороне.',TOKEN_HELD:'У этого героя уже есть Aegis.',UNKNOWN_EXPEDITION:'Выберите известную цель вылазки.',TARGET_HIDDEN:'Эта цель скрыта. Нужен предмет обнаружения.',
  INSUFFICIENT_GOLD:'Не хватает золота.', PLACE_OCCUPIED:'Это место уже занято или зарезервировано.', WRONG_PLACE_TYPE:'Здание ставится на квадрат, герой — на круг.',
  ACTOR_DEAD:'Герой возвращается после гибели.', ACTOR_BUSY:'Сначала дождитесь завершения действия.', MAX_LEVEL:'Максимальный уровень.',
  PREPARATION_ONLY:'Действие доступно между волнами.', WAVE_ONLY:'Способность доступна во время волны.', COOLDOWN:'Способность ещё перезаряжается.',
  INVALID_TARGET:'Выберите допустимую цель.', OUT_OF_RANGE:'Цель вне радиуса способности.', TARGET_IMMOVABLE:'Командир не перемещается крюком.',
  SPELL_NOT_STEALABLE:'Командир ещё не применил доступное для кражи заклинание.', SUMMON_ACTIVE:'Надгробие ещё действует. Дождитесь его исчезновения.', INVALID_PRIORITY:'Выберите доступный приоритет стрельбы.', NO_SCROLL:'Сначала купите свиток телепорта.', PAUSED:'Продолжите игру.', RUN_FINISHED:'Партия завершена.', UNKNOWN_ACTOR:'Объект уже исчез.',
};
function releaseLabel(core?:string){return core?.startsWith('r1-')?'R1':core?.startsWith('r2-')?'R2':core?.startsWith('r3-')?'R3':'неизвестной версии';}
async function verifyArchive(releaseId:string,expected:Versions){
  if(!/^r[123]-core-/.test(expected.core))throw Error('Сохранение относится к неподдерживаемому ядру. Исходная запись сохранена.');
  const [manifestResponse,archived]=await Promise.all([fetch(`/td/releases/${encodeURIComponent(releaseId)}/manifest.json`),api<Bootstrap>(`/bootstrap?clientReleaseId=${encodeURIComponent(releaseId)}`)]);
  if(!manifestResponse.ok)throw Error('Проверенная сборка для сохранения недоступна. Исходная запись сохранена.');
  const manifest=await manifestResponse.json() as Manifest;
  if(manifest.releaseId!==releaseId||archived.clientReleaseId!==releaseId||!archived.capabilities.battle||(['core','content','metadataSchema','saveFormat','api'] as const).some(key=>manifest.versions[key]!==expected[key]||archived.versions[key]!==expected[key]))throw Error('Архивная сборка не совпала с закреплёнными версиями сохранения. Исходная запись сохранена.');
  const index=await fetch(`/td/releases/${encodeURIComponent(releaseId)}/web/index.html`,{method:'HEAD'});if(!index.ok)throw Error('Клиент архивной сборки недоступен. Исходная запись сохранена.');
}
function persistPreparation(message='Подготовка не записалась на устройство. Повторите сохранение перед волной.'){
  if(!game||game.phase!=='preparation'||!saves)return;const current=game,manager=saves,snapshot=createSnapshot(game);checkpointTasks++;savingLocal=true;renderUi(true);
  void manager.checkpoint(snapshot).catch(()=>{if(game===current)showToast(message,true);}).finally(()=>{if(game===current){checkpointTasks--;savingLocal=checkpointTasks>0;renderUi(true);}});
}
function selectDestination(kind:ExpeditionKind){if(!content.expeditions.some(e=>e.kind===kind))return;aim=null;previewKind=null;itemChoice=null;expeditionDraft=kind;if(!selectedHero())selection={kind:'expedition',id:kind};renderer?.select({kind:'expedition',id:kind});renderUi(true);}
function placeLabel(id: string) { const parts=id.split('-'); return `${parts[1]?.[0]==='n'?'Верхняя':parts[1]?.[0]==='s'?'Нижняя':'Средняя'} линия · ${parts[1]?.slice(1) ?? ''}`; }
function showToast(message: string, error=false) {
  document.querySelector('.toast')?.remove(); if(toastTimer)clearTimeout(toastTimer);
  const el=document.createElement('div');el.className=`toast${error?' error':''}`;el.role='status';el.textContent=message;document.body.append(el);
  toastTimer=setTimeout(()=>el.remove(),4500);
}
function loading(message='Проверяем версии и загружаем поле…') {
  app.innerHTML=`<div class="boot"><div class="boot-card stack"><div class="eyebrow">FOXYGAMES / R3</div><h1>Последний трон</h1><div class="row"><div class="loader" aria-hidden="true"></div><p class="lead">${esc(message)}</p></div></div></div>`;
}
function fail(error: unknown) {
  stopBattle();
  app.innerHTML=`<div class="boot"><div class="boot-card stack"><div class="eyebrow">ПОСЛЕДНИЙ ТРОН</div><h1>Не удалось открыть поле</h1><p class="error-message">${esc(error instanceof Error?error.message:'Временная ошибка загрузки.')}</p><button class="primary" data-action="reload">Повторить загрузку</button><p class="small muted">Локальные сохранения остаются на устройстве.</p></div></div>`;
}
async function load() {
  loading();
  try {
    const manifest=await fetch(`/td/releases/${encodeURIComponent(launchId)}/manifest.json`).then(r=>{if(!r.ok)throw Error('Манифест релиза недоступен.');return r.json() as Promise<Manifest>;});
    bootstrap=await api<Bootstrap>(`/bootstrap?clientReleaseId=${encodeURIComponent(launchId)}`);
    if(manifest.releaseId!==launchId||bootstrap.clientReleaseId!==launchId||['core','content','metadataSchema','saveFormat','api'].some(k=>manifest.versions[k as keyof Versions]!==bootstrap.versions[k as keyof Versions]))throw Error('Версии манифеста и API не совпали.');
    if(!bootstrap.capabilities.battle||bootstrap.versions.core!==CORE_VERSION||bootstrap.versions.saveFormat!==SNAPSHOT_VERSION)throw Error('Эта сборка не поддерживает игровую партию R3.');
    if(!bootstrap.contentUrl.startsWith('/td/api/v1/'))throw Error('Неизвестный адрес игрового контента.');
    const contentResponse=await fetch(bootstrap.contentUrl,{credentials:'same-origin'});if(!contentResponse.ok)throw Error('Игровой контент недоступен.');const projection=await contentResponse.json();const expectedHash=contentResponse.headers.get('ETag')?.match(/^"sha256-([a-f0-9]{64})"$/)?.[1];if(!expectedHash)throw Error('Не указан hash игрового контента.');const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(projection)));const actualHash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');if(actualHash!==expectedHash)throw Error('Целостность игрового контента не подтверждена.');
    content=parseContentProjection(projection);
    if(content.contentVersion!==bootstrap.versions.content||content.metadataSchemaVersion!==bootstrap.versions.metadataSchema)throw Error('Контент относится к другому релизу.');
    await api('/guest-session',{method:'POST',body:'{}'});profile=await api<Profile>('/profile');
    audio.settings(profile.settings.soundEnabled,profile.settings.volume);
    await showMenu();
  } catch(error){fail(error);}
}
async function showMenu() {
  stopBattle();loading('Читаем сохранённые партии…');
  try {
    const all=await store.list();
    const seen=new Set<string>();localCandidates=[];
    const selected=sessionStorage.getItem('last-throne-selected-record');
    all.sort((a,b)=>Number(b.key===selected)-Number(a.key===selected)||b.updatedAt-a.updatedAt);
    for(const r of all){if(!seen.has(r.runId)){seen.add(r.runId);localCandidates.push(r as LocalRun<GameSnapshot,FinishResult>);}}
    cloudCandidates=[];
    try { const response=await api<{runs:RunResponse[]}|RunResponse[]>('/runs');cloudCandidates=Array.isArray(response)?response:response.runs; }catch{cloudMessage='История сервера недоступна. Локальные партии можно открыть.';}
    const activeLocals=localCandidates.filter(r=>r.latestLocalCheckpoint&&!r.terminalRecord&&!cloudCandidates.some(c=>c.id===r.runId&&c.status!=='active'));
    const terminal=localCandidates.find(r=>r.terminalRecord);
    const finished=cloudCandidates.filter(r=>r.status!=='active'&&!localCandidates.some(l=>l.runId===r.id&&l.terminalRecord)).slice(0,3);
    const remotes=cloudCandidates.filter(r=>r.status==='active'&&!localCandidates.some(l=>l.runId===r.id));
    app.innerHTML=`<div class="boot"><main class="boot-card"><div class="brand-line"><div class="crest" aria-hidden="true">♜</div><div><div class="eyebrow">FOXYGAMES · TOWER DEFENCE</div><p class="small muted" style="margin-top:5px">R3 · пятнадцать волн, вылазки и снаряжение</p></div></div><h1>Последний<br>трон</h1><p class="lead">Пять героев защищают Древнего. Соберите оборону, отправляйте защитников в лагерь, лавку и к Рошану. Предметы и похищенная магия помогут пережить пятнадцать волн.</p><div class="menu-actions"><button class="primary" data-action="play">Новая партия</button>${activeLocals.map(local=>`<button data-action="continue-local" data-key="${esc(local.key)}">Продолжить ${releaseLabel(local.pins.coreVersion)} · волна ${local.latestLocalCheckpoint!.nextWave}</button>`).join('')}${remotes.map(remote=>`<button data-action="continue-cloud" data-id="${esc(remote.id)}">Облачная партия ${releaseLabel(remote.coreVersion)}</button>`).join('')}<button class="subtle" data-action="settings">Настройки</button></div><p class="menu-note">Квадратные фундаменты — для зданий. Круглые руны — для героев.<br>При перезагрузке во время боя волна начинается с последней контрольной точки. Гостевой профиль связан с этим браузером.<br>Сохранения R1/R2 открываются в своей проверенной версии — пять/десять волн.</p>${terminal?`<div class="history"><button class="subtle" data-action="local-result" data-key="${esc(terminal.key)}">Последний результат: ${terminal.terminalRecord!.outcome==='victory'?'победа':'поражение'} · открыть / синхронизировать</button></div>`:''}${finished.length?`<div class="history">${finished.map(r=>`<button class="subtle" data-action="cloud-result" data-id="${esc(r.id)}">Завершённая партия · ${r.status==='victory'?'победа':'поражение'}</button>`).join('')}</div>`:''}${cloudMessage?`<p class="small muted" style="margin-top:14px">${esc(cloudMessage)}</p>`:''}<p class="small muted desktop-note" style="margin-top:12px">R3 рассчитан на компьютер: мышь и клавиатура. Приёмка на телефоне пока не выполнена.</p></main></div>`;
  }catch(error){fail(error);}
}
function pins(): RunPins { return{clientReleaseId:launchId,coreVersion:bootstrap.versions.core,contentVersion:bootstrap.versions.content,metadataSchemaVersion:bootstrap.versions.metadataSchema,snapshotSchemaVersion:SNAPSHOT_VERSION}; }
function checkWebGl(){const canvas=document.createElement('canvas');const gl=canvas.getContext('webgl2');if(!gl)throw Error('Для игры требуется WebGL 2. Включите аппаратное ускорение браузера.');gl.getExtension('WEBGL_lose_context')?.loseContext();}
async function newGame() {
  loading('Готовим новую оборону…');
  try {
    checkWebGl();await audio.unlock().catch(()=>{});
    let pending: {clientRunId:string;seed:number;clientReleaseId:string;coreVersion:string;contentVersion:string};
    const previous=sessionStorage.getItem(`last-throne-create:${launchId}`);
    if(previous){pending=JSON.parse(previous);if(pending.clientReleaseId!==launchId)throw Error('Незавершённое создание относится к другому релизу. Откройте прежнюю сборку.');}
    else {const value=new Uint32Array(1);crypto.getRandomValues(value);pending={clientRunId:crypto.randomUUID(),seed:value[0],clientReleaseId:launchId,coreVersion:bootstrap.versions.core,contentVersion:bootstrap.versions.content};sessionStorage.setItem(`last-throne-create:${launchId}`,JSON.stringify(pending));}
    const created=await api<RunResponse>('/runs',{method:'POST',body:JSON.stringify(pending)});
    const g=createGame(content,pending.seed);
    const r:LocalRun<GameSnapshot,FinishResult>={key:`${pending.clientRunId}:${tabBranchId()}`,runId:created.id,clientRunId:pending.clientRunId,pins:pins(),seed:pending.seed,serverRevision:created.revision,localGeneration:1,confirmedGeneration:0,latestLocalCheckpoint:createSnapshot(g),terminalRecord:null,pendingOperation:null,conflict:null,updatedAt:Date.now()};
    await store.put(r);sessionStorage.setItem('last-throne-selected-record',r.key);sessionStorage.removeItem(`last-throne-create:${launchId}`);
    await mountBattle(g,r);await saves!.checkpoint(createSnapshot(g));
  }catch(error){fail(error);}
}
async function resumeLocal(key:string, resultOnly=false) {
  void audio.unlock().catch(()=>{});
  loading('Проверяем контрольную точку…');
  try {
    const source=await store.get(key) as LocalRun<GameSnapshot,FinishResult>|undefined;if(!source)throw Error('Локальная запись не найдена.');
    if(source.pins.clientReleaseId!==launchId){await verifyArchive(source.pins.clientReleaseId,{core:source.pins.coreVersion,content:source.pins.contentVersion,metadataSchema:source.pins.metadataSchemaVersion,saveFormat:source.pins.snapshotSchemaVersion,api:1});location.assign(`/td/releases/${encodeURIComponent(source.pins.clientReleaseId)}/web/index.html?resume=${encodeURIComponent(source.key)}`);return;}
    if(source.pins.coreVersion!==bootstrap.versions.core||source.pins.contentVersion!==content.contentVersion||source.pins.metadataSchemaVersion!==content.metadataSchemaVersion||source.pins.snapshotSchemaVersion!==SNAPSHOT_VERSION)throw Error('Сохранение несовместимо с этой сборкой. Исходная запись сохранена.');
    let remote:RunResponse|null=null;try{remote=await api(`/runs/${encodeURIComponent(source.runId)}`);}catch(error){if(error instanceof ApiError&&error.status===404)throw Error('Гостевой профиль не имеет доступа к этой партии. Локальная запись сохранена.');}
    const branched=await branchRecord(store,source) as LocalRun<GameSnapshot,FinishResult>;sessionStorage.setItem('last-throne-selected-record',branched.key);
    if(remote&&remote.status!=='active'&&!branched.terminalRecord){branched.conflict='Облачная партия уже завершена. Локальная ветка сохранена.';await store.put(branched);await showMenu();showToast(branched.conflict,true);return;}
    if(branched.terminalRecord||resultOnly){record=branched;saves=new SaveManager(record.key,store,onSaveStatus);void saves.sync();showStandaloneResult(branched.terminalRecord!);return;}
    if(!branched.latestLocalCheckpoint)throw Error('Безопасной контрольной точки пока нет.');
    const checked=validateSnapshot(branched.latestLocalCheckpoint,content,{core:bootstrap.versions.core,content:content.contentVersion,metadataSchema:content.metadataSchemaVersion});
    if(!checked.valid)throw Error(`Повреждённое сохранение: ${checked.errors.join(', ')}. Исходная запись сохранена.`);
    const g=restoreSnapshot(content,branched.latestLocalCheckpoint);await mountBattle(g,branched);void saves!.sync();showToast(`Продолжаем с подготовки к волне ${g.nextWave}.`);
  }catch(error){fail(error);}
}
async function resumeCloud(id:string) {
  void audio.unlock().catch(()=>{});
  loading('Загружаем облачную контрольную точку…');
  try {
    const run=await api<RunResponse>(`/runs/${encodeURIComponent(id)}`);
    if(run.status!=='active'){await showMenu();showToast('Эта партия уже завершена.');return;}
    if(run.clientReleaseId!==launchId){if(!run.clientReleaseId||!run.coreVersion||!run.contentVersion||!run.metadataSchemaVersion||!Number.isSafeInteger(run.snapshotSchemaVersion))throw Error('У облачной партии отсутствуют закреплённые версии.');await verifyArchive(run.clientReleaseId,{core:run.coreVersion,content:run.contentVersion,metadataSchema:run.metadataSchemaVersion,saveFormat:run.snapshotSchemaVersion,api:1});location.assign(`/td/releases/${encodeURIComponent(run.clientReleaseId)}/web/index.html?cloud=${encodeURIComponent(id)}`);return;}
    const checkpoint=await api<{revision:number;snapshotSchemaVersion:number;snapshot:GameSnapshot}>(`/runs/${encodeURIComponent(id)}/checkpoint`);
    const g=restoreSnapshot(content,checkpoint.snapshot);
    const clientRunId=crypto.randomUUID();const r:LocalRun<GameSnapshot,FinishResult>={key:`${clientRunId}:${tabBranchId()}`,clientRunId,runId:id,pins:pins(),seed:g.seed,serverRevision:('runRevision' in checkpoint?Number(checkpoint.runRevision):run.revision),localGeneration:1,confirmedGeneration:1,latestLocalCheckpoint:checkpoint.snapshot,pendingOperation:null,terminalRecord:null,conflict:null,updatedAt:Date.now()};
    await store.put(r);sessionStorage.setItem('last-throne-selected-record',r.key);await mountBattle(g,r);
  }catch(error){fail(error);}
}
function onSaveStatus(status:SaveStatus,r:LocalRun<GameSnapshot,FinishResult>,message?:string){record=r;saveStatus=status;cloudMessage=message??'';renderSaveState();}
function renderSaveState(){
  const box=document.querySelector<HTMLElement>('#save-state');if(box)box.dataset.status=saveStatus;
  const labels={device:'Сохранено на устройстве',server:'Сохранено на сервере',saving:'На устройстве · синхронизация',error:'На устройстве · облако недоступно',conflict:'Конфликт · локальная ветка сохранена'};
  const wave=record?.latestLocalCheckpoint?.nextWave;
  const saveHtml=`<span class="status-dot"></span>${labels[saveStatus]}${wave?`<div>Контрольная точка: перед волной ${wave}</div>`:''}${cloudMessage?`<div>${esc(cloudMessage)}</div>`:''}${saveStatus==='error'?'<button data-action="sync">Повторить синхронизацию</button>':''}${saveStatus==='conflict'?'<button data-action="open-cloud">Открыть облачную ветку</button>':''}`;
  if(box&&saveSignature!==saveHtml){saveSignature=saveHtml;preserveFocus(box,saveHtml);}
  const resultSave=document.querySelector('#result-save');if(resultSave)resultSave.textContent=labels[saveStatus];
}
async function mountBattle(g:GameState,r:LocalRun<GameSnapshot,FinishResult>){
  stopBattle(true);game=g;record=r;seq=0;expeditionDraft=null;itemChoice=null;rewardChoice=null;discardRewardId=null;checkpointTasks=0;startingWave=false;selection=null;aim=null;teleportTarget=null;previewKind=null;usedAbility=false;recentEvents=[];eventTotals={};contextLost=false;panelSignature='';barSignature='';waveSignature='';saveSignature='';cloudMessage='';saveStatus='device';
  saves=new SaveManager(r.key,store,onSaveStatus);
  app.innerHTML=`<main class="shell"><header class="topbar"><div class="brand">Последний трон<small>FOXYGAMES · R3</small></div><div class="top-stats"><div class="stat"><span>Волна</span><strong id="wave-stat"></strong></div><div class="stat gold"><span>Золото</span><strong id="gold-stat"></strong></div><div class="stat"><span>Древний</span><strong id="throne-stat"></strong><div class="throne-meter"><i id="throne-fill"></i></div></div></div><div class="top-controls"><button class="subtle" data-action="overview">Площадки</button><button class="subtle" data-action="expeditions">Вылазки</button><button data-action="pause" id="pause-button">Пауза <span class="hotkey">Space</span></button><button data-action="settings">⚙ <span class="small">Настройки</span></button><button class="subtle" data-action="menu">Меню</button></div></header><div class="battle-layout"><div class="arena"><canvas id="battle-canvas" tabindex="0" aria-label="Поле боя. Для действий клавиатурой используйте список площадок и героев справа."></canvas><div class="map-caption">ТРИ ЛИНИИ / ЗАЩИТА ДРЕВНЕГО</div><div class="aim-banner hidden" id="aim-banner"></div><div class="legend"><span><i class="square"></i>Построить</span><span><i class="round"></i>Разместить героя</span></div></div><aside class="sidebar" aria-label="Действия"><div id="context-panel"></div><div id="wave-panel"></div><div class="tutorial" id="tutorial"></div><div class="save-state" id="save-state" role="status"></div></aside></div><footer class="hero-bar" id="hero-bar"></footer></main>`;
  const canvas=document.querySelector<HTMLCanvasElement>('#battle-canvas')!;
  renderer=createRenderer(canvas,content,onPick,onContextState);let resourceTimeout:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([renderer.ready(),new Promise<never>((_,reject)=>{resourceTimeout=setTimeout(()=>reject(Error('Графические ресурсы не подготовились. Повторите загрузку; контрольная точка сохранена.')),20000);})]);}finally{if(resourceTimeout)clearTimeout(resourceTimeout);}
  renderer.setQuality(profile.settings.quality==='low'?'low':'high');audio.settings(profile.settings.soundEnabled,profile.settings.volume);
  renderUi();previousTime=performance.now();accumulator=0;frame=requestAnimationFrame(loop);
}
function stopBattle(preserveAudio=false){if(!preserveAudio){audio.dispose();audio=createAudio();if(profile)audio.settings(profile.settings.soundEnabled,profile.settings.volume);}if(frame)cancelAnimationFrame(frame);frame=0;startingWave=false;savingLocal=false;renderer?.dispose();renderer=null;saves?.dispose();saves=null;game=null;previousTime=0;accumulator=0;document.querySelector('.modal-backdrop')?.remove();modalOpen=false;app.inert=false;}
function onContextState(state:{state:string;message?:string}){
  if(state.state==='lost'){contextLost=true;if(game&&(game.phase==='wave'||game.phase==='preparation'))issue('pause');accumulator=0;showModal('Графика приостановлена','Браузер потерял графический контекст. Партия остановлена; контрольная точка сохранена.',[{action:'menu-confirm',label:'В меню'}]);}
  else if(state.state==='restored'){contextLost=false;showModal('Графика восстановлена','Игровое время не догонялось. Продолжите партию, когда будете готовы.',[{action:'resume',label:'Продолжить',primary:true},{action:'menu-confirm',label:'В меню'}]);}
  else{contextLost=true;if(game&&(game.phase==='wave'||game.phase==='preparation'))issue('pause');showModal('Графика недоступна',state.message??'Не удалось отрисовать сцену. Контрольная точка сохранена.',[{action:'menu-confirm',label:'В меню'}]);}
}
function issue(type:CommandType,payload:Record<string,unknown>={},actorId?:string){
  if(!game)return;if(startingWave&&!['pause','resume','start_wave'].includes(type)){showToast('Дождитесь записи контрольной точки перед волной.');return;}const wasPreparation=game.phase==='preparation';const result=submitCommand(game,{commandId:crypto.randomUUID(),tick:game.simTick+(game.phase==='wave'&&type!=='pause'?1:0),sequence:seq++,type,payload,...(actorId?{actorId}:{})});
  if(result.status==='rejected')showToast(reasons[result.code]??`Действие отклонено: ${result.code}`,true);else if(type==='build'||type==='upgrade'||type==='cast'||type==='teleport')void audio.unlock().catch(()=>{});
  if(result.status==='accepted'){if(type==='pause')void audio.suspend();if(type==='resume')void audio.unlock().catch(()=>{});if(wasPreparation&&['send_expedition','equip_item','choose_reward','discard_reward','set_priority'].includes(type))persistPreparation();}
  renderUi(true);return result;
}
async function startWave(){if(!game||game.phase!=='preparation'||savingLocal||contextLost||game.pendingRewards.length||!saves)return;
  const current=game,manager=saves;startingWave=true;savingLocal=true;renderUi(true);
  try{await manager.checkpoint(createSnapshot(current));if(game===current&&game.phase==='preparation'&&!contextLost)issue('start_wave');}
  catch{if(game===current)showToast('Не удалось записать локальную контрольную точку. Волна не началась; повторите.',true);}
  finally{if(game===current){startingWave=false;savingLocal=checkpointTasks>0;renderUi(true);}}
}
function selectedHero(){return game?.heroes.find(h=>h.id===selection?.id&&selection.kind==='hero');}
function selectedBuilding(){return game?.buildings.find(b=>(selection?.kind==='building'&&b.id===selection.id)||(selection?.kind==='pad'&&b.padId===selection.id));}
function choose(kind:string,id:string){selection={kind,id};expeditionDraft=null;itemChoice=null;aim=null;teleportTarget=null;previewKind=null;renderer?.select(selection as never);renderUi(true);}
function onPick(pick:RendererPick){
  if(!game||modalOpen)return;
  const hero=selectedHero();
  if(aim==='cast'&&hero){
    if(targetedAbility(hero)){if(pick.kind!=='enemy'||!pick.id){showToast(hero.kind==='rubick'?'Для кражи выберите командира с заклинанием.':'Выберите видимого врага в радиусе.',true);return;}issue('cast',{targetId:pick.id},hero.id);}
    else issue('cast',{x:Math.round(pick.x),y:Math.round(pick.y)},hero.id);
    aim=null;renderer?.select(selection as never);renderUi(true);return;
  }
  if(aim==='teleport'&&hero){if(pick.kind!=='anchor'||!pick.id){showToast('Выберите свободную круглую позицию.',true);return;}teleportTarget=pick.id;renderUi(true);return;}
  if(pick.kind==='expedition'&&pick.id){selectDestination(pick.id as ExpeditionKind);return;}
  if(pick.id&&['pad','anchor','hero','building','enemy'].includes(pick.kind))choose(pick.kind,pick.id);
  else{selection=null;renderer?.select(null);renderUi(true);}
}
function loop(now:number){
  if(!game||!renderer)return;
  const delta=Math.min(.25,Math.max(0,(now-previousTime)/1000));previousTime=now;
  if(game.phase==='wave'&&!contextLost&&!document.hidden){accumulator=Math.min(accumulator+delta,.25);while(accumulator>=1/30&&game.phase==='wave'){advanceTicks(game,1);accumulator-=1/30;}}
  else accumulator=0;
  const events=drainEvents(game);
  for(const event of events)handleEvent(event);
  try{if(!contextLost)renderer.render(game,events,delta);}catch(error){contextLost=true;issue('pause');showModal('Графика недоступна',error instanceof Error?error.message:'Ошибка графики.',[{action:'menu-confirm',label:'В меню'}]);}
  if(now-lastUiTime>150){renderUi();lastUiTime=now;}
  frame=requestAnimationFrame(loop);
}
function handleEvent(event:GameEvent){
  for(const key of [event.type,...(event.spellId?[`spell:${event.type}:${event.spellId}`]:[]),...(event.effectId?[`effect:${event.effectId}`]:[])])eventTotals[key]=(eventTotals[key]??0)+1;
  recentEvents.push(structuredClone(event));if(recentEvents.length>120)recentEvents.shift();
  if(event.type==='command_result'&&event.reason==='rejected')showToast(reasons[event.code??'']??`Действие отклонено: ${event.code}`,true);
  if(event.effectId==='expedition_return')showToast(event.kind==='shop'?'Герой вернулся из лавки. Выберите и сохраните награду.':event.kind==='roshan'?'Герой вернулся с Aegis — одно личное воскрешение.':'Герой вернулся из лагеря. Золото получено.');
  if(event.effectId==='aegis_revive')showToast('Aegis израсходован: герой воскрес на своей позиции.');
  if(['expedition_depart','expedition_return','item_equipped','aegis_revive','healing_aura','detection_reveal','enemy_heal'].includes(event.effectId??'')||event.type==='reward_pending'||event.type==='commander_cast')audio.cue(event.effectId??event.type);
  if(event.type==='spell_stolen')showToast(`Rubick получил: ${spellLabel(event.spellId)}. Выберите область для применения.`);
  if(event.type==='cast_started'){usedAbility=true;audio.cue(event.effectId??'cast');}
  if(['construction_started','teleport_started','hero_relocated','upgraded'].includes(event.type))audio.cue(event.effectId??event.type);
  if(event.type==='wave_finished'&&game?.phase==='preparation'){
    persistPreparation('Локальное сохранение не удалось. Перед следующей волной повторите запись.');
    showToast(`Волна ${event.wave} отражена. Награда уже добавлена.`);
  }
  if(event.type==='run_finished'&&game){const result=getFinishResult(game);void saves!.finish(result).catch(()=>showToast('Результат не записан на устройство. Нажмите «Повторить сохранение».',true));showResult(result);}
}
function preserveFocus(container:HTMLElement,html:string){
  const active=document.activeElement as HTMLElement|null;const focusKey=container.contains(active)?active?.dataset.focus:undefined;
  container.innerHTML=html;
  for(const control of container.querySelectorAll<HTMLElement>('[data-action]')){
    if(!control.dataset.focus)control.dataset.focus=[control.dataset.action,control.dataset.id,control.dataset.kind,control.dataset.priority,control.dataset.anchor,control.dataset.x,control.dataset.y].map(value=>value??'').join('|');
  }
  if(focusKey)container.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus({preventScroll:true});
}
function renderUi(force=false){
  if(!game)return;
  const text=(id:string,value:string)=>{const node=document.getElementById(id);if(node&&node.textContent!==value)node.textContent=value;};
  text('wave-stat',`${game.activeWave??game.nextWave??content.waves.length} / ${content.waves.length}${game.phase==='preparation'?' · подготовка':game.phase==='paused'?' · пауза':''}`);text('gold-stat',String(game.gold));text('throne-stat',`${game.throneHp} / ${content.throneHp}`);
  const fill=document.querySelector<HTMLElement>('#throne-fill');if(fill)fill.style.width=`${Math.max(0,game.throneHp/content.throneHp*100)}%`;
  const pause=document.querySelector<HTMLElement>('#pause-button');if(pause)pause.innerHTML=`${game.phase==='paused'?'Продолжить':'Пауза'} <span class="hotkey">Space</span>`;
  const hero=selectedHero();
  const contextHtml=panelHtml();
  if(contextHtml!==panelSignature){panelSignature=contextHtml;const panel=document.querySelector<HTMLElement>('#context-panel');if(panel)preserveFocus(panel,contextHtml);}
  const wave=content.waves.find(w=>w.number===(game!.nextWave??game!.activeWave));
  const wp=document.querySelector<HTMLElement>('#wave-panel');
  const rewardHtml=pendingRewardsHtml(content,game,rewardChoice,discardRewardId);
  const nextWaveHtml=game.phase==='preparation'?`<div class="panel-divider"></div><p class="section-label">Следующая волна ${game.nextWave}</p><p class="wave-preview">${wave?.groups.map(g=>{const definition=content.enemies.find(e=>e.kind===g.enemyKind);return `${definition?.sidePath?'Боковой обход':['Верх','Центр','Низ'][g.lane]}: ${g.count} × ${esc(definition?.label)}${definition?.hidden?' · скрытый, нужно обнаружение':''}`;}).join('<br>')??''}</p><button class="primary" style="width:100%;margin-top:12px" data-action="start-wave" data-focus="start-wave" ${savingLocal||game.pendingRewards.length?'disabled':''}>${savingLocal?'Записываем контрольную точку…':game.pendingRewards.length?'Сначала решите судьбу награды':`Начать волну ${game.nextWave}`}</button>`:game.phase==='paused'?'<button class="primary" style="width:100%" data-action="resume" data-focus="wave-resume">Продолжить игру</button>':`<p class="small muted">Волна идёт · видимых врагов ${game.enemies.filter(e=>e.visible).length}<br>Вылазки и перезарядки идут только по игровым тактам.</p>`;
  const waveHtml=rewardHtml+nextWaveHtml;
  // Compare source strings: browser HTML serialization normalizes whitespace/attributes.
  if(wp&&waveSignature!==waveHtml){waveSignature=waveHtml;preserveFocus(wp,waveHtml);}
  const tutorial=document.querySelector<HTMLElement>('#tutorial');if(tutorial){const step=!game.buildings.length?'Выберите квадратный фундамент и постройте защиту.':!game.heroes.some(h=>h.level>1)&&!game.buildings.some(b=>b.level>1)?'Выберите защитника и купите улучшение.':!usedAbility?'Начните волну. Выберите героя, нажмите Q и укажите цель способности.':'Круги — герои, квадраты — здания. Вы готовы защищать Древнего.';tutorial.innerHTML=`<h3>Полевой инструктаж</h3><p>${step}</p>`;}
  const bar=document.querySelector<HTMLElement>('#hero-bar');const barHtml=game.heroes.map((h,i)=>`<button class="hero-card${selection?.kind==='hero'&&selection.id===h.id?' selected':''}${h.expedition?' absent':''}" data-action="select-hero" data-id="${esc(h.id)}" data-focus="hero-${esc(h.id)}"><div class="portrait ${h.kind}" aria-hidden="true">${({pudge:'P',shaman:'S',undying:'U',rubick:'R',sniper:'N'})[h.kind]}</div><div class="hero-info"><strong>${esc(content.heroes.find(d=>d.kind===h.kind)!.label)} <span class="hotkey">${i+1}</span></strong><p>Ур. ${h.level} · ${esc(heroStateText(content,h))}</p>${h.expedition?`<progress class="hero-expedition-progress" max="${h.expedition.totalTicks}" value="${h.expedition.totalTicks-h.expedition.remainingTicks}" aria-label="Ход вылазки"></progress>`:`<div class="hero-hp"><i style="width:${Math.max(0,h.hp/h.maxHp*100)}%"></i></div>`}<div class="card-inventory">${h.items.map((id,slot)=>`<span title="Слот ${slot+1}: ${esc(content.items.find(i=>i.id===id)?.label??'пусто')}" aria-label="Слот ${slot+1}: ${esc(content.items.find(i=>i.id===id)?.label??'пусто')}">${id?'✦':'◇'}</span>`).join('')}<span class="card-aegis${h.aegisToken?' active':''}" title="${h.aegisToken?'Aegis: одно личное воскрешение':'Aegis отсутствует'}">♜</span>${h.expedition?'<em>Вне обороны</em>':''}</div></div></button>`).join('')+'<div class="hero-bar-help"><span class="hotkey">1–5</span> — герои · <span class="hotkey">Q</span> — способность<br><span class="hotkey">T</span> — перенос · <span class="hotkey">Esc</span> — отмена</div>';
  if(bar&&(force||barSignature!==barHtml)){barSignature=barHtml;preserveFocus(bar,barHtml);}
  const banner=document.querySelector<HTMLElement>('#aim-banner');if(banner){banner.classList.toggle('hidden',!aim);banner.textContent=aim==='cast'&&hero?abilityHint(hero):aim==='teleport'?'Перенос: выберите свободную круглую позицию':'';}
  const contextPanel=document.querySelector<HTMLElement>('#context-panel');contextPanel?.setAttribute('aria-busy',String(startingWave));
  for(const button of app.querySelectorAll<HTMLButtonElement>('button[data-action]')){
    if(!preparationMutationActions.has(button.dataset.action??''))continue;
    if(startingWave){button.dataset.preparationDisabled??=String(button.disabled);button.disabled=true;}
    else if(button.dataset.preparationDisabled!==undefined){button.disabled=button.dataset.preparationDisabled==='true';delete button.dataset.preparationDisabled;}
  }
  renderSaveState();
}
function spellLabel(id:string|null|undefined){return content?.spells.find(spell=>spell.behaviorId===id)?.label??'Неизвестное заклинание';}
function targetedAbility(hero:GameState['heroes'][number]){return hero.kind==='pudge'||hero.kind==='sniper'||hero.kind==='rubick'&&!hero.stolenSpell;}
function abilityCooldown(hero:GameState['heroes'][number]){return hero.kind==='rubick'&&!hero.stolenSpell?hero.stealCooldown:hero.abilityCooldown;}
function abilityLabel(hero:GameState['heroes'][number]){return hero.kind==='rubick'?(hero.stolenSpell?`Применить: ${spellLabel(hero.stolenSpell)}`:'Украсть заклинание'):({pudge:'Мясной крюк',shaman:'Змеиные стражи',undying:'Надгробие',sniper:'Прицельный выстрел'})[hero.kind];}
function abilityHint(hero:GameState['heroes'][number]){return targetedAbility(hero)?hero.kind==='rubick'?'Кража: выберите командира с последним заклинанием':`${abilityLabel(hero)}: выберите врага в радиусе`:`${abilityLabel(hero)}: выберите область в радиусе`;}
function heroDescription(hero:GameState['heroes'][number]){return ({pudge:'Притягивает одного врага к себе.',shaman:'Поднимает временных змеиных стражей.',undying:'Поднимает надгробие, из которого выходят временные зомби.',rubick:'Забирает последнее заклинание командира. Следующий каст применяет его на вашей стороне.',sniper:'Дальняя автоматическая стрельба. Ручной выстрел готовится по выбранной цели; исчезнувшая цель даёт промах.'})[hero.kind];}
function panelHtml(){
  if(!game)return'';const hero=selectedHero(),building=selectedBuilding();
  if(selection?.kind==='expedition'){
    const destination=content.expeditions.find(d=>d.kind===selection!.id);if(destination)return `<div class="stack"><p class="section-label">Вылазка · ${esc(destination.label)}</p><h2>${destinationIcon(destination.kind)} ${esc(destination.label)}</h2><p class="context-hint">${destination.durationTicks/30} с боевого времени.<br>Награда: ${esc(expeditionReward(content,destination.kind))}.<br>Выберите героя. Он уйдёт из обороны после подтверждения.</p>${game.heroes.map(h=>`<button data-action="expedition-hero" data-id="${h.id}" data-kind="${destination.kind}" data-focus="expedition-hero-${h.id}" ${game!.phase!=='preparation'||h.hp<=0||h.expedition||h.teleport||game!.heroes.some(h=>h.expedition)?'disabled':''}>${esc(content.heroes.find(d=>d.kind===h.kind)?.label)} · ${esc(heroStateText(content,h))}</button>`).join('')}</div>`;
  }
  if(hero){const definition=content.heroes.find(h=>h.kind===hero.kind)!;const cost=definition.upgradeCosts[hero.level-1];const ability=abilityLabel(hero);const cooldown=abilityCooldown(hero);
    let actions=`<button data-action="ability" data-focus="ability" ${game.phase!=='wave'||hero.hp<=0||hero.expedition||cooldown>0||hero.teleport?'disabled':''}>${ability} <span class="hotkey">Q</span>${cooldown?` · ${Math.ceil(cooldown/30)} с`:''}</button>`;
    if(hero.kind==='rubick')actions+=`<div class="spell-slot" role="status"><strong>${hero.stolenSpell?esc(spellLabel(hero.stolenSpell)):'Пустой слот'}</strong><p class="small muted">Кража: ${hero.stealCooldown?`${Math.ceil(hero.stealCooldown/30)} с`:'готова'} · применение: ${hero.abilityCooldown?`${Math.ceil(hero.abilityCooldown/30)} с`:'готово'}</p></div>`;
    if(hero.kind==='sniper')actions+=`<p class="small muted">Приоритет автоматической стрельбы</p><div class="priority-buttons">${(['nearest','strongest','commander'] as const).map(priority=>`<button class="subtle${hero.priority===priority?' selected':''}" data-action="priority" data-priority="${priority}" data-focus="priority-${priority}" aria-pressed="${hero.priority===priority}" ${hero.expedition?'disabled':''}>${({nearest:'Ближайший',strongest:'Сильнейший',commander:'Командир'})[priority]}</button>`).join('')}</div>`;
    actions+=hero.level<3?`<button class="gold" data-action="upgrade" data-focus="upgrade" ${game.gold<cost||hero.hp<=0||hero.expedition?'disabled':''}>Уровень ${hero.level+1} · ${cost} золота</button><p class="small muted">Больше HP и урона; радиус атаки +25.</p>`:'<p class="small muted">Максимальный уровень</p>';
    actions+=`<button data-action="teleport-mode" data-focus="teleport" ${hero.hp<=0||hero.expedition||hero.teleport?'disabled':''}>${game.phase==='preparation'?'Переставить бесплатно':'Телепортировать'} <span class="hotkey">T</span></button>`;
    if(aim==='cast'){
      const targets=game.enemies.filter(e=>e.hp>0&&e.visible&&(e.x-hero.x)**2+(e.y-hero.y)**2<=definition.abilityRange**2&&(hero.kind==='pudge'?content.enemies.find(d=>d.kind===e.kind)?.movable:hero.kind==='rubick'?content.enemies.find(d=>d.kind===e.kind)?.commander&&e.lastSpell&&e.stealable:true));
      if(targetedAbility(hero))actions+=`<p class="context-hint">${hero.kind==='rubick'?'Выберите командира с последним заклинанием:':'Выберите врага на поле или здесь:'}</p>${targets.slice(0,8).map(e=>`<button class="subtle" data-action="cast-enemy" data-id="${esc(e.id)}" data-focus="target-${esc(e.id)}">${esc(content.enemies.find(d=>d.kind===e.kind)?.label)} · ${['верх','центр','низ'][e.lane]}${hero.kind==='rubick'?` · ${esc(spellLabel(e.lastSpell))}`:''}</button>`).join('')||'<p class="small muted">Допустимые цели ещё не подошли.</p>'}`;
      else actions+=`<p class="context-hint">Щёлкните по области в светящемся радиусе. Быстрые точки:</p><button class="subtle" data-action="cast-area" data-x="${hero.x}" data-y="${hero.y}" data-focus="cast-self">Вокруг героя</button>${content.map.paths.map((path,lane)=>{const target=[...path].sort((a,b)=>(a.x-hero.x)**2+(a.y-hero.y)**2-((b.x-hero.x)**2+(b.y-hero.y)**2))[0];return `<button class="subtle" data-action="cast-area" data-x="${target.x}" data-y="${target.y}" data-focus="cast-lane-${lane}">${['Верхняя','Средняя','Нижняя'][lane]} линия</button>`;}).join('')}`;
    }
    if(aim==='teleport'){
      if(game.phase==='wave')actions+=`<p class="context-hint">Канал ${(content.teleportTicks/30).toFixed(1)} с. Свитков: ${game.scrolls}. Герой не атакует во время переноса.</p>${!game.scrolls?`<button class="gold" data-action="buy-scroll" ${game.gold<content.scrollCost?'disabled':''}>Купить свиток · ${content.scrollCost}</button>`:''}`;
      actions+=content.map.places.filter(p=>p.kind==='hero_anchor'&&!game!.heroes.some(h=>h.anchorId===p.id||h.teleport?.targetAnchorId===p.id)).map(p=>`<button class="subtle${teleportTarget===p.id?' selected':''}" data-action="teleport-target" data-id="${esc(p.id)}" data-focus="anchor-${esc(p.id)}">◯ ${placeLabel(p.id)}</button>`).join('');
      if(teleportTarget)actions+=`<button class="primary" data-action="teleport-confirm" ${game.phase==='wave'&&!game.scrolls?'disabled':''}>${game.phase==='preparation'?'Подтвердить перестановку':'Подтвердить · 1 свиток'}</button>`;
    }
    if(aim)actions+='<button class="subtle" data-action="cancel">Отмена <span class="hotkey">Esc</span></button>';
    return `<div class="stack"><p class="section-label">Герой · круглая позиция</p><h2>${esc(definition.label)}</h2><p class="context-hint">${`${esc(heroStateText(content,hero))} · уровень ${hero.level}`}<br>${heroDescription(hero)}</p>${hero.expedition?expeditionHtml(content,game,hero,null):''}<div class="panel-actions">${actions}</div>${inventoryHtml(content,hero)}${itemPurchaseHtml(content,game,hero,itemChoice)}${!hero.expedition?expeditionHtml(content,game,hero,expeditionDraft):''}</div>`;
  }
  if(building){const definition=content.buildings.find(b=>b.kind===building.kind)!;const cost=definition.upgradeCosts[building.level-1];return `<div class="stack"><p class="section-label">Здание · квадратный фундамент</p><h2>${esc(definition.label)}</h2><p class="context-hint">Уровень ${building.level} · ${building.hp}/${building.maxHp} HP${building.constructionTicks?`<br>Строительство: ${Math.ceil(building.constructionTicks/30)} с`:''}</p><div class="panel-actions">${building.level<3?`<button class="gold" data-action="upgrade" data-focus="upgrade" ${game.gold<cost||building.constructionTicks>0?'disabled':''}>Уровень ${building.level+1} · ${cost} золота</button><p class="small muted">Больше HP и урона; радиус +20.</p>`:'<p class="small muted">Максимальный уровень</p>'}<button class="danger" data-action="sell" ${game.phase!=='preparation'?'disabled':''}>Продать · возврат ${Math.floor(building.spentGold*content.sellPercent/100)}</button><p class="small muted">Продажа доступна между волнами.</p></div></div>`;}
  if(selection?.kind==='pad')return `<div class="stack"><p class="section-label">Построить · ${placeLabel(selection.id)}</p><h2>Свободный фундамент</h2><p class="context-hint">Выберите здание. Призрачная модель показывает размещение и радиус; отмена бесплатна.</p>${content.buildings.map(b=>`<button class="choice${previewKind===b.kind?' selected':''}" data-action="preview" data-kind="${b.kind}" data-focus="preview-${b.kind}"><strong>${esc(b.label)}</strong><span>${b.kind==='ballista'?'Физический урон, точная одиночная цель.':b.kind==='magic_tower'?'Цепная молния по нескольким врагам.':'Пульс замедления в области, чтобы задержать волну.'}</span><span class="price">${b.cost} золота · радиус ${b.range}</span></button>`).join('')}${previewKind?`<button class="primary" data-action="build-confirm" data-focus="build-confirm" ${game.gold<content.buildings.find(b=>b.kind===previewKind)!.cost?'disabled':''}>Подтвердить постройку</button>${game.gold<content.buildings.find(b=>b.kind===previewKind)!.cost?'<p class="small" style="color:#efb096">Не хватает золота.</p>':''}<button class="subtle" data-action="cancel">Отменить preview</button>`:''}</div>`;
  if(selection?.kind==='anchor'){const occupant=game.heroes.find(h=>h.anchorId===selection!.id||h.teleport?.targetAnchorId===selection!.id);return `<div class="stack"><p class="section-label">Разместить героя</p><h2>Круглая позиция</h2><p class="context-hint">${placeLabel(selection.id)}<br>${occupant?'Занято или зарезервировано героем.':'Выберите героя, затем подтвердите перенос.'}</p>${game.heroes.map(h=>`<button data-action="select-for-anchor" data-id="${esc(h.id)}" data-anchor="${esc(selection!.id)}" ${occupant||h.hp<=0||h.expedition?'disabled':''}>${esc(content.heroes.find(d=>d.kind===h.kind)!.label)}</button>`).join('')}</div>`;}
  if(selection?.kind==='enemy'){const e=game.enemies.find(e=>e.id===selection!.id);if(e&&e.visible)return `<div class="stack"><p class="section-label">Противник</p><h2>${esc(content.enemies.find(d=>d.kind===e.kind)?.label)}</h2><p class="context-hint">${e.hp}/${e.maxHp} HP · ${content.enemies.find(d=>d.kind===e.kind)?.sidePath?'Боковой обход':`${['Верхняя','Средняя','Нижняя'][e.lane]} линия`}${content.enemies.find(d=>d.kind===e.kind)?.commander?`<br>Последнее заклинание: ${e.lastSpell?esc(spellLabel(e.lastSpell)):'ещё не применял'}`:''}</p></div>`;}
  return `<div class="stack"><p class="section-label">Оборона Древнего</p><h2>Соберите защиту</h2><p class="context-hint">Нажмите на <strong style="color:#efc676">квадратный фундамент</strong>, чтобы строить, или на <strong style="color:#8fe0b5">круглую руну</strong>, чтобы поставить героя.</p><details><summary class="small" style="cursor:pointer;color:#e4d5b6">Фундаменты · управление клавиатурой</summary><div class="stack" style="gap:6px;margin-top:10px">${content.map.places.filter(p=>p.kind==='building_pad').sort((a,b)=>a.id.localeCompare(b.id)).map(p=>`<button class="subtle" data-action="select-pad" data-id="${esc(p.id)}" data-focus="pad-${esc(p.id)}">▣ ${placeLabel(p.id)}${game!.buildings.some(b=>b.padId===p.id)?' · занято':''}</button>`).join('')}</div></details><div class="destination-shortcuts" aria-label="Цели вылазок">${content.expeditions.map(d=>`<button class="subtle ${d.kind}" data-action="destination" data-kind="${d.kind}" data-focus="destination-${d.kind}">${destinationIcon(d.kind)} ${esc(d.label)}</button>`).join('')}</div><p class="small muted">Вылазки отправляются между волнами: герой временно покидает оборону.</p></div>`;
}
function showModal(title:string,message:string,actions:Array<{action:string;label:string;primary?:boolean}>){lastFocus=document.activeElement as HTMLElement;app.inert=true;document.querySelector('.modal-backdrop')?.remove();modalOpen=true;const el=document.createElement('div');el.className='modal-backdrop';el.innerHTML=`<section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2><p>${esc(message)}</p><div class="stack">${actions.map(a=>`<button class="${a.primary?'primary':'subtle'}" data-action="${a.action}">${esc(a.label)}</button>`).join('')}</div></section>`;document.body.append(el);el.querySelector<HTMLButtonElement>('button')?.focus();}
function closeModal(){document.querySelector('.modal-backdrop')?.remove();modalOpen=false;app.inert=false;if(lastFocus?.isConnected)lastFocus.focus();}
function showResult(result:FinishResult,cloudOnly=false){void audio.suspend();showModal(result.outcome==='victory'?'Древний выстоял':'Древний пал',result.outcome==='victory'?`${result.lastCompletedWave} волн отражены. Ночь принадлежит вашим героям.`:'Оборона сломлена. Измените расстановку и попробуйте снова.',[...(cloudOnly?[]:[{action:'result-save',label:'Повторить сохранение'}]),{action:'menu-confirm',label:'В меню',primary:true}]);const section=document.querySelector('.modal')!;const stats=document.createElement('div');stats.className='summary-grid';stats.innerHTML=`<div><span>Волн отражено</span><strong>${result.lastCompletedWave}</strong></div><div><span>Побеждено врагов</span><strong>${result.statistics.kills}</strong></div><div><span>Игровое время</span><strong>${Math.floor(result.simTick/30)} с</strong></div><div><span>Древний</span><strong>${result.throneHp} HP</strong></div>`;section.insertBefore(stats,section.lastElementChild);const status=document.createElement('p');status.id='result-save';status.className='small';section.append(status);renderSaveState();}
function showStandaloneResult(result:FinishResult,cloudOnly=false){app.innerHTML='<div class="boot"><div class="boot-card"><div class="eyebrow">ИТОГ ПАРТИИ</div><h1>Последний трон</h1><p class="lead">Результат сохранён на этом устройстве.</p><button data-action="menu-confirm">В меню</button></div></div>';showResult(result,cloudOnly);if(cloudOnly){const p=document.querySelector('#result-save');if(p)p.textContent='Результат сохранён на сервере.';}}
function showSettings(){if(game&&(game.phase==='wave'||game.phase==='preparation'))issue('pause');closeModal();lastFocus=document.activeElement as HTMLElement;app.inert=true;modalOpen=true;const el=document.createElement('div');el.className='modal-backdrop';el.innerHTML=`<section class="modal" role="dialog" aria-modal="true" aria-label="Настройки"><h2>Настройки</h2><label class="settings-row">Звук <input id="sound-setting" type="checkbox" ${profile.settings.soundEnabled?'checked':''}></label><label class="settings-row">Громкость <input id="volume-setting" type="range" min="0" max="1" step="0.05" value="${profile.settings.volume}"></label><label class="settings-row">Графика <select id="quality-setting"><option value="high" ${profile.settings.quality!=='low'?'selected':''}>Обычная</option><option value="low" ${profile.settings.quality==='low'?'selected':''}>Низкая</option></select></label><p class="small muted">В низком качестве сохраняются цели, опасные зоны и разница площадок. При уходе с вкладки игра всегда ставится на паузу.</p><button class="primary" data-action="settings-save">Сохранить</button></section>`;document.body.append(el);el.querySelector<HTMLInputElement>('input')?.focus();}
async function saveSettings(){const settings={soundEnabled:document.querySelector<HTMLInputElement>('#sound-setting')!.checked,volume:Number(document.querySelector<HTMLInputElement>('#volume-setting')!.value),quality:document.querySelector<HTMLSelectElement>('#quality-setting')!.value as 'low'|'high'};audio.settings(settings.soundEnabled,settings.volume);void audio.unlock().catch(()=>{});try{profile=await api<Profile>('/profile',{method:'PATCH',body:JSON.stringify({expectedRevision:profile.revision,settings})});audio.settings(profile.settings.soundEnabled,profile.settings.volume);renderer?.setQuality(profile.settings.quality==='low'?'low':'high');closeModal();if(game?.phase==='paused')issue('resume');}catch(error){audio.settings(profile.settings.soundEnabled,profile.settings.volume);showToast(error instanceof Error?error.message:'Настройки не сохранены.',true);}}
async function menuConfirm(){closeModal();if(game?.phase==='paused'&&game.pausedFrom==='preparation')issue('resume');if(game?.phase==='preparation'){try{await saves!.checkpoint(createSnapshot(game));}catch{showToast('Не удалось записать контрольную точку. Партия оставлена открытой.',true);return;}}await showMenu();}
async function act(button:HTMLElement){const action=button.dataset.action;const hero=selectedHero(),building=selectedBuilding();
  switch(action){
    case'reload':await load();break;case'play':await newGame();break;
    case'continue-local':await resumeLocal(button.dataset.key!);break;case'local-result':await resumeLocal(button.dataset.key!,true);break;case'continue-cloud':await resumeCloud(button.dataset.id!);break;case'cloud-result':{const r=await api<RunResponse>(`/runs/${encodeURIComponent(button.dataset.id!)}`);if(r.result){stopBattle();record=null;showStandaloneResult(r.result,true);}else showToast('Итог пока недоступен.',true);break;}
    case'overview':selection=null;aim=null;previewKind=null;teleportTarget=null;renderer?.select(null);renderUi(true);break;
    case'expeditions':choose('expedition','camp');expeditionDraft='camp';renderUi(true);break;
    case'destination':selectDestination(button.dataset.kind as ExpeditionKind);break;
    case'expedition-hero':choose('hero',button.dataset.id!);expeditionDraft=button.dataset.kind as ExpeditionKind;renderUi(true);break;
    case'expedition-preview':if(hero)selectDestination(button.dataset.kind as ExpeditionKind);break;
    case'expedition-confirm':if(hero&&expeditionDraft&&game?.phase==='preparation'){const result=issue('send_expedition',{kind:expeditionDraft},hero.id);if(result?.status==='accepted'){expeditionDraft=null;renderer?.select(selection as never);renderUi(true);}}break;
    case'expedition-cancel':expeditionDraft=null;renderer?.select(selection as never);renderUi(true);break;
    case'item-preview':if(hero){itemChoice={itemId:button.dataset.item!,slot:null};renderUi(true);}break;
    case'item-slot':if(itemChoice&&(button.dataset.slot==='0'||button.dataset.slot==='1')){itemChoice.slot=Number(button.dataset.slot) as 0|1;renderUi(true);}break;
    case'item-confirm':if(hero&&itemChoice&&itemChoice.slot!==null){const result=issue('equip_item',{itemId:itemChoice.itemId,slot:itemChoice.slot},hero.id);if(result?.status==='accepted'){itemChoice=null;renderUi(true);}}break;
    case'item-cancel':itemChoice=null;renderUi(true);break;
    case'reward-item':rewardChoice={rewardId:button.dataset.reward!,itemId:button.dataset.item!,slot:null};discardRewardId=null;renderUi(true);break;
    case'reward-slot':if(rewardChoice&&rewardChoice.rewardId===button.dataset.reward&&(button.dataset.slot==='0'||button.dataset.slot==='1')){rewardChoice.slot=Number(button.dataset.slot) as 0|1;renderUi(true);}break;
    case'reward-confirm':if(rewardChoice&&rewardChoice.slot!==null&&game?.phase==='preparation'){const {rewardId,itemId,slot}=rewardChoice;const result=issue('choose_reward',{rewardId,itemId,slot});if(result?.status==='accepted'){rewardChoice=null;discardRewardId=null;renderUi(true);}}break;
    case'reward-discard':discardRewardId=button.dataset.reward!;rewardChoice=null;renderUi(true);break;
    case'reward-discard-cancel':discardRewardId=null;renderUi(true);break;
    case'reward-discard-confirm':if(discardRewardId===button.dataset.reward&&game?.phase==='preparation'){const result=issue('discard_reward',{rewardId:discardRewardId});if(result?.status==='accepted'){discardRewardId=null;rewardChoice=null;renderUi(true);}}break;
    case'start-wave':await startWave();break;case'select-hero':choose('hero',button.dataset.id!);break;case'select-pad':choose('pad',button.dataset.id!);break;
    case'preview':previewKind=button.dataset.kind as BuildingKind;renderer?.select({kind:'pad',id:selection!.id,previewKind} as never);renderUi(true);break;
    case'build-confirm':if(previewKind&&selection){issue('build',{padId:selection.id,kind:previewKind});previewKind=null;renderer?.select(selection as never);renderUi(true);}break;
    case'priority':if(hero?.kind==='sniper')issue('set_priority',{priority:button.dataset.priority},hero.id);break;
    case'upgrade':if(hero||building)issue('upgrade',{},(hero??building)!.id);break;case'sell':if(building)issue('sell',{},building.id);break;
    case'ability':if(hero&&game?.phase==='wave'&&hero.hp>0&&!hero.expedition&&!hero.teleport&&!abilityCooldown(hero)){aim='cast';teleportTarget=null;renderer?.select({...selection!,aim} as never);renderUi(true);}break;
    case'cast-enemy':if(hero){issue('cast',{targetId:button.dataset.id},hero.id);aim=null;renderer?.select(selection as never);renderUi(true);}break;
    case'cast-area':if(hero){issue('cast',{x:Number(button.dataset.x),y:Number(button.dataset.y)},hero.id);aim=null;renderer?.select(selection as never);renderUi(true);}break;
    case'teleport-mode':if(hero&&hero.hp>0&&!hero.expedition&&!hero.teleport){aim='teleport';teleportTarget=null;renderer?.select({...selection!,aim} as never);renderUi(true);}break;
    case'teleport-target':teleportTarget=button.dataset.id!;renderUi(true);break;
    case'select-for-anchor':selection={kind:'hero',id:button.dataset.id!};aim='teleport';teleportTarget=button.dataset.anchor!;renderer?.select({...selection,aim} as never);renderUi(true);break;
    case'buy-scroll':issue('buy_scroll');break;
    case'teleport-confirm':if(hero&&teleportTarget){issue('teleport',{anchorId:teleportTarget},hero.id);aim=null;teleportTarget=null;renderer?.select(selection as never);renderUi(true);}break;
    case'cancel':aim=null;teleportTarget=null;previewKind=null;renderer?.select(selection as never);renderUi(true);break;
    case'pause':if(game){if(game.phase==='paused'&&!contextLost){closeModal();issue('resume');}else if(game.phase==='wave'||game.phase==='preparation'){issue('pause');showModal('Пауза','Такты боя остановлены. Контрольная точка не меняется посреди волны.',[{action:'resume',label:'Продолжить',primary:true},{action:'menu',label:'В меню'}]);}}break;
    case'resume':if(!contextLost){closeModal();previousTime=performance.now();accumulator=0;issue('resume');}break;
    case'settings':showSettings();break;case'settings-save':await saveSettings();break;
    case'menu':if(game){if(game.phase==='wave'||game.phase==='preparation')issue('pause');showModal('Вернуться в меню?',`При продолжении загрузится контрольная точка перед волной ${record?.latestLocalCheckpoint?.nextWave??1}. Текущую волну придётся начать заново.`,[{action:'menu-confirm',label:'В меню',primary:true},{action:'resume',label:'Остаться'}]);}else await showMenu();break;
    case'menu-confirm':await menuConfirm();break;
    case'sync':void saves?.sync();break;
    case'open-cloud':if(record){const id=record.runId;closeModal();stopBattle();await resumeCloud(id);}break;
    case'result-save':if(game&&(game.phase==='victory'||game.phase==='defeat')){try{await saves!.finish(getFinishResult(game));void saves!.sync();}catch{showToast('Запись результата снова не удалась.',true);}}else void saves?.sync();break;
  }
}
app.addEventListener('click',event=>{const button=(event.target as HTMLElement).closest<HTMLElement>('[data-action]');if(button&&!(button as HTMLButtonElement).disabled)void act(button).catch(error=>showToast(error instanceof Error?error.message:'Действие не выполнено.',true));});
document.addEventListener('click',event=>{const button=(event.target as HTMLElement).closest<HTMLElement>('.modal-backdrop [data-action]');if(button&&!(button as HTMLButtonElement).disabled)void act(button).catch(error=>showToast(error instanceof Error?error.message:'Ошибка.',true));});
document.addEventListener('keydown',event=>{
  const target=event.target as HTMLElement;if(target.matches('input,textarea,select')||target.isContentEditable)return;
  if(modalOpen){if(event.key==='Tab'){const items=[...document.querySelectorAll<HTMLElement>('.modal button:not(:disabled),.modal input,.modal select')];const index=items.indexOf(document.activeElement as HTMLElement);if(event.shiftKey&&index<=0){event.preventDefault();items.at(-1)?.focus();}else if(!event.shiftKey&&(index===items.length-1||index<0)){event.preventDefault();items[0]?.focus();}}if(event.key==='Escape'&&!contextLost&&game?.phase==='paused'){closeModal();issue('resume');}return;}
  if(!game)return;
  if(/^[1-5]$/.test(event.key)){event.preventDefault();const hero=game.heroes[Number(event.key)-1];if(hero)choose('hero',hero.id);}
  else if(event.key.toLowerCase()==='q'){event.preventDefault();const hero=selectedHero();if(hero&&game.phase==='wave'&&hero.hp>0&&!hero.expedition&&!hero.teleport&&!abilityCooldown(hero)){aim='cast';renderer?.select({...selection!,aim} as never);renderUi(true);}}
  else if(event.key.toLowerCase()==='t'){event.preventDefault();if(selectedHero()?.hp&& !selectedHero()?.expedition&&!selectedHero()?.teleport){aim='teleport';teleportTarget=null;renderer?.select({...selection!,aim} as never);renderUi(true);}}
  else if(event.code==='Space'){event.preventDefault();document.querySelector<HTMLButtonElement>('#pause-button')?.click();}
  else if(event.key==='Escape'){aim=null;previewKind=null;teleportTarget=null;renderer?.select(selection as never);renderUi(true);}
});
document.addEventListener('visibilitychange',()=>{previousTime=performance.now();accumulator=0;if(document.hidden&&game&&(game.phase==='wave'||game.phase==='preparation')){issue('pause');showModal('Игра приостановлена','Вы ушли с вкладки. Игровое время остановлено; продолжите явно.',[{action:'resume',label:'Продолжить',primary:true},{action:'menu-confirm',label:'В меню'}]);}});
window.addEventListener('beforeunload',event=>{if(game&&(game.phase==='wave'||(game.phase==='paused'&&game.pausedFrom==='wave'))){event.preventDefault();}});
window.addEventListener('pageshow',event=>{if(event.persisted)void load();});
window.addEventListener('pagehide',()=>{if(frame)cancelAnimationFrame(frame);saves?.dispose();renderer?.dispose();audio.dispose();});
void load().then(()=>{const params=new URLSearchParams(location.search);if(params.has('resume'))void resumeLocal(params.get('resume')!);else if(params.has('cloud'))void resumeCloud(params.get('cloud')!);});
// Read-only diagnostics for support and acceptance; no commands or mutable game objects are exposed.
Object.defineProperty(window,'lastThroneDiagnostics',{value:()=>({releaseId:launchId,runId:record?.runId,versions:record&&{...record.pins},phase:game?.phase,simTick:game?.simTick,lastCompletedWave:game?.lastCompletedWave,nextWave:game?.nextWave,totalWaves:content?.waves.length,gold:game?.gold,throneHp:game?.throneHp,heroes:game?.heroes.map(h=>({id:h.id,kind:h.kind,hp:h.hp,level:h.level,x:h.x,y:h.y,anchorId:h.anchorId,teleporting:!!h.teleport,abilityCooldown:h.abilityCooldown,stolenSpell:h.stolenSpell,stealCooldown:h.stealCooldown,priority:h.priority,items:[...h.items],expedition:h.expedition&&{...h.expedition},aegisToken:h.aegisToken,shield:h.shield&&{...h.shield}})),buildings:game?.buildings.map(b=>({id:b.id,kind:b.kind,padId:b.padId,level:b.level,constructionTicks:b.constructionTicks,shield:b.shield&&{...b.shield}})),enemies:game?.enemies.map(e=>({id:e.id,kind:e.kind,x:e.x,y:e.y,hp:e.hp,lastSpell:e.lastSpell,stealable:e.stealable,hidden:e.hidden,visible:e.visible,slow:e.slow&&{...e.slow},shield:e.shield&&{...e.shield}})),enemyCount:game?.enemies.length,pendingRewards:game?.pendingRewards.map(r=>({...r,options:[...r.options]})),summons:game?.summons.map(s=>({id:s.id,kind:s.kind,x:s.x,y:s.y,ttlTicks:s.ttlTicks})),summonCount:game?.summons.length,events:structuredClone(recentEvents),eventTotals:{...eventTotals},statistics:game&&{...game.statistics},saveStatus,checkpoint:{savingLocal,startTransaction:startingWave,pendingTasks:checkpointTasks},localGeneration:record?.localGeneration,confirmedGeneration:record?.confirmedGeneration,graphics:renderer?.getDiagnostics(),audio:audio.getDiagnostics()}),configurable:false});
