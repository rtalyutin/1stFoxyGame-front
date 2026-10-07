import './style.css';
import './item-shop.css';
import { RunSimulation } from './game/simulation';
import type { Command, Point } from './game/simulation';
import { DEFAULT_CONFIG, FIXED_STEP } from './game/config';
import { EQUIPMENT_SLOTS, CONSUMABLE_IDS, computeModifiers, canCraft, recipeCost, getItemDefinition, getConsumableDefinition } from './game/equipment';
import type { ConsumableId, EquipmentModifiers, Operation, Recipe, Slot } from './game/equipment';
import { WorldView } from './presentation/world';
import { ItemShop } from './presentation/item-shop';
import { WorkshopScene } from './presentation/workshop-scene';
import {iconPath} from './presentation/supplies';
import { ConnectionMonitor } from './platform/connection';
import type { ConnectionState } from './platform/connection';
import { GameInput } from './platform/input';
import { loadCatalog } from './platform/catalog';
import { ApiError, GameApi } from './platform/api';
import { FrameJournal, ProfileSession, goldText } from './platform/profile';
import { productionRateText, settlementDuration } from './platform/workshop';
import type { WorkshopSettlement,ProductionId } from './platform/workshop';
import { canSettleProduction, WorkshopNavigation } from './platform/workshop-navigation';
import type { WorkshopRunState } from './platform/workshop-navigation';

export type AppPhase = 'BOOT' | 'LOGIN' | 'GALLERY' | 'COUNTDOWN' | 'RUNNING' | 'PAUSED' | 'GAME_OVER' | 'SHOP' | 'WORKSHOP';
const get = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = get<HTMLCanvasElement>('world');
const primary = get<HTMLButtonElement>('primary');
const secondary = get<HTMLButtonElement>('secondary');
const pauseButton = get<HTMLButtonElement>('pause');
const api = new GameApi();
let tabStorage: Storage | undefined;
try { tabStorage = sessionStorage; } catch { /* Browser privacy mode can disable storage. */ }
const session = new ProfileSession(api, tabStorage);
const journal = new FrameJournal();
const workshopNavigation = new WorkshopNavigation();
let phase: AppPhase = 'BOOT';
let sim: RunSimulation | null = null;
let world: WorldView;
let itemShop: ItemShop | null = null;
let workshopScene: WorkshopScene|null=null;
let selectedProduction:ProductionId|null=null;
let input: GameInput;
let connection: ConnectionMonitor;
let commands: Command[] = [];
let countdown = 0;
let countdownFinishing = false;
let accumulator = 0;
let previousFrame = performance.now();
let pauseReason = 'Путь ждёт.';
let contextAvailable = true;
let busy = false;
let batchPromise: Promise<void> | null = null;
let pausePromise: Promise<void> | null = null;
let feedbackUntil = 0;
let lifecycleEpoch = 0;
let assets: 'loading' | 'ready' | 'error' = 'loading';
let errorMessage = '';
let profileRenderKey = '';
let cooldownDuration = DEFAULT_CONFIG.hookCooldown;
let identityLoaded = false;
let resumeWanted = false;
let workshopRenderKey = '';
let workshopReceipt: WorkshopSettlement | null = null;
let offlineReceipt: WorkshopSettlement | null = null;
let tapConfirmation = '';
const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const slotNames: Record<Slot, string> = { weapon: 'Оружие', body: 'Тело', legs: 'Ноги', talisman: 'Талисман' };

function feedback(text: string): void { get('feedback').textContent = text; feedbackUntil = performance.now() + 1600; }
function transition(next: AppPhase): void {
  const previous = phase;
  phase = next; document.body.dataset.phase = next; accumulator = 0; commands = [];
  input?.setEnabled(next === 'RUNNING' && session.run?.control === 'owner');
  if (next === 'RUNNING') canvas.focus({ preventScroll: true });
  if (next === 'GALLERY' && !session.run && previous !== 'GALLERY') refreshBalancePreview();
  updateScreen();
}
function refreshBalancePreview(): void {
  const request = session.refreshBalancePreview(); profileRenderKey = ''; updateScreen();
  void request.finally(() => { profileRenderKey = ''; updateScreen(); });
}
function liveReadOnly(): boolean { return session.run?.control === 'readOnly' && session.run.snapshot?.state?.phase !== 'gameOver'; }
function ownedRun(): { runId: string; ownerEpoch: number } {
  if (!session.run || session.run.control !== 'owner') throw new ApiError('RUN_NOT_OWNER', 'Забег открыт на другом устройстве. Забери управление явно.', 409);
  return { runId: session.run.runId, ownerEpoch: session.run.ownerEpoch };
}
function blocked(): boolean { return busy || Boolean(batchPromise) || Boolean(session.pending); }
function workshopRun(): WorkshopRunState | null {
  const run = session.run;
  return run ? {runId:run.runId,phase:run.control === 'readOnly' && run.snapshot?.state?.phase !== 'gameOver' ? 'readOnly' : run.snapshot?.state?.phase ?? 'incompatible'} : null;
}
function workshopSafe(): boolean {
  if (!session.profile || !['GALLERY','GAME_OVER','SHOP'].includes(phase) || liveReadOnly()) return false;
  const run = workshopRun(); return phase === 'SHOP' ? run?.phase === 'shop' : phase === 'GAME_OVER' ? run?.phase === 'gameOver' : !run || run.phase === 'gameOver';
}
async function loadAssets(): Promise<void> {
  assets = 'loading'; updateScreen();
  try { await world.loadAssets(); assets = 'ready'; }
  catch (error) { assets = 'error'; console.error('Model loading failed', error); }
  updateScreen();
}
function applyRun(replayQueued = false): void {
  const view = session.run;
  const keepWorkshop = phase === 'WORKSHOP' && workshopNavigation.valid(workshopRun());
  const keepGallery = phase === 'GALLERY' && (!view || view.snapshot?.state?.phase === 'gameOver');
  if (!view) { sim = null; transition(keepWorkshop ? 'WORKSHOP' : session.profile ? 'GALLERY' : 'LOGIN'); return; }
  try {
    sim = RunSimulation.restore(view.snapshot);
    if (replayQueued && view.control === 'owner') for (const frame of journal.queued) sim.step(frame);
  } catch {
    sim = null; errorMessage = 'Снимок забега несовместим или повреждён. Постоянное имущество сохранено. Заверши этот забег и начни новый.';
    transition('PAUSED'); return;
  }
  if (keepWorkshop) { transition('WORKSHOP'); return; }
  if (keepGallery) { transition('GALLERY'); return; }
  if (sim.state.phase === 'gameOver') { transition('GAME_OVER'); return; }
  if (view.control === 'readOnly') {
    pauseReason = 'Этот аккаунт управляет забегом на другом устройстве. Здесь доступен просмотр; управление можно забрать кнопкой ниже.';
    sim.pause(); transition('PAUSED'); return;
  }
  if (sim.state.phase === 'shop') {
    // The shop UI opens only after the server confirms this exact marker/frame.
    if (view.snapshot.state.phase === 'shop') transition('SHOP');
    else { pauseReason = 'Подтверждаем вход в магазин…'; transition('PAUSED'); }
  }
  else if (sim.state.phase === 'paused' && phase !== 'COUNTDOWN' || phase !== 'RUNNING' && phase !== 'COUNTDOWN') transition('PAUSED');
  updateScreen();
}
function handleError(error: unknown): void {
  errorMessage = error instanceof Error ? error.message : 'Не удалось сохранить действие. Повтори проверку.';
  if (error instanceof ApiError && error.status === 401) {
    input?.clear(); identityLoaded = false; clearWorkshop(); session.clearIdentity(); transition('LOGIN');
    errorMessage = 'Сессия истекла или отозвана. Войди снова: профиль и подтверждённый забег остаются на сервере.';
  } else if (error instanceof ApiError && ['REVISION_CONFLICT', 'RUN_NOT_OWNER', 'OPERATION_CONFLICT'].includes(error.code)) {
    input?.clear(); pauseReason = 'Данные изменились в другом клиенте. Загрузи актуальное состояние перед продолжением.';
    if (phase !== 'SHOP' && phase !== 'WORKSHOP' && phase !== 'GALLERY' && phase !== 'GAME_OVER') transition('PAUSED');
  } else if (phase === 'RUNNING' || phase === 'COUNTDOWN') {
    input?.clear(); pauseReason = 'Сервер не подтвердил действие. Забег остановлен до проверки результата.'; transition('PAUSED');
  }
  updateScreen();
}
async function flushFrames(all = false): Promise<void> {
  if (batchPromise) { await batchPromise; if (all && journal.queued.length) return flushFrames(true); return; }
  if (!journal.queued.length) return;
  if (session.pending) throw new ApiError('OPERATION_PENDING', 'Сначала проверь результат ожидающей операции.', 409);
  const frames = journal.begin(all ? 120 : 30);
  batchPromise = (async () => {
    try {
      await session.operate('advance_run', { ...ownedRun(), frames });
      journal.acknowledge(); applyRun(true);
    } catch (error) {
      handleError(error);
      // A definite refusal means all speculative frames must be reloaded from server.
      if (!session.pending) journal.clear();
      throw error;
    }
  })();
  try { await batchPromise; } finally { batchPromise = null; updateScreen(); }
  if (all && journal.queued.length) await flushFrames(true);
}
/** Freeze only the client display while the same authoritative operation commits. */
async function transact(type: Operation['type'], payload: Operation['payload'], continueAfter = false): Promise<boolean> {
  if (busy || session.pending) return false;
  busy = true; errorMessage = ''; const wasRunning = phase === 'RUNNING';
  if (wasRunning) { pauseReason = 'Подтверждаем действие на сервере…'; transition('PAUSED'); }
  try {
    await flushFrames(true);
    await session.operate(type, payload);
    applyRun();
    if (continueAfter && !document.hidden && contextAvailable && session.run?.control === 'owner' && sim?.state.phase === 'running') prepareCountdown();
    return true;
  } catch (error) { handleError(error); return false; }
  finally { busy = false; profileRenderKey = ''; updateScreen(); }
}
async function pause(reason: string): Promise<void> {
  if (!['RUNNING','COUNTDOWN'].includes(phase)) return;
  lifecycleEpoch++; resumeWanted = false; pauseReason = reason; transition('PAUSED');
  if (!session.run || session.run.control !== 'owner' || pausePromise) return;
  pausePromise = (async () => {
    try {
      await flushFrames(true);
      if (session.run?.snapshot?.state?.phase === 'running' && !session.pending) {
        await session.operate('pause_run', ownedRun()); applyRun();
      }
    } catch (error) { handleError(error); }
  })();
  try { await pausePromise; } finally { pausePromise = null; updateScreen(); }
}
function cast(aim: Point): void {
  if (phase !== 'RUNNING' || !sim || session.run?.control !== 'owner') return;
  if (!sim.canCast || commands.some(command => command.type === 'cast')) { feedback('Крюк ещё не готов'); return; }
  commands.push({ type: 'cast', aim });
}
function enterShop(): void {
  if (phase !== 'RUNNING' || !sim?.canEnterShop || blocked() || commands.some(command => command.type === 'enterShop')) return;
  const shop = sim.availableShop;
  if (shop) commands.push({ type: 'enterShop', shopId: shop.id });
}
function consume(slot: number): void {
  if (phase !== 'RUNNING' || blocked()) return;
  const definitionId = session.profile?.loadouts.pudge.quick[slot];
  if (!definitionId || !session.profile?.consumables[definitionId]) { feedback('Расходник недоступен'); return; }
  void transact('consume', { ...ownedRun(), definitionId }, true);
}
function updateConnection(state: ConnectionState): void {
  const status = get('connection'); status.dataset.state = state;
  status.querySelector('span')!.textContent = state === 'online' ? 'В сети' : state === 'offline' ? 'Нет связи' : 'Подключение…';
  if (state !== 'online') void pause('Связь потеряна. Подтверждённый забег хранится на сервере.');
  updateScreen();
}
function make<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element;
}
function actionButton(text: string, click: () => void, disabled = false): HTMLButtonElement {
  const button = make('button', text); button.type = 'button'; button.disabled = disabled; button.addEventListener('click', click); return button;
}
function clearWorkshop(): void {
  workshopNavigation.clear(); workshopReceipt = null; offlineReceipt = null; workshopRenderKey = ''; tapConfirmation = '';
}
function receiptText(receipt: WorkshopSettlement): string {
  const capped = receipt.discardedMs ? ` Лимит офлайна: ${settlementDuration(receipt.creditedMs)} из ${settlementDuration(receipt.elapsedMs)}; ${settlementDuration(receipt.discardedMs)} сверх лимита не начислены.` : ` За ${settlementDuration(receipt.creditedMs)}.`;
  return `Производства начислили ${goldText(receipt.goldMilli)} золота.${capped}`;
}
function recordWorkshopReceipt(): void {
  const receipt = session.workshop?.lastSettlement;
  if (!receipt) return;
  workshopReceipt = receipt;
  if (receipt.elapsedMs >= 60000 || receipt.discardedMs > 0) offlineReceipt = receipt;
}
async function workshopAction(type: Extract<Operation['type'], `forge_${string}`>, payload: Operation['payload']): Promise<void> {
  if (blocked() || document.hidden || !session.profile || !canSettleProduction(phase) || phase === 'PAUSED' && type !== 'forge_settle') return;
  busy = true; errorMessage = ''; updateScreen();
  if (type === 'forge_tap') { tapConfirmation = ''; get('workshop-tap-status').textContent = 'Подтверждаем удар…'; }
  try {
    const result = await session.operate(type, payload); recordWorkshopReceipt(); applyRun();
    if (!session.workshop) await session.refreshWorkshop();
    if (type === 'forge_tap') {
      workshopScene?.confirmTap(result.operationId);
      tapConfirmation = `+${goldText(result.workshop?.tapGoldMilli ?? session.workshop!.tapGoldMilli)} золота · удар подтверждён`;
      const button = get('workshop-tap'); button.classList.remove('tap-confirmed'); void button.offsetWidth; button.classList.add('tap-confirmed');
    }
  } catch (error) {
    handleError(error);
    if (!session.pending && error instanceof ApiError && error.status === 409 && session.profile) {
      // The refused purchase keeps its price/id. A read shows the new quote;
      // buying again always requires a separate explicit player action.
      try { await session.refreshWorkshop(); } catch (refreshError) { handleError(refreshError); }
    }
  } finally { busy = false; profileRenderKey = ''; workshopRenderKey = ''; updateScreen(); }
}
function openWorkshop(): void {
  if (blocked() || !workshopSafe() || !workshopNavigation.enter(phase,workshopRun())) return;
  tapConfirmation = ''; transition('WORKSHOP'); void workshopAction('forge_settle',{});
}
function settleVisibleWorkshop(): void {
  if (document.hidden || blocked() || journal.length > 0 || pausePromise || connection?.state !== 'online' || !canSettleProduction(phase)) return;
  void workshopAction('forge_settle',{});
}
function renderWorkshop(): void {
  if (phase !== 'WORKSHOP') return;
  const p = session.profile, view = session.workshop;
  get('workshop-wallet').textContent = p ? `${goldText(p.goldMilli)} золота` : '—';
  get('workshop-rate').textContent = view ? `${productionRateText(view.productionRate)} / с` : '—';
  workshopScene?.update(view);
  get('workshop-loading').hidden = Boolean(view)&&Boolean(workshopScene?.ready);
  get('workshop-loading').textContent = session.pending ? 'Результат неизвестен. Проверь ту же операцию перед новым действием.' : errorMessage ? 'Данные мастерской пока недоступны. Повтори загрузку или вернись назад.' : 'Загружаем серверную мастерскую…';
  get('workshop-controls').hidden = !view;
  if(view)get('workshop-loading').textContent=workshopScene?.error||'Открываем 3D-мастерскую…';
  get<HTMLButtonElement>('workshop-return').disabled = blocked();
  get('workshop-return').textContent = workshopNavigation.origin === 'SHOP' ? 'Вернуться в магазин' : workshopNavigation.origin === 'GAME_OVER' ? 'Вернуться к результатам' : 'Вернуться в галерею';
  get<HTMLButtonElement>('workshop-refresh').disabled = blocked() || connection?.state !== 'online';
  if (!view || !p) return;
  const unavailable = blocked() || connection?.state !== 'online'||!workshopScene?.ready;
  get<HTMLButtonElement>('workshop-tap').disabled = unavailable;
  get('workshop-tap').textContent = busy ? 'Подтверждаем действие…' : `Удар по наковальне · +${goldText(view.tapGoldMilli)} золота`;
  get('workshop-tap-status').textContent = tapConfirmation;
  const key = `${p.accountId}/${p.revision}/${view.balanceRevision}/${view.serverNowMs}/${unavailable}`;
  if (key !== workshopRenderKey) {
    workshopRenderKey = key;
    const productions = get('workshop-productions'); productions.replaceChildren();
    for (const production of view.productions) {
      const row = make('article', undefined, 'workshop-production'); row.dataset.productionId = production.id;
      row.dataset.selected=String(production.id===selectedProduction);
      const description = make('div'); description.append(make('h3',production.name), make('p', `Построено: ${production.owned} · каждый даёт ${goldText(production.rateGoldMilliPerSecond)} золота/с до множителя`, 'recipe-effect'));
      const price = production.nextCostGoldMilli;
      description.append(make('p', price === null ? 'Следующая постройка недоступна: предел стоимости.' : `Следующая: ${goldText(price)} золота`, 'recipe-cost'));
      const button = actionButton('Построить', () => { void workshopAction('forge_buy',{productionId:production.id,balanceRevision:view.balanceRevision}); }, unavailable || price === null || BigInt(p.goldMilli) < BigInt(price));
      button.dataset.productionId = production.id;
      row.append(description,button); productions.append(row);
    }
    const upgrades = get('workshop-upgrades'); upgrades.replaceChildren();
    for (const upgrade of ['tap','organization'] as const) {
      const row = make('article', undefined, 'workshop-upgrade'), next = view.upgrades[upgrade], description = make('div');
      description.append(make('h3',upgrade === 'tap' ? 'Сила удара' : 'Организация мастерской'), make('p', `Уровень ${upgrade === 'tap' ? view.tapLevel : view.organizationLevel} / 3`, 'recipe-effect'));
      const effect = upgrade === 'tap' ? (view.upgrades.tap.nextGoldMilli === null ? '' : `Удар: ${goldText(view.upgrades.tap.nextGoldMilli)} золота`) : (view.upgrades.organization.nextPermille === null ? '' : `Доход: ×${view.upgrades.organization.nextPermille / 1000}`);
      description.append(make('p', next.costGoldMilli === null ? 'Максимальный уровень' : `${effect} · ${goldText(next.costGoldMilli)} золота`, 'recipe-cost'));
      const button = actionButton('Улучшить', () => { void workshopAction('forge_upgrade',{upgrade,balanceRevision:view.balanceRevision}); }, unavailable || next.costGoldMilli === null || BigInt(p.goldMilli) < BigInt(next.costGoldMilli));
      button.dataset.upgrade = upgrade; row.append(description,button); upgrades.append(row);
    }
  }
  get('workshop-settlement').hidden = !workshopReceipt;
  get('workshop-settlement').textContent = workshopReceipt ? receiptText(workshopReceipt) : '';
  get('workshop-policy').textContent = `Доход ×${view.organizationPermille / 1000}. Офлайн учитывается до ${settlementDuration(view.offlineCapSeconds * 1000)} за одно отсутствие. Настройки мастерской действуют с публикации; прошедшее время оплачивается по прежним ставкам. Показано только подтверждённое золото.`;
}
function costText(recipe: Recipe): string { return `${goldText(recipe.goldMilli)} золота · сталь ${recipe.components.steel} · жар ${recipe.components.ember} · ядра ${recipe.components.core}`; }
function effectText(modifiers: Partial<EquipmentModifiers>): string {
  const labels: Record<keyof EquipmentModifiers,string> = { rangeMultiplier:'Дальность ×', outboundSpeedMultiplier:'Вылет ×', returnSpeedMultiplier:'Возврат ×', cooldown:'Перезарядка, с: ', lateralSpeedMultiplier:'Движение ×', pierceTargets:'Целей на вылете: ', returnHitTargets:'Целей на возврате: ', goldMultiplierMilli:'Золото ×' };
  return Object.entries(modifiers).map(([key,value]) => `${labels[key as keyof EquipmentModifiers]}${key === 'goldMultiplierMilli' ? value / 1000 : value}`).join(' · ');
}
function itemDescription(definitionId: string): string {
  if (definitionId !== 'debt_clock') return '';
  const forge = session.pinnedBalance?.compiled.forge;
  return forge ? `Каждое ${forge.clockEveryKills}-е убийство: золото за ${forge.clockSeconds} с текущего производства.` : 'Экономический эффект часов появится в следующем забеге на новой версии баланса.';
}
function displayItem(definitionId: string) {
  return definitionId === 'debt_clock' && !session.catalog?.items.some(item => item.id === 'debt_clock') ? getItemDefinition(definitionId) : getItemDefinition(definitionId,session.catalog!);
}
function deficitText(recipe: Recipe): string {
  const profile = session.profile!; const missing: string[] = [];
  const gold = BigInt(recipe.goldMilli) - BigInt(profile.goldMilli);
  if (gold > 0n) missing.push(`${goldText(String(gold))} золота`);
  for (const id of ['steel','ember','core'] as const) if (recipe.components[id] > profile.components[id]) missing.push(`${{steel:'стали',ember:'жара',core:'ядер'}[id]} ${recipe.components[id] - profile.components[id]}`);
  return missing.length ? `Не хватает: ${missing.join(' · ')}` : 'Все ресурсы доступны';
}
function renderProfile(): void {
  const p = session.profile, catalog = session.catalog;
  if (!p) return;
  if (!catalog) {
    const key = `${p.accountId}/${p.revision}/preview-${session.previewState}`;
    if (key === profileRenderKey) return; profileRenderKey = key;
    get('wallet').textContent = `Золото ${goldText(p.goldMilli)} · сталь ${p.components.steel} · жар ${p.components.ember} · ядра ${p.components.core}`;
    get('profile-stats').textContent = `Подтверждённая ревизия ${p.revision} · забегов ${p.stats.runs} · убийств ${p.stats.totalKills} · рекорд ${Math.floor(p.stats.bestDistance)} м`;
    get('loadout').replaceChildren(); get('inventory').replaceChildren(); get('recipes').replaceChildren(make('p','Цены и модификаторы появятся после загрузки предпросмотра баланса.','control-hint'));
    return;
  }
  const editable = !liveReadOnly() && (phase === 'SHOP' || phase === 'GALLERY' && (!session.run || session.run.snapshot?.state?.phase === 'gameOver'));
  itemShop?.update(p, catalog, phase === 'SHOP' && editable, blocked());
  world?.setEquipment(p);
  const key = `${p.accountId}/${p.revision}/${session.pinnedBalance?.revision}/${phase}/${blocked()}/${editable}`;
  if (key === profileRenderKey) return; profileRenderKey = key; cooldownDuration = computeModifiers(p, catalog, session.pinnedBalance!.compiled.baseModifiers).cooldown;
  get('wallet').textContent = `Золото ${goldText(p.goldMilli)} · сталь ${p.components.steel} · жар ${p.components.ember} · ядра ${p.components.core}`;
  get('profile-stats').textContent = `Подтверждённая ревизия ${p.revision} · забегов ${p.stats.runs} · убийств ${p.stats.totalKills} · рекорд ${Math.floor(p.stats.bestDistance)} м · баланс ${session.pinnedBalance!.revision}${session.run ? ' закреплён за этим забегом' : ' — предпросмотр; текущая версия закрепляется при старте'} `;
  const loadout = get('loadout'); loadout.replaceChildren();
  for (const slot of EQUIPMENT_SLOTS) {
    const row = make('div', undefined, 'loadout-row'), select = make('select'); select.setAttribute('aria-label', slotNames[slot]);
    select.append(new Option('Не надето', ''));
    for (const item of p.items) if (displayItem(item.definitionId).slot === slot) {
      const option = new Option(`${displayItem(item.definitionId).name} · ур. ${item.level}`, item.id);
      if (item.definitionId === 'debt_clock' && !catalog.items.some(d => d.id === 'debt_clock')) option.disabled = true;
      select.append(option);
    }
    select.value = p.loadouts.pudge[slot] ?? ''; select.disabled = !editable || blocked();
    row.append(make('label', slotNames[slot]), select, actionButton('Надеть', () => { void transact('equip', { slot, itemId: select.value || null }); }, !editable || blocked())); loadout.append(row);
  }
  for (let slot = 0; slot < 2; slot++) {
    const row = make('div', undefined, 'loadout-row'), select = make('select'); select.setAttribute('aria-label', `Быстрый слот ${slot + 1}`);
    select.append(new Option('Пусто', ''));
    for (const id of CONSUMABLE_IDS) select.append(new Option(`${getConsumableDefinition(id, catalog).name} · ${p.consumables[id]} шт.`, id));
    select.value = p.loadouts.pudge.quick[slot] ?? ''; select.disabled = !editable || blocked();
    row.append(make('label', `Быстрый ${slot + 1}`), select, actionButton('Сохранить', () => {
      const slots = [...p.loadouts.pudge.quick] as [ConsumableId|null,ConsumableId|null]; slots[slot] = select.value as ConsumableId || null; void transact('quick_slots', { slots });
    }, !editable || blocked())); loadout.append(row);
  }
  const inventory = get('inventory'); inventory.replaceChildren();
  inventory.append(make('p', p.items.length ? 'Собранные предметы' : 'Предметов пока нет. Золото и компоненты добываются в забеге.'));
  for (const item of p.items) {
    const definition = displayItem(item.definitionId), row = make('div', undefined, 'inventory-row');
    row.append(make('strong', `${definition.name} · уровень ${item.level}`), make('p', itemDescription(item.definitionId) || effectText(definition.levels[item.level - 1].modifiers), 'recipe-effect'));
    const nextLevel = definition.levels.find(level => level.level === item.level + 1);
    const recipe = nextLevel ? recipeCost(item.definitionId, item.level, catalog) : null;
    if (recipe && nextLevel) row.append(make('p', `Следующий уровень: ${effectText(nextLevel.modifiers)}`, 'recipe-effect'), make('p', `Улучшение: ${costText(recipe)}`, 'recipe-cost'), make('p', deficitText(recipe), 'recipe-deficit'), actionButton('Улучшить', () => { void transact('upgrade', { itemId: item.id }); }, phase !== 'SHOP' || !editable || blocked() || !canCraft(p, recipe)));
    else row.append(make('p', 'Максимальный уровень', 'recipe-cost'));
    inventory.append(row);
  }
  const recipes = get('recipes'); recipes.replaceChildren();
  if (phase !== 'SHOP') recipes.append(make('p', 'Крафт и улучшение доступны в магазине на пути. Здесь можно посмотреть цены.', 'control-hint'));
  for (const definition of [...catalog.items, ...catalog.consumables]) {
    const recipe = recipeCost(definition.id, 0, catalog); if (!recipe) continue;
    const row = make('div', undefined, 'recipe-card'); row.append(make('strong', definition.name), make('p', costText(recipe), 'recipe-cost'));
    if ('levels' in definition) row.append(make('p', `${slotNames[definition.slot]} · ${itemDescription(definition.id) || effectText(definition.levels[0].modifiers)}`, 'recipe-effect'));
    else row.append(make('p', definition.effect.type === 'slow' ? `Замедляет текущих врагов и снаряды на ${definition.effect.durationSeconds} с` : `Золото ×${definition.effect.goldMultiplierMilli / 1000} за следующие ${definition.effect.kills} убийства`, 'recipe-effect'));
    row.append(make('p', deficitText(recipe), 'recipe-deficit'), actionButton('Создать', () => { void transact('craft', { definitionId: definition.id }); }, phase !== 'SHOP' || !editable || blocked() || !canCraft(p, recipe))); recipes.append(row);
  }
}
function updateQuickSlots(): void {
  get('quick-consumables').hidden = phase !== 'RUNNING';
  for (let i = 0; i < 2; i++) {
    const button = get<HTMLButtonElement>(`quick-${i}`), id = session.profile?.loadouts.pudge.quick[i];
    button.replaceChildren();
    if(id){const image=make('img');image.src=iconPath(id);image.alt='';image.width=36;image.height=36;button.append(image);}
    button.append(document.createTextNode(id && session.catalog ? `${i + 1} · ${getConsumableDefinition(id, session.catalog).name} (${session.profile!.consumables[id]})` : `${i + 1} · пусто`));
    button.disabled = !id || !session.profile?.consumables[id] || blocked() || phase !== 'RUNNING';
  }
}
function updateScreen(): void {
  world?.setMode(phase==='GALLERY'?'gallery':phase==='GAME_OVER'?'results':'run');
  itemShop?.setActive(phase === 'SHOP');
  workshopScene?.setActive(phase === 'WORKSHOP');
  const inBattle = ['RUNNING','COUNTDOWN','PAUSED','GAME_OVER'].includes(phase);
  get('hud').hidden = !inBattle || phase === 'GAME_OVER'; get('ability').hidden = !inBattle || phase === 'GAME_OVER';
  pauseButton.hidden = phase !== 'RUNNING'; get('overlay').hidden = phase === 'RUNNING' || phase === 'COUNTDOWN'; get('countdown').hidden = phase !== 'COUNTDOWN';
  get('instructions').hidden = phase !== 'GALLERY'; get('results').hidden = phase !== 'GAME_OVER';
  get('gallery-controls').hidden=phase!=='GALLERY';
  get('login-form').hidden = phase !== 'LOGIN'; get('profile-panel').hidden = !session.profile || !['GALLERY','SHOP','GAME_OVER'].includes(phase);
  get('open-workshop').hidden = !workshopSafe(); get<HTMLButtonElement>('open-workshop').disabled = blocked() || connection?.state !== 'online';
  get('workshop-panel').hidden = phase !== 'WORKSHOP';
  get('offline-income').hidden = !offlineReceipt || !session.profile || !['GALLERY','GAME_OVER','SHOP','PAUSED'].includes(phase);
  get('offline-income').textContent = offlineReceipt ? receiptText(offlineReceipt) : '';
  get('logout').hidden = !session.profile || ['RUNNING','COUNTDOWN'].includes(phase); get<HTMLButtonElement>('logout').disabled = blocked();
  secondary.hidden = !['PAUSED','GAME_OVER'].includes(phase) || liveReadOnly();
  secondary.disabled = blocked(); secondary.textContent = phase === 'GAME_OVER' ? 'В галерею' : 'Завершить забег и выйти в галерею';
  primary.hidden = phase === 'LOGIN' || phase === 'BOOT' || phase === 'WORKSHOP' || liveReadOnly();
  primary.disabled = blocked() || Boolean(pausePromise) || assets === 'loading' || !contextAvailable || connection?.state !== 'online' || !session.profile || phase === 'PAUSED' && !sim;
  get('error-message').hidden = !errorMessage; get('error-message').textContent = errorMessage;
  get('recover-operation').hidden = !session.pending; get<HTMLButtonElement>('recover-operation').disabled = busy || Boolean(batchPromise);
  get('reload-profile').hidden = !errorMessage || Boolean(session.pending); get<HTMLButtonElement>('reload-profile').disabled = busy || Boolean(batchPromise);
  const preview = phase === 'GALLERY' && Boolean(session.profile) && !session.run;
  get('balance-preview-status').hidden = !preview;
  get('balance-preview-status').textContent = session.previewState === 'error' ? session.previewError : session.previewState === 'loading' ? 'Загружаем действующую версию баланса для предпросмотра…' : session.balance ? `Предпросмотр баланса ${session.balance.revision}. При старте сервер закрепит действующую версию.` : 'Предпросмотр баланса ещё не загружен.';
  get('reload-balance-preview').hidden = !preview; get<HTMLButtonElement>('reload-balance-preview').disabled = session.previewState === 'loading' || blocked();
  get('reload-balance-preview').textContent = session.previewState === 'error' ? 'Повторить загрузку предпросмотра баланса' : 'Обновить предпросмотр баланса';
  get('takeover').hidden = !liveReadOnly(); get<HTMLButtonElement>('takeover').disabled = blocked() || connection?.state !== 'online';
  get('account-status').hidden = !session.profile; get('account-status').textContent = session.profile ? `Аккаунт: ${session.profile.accountId.slice(0,8)} · ${liveReadOnly() ? 'ПРОСМОТР' : 'серверное сохранение'}` : '';
  get('control-hint').hidden = !['GALLERY','RUNNING','PAUSED'].includes(phase);
  get('enter-shop').hidden = phase !== 'RUNNING' || !sim?.canEnterShop; get<HTMLButtonElement>('enter-shop').disabled = blocked();
  if (phase === 'BOOT' || phase === 'LOGIN') {
    get('eyebrow').textContent = 'ПОСТОЯННЫЙ ПРОФИЛЬ'; get('screen-title').innerHTML = 'ВХОД<span>Твой запас переживёт забег</span>';
    get('screen-description').textContent = phase === 'BOOT' ? 'Проверяем сессию и серверный профиль…' : 'Войди с выданными логином и паролем. Предметы и ресурсы сохраняются после смерти.';
  } else if (phase === 'GALLERY') {
    get('eyebrow').textContent = 'ГАЛЕРЕЯ ПУДЖА'; get('screen-title').innerHTML = 'ПУДЖ<span>Сборка остаётся. Жизнь — одна.</span>';
    get('screen-description').textContent = 'Выбери снаряжение и быстрые слоты. В забеге добывай золото и компоненты; в магазине путь полностью остановится.';
    primary.textContent = 'Начать путь  →';
  } else if (phase === 'PAUSED') {
    get('eyebrow').textContent = 'ПОДТВЕРЖДЁННЫЙ ЗАБЕГ НА СЕРВЕРЕ'; get('screen-title').innerHTML = 'ПАУЗА<span>Продолжение только по твоей команде</span>';
    get('screen-description').textContent = pauseReason; primary.textContent = 'Продолжить путь  →';
  } else if (phase === 'SHOP') {
    get('eyebrow').textContent = 'МАГАЗИН НА ПУТИ'; get('screen-title').innerHTML = 'СОБЕРИ<span>Весь бой дождётся твоего выхода</span>';
    get('screen-description').textContent = 'Золото и все компоненты списываются вместе. Экипировка применяется к следующему броску; летящий крюк сохраняет прежние параметры.';
    primary.textContent = 'Выйти из магазина  →'; get<HTMLDetailsElement>('craft-panel').open = true; get<HTMLDetailsElement>('equipment-panel').open = true;
  } else if (phase === 'WORKSHOP') {
    get('eyebrow').textContent = 'ПОСТОЯННАЯ МАСТЕРСКАЯ'; get('screen-title').innerHTML = 'КУЙ<span>Золото работает, пока ты в пути.</span>';
    get('screen-description').textContent = 'Наноси удары вручную, строй производства и улучшай доход. Всё золото доступно и мастерской, и магазину на пути.';
  } else if (phase === 'GAME_OVER' && sim) {
    get('eyebrow').textContent = 'КОНЕЦ ПУТИ'; get('screen-title').innerHTML = 'ЕЩЁ ОДИН?<span>Имущество остаётся с тобой</span>';
    get('screen-description').textContent = sim.state.deathReason === 'projectile' ? 'Снаряд попал в Пуджа. Одного попадания достаточно.' : sim.state.deathReason === 'contact' ? 'Живой крип добрался до Пуджа.' : sim.state.deathReason === 'abandoned' ? 'Забег завершён. Все подтверждённые ресурсы сохранены.' : 'Крип прошёл за спину. Путь окончен; подтверждённая добыча сохранена.';
    const { kills,distance,time } = sim.state;
    get('results').innerHTML = `<div><dt>Расстояние</dt><dd>${Math.floor(distance)} м</dd></div><div><dt>Время</dt><dd>${formatTime(time)}</dd></div><div><dt>Обычные крипы</dt><dd>${kills.normal}</dd></div><div><dt>Сильные / боссы</dt><dd>${kills.strong} / ${kills.boss}</dd></div>`;
    const loot = session.run?.loot;
    if (loot) {
      const title = session.run?.snapshot?.state?.phase === 'gameOver' ? 'Добыча забега' : 'Добыча: подтверждаем итог…';
      const gold = make('div'); gold.append(make('dt', title), make('dd', `${goldText(loot.goldMilli)} золота`));
      const components = make('div'); components.append(make('dt', 'Сталь / жар / ядра'), make('dd', `${loot.components.steel} / ${loot.components.ember} / ${loot.components.core}`));
      get('results').append(gold, components);
    }
    primary.textContent = 'Ещё раз  →';
  }
  if (!primary.hidden && connection?.state !== 'online') primary.textContent = 'Ожидаем соединение…';
  if (!primary.hidden && busy) primary.textContent = 'Подтверждаем действие…';
  if (!primary.hidden && session.pending) primary.textContent = 'Сначала проверь результат операции';
  if (!primary.hidden && assets !== 'ready') {
    primary.textContent = assets === 'loading' ? 'Загрузка моделей…' : 'Повторить загрузку моделей';
    if (assets === 'error') get('screen-description').textContent = 'Не удалось загрузить модели. Проверь соединение и повтори загрузку.';
  }
  get<HTMLButtonElement>('login-submit').disabled = busy || connection?.state !== 'online';
  renderProfile(); renderWorkshop(); updateQuickSlots();
}
function formatTime(seconds: number): string { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2,'0')}`; }
function prepareCountdown(): void {
  countdown = motion ? 3 : 1; countdownFinishing = false; resumeWanted = true;
  get('countdown').textContent = String(Math.ceil(countdown)); transition('COUNTDOWN');
}
async function finishCountdown(): Promise<void> {
  if (countdownFinishing || !resumeWanted || phase !== 'COUNTDOWN') return;
  countdownFinishing = true; const epoch = lifecycleEpoch;
  try {
    if (session.run?.snapshot?.state?.phase === 'paused') { await session.operate('resume_run', ownedRun()); applyRun(); }
    if (epoch === lifecycleEpoch && resumeWanted && !document.hidden && contextAvailable && phase === 'COUNTDOWN' && sim) { sim.resume(); transition('RUNNING'); }
    else if (session.run?.snapshot?.state?.phase === 'running') { transition('RUNNING'); await pause('Продолжение прервано. Подтверди его ещё раз.'); }
  } catch (error) { handleError(error); }
  finally { countdownFinishing = false; }
}
async function begin(): Promise<void> {
  if (assets === 'error') { void loadAssets(); return; }
  if (assets !== 'ready' || blocked() || !contextAvailable || !['GALLERY','PAUSED','GAME_OVER','SHOP'].includes(phase)) return;
  busy = true; errorMessage = ''; updateScreen(); const epoch = lifecycleEpoch;
  try {
    if (!await connection.check()) throw new Error('Сервер недоступен. Продолжение подождёт.');
    await loadCatalog(); await flushFrames(true); if (pausePromise) await pausePromise;
    if (phase === 'SHOP') {
      await session.operate('leave_shop', ownedRun());
      pauseReason = 'Магазин закрыт. Забег сохранён; продолжи путь отдельным действием.';
      applyRun();
      return;
    }
    else if (phase === 'GALLERY' || phase === 'GAME_OVER') { journal.clear(); await session.operate('start_run', {}); applyRun(); }
    else if (session.run?.snapshot?.state?.phase === 'running') { await session.operate('pause_run', ownedRun()); applyRun(); }
    if (epoch === lifecycleEpoch && !document.hidden && contextAvailable && session.run?.control === 'owner' && sim) prepareCountdown();
  } catch (error) { handleError(error); }
  finally { busy = false; updateScreen(); }
}
async function restoreProfile(): Promise<void> {
  if (busy || batchPromise) return; busy = true; errorMessage = ''; updateScreen();
  const restoreWorkshop = phase === 'WORKSHOP';
  try {
    await api.session(); await session.load(); identityLoaded = true; journal.clear();
    phase = restoreWorkshop && workshopNavigation.valid(workshopRun()) ? 'WORKSHOP' : 'PAUSED'; applyRun();
    if (session.run?.control === 'owner' && session.run.snapshot?.state?.phase === 'running') { await session.operate('pause_run', ownedRun()); recordWorkshopReceipt(); applyRun(); }
    pauseReason = 'Забег восстановлен с подтверждённого серверного снимка. Нажми «Продолжить», затем дождись отсчёта.';
    if (!session.run && phase !== 'WORKSHOP') transition('GALLERY');
    await session.operate('forge_settle',{}); recordWorkshopReceipt(); applyRun();
  } catch (error) { handleError(error); }
  finally { busy = false; updateScreen(); }
}
async function recoverOperation(): Promise<void> {
  if (busy || batchPromise || !session.pending) return; busy = true; updateScreen();
  const type = session.pending.type;
  try {
    await api.session(); const recovered=await session.recover(); errorMessage = '';
    if(type==='forge_tap')workshopScene?.confirmTap(recovered.operationId);
    recordWorkshopReceipt();
    if (type === 'advance_run') journal.acknowledge(); applyRun(true);
    await flushFrames(true);
    if (session.run?.control === 'owner' && session.run.snapshot?.state?.phase === 'running') { await session.operate('pause_run', ownedRun()); recordWorkshopReceipt(); applyRun(); }
    pauseReason = 'Результат той же операции подтверждён. Можно продолжить.';
    if (type.startsWith('forge_') && !session.workshop) await session.refreshWorkshop();
  } catch (error) { handleError(error); }
  finally { busy = false; updateScreen(); }
}
async function authenticate(event: SubmitEvent): Promise<void> {
  event.preventDefault(); if (busy) return; busy = true; errorMessage = ''; updateScreen();
  const password = get<HTMLInputElement>('password');
  try {
    await api.login(get<HTMLInputElement>('login').value.trim(), password.value); password.value = '';
    clearWorkshop();
    await session.load(); identityLoaded = true; journal.clear(); phase = 'PAUSED'; applyRun();
    if (session.run?.control === 'owner' && session.run.snapshot?.state?.phase === 'running') { await session.operate('pause_run', ownedRun()); recordWorkshopReceipt(); applyRun(); }
    if (!session.run) transition('GALLERY');
    await session.operate('forge_settle',{}); recordWorkshopReceipt(); applyRun();
    pauseReason = 'Подтверждённый забег восстановлен. Продолжи явно после отсчёта.';
  } catch (error) { password.value = ''; handleError(error); }
  finally { busy = false; updateScreen(); }
}

try {
  world = new WorldView(canvas);
  workshopScene=new WorkshopScene(get<HTMLCanvasElement>('workshop-world'),id=>{
    selectedProduction=id;workshopRenderKey='';renderWorkshop();
    document.querySelector<HTMLElement>('.workshop-production[data-production-id="'+id+'"]')?.scrollIntoView({block:'nearest'});
  },()=>{if(phase==='WORKSHOP'&&session.workshop&&!blocked())void workshopAction('forge_tap',{balanceRevision:session.workshop.balanceRevision});},()=>{workshopRenderKey='';updateScreen();});
  itemShop = new ItemShop(get('shop-3d-controls'), get<HTMLCanvasElement>('shop-world'), transact,
    (id,level) => itemDescription(id) || effectText(displayItem(id).levels[level-1].modifiers));
  session.onCommitted=(result,type)=>{
    if(result.visualRewards){world.confirmRewards(result.operationId,result.visualRewards);for(const reward of result.visualRewards)if(reward.clockGoldMilli!==undefined)feedback(`Часы должника: +${goldText(reward.clockGoldMilli)} золота · ${reward.clockSeconds} с производства`);}
    if(type==='craft'||type==='upgrade')itemShop?.confirmOperation(result.operationId);
  };
  get('gallery-left').addEventListener('click',()=>world.rotateGallery(-Math.PI/4));get('gallery-right').addEventListener('click',()=>world.rotateGallery(Math.PI/4));
  if(import.meta.env.DEV&&new URLSearchParams(location.search).has('probe-qa'))Object.assign(window,{runnerRuntimeProbe:{world,get phase(){return phase;},get sim(){return sim;},session}});
  input = new GameInput(canvas, get('touch-move'), get('joystick-thumb'), {
    aim: (x,y) => world.aim(x,y), cast, ready: () => Boolean(sim?.canCast), unavailable: () => feedback('Крюк ещё не готов'),
    pause: () => { void pause('Ты остановил забег.'); }, enterShop, consume,
  });
  connection = new ConnectionMonitor(updateConnection);
  primary.addEventListener('click', () => { void begin(); });
  secondary.addEventListener('click', () => {
    if (blocked() || liveReadOnly()) return;
    if (session.run?.snapshot?.state?.phase === 'gameOver') { journal.clear(); transition('GALLERY'); return; }
    if (session.run) void transact('end_run', ownedRun()).then(ok => { if (ok) { journal.clear(); transition('GALLERY'); } });
    else transition('GALLERY');
  });
  pauseButton.addEventListener('click', () => { void pause('Ты остановил забег.'); });
  get('login-form').addEventListener('submit', event => { void authenticate(event as SubmitEvent); });
  get('reload-profile').addEventListener('click', () => { void restoreProfile(); });
  get('reload-balance-preview').addEventListener('click', refreshBalancePreview);
  get('open-workshop').addEventListener('click', openWorkshop);
  get('workshop-tap').addEventListener('click', () => {
    if (phase === 'WORKSHOP' && session.workshop) void workshopAction('forge_tap',{balanceRevision:session.workshop.balanceRevision});
  });
  get('workshop-refresh').addEventListener('click', () => { void workshopAction('forge_settle',{}); });
  get('workshop-return').addEventListener('click', () => {
    if (phase !== 'WORKSHOP' || blocked()) return;
    transition(workshopNavigation.leave(workshopRun()));
  });
  get('recover-operation').addEventListener('click', () => { void recoverOperation(); });
  get('takeover').addEventListener('click', () => {
    const runId = session.run?.runId; if (runId) void transact('takeover_run', { runId }).then(ok => { if (ok) { journal.clear(); input.clear(); pauseReason = 'Управление передано сюда. Продолжи забег явно.'; updateScreen(); } });
  });
  get('logout').addEventListener('click', () => {
    if (blocked()) return; busy = true;
    void api.logout().then(() => { clearWorkshop(); session.clearIdentity(); sim = null; journal.clear(); identityLoaded = false; transition('LOGIN'); }).catch(handleError).finally(() => { busy = false; updateScreen(); });
  });
  get('enter-shop').addEventListener('click', enterShop);
  for (let i = 0; i < 2; i++) {
    const button = get(`quick-${i}`); button.addEventListener('pointerdown', event => { event.stopPropagation(); });
    button.addEventListener('click', event => { event.stopPropagation(); consume(i); });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) void pause('Вкладка была скрыта. Продолжи, когда будешь готов.'); else settleVisibleWorkshop(); });
  window.addEventListener('blur', () => { void pause('Окно потеряло фокус. Продолжи, когда будешь готов.'); });
  window.addEventListener('offline', () => { lifecycleEpoch++; connection.markOffline(); });
  window.addEventListener('online', () => { void connection.check(); });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lifecycleEpoch++; contextAvailable = false; void pause('Графический контекст потерян. Ждём восстановления.'); updateScreen(); });
  canvas.addEventListener('webglcontextrestored', () => { contextAvailable = true; updateScreen(); });
  connection.start(); void loadAssets();
  // Safe screens share the existing operation queue. Battle batches already
  // settle production; hidden documents need no client clock or background loop.
  let workshopTimer: number | null = window.setInterval(settleVisibleWorkshop,15000);
  window.addEventListener('pagehide', () => { if (workshopTimer !== null) clearInterval(workshopTimer); workshopTimer = null; });
  window.addEventListener('pageshow', () => { if (workshopTimer === null) workshopTimer = window.setInterval(settleVisibleWorkshop,15000); settleVisibleWorkshop(); });
  void restoreProfile().finally(() => { if (!identityLoaded && phase === 'BOOT') transition('LOGIN'); });
  world.engine.runRenderLoop(() => {
    const now = performance.now(), delta = Math.max(0,(now - previousFrame) / 1000); previousFrame = now;
    if (delta > .5 && (phase === 'RUNNING' || phase === 'COUNTDOWN')) void pause('Игра была прервана. Продолжи, когда будешь готов.');
    if (phase === 'COUNTDOWN' && !countdownFinishing) { countdown -= Math.min(delta,.1); get('countdown').textContent = String(Math.max(1,Math.ceil(countdown))); if (countdown <= 0) void finishCountdown(); }
    if (phase === 'RUNNING' && sim) {
      accumulator += delta;
      while (accumulator + 1e-10 >= FIXED_STEP && phase === 'RUNNING') {
        const frame: Command[] = [{ type:'move',axis:input.axis },...commands]; commands = []; journal.append(frame); sim.step(frame); world.observe(sim.state); accumulator -= FIXED_STEP;
        if (sim.state.phase === 'gameOver') { transition('GAME_OVER'); void flushFrames(true).catch(() => {}); }
        else if (sim.state.phase === 'shop') { pauseReason = 'Подтверждаем вход в магазин…'; transition('PAUSED'); void flushFrames(true).catch(() => {}); }
        else if (journal.length >= 120) { void pause('Ожидаем подтверждение кадров сервером. Продолжи после синхронизации.'); }
        else if (journal.queued.length >= 30 && !batchPromise && !session.pending) void flushFrames().catch(() => {});
      }
    }
    const state = sim?.state; input.refreshAim({ x:state?.hero.x ?? 0,z:(state?.hero.z ?? 0)+20 });
    get('distance').innerHTML = `${Math.floor(state?.distance ?? 0)}<small> м</small>`;
    get('kills').textContent = String(state ? state.kills.normal + state.kills.strong + state.kills.boss : 0);
    const boss = state?.enemies.find(enemy => enemy.kind === 'boss' && enemy.status === 'alive'); get('boss-status').hidden = !boss || phase !== 'RUNNING'; if (boss) get('boss-hits').textContent = `${boss.hitsRemaining} / ${boss.requiredHits}`;
    get('shot-warning').hidden = !(phase === 'RUNNING' && state?.enemies.some(enemy => enemy.status === 'alive' && enemy.shooting?.phase === 'telegraph'));
    const remaining = state?.cooldownRemaining ?? 0;
    get('hook-status').textContent = state?.hook ? state.hook.phase === 'outbound' ? 'Крюк летит' : 'Возвращается' : remaining > 0 ? `${remaining.toFixed(1)} с` : 'Готов';
    const cooldown = session.profile ? cooldownDuration : sim?.config.hookCooldown ?? DEFAULT_CONFIG.hookCooldown;
    get('cooldown-fill').style.transform = `scaleX(${Math.max(0,Math.min(1,1-remaining/cooldown))})`; get('ability').dataset.ready = String(Boolean(sim?.canCast));
    get('enter-shop').hidden = phase !== 'RUNNING' || !sim?.canEnterShop; get<HTMLButtonElement>('enter-shop').disabled = blocked(); updateQuickSlots();
    if (now > feedbackUntil) get('feedback').textContent = '';
    if (contextAvailable) {
      if(phase==='WORKSHOP'&&workshopScene?.renderFrame(delta))return;
      if (phase !== 'SHOP' || !itemShop?.renderFrame(delta)) world.render(sim,input.aimPoint,delta);
    }
  });
} catch (error) {
  get('eyebrow').textContent = 'НЕ УДАЛОСЬ ОТКРЫТЬ ИГРУ'; get('screen-title').innerHTML = 'НУЖЕН WEBGL<span>Проверь браузер и ускорение графики</span>';
  get('screen-description').textContent = '3D-сцена недоступна. Обнови страницу в браузере с аппаратным ускорением.'; primary.hidden = true; get('instructions').hidden = true; console.error(error);
}
