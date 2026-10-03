import './style.css';
import { RunSimulation } from './game/simulation';
import type { Command, Point } from './game/simulation';
import { DEFAULT_CONFIG, FIXED_STEP } from './game/config';
import { WorldView } from './presentation/world';
import { ConnectionMonitor } from './platform/connection';
import type { ConnectionState } from './platform/connection';
import { GameInput } from './platform/input';
import { loadCatalog } from './platform/catalog';

export type AppPhase = 'BOOT' | 'GALLERY' | 'COUNTDOWN' | 'RUNNING' | 'PAUSED' | 'GAME_OVER' | 'SHOP' | 'WORKSHOP';
const get = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = get<HTMLCanvasElement>('world');
const primary = get<HTMLButtonElement>('primary');
const secondary = get<HTMLButtonElement>('secondary');
const pauseButton = get<HTMLButtonElement>('pause');
let phase: AppPhase = 'BOOT';
let sim: RunSimulation | null = null;
let world: WorldView;
let input: GameInput;
let connection: ConnectionMonitor;
let commands: Command[] = [];
let countdown = 0;
let accumulator = 0;
let previousFrame = performance.now();
let pauseReason = 'Путь ждёт.';
let contextAvailable = true;
let actionPending = false;
let feedbackUntil = 0;
let lifecycleEpoch = 0;
let assets: 'loading' | 'ready' | 'error' = 'loading';
let startError = '';
const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

async function loadAssets(): Promise<void> {
  assets = 'loading'; updateScreen();
  try { await world.loadAssets(); assets = 'ready'; }
  catch (error) { assets = 'error'; console.error('Model loading failed', error); }
  updateScreen();
}

function feedback(text: string): void {
  get('feedback').textContent = text;
  feedbackUntil = performance.now() + 1300;
}

function transition(next: AppPhase): void {
  phase = next;
  document.body.dataset.phase = next;
  accumulator = 0;
  commands = [];
  input?.setEnabled(next === 'RUNNING');
  updateScreen();
}

function pause(reason: string): void {
  if (phase !== 'RUNNING' && phase !== 'COUNTDOWN') return;
  sim?.pause();
  pauseReason = reason;
  transition('PAUSED');
}

function cast(aim: Point): void {
  if (phase !== 'RUNNING' || !sim) return;
  if (!sim.canCast || commands.some((command) => command.type === 'cast')) {
    feedback('Крюк ещё не готов');
    return;
  }
  commands.push({ type: 'cast', aim });
}

function updateConnection(state: ConnectionState): void {
  const status = get('connection');
  status.dataset.state = state;
  status.querySelector('span')!.textContent = state === 'online' ? 'В сети' : state === 'offline' ? 'Нет связи' : 'Подключение…';
  if (state !== 'online') pause('Связь с сервером потеряна. Забег остановлен.');
  if (phase === 'BOOT') transition('GALLERY');
  else updateScreen();
}

function updateScreen(): void {
  const inBattle = ['RUNNING', 'COUNTDOWN', 'PAUSED', 'GAME_OVER'].includes(phase);
  get('hud').hidden = !inBattle || phase === 'GAME_OVER';
  get('ability').hidden = !inBattle || phase === 'GAME_OVER';
  pauseButton.hidden = phase !== 'RUNNING';
  get('overlay').hidden = phase === 'RUNNING' || phase === 'COUNTDOWN';
  get('countdown').hidden = phase !== 'COUNTDOWN';
  get('instructions').hidden = phase !== 'BOOT' && phase !== 'GALLERY';
  get('results').hidden = phase !== 'GAME_OVER';
  secondary.hidden = phase !== 'PAUSED' && phase !== 'GAME_OVER';
  get('control-hint').hidden = phase === 'GAME_OVER';
  primary.disabled = assets === 'loading' || actionPending || !contextAvailable || connection?.state !== 'online';
  if (phase === 'BOOT' || phase === 'GALLERY') {
    get('eyebrow').textContent = 'СТРЕЛОК И БОСС';
    get('screen-title').innerHTML = 'ПУДЖ<span>Путь без права на промах</span>';
    get('screen-description').textContent = 'Не пропускай врагов и уклоняйся от пуль. Стрелку нужен один хук, боссу — три. Предупреждение на дороге показывает направление выстрела.';
    primary.textContent = connection?.state === 'online' ? 'Начать путь  →' : 'Ожидаем соединение…';
  } else if (phase === 'PAUSED') {
    get('eyebrow').textContent = 'ЗАБЕГ СОХРАНЁН В ЭТОЙ ВКЛАДКЕ';
    get('screen-title').innerHTML = 'ПАУЗА<span>Каждая секунда подождёт</span>';
    get('screen-description').textContent = pauseReason;
    primary.textContent = !contextAvailable ? 'Восстановление графики…' : connection?.state !== 'online' ? 'Ожидаем соединение…' : 'Продолжить путь  →';
  } else if (phase === 'GAME_OVER' && sim) {
    get('eyebrow').textContent = 'КОНЕЦ ПУТИ';
    get('screen-title').innerHTML = 'ЕЩЁ ОДИН?<span>Новый забег. Новый шанс.</span>';
    get('screen-description').textContent = sim.state.deathReason === 'projectile'
      ? 'Вражеский снаряд попал в Пуджа. Одного попадания достаточно.'
      : sim.state.deathReason === 'contact' ? 'Живой крип добрался до Пуджа.' : 'Крип прошёл за спину. На этом путь окончен.';
    const { kills, distance, time } = sim.state;
    get('results').innerHTML = `<div><dt>Расстояние</dt><dd>${Math.floor(distance)} м</dd></div><div><dt>Время</dt><dd>${formatTime(time)}</dd></div><div><dt>Обычные крипы</dt><dd>${kills.normal}</dd></div><div><dt>Сильные / боссы</dt><dd>${kills.strong} / ${kills.boss}</dd></div>`;
    primary.textContent = connection.state === 'online' ? 'Ещё раз  →' : 'Ожидаем соединение…';
  }
  if (actionPending) primary.textContent = 'Проверяем соединение…';
  if (startError && (phase === 'GALLERY' || phase === 'GAME_OVER')) {
    get('screen-description').textContent = startError;
    primary.textContent = 'Попробовать снова  →';
  }
  if (assets !== 'ready') {
    get('screen-description').textContent = assets === 'loading'
      ? 'Загружаем героя, крипов и окружение…'
      : 'Не удалось загрузить игровые модели. Проверь соединение и повтори загрузку.';
    primary.textContent = assets === 'loading' ? 'Загрузка моделей…' : 'Повторить загрузку';
  }
}

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

async function begin(): Promise<void> {
  if (assets === 'error') { void loadAssets(); return; }
  if (assets !== 'ready') return;
  if (actionPending || !contextAvailable || !['GALLERY', 'PAUSED', 'GAME_OVER'].includes(phase)) return;
  const intendedPhase = phase;
  const intendedEpoch = lifecycleEpoch;
  startError = '';
  actionPending = true;
  updateScreen();
  const online = await connection.check();
  if (online && intendedPhase !== 'PAUSED') {
    try { await loadCatalog(); }
    catch (error) {
      startError = error instanceof Error ? error.message : 'Не удалось загрузить правила. Попробуй снова.';
      actionPending = false; updateScreen(); return;
    }
  }
  actionPending = false;
  if (!online || document.hidden || !document.hasFocus() || !contextAvailable
      || intendedPhase !== phase || intendedEpoch !== lifecycleEpoch) { updateScreen(); return; }
  if (phase !== 'PAUSED') {
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    sim = new RunSimulation(crypto.randomUUID(), random);
    sim.pause();
  }
  countdown = motion ? 3 : 1;
  get('countdown').textContent = String(Math.ceil(countdown));
  transition('COUNTDOWN');
}

try {
  world = new WorldView(canvas);
  input = new GameInput(canvas, get('touch-move'), get('joystick-thumb'), {
    aim: (x, y) => world.aim(x, y), cast,
    ready: () => Boolean(sim?.canCast), unavailable: () => feedback('Крюк ещё не готов'),
    pause: () => { if (phase === 'RUNNING' || phase === 'COUNTDOWN') pause('Ты остановил забег.'); },
  });
  connection = new ConnectionMonitor(updateConnection);
  primary.addEventListener('click', () => { void begin(); });
  secondary.addEventListener('click', () => { sim = null; transition('GALLERY'); });
  pauseButton.addEventListener('click', () => pause('Ты остановил забег.'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { lifecycleEpoch++; pause('Вкладка была скрыта. Продолжи, когда будешь готов.'); }
  });
  window.addEventListener('blur', () => { lifecycleEpoch++; pause('Окно потеряло фокус. Продолжи, когда будешь готов.'); });
  window.addEventListener('offline', () => { lifecycleEpoch++; connection.markOffline(); });
  window.addEventListener('online', () => { void connection.check(); });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); lifecycleEpoch++; contextAvailable = false; pause('Графический контекст потерян. Ожидаем восстановления.'); updateScreen();
  });
  canvas.addEventListener('webglcontextrestored', () => { contextAvailable = true; updateScreen(); });
  connection.start();
  void loadAssets();
  world.engine.runRenderLoop(() => {
    const now = performance.now();
    const delta = Math.max(0, (now - previousFrame) / 1000);
    previousFrame = now;
    // A blocked frame is a system pause, not a burst of unseen enemy movement.
    if (delta > 0.5 && (phase === 'RUNNING' || phase === 'COUNTDOWN')) pause('Игра была прервана. Продолжи, когда будешь готов.');
    if (phase === 'COUNTDOWN') {
      countdown -= Math.min(delta, 0.1);
      get('countdown').textContent = String(Math.max(1, Math.ceil(countdown)));
      if (countdown <= 0) { sim?.resume(); transition('RUNNING'); }
    }
    if (phase === 'RUNNING' && sim) {
      accumulator += delta;
      while (accumulator + 1e-10 >= FIXED_STEP && phase === 'RUNNING') {
        sim.step([{ type: 'move', axis: input.axis }, ...commands]);
        world.observe(sim.state);
        commands = [];
        accumulator -= FIXED_STEP;
        if (sim.state.phase === 'gameOver') transition('GAME_OVER');
      }
    }
    const state = sim?.state;
    input.refreshAim({ x: state?.hero.x ?? 0, z: (state?.hero.z ?? 0) + 20 });
    get('distance').innerHTML = `${Math.floor(state?.distance ?? 0)}<small> м</small>`;
    get('kills').textContent = String(state ? state.kills.normal + state.kills.strong + state.kills.boss : 0);
    const boss = state?.enemies.find(enemy => enemy.kind === 'boss' && enemy.status === 'alive');
    get('boss-status').hidden = !boss || phase !== 'RUNNING';
    if (boss) get('boss-hits').textContent = `${boss.hitsRemaining} / ${boss.requiredHits}`;
    const preparing = phase === 'RUNNING' && state?.enemies.some(enemy => enemy.status === 'alive' && enemy.shooting?.phase === 'telegraph');
    get('shot-warning').hidden = !preparing;
    const remaining = state?.cooldownRemaining ?? 0;
    get('hook-status').textContent = state?.hook ? state.hook.phase === 'outbound' ? 'Крюк летит' : 'Возвращается' : remaining > 0 ? `${remaining.toFixed(1)} с` : 'Готов';
    get('cooldown-fill').style.transform = `scaleX(${Math.max(0, Math.min(1, 1 - remaining / (sim?.config.hookCooldown ?? DEFAULT_CONFIG.hookCooldown)))})`;
    get('ability').dataset.ready = String(Boolean(sim?.canCast));
    if (now > feedbackUntil) get('feedback').textContent = '';
    if (contextAvailable) world.render(sim, input.aimPoint, delta);
  });
} catch (error) {
  get('eyebrow').textContent = 'НЕ УДАЛОСЬ ОТКРЫТЬ ИГРУ';
  get('screen-title').innerHTML = 'НУЖЕН WEBGL<span>Проверь браузер и ускорение графики</span>';
  get('screen-description').textContent = 'Игровая 3D-сцена недоступна. Попробуй обновить страницу в браузере с включённым аппаратным ускорением.';
  primary.hidden = true;
  get('instructions').hidden = true;
  console.error(error);
}
