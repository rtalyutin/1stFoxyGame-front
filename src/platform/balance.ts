import type { SimulationConfig, ShopZoneConfig } from '../game/config';
import { RunSimulation } from '../game/simulation';
import type { EquipmentCatalog, EquipmentModifiers } from '../game/equipment';
import { parseGoldMilli, validateCatalog as validateEquipmentCatalog } from '../game/equipment';
import { ApiError, GameApi, TransportError } from './api';
import { validateForgeConfig } from './workshop';
import type { ForgeConfig } from './workshop';

export const BALANCE_SCHEMA = 'runner-balance.1' as const;
export type BalanceValue = number | boolean | string;
export interface BalanceParameter { key: string; label: string; group: string; unit: string; type: 'number' | 'integer' | 'boolean' | 'goldMilli'; min?: number; max?: number; step?: number; }
export interface RuntimeBalance {
  shopMinDistance: number; shopMaxDistance: number; shopRightProbability: number;
  shooterChanceStart: number; shooterChanceMax: number; shooterChanceRampSeconds: number;
  slowDurationSeconds: number; slowSpeedMultiplier: number; collectorKills: number; collectorGoldMultiplierMilli: number;
}
export interface CompiledBalance {
  config: SimulationConfig; shopZone: ShopZoneConfig; equipment: EquipmentCatalog;
  rewards: { version: 'r34.1'; components: { id: 'steel' | 'ember' | 'core'; label: string }[]; rewards: { kind: 'normal' | 'strong' | 'boss'; baseGoldMilli: string; commonDrops: number; coreDrops: number; steelProbability: number }[] };
  baseModifiers: EquipmentModifiers; runtime?: RuntimeBalance; forge?: ForgeConfig;
}
export interface PinnedBalance { schemaVersion: typeof BALANCE_SCHEMA; revision: string; compiled: CompiledBalance; }
export interface BalanceDocument extends PinnedBalance { values: Record<string, BalanceValue>; parameters: readonly BalanceParameter[]; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(): never { throw new ApiError('CORRUPT_BALANCE', 'Ответ с балансом повреждён или несовместим. Повтори загрузку.', 503); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(); return value as Record<string, unknown>; }
const numericRecord = (value: unknown): Record<string, unknown> => {
  const record = object(value); if (!Object.keys(record).length || Object.values(record).some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) fail(); return record;
};
/** Numeric tuning is data; structural/protocol changes still require a paired release. */
export function validatePinnedBalance(value: unknown): PinnedBalance {
  const b = object(value);
  if (b.schemaVersion !== BALANCE_SCHEMA || typeof b.revision !== 'string' || b.revision !== 'legacy-r34.1' && !UUID.test(b.revision)) fail();
  const compiled = object(b.compiled), config = object(compiled.config);
  if (typeof config.spawning !== 'boolean' || Object.entries(config).some(([k,v]) => k !== 'spawning' && (typeof v !== 'number' || !Number.isFinite(v) || v < 0))) fail();
  for (const key of ['heroSpeed','lateralSpeed','heroRadius','lateralLimit','enemySpeed','enemyRadius','breachOffset','spawnDistance','spawnMinSeconds','spawnMaxSeconds','maxEnemies','hookRange','hookOutboundSpeed','hookReturnSpeed','hookCooldown','hookRadius','strongRadius','bossRadius','bossEnemySpeed','bossRequiredHits','projectileRadius','projectileSpeed','projectileLifetime','shooterTelegraph','shooterInterval','bossTelegraph','bossInterval','bossVolleyDegrees','maxShooters','maxBosses','maxProjectiles','shooterUnlockSeconds','bossFirstSeconds','bossMinKills','bossMinInterval','bossMaxInterval','shopMinInterval','shopMaxInterval','spawnSafetySeconds','spawnRetrySeconds']) if (typeof config[key] !== 'number') fail();
  const zone = numericRecord(compiled.shopZone); if (typeof zone.lateralRadius !== 'number' || typeof zone.longitudinalRadius !== 'number') fail();
  try { validateEquipmentCatalog(compiled.equipment); } catch { fail(); }
  const base = numericRecord(compiled.baseModifiers);
  for (const key of ['rangeMultiplier','outboundSpeedMultiplier','returnSpeedMultiplier','cooldown','lateralSpeedMultiplier','pierceTargets','returnHitTargets','goldMultiplierMilli']) if (typeof base[key] !== 'number') fail();
  if (base.cooldown !== config.hookCooldown) fail();
  const rewards = object(compiled.rewards);
  if (rewards.version !== 'r34.1' || !Array.isArray(rewards.components) || rewards.components.length !== 3 || !Array.isArray(rewards.rewards) || rewards.rewards.length !== 3) fail();
  const components = new Set();
  for (const raw of rewards.components) { const component = object(raw); if (!['steel','ember','core'].includes(String(component.id)) || components.has(component.id) || typeof component.label !== 'string' || !component.label.trim()) fail(); components.add(component.id); }
  const seen = new Set();
  for (const raw of rewards.rewards as unknown[]) {
    const reward = object(raw); if (!['normal','strong','boss'].includes(String(reward.kind)) || seen.has(reward.kind)) fail(); seen.add(reward.kind);
    try { parseGoldMilli(reward.baseGoldMilli); } catch { fail(); }
    for (const [key,max] of [['commonDrops',2],['coreDrops',1]] as const) if (typeof reward[key] !== 'number' || !Number.isSafeInteger(reward[key]) || reward[key] < 0 || reward[key] > max) fail();
    if (typeof reward.steelProbability !== 'number' || !Number.isFinite(reward.steelProbability) || reward.steelProbability < 0 || reward.steelProbability > 1) fail();
  }
  if (compiled.runtime !== undefined) {
    const runtime = numericRecord(compiled.runtime);
    for (const key of ['shopMinDistance','shopMaxDistance','shopRightProbability','shooterChanceStart','shooterChanceMax','shooterChanceRampSeconds','slowDurationSeconds','slowSpeedMultiplier','collectorKills','collectorGoldMultiplierMilli']) if (typeof runtime[key] !== 'number') fail();
  } else if (b.revision !== 'legacy-r34.1') fail();
  // Old saved snapshots predate the workshop. A present forge section must be complete.
  if (compiled.forge !== undefined) { try { validateForgeConfig(compiled.forge); } catch { fail(); } }
  try {
    const typed = compiled as unknown as CompiledBalance;
    new RunSimulation('balance-response-check', 1, { config:typed.config, shopZone:typed.shopZone, runtimeBalance:typed.runtime }).setEquipment(typed.baseModifiers);
  } catch { fail(); }
  return structuredClone(value) as PinnedBalance;
}
export function parameterError(parameter: BalanceParameter, value: unknown): string | null {
  if (parameter.type === 'boolean') return typeof value === 'boolean' ? null : 'Выбери включено или выключено.';
  if (parameter.type === 'goldMilli') {
    try {
      const amount = parseGoldMilli(value);
      if (/^forge\.productions\.[a-z]+\.baseCostGoldMilli$/.test(parameter.key) && amount % 1000n) return 'Базовая цена постройки задаётся в целом золоте: кратно 1000 тысячных.';
      return null;
    } catch { return 'Нужно целое число тысячных золота от 0 до 9223372036854775807.'; }
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Введи число.';
  if (parameter.type === 'integer' && !Number.isSafeInteger(value)) return 'Нужно целое число.';
  if (parameter.min !== undefined && value < parameter.min) return `Минимум: ${parameter.min}.`;
  if (parameter.max !== undefined && value > parameter.max) return `Максимум: ${parameter.max}.`;
  return null;
}
export function validateBalanceDocument(value: unknown): BalanceDocument {
  const pinned = validatePinnedBalance(value), record = object(value), values = object(record.values);
  if (pinned.revision === 'legacy-r34.1' || !Array.isArray(record.parameters) || !record.parameters.length || record.parameters.length > 1000) fail();
  const keys = new Set<string>();
  for (const raw of record.parameters as unknown[]) {
    const p = object(raw);
    if (typeof p.key !== 'string' || !/^[a-zA-Z0-9_.]+$/.test(p.key) || keys.has(p.key) || typeof p.label !== 'string' || typeof p.group !== 'string' || typeof p.unit !== 'string' || !['number','integer','boolean','goldMilli'].includes(String(p.type))) fail();
    for (const key of ['min','max','step']) if (p[key] !== undefined && (typeof p[key] !== 'number' || !Number.isFinite(p[key]))) fail();
    if (typeof p.min === 'number' && typeof p.max === 'number' && p.min > p.max || typeof p.step === 'number' && p.step <= 0) fail();
    if (parameterError(p as unknown as BalanceParameter, values[p.key])) fail(); keys.add(p.key);
  }
  if (Object.keys(values).length !== keys.size || Object.keys(values).some(key => !keys.has(key))) fail();
  return structuredClone(value) as BalanceDocument;
}
export class BalanceEditor {
  document: BalanceDocument | null = null;
  draft: Record<string, BalanceValue> = {};
  error = '';
  busy = false;
  constructor(readonly api: GameApi) {}
  get dirty(): boolean { return Boolean(this.document && this.document.parameters.some(p => this.draft[p.key] !== this.document!.values[p.key])); }
  async load(): Promise<void> {
    this.busy = true;
    try { this.document = validateBalanceDocument(await this.api.call('/admin/balance')); this.draft = structuredClone(this.document.values); this.error = ''; }
    catch (e) { this.error = e instanceof Error ? e.message : 'Не удалось загрузить баланс.'; throw e; }
    finally { this.busy = false; }
  }
  async save(): Promise<void> {
    if (!this.document || this.busy) return;
    this.busy = true; this.error = '';
    try {
      const saved = validateBalanceDocument(await this.api.call('/admin/balance', { expectedRevision: this.document.revision, values: this.draft }, 'PUT'));
      this.document = saved; this.draft = structuredClone(saved.values);
    } catch (e) {
      this.error = e instanceof ApiError && e.status === 409 ? 'Баланс уже изменён в другом окне. Черновик сохранён здесь. Загрузи текущую версию, чтобы сверить изменения; это заменит черновик.' : e instanceof TransportError ? 'Ответ на сохранение не получен. Изменения могли сохраниться. Черновик оставлен здесь; загрузка текущей версии покажет результат и заменит черновик.' : e instanceof Error ? e.message : 'Не удалось сохранить баланс.';
      throw e;
    } finally { this.busy = false; }
  }
}
