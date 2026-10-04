import './style.css';
import { RunSimulation } from './game/simulation';
import type { Command, Point } from './game/simulation';
import { DEFAULT_CONFIG, FIXED_STEP } from './game/config';
import { EQUIPMENT_SLOTS, CONSUMABLE_IDS, computeModifiers, canCraft, recipeCost, getItemDefinition, getConsumableDefinition } from './game/equipment';
import type { ConsumableId, EquipmentModifiers, Operation, Recipe, Slot } from './game/equipment';
import { WorldView } from './presentation/world';
import { ConnectionMonitor } from './platform/connection';
import type { ConnectionState } from './platform/connection';
import { GameInput } from './platform/input';
import { loadCatalog } from './platform/catalog';
import { ApiError, GameApi } from './platform/api';
import { FrameJournal, ProfileSession, goldText } from './platform/profile';

export type AppPhase = 'BOOT' | 'LOGIN' | 'GALLERY' | 'COUNTDOWN' | 'RUNNING' | 'PAUSED' | 'GAME_OVER' | 'SHOP';
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
let phase: AppPhase = 'BOOT';
let sim: RunSimulation | null = null;
let world: WorldView;
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
const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const slotNames: Record<Slot, string> = { weapon: 'Оружие', body: 'Тело', legs: 'Ноги', talisman: 'Талисман' };

function feedback(text: string): void { get('feedback').textContent = text; feedbackUntil = performance.now() + 1600; }
function transition(next: AppPhase): void {
  phase = next; document.body.dataset.phase = next; accumulator = 0; commands = [];
  input?.setEnabled(next === 'RUNNING' && session.run?.control === 'owner');
  if (next === 'RUNNING') canvas.focus({ preventScroll: true });
  updateScreen();
}
function liveReadOnly(): boolean { return session.run?.control === 'readOnly' && session.run.snapshot?.state?.phase !== 'gameOver'; }
function ownedRun(): { runId: string; ownerEpoch: number } {
  if (!session.run || session.run.control !== 'owner') throw new ApiError('RUN_NOT_OWNER', 'Забег открыт на другом устройстве. Забери управление явно.', 409);
  return { runId: session.run.runId, ownerEpoch: session.run.ownerEpoch };
}
function blocked(): boolean { return busy || Boolean(batchPromise) || Boolean(session.pending); }
async function loadAssets(): Promise<void> {
  assets = 'loading'; updateScreen();
  try { await world.loadAssets(); assets = 'ready'; }
  catch (error) { assets = 'error'; console.error('Model loading failed', error); }
  updateScreen();
}
function applyRun(replayQueued = false): void {
  const view = session.run;
  if (!view) { sim = null; transition(session.profile ? 'GALLERY' : 'LOGIN'); return; }
  try {
    sim = RunSimulation.restore(view.snapshot);
    if (replayQueued && view.control === 'owner') for (const frame of journal.queued) sim.step(frame);
  } catch {
    sim = null; errorMessage = 'Снимок забега несовместим или повреждён. Постоянное имущество сохранено. Заверши этот забег и начни новый.';
    transition('PAUSED'); return;
  }
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
    input?.clear(); identityLoaded = false; session.clearIdentity(); transition('LOGIN');
    errorMessage = 'Сессия истекла или отозвана. Войди снова: профиль и подтверждённый забег остаются на сервере.';
  } else if (error instanceof ApiError && ['REVISION_CONFLICT', 'RUN_NOT_OWNER', 'OPERATION_CONFLICT'].includes(error.code)) {
    input?.clear(); pauseReason = 'Данные изменились в другом клиенте. Загрузи актуальное состояние перед продолжением.';
    if (phase !== 'SHOP') transition('PAUSED');
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
function costText(recipe: Recipe): string { return `${goldText(recipe.goldMilli)} золота · сталь ${recipe.components.steel} · жар ${recipe.components.ember} · ядра ${recipe.components.core}`; }
function effectText(modifiers: Partial<EquipmentModifiers>): string {
  const labels: Record<keyof EquipmentModifiers,string> = { rangeMultiplier:'Дальность ×', outboundSpeedMultiplier:'Вылет ×', returnSpeedMultiplier:'Возврат ×', cooldown:'Перезарядка, с: ', lateralSpeedMultiplier:'Движение ×', pierceTargets:'Целей на вылете: ', returnHitTargets:'Целей на возврате: ', goldMultiplierMilli:'Золото ×' };
  return Object.entries(modifiers).map(([key,value]) => `${labels[key as keyof EquipmentModifiers]}${key === 'goldMultiplierMilli' ? value / 1000 : value}`).join(' · ');
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
  if (!p || !catalog) return;
  const editable = !liveReadOnly() && (phase === 'SHOP' || phase === 'GALLERY' && (!session.run || session.run.snapshot?.state?.phase === 'gameOver'));
  const key = `${p.accountId}/${p.revision}/${phase}/${blocked()}/${editable}`;
  if (key === profileRenderKey) return; profileRenderKey = key; cooldownDuration = computeModifiers(p).cooldown;
  get('wallet').textContent = `Золото ${goldText(p.goldMilli)} · сталь ${p.components.steel} · жар ${p.components.ember} · ядра ${p.components.core}`;
  get('profile-stats').textContent = `Подтверждённая ревизия ${p.revision} · забегов ${p.stats.runs} · убийств ${p.stats.totalKills} · рекорд ${Math.floor(p.stats.bestDistance)} м`;
  const loadout = get('loadout'); loadout.replaceChildren();
  for (const slot of EQUIPMENT_SLOTS) {
    const row = make('div', undefined, 'loadout-row'), select = make('select'); select.setAttribute('aria-label', slotNames[slot]);
    select.append(new Option('Не надето', ''));
    for (const item of p.items) if (getItemDefinition(item.definitionId).slot === slot) select.append(new Option(`${getItemDefinition(item.definitionId).name} · ур. ${item.level}`, item.id));
    select.value = p.loadouts.pudge[slot] ?? ''; select.disabled = !editable || blocked();
    row.append(make('label', slotNames[slot]), select, actionButton('Надеть', () => { void transact('equip', { slot, itemId: select.value || null }); }, !editable || blocked())); loadout.append(row);
  }
  for (let slot = 0; slot < 2; slot++) {
    const row = make('div', undefined, 'loadout-row'), select = make('select'); select.setAttribute('aria-label', `Быстрый слот ${slot + 1}`);
    select.append(new Option('Пусто', ''));
    for (const id of CONSUMABLE_IDS) select.append(new Option(`${getConsumableDefinition(id).name} · ${p.consumables[id]} шт.`, id));
    select.value = p.loadouts.pudge.quick[slot] ?? ''; select.disabled = !editable || blocked();
    row.append(make('label', `Быстрый ${slot + 1}`), select, actionButton('Сохранить', () => {
      const slots = [...p.loadouts.pudge.quick] as [ConsumableId|null,ConsumableId|null]; slots[slot] = select.value as ConsumableId || null; void transact('quick_slots', { slots });
    }, !editable || blocked())); loadout.append(row);
  }
  const inventory = get('inventory'); inventory.replaceChildren();
  inventory.append(make('p', p.items.length ? 'Собранные предметы' : 'Предметов пока нет. Золото и компоненты добываются в забеге.'));
  for (const item of p.items) {
    const definition = getItemDefinition(item.definitionId), row = make('div', undefined, 'inventory-row');
    row.append(make('strong', `${definition.name} · уровень ${item.level}`), make('p', effectText(definition.levels[item.level - 1].modifiers), 'recipe-effect'));
    const nextLevel = definition.levels.find(level => level.level === item.level + 1);
    const recipe = nextLevel ? recipeCost(item.definitionId, item.level) : null;
    if (recipe && nextLevel) row.append(make('p', `Следующий уровень: ${effectText(nextLevel.modifiers)}`, 'recipe-effect'), make('p', `Улучшение: ${costText(recipe)}`, 'recipe-cost'), make('p', deficitText(recipe), 'recipe-deficit'), actionButton('Улучшить', () => { void transact('upgrade', { itemId: item.id }); }, phase !== 'SHOP' || !editable || blocked() || !canCraft(p, recipe)));
    else row.append(make('p', 'Максимальный уровень', 'recipe-cost'));
    inventory.append(row);
  }
  const recipes = get('recipes'); recipes.replaceChildren();
  if (phase !== 'SHOP') recipes.append(make('p', 'Крафт и улучшение доступны в магазине на пути. Здесь можно посмотреть цены.', 'control-hint'));
  for (const definition of [...catalog.items, ...catalog.consumables]) {
    const recipe = recipeCost(definition.id); if (!recipe) continue;
    const row = make('div', undefined, 'recipe-card'); row.append(make('strong', definition.name), make('p', costText(recipe), 'recipe-cost'));
    if ('levels' in definition) row.append(make('p', `${slotNames[definition.slot]} · ${effectText(definition.levels[0].modifiers)}`, 'recipe-effect'));
    else row.append(make('p', definition.effect.type === 'slow' ? `Замедляет текущих врагов и снаряды на ${definition.effect.durationSeconds} с` : `Золото ×${definition.effect.goldMultiplierMilli / 1000} за следующие ${definition.effect.kills} убийства`, 'recipe-effect'));
    row.append(make('p', deficitText(recipe), 'recipe-deficit'), actionButton('Создать', () => { void transact('craft', { definitionId: definition.id }); }, phase !== 'SHOP' || !editable || blocked() || !canCraft(p, recipe))); recipes.append(row);
  }
}
function updateQuickSlots(): void {
  get('quick-consumables').hidden = phase !== 'RUNNING';
  for (let i = 0; i < 2; i++) {
    const button = get<HTMLButtonElement>(`quick-${i}`), id = session.profile?.loadouts.pudge.quick[i];
    button.textContent = id ? `${i + 1} · ${getConsumableDefinition(id).name} (${session.profile!.consumables[id]})` : `${i + 1} · пусто`;
    button.disabled = !id || !session.profile?.consumables[id] || blocked() || phase !== 'RUNNING';
  }
}
function updateScreen(): void {
  const inBattle = ['RUNNING','COUNTDOWN','PAUSED','GAME_OVER'].includes(phase);
  get('hud').hidden = !inBattle || phase === 'GAME_OVER'; get('ability').hidden = !inBattle || phase === 'GAME_OVER';
  pauseButton.hidden = phase !== 'RUNNING'; get('overlay').hidden = phase === 'RUNNING' || phase === 'COUNTDOWN'; get('countdown').hidden = phase !== 'COUNTDOWN';
  get('instructions').hidden = phase !== 'GALLERY'; get('results').hidden = phase !== 'GAME_OVER';
  get('login-form').hidden = phase !== 'LOGIN'; get('profile-panel').hidden = !session.profile || !['GALLERY','SHOP','GAME_OVER'].includes(phase);
  get('logout').hidden = !session.profile || ['RUNNING','COUNTDOWN'].includes(phase); get<HTMLButtonElement>('logout').disabled = blocked();
  secondary.hidden = !['PAUSED','GAME_OVER'].includes(phase) || liveReadOnly();
  secondary.disabled = blocked(); secondary.textContent = phase === 'GAME_OVER' ? 'В галерею' : 'Завершить забег и выйти в галерею';
  primary.hidden = phase === 'LOGIN' || phase === 'BOOT' || liveReadOnly();
  primary.disabled = blocked() || Boolean(pausePromise) || assets === 'loading' || !contextAvailable || connection?.state !== 'online' || !session.profile || phase === 'PAUSED' && !sim;
  get('error-message').hidden = !errorMessage; get('error-message').textContent = errorMessage;
  get('recover-operation').hidden = !session.pending; get<HTMLButtonElement>('recover-operation').disabled = busy || Boolean(batchPromise);
  get('reload-profile').hidden = !errorMessage || Boolean(session.pending); get<HTMLButtonElement>('reload-profile').disabled = busy || Boolean(batchPromise);
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
  renderProfile(); updateQuickSlots();
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
    if (phase === 'SHOP') { await session.operate('leave_shop', ownedRun()); applyRun(); }
    else if (phase === 'GALLERY' || phase === 'GAME_OVER') { journal.clear(); await session.operate('start_run', {}); applyRun(); }
    else if (session.run?.snapshot?.state?.phase === 'running') { await session.operate('pause_run', ownedRun()); applyRun(); }
    if (epoch === lifecycleEpoch && !document.hidden && contextAvailable && session.run?.control === 'owner' && sim) prepareCountdown();
  } catch (error) { handleError(error); }
  finally { busy = false; updateScreen(); }
}
async function restoreProfile(): Promise<void> {
  if (busy || batchPromise) return; busy = true; errorMessage = ''; updateScreen();
  try {
    await api.session(); await session.load(); identityLoaded = true; journal.clear();
    phase = 'PAUSED'; applyRun();
    if (session.run?.control === 'owner' && session.run.snapshot?.state?.phase === 'running') { await session.operate('pause_run', ownedRun()); applyRun(); }
    pauseReason = 'Забег восстановлен с подтверждённого серверного снимка. Нажми «Продолжить», затем дождись отсчёта.';
    if (!session.run) transition('GALLERY');
  } catch (error) { handleError(error); }
  finally { busy = false; updateScreen(); }
}
async function recoverOperation(): Promise<void> {
  if (busy || batchPromise || !session.pending) return; busy = true; updateScreen();
  const type = session.pending.type;
  try {
    await api.session(); await session.recover(); errorMessage = '';
    if (type === 'advance_run') journal.acknowledge(); applyRun(true);
    await flushFrames(true);
    if (session.run?.control === 'owner' && session.run.snapshot?.state?.phase === 'running') { await session.operate('pause_run', ownedRun()); applyRun(); }
    pauseReason = 'Результат той же операции подтверждён. Можно продолжить.';
  } catch (error) { handleError(error); }
  finally { busy = false; updateScreen(); }
}
async function authenticate(event: SubmitEvent): Promise<void> {
  event.preventDefault(); if (busy) return; busy = true; errorMessage = ''; updateScreen();
  const password = get<HTMLInputElement>('password');
  try {
    await api.login(get<HTMLInputElement>('login').value.trim(), password.value); password.value = '';
    await session.load(); identityLoaded = true; journal.clear(); phase = 'PAUSED'; applyRun();
    if (session.run?.control === 'owner' && session.run.snapshot?.state?.phase === 'running') { await session.operate('pause_run', ownedRun()); applyRun(); }
    if (!session.run) transition('GALLERY');
    pauseReason = 'Подтверждённый забег восстановлен. Продолжи явно после отсчёта.';
  } catch (error) { password.value = ''; handleError(error); }
  finally { busy = false; updateScreen(); }
}

try {
  world = new WorldView(canvas);
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
  get('recover-operation').addEventListener('click', () => { void recoverOperation(); });
  get('takeover').addEventListener('click', () => {
    const runId = session.run?.runId; if (runId) void transact('takeover_run', { runId }).then(ok => { if (ok) { journal.clear(); input.clear(); pauseReason = 'Управление передано сюда. Продолжи забег явно.'; updateScreen(); } });
  });
  get('logout').addEventListener('click', () => {
    if (blocked()) return; busy = true;
    void api.logout().then(() => { session.clearIdentity(); sim = null; journal.clear(); identityLoaded = false; transition('LOGIN'); }).catch(handleError).finally(() => { busy = false; updateScreen(); });
  });
  get('enter-shop').addEventListener('click', enterShop);
  for (let i = 0; i < 2; i++) {
    const button = get(`quick-${i}`); button.addEventListener('pointerdown', event => { event.stopPropagation(); });
    button.addEventListener('click', event => { event.stopPropagation(); consume(i); });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) void pause('Вкладка была скрыта. Продолжи, когда будешь готов.'); });
  window.addEventListener('blur', () => { void pause('Окно потеряло фокус. Продолжи, когда будешь готов.'); });
  window.addEventListener('offline', () => { lifecycleEpoch++; connection.markOffline(); });
  window.addEventListener('online', () => { void connection.check(); });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lifecycleEpoch++; contextAvailable = false; void pause('Графический контекст потерян. Ждём восстановления.'); updateScreen(); });
  canvas.addEventListener('webglcontextrestored', () => { contextAvailable = true; updateScreen(); });
  connection.start(); void loadAssets();
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
    if (contextAvailable) world.render(sim,input.aimPoint,delta);
  });
} catch (error) {
  get('eyebrow').textContent = 'НЕ УДАЛОСЬ ОТКРЫТЬ ИГРУ'; get('screen-title').innerHTML = 'НУЖЕН WEBGL<span>Проверь браузер и ускорение графики</span>';
  get('screen-description').textContent = '3D-сцена недоступна. Обнови страницу в браузере с аппаратным ускорением.'; primary.hidden = true; get('instructions').hidden = true; console.error(error);
}
