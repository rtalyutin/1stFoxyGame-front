import { parseGoldMilli } from '../game/equipment';
import { ApiError } from './api';

export const PRODUCTION_IDS = ['apprentice', 'smelter', 'press', 'alchemy'] as const;
export type ProductionId = typeof PRODUCTION_IDS[number];
export interface ForgeConfig {
  productions: Record<ProductionId, { baseCostGoldMilli: string; rateGoldMilliPerSecond: string }>;
  priceGrowthPermille: number;
  tapGoldMilli: [string, string, string, string];
  tapUpgradeCostGoldMilli: [string, string, string];
  organizationPermille: [number, number, number, number];
  organizationUpgradeCostGoldMilli: [string, string, string];
  offlineCapSeconds: number;
  clockEveryKills: number;
  clockSeconds: number;
}
export interface WorkshopSettlement { elapsedMs: number; creditedMs: number; discardedMs: number; goldMilli: string; }
export interface WorkshopView {
  schemaVersion: 'runner-workshop.1'; balanceRevision: string; serverNowMs: number; settledAtMs: number;
  offlineCapSeconds: number; tapLevel: number; organizationLevel: number; tapGoldMilli: string;
  productionRate: { numerator: string; denominator: 1000 };
  productions: { id: ProductionId; name: string; owned: number; rateGoldMilliPerSecond: string; nextCostGoldMilli: string | null }[];
  upgrades: { tap: { costGoldMilli: string | null; nextGoldMilli: string | null }; organization: { costGoldMilli: string | null; nextPermille: number | null } };
  organizationPermille: number;
  lastSettlement?: WorkshopSettlement;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(): never { throw new ApiError('CORRUPT_WORKSHOP', 'Ответ мастерской повреждён. Золото не рассчитано на устройстве; повтори загрузку.', 503); }
function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const v = value as Record<string, unknown>;
  if (required.some(key => !(key in v)) || Object.keys(v).some(key => !required.includes(key) && !optional.includes(key))) return fail();
  return v;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail();
}
function gold(value: unknown): asserts value is string { try { parseGoldMilli(value); } catch { fail(); } }
function nullableGold(value: unknown): void { if (value !== null) gold(value); }

export function validateForgeConfig(value: unknown): ForgeConfig {
  const v = object(value, ['productions','priceGrowthPermille','tapGoldMilli','tapUpgradeCostGoldMilli','organizationPermille','organizationUpgradeCostGoldMilli','offlineCapSeconds','clockEveryKills','clockSeconds']);
  const productions = object(v.productions, PRODUCTION_IDS);
  for (const id of PRODUCTION_IDS) {
    const p = object(productions[id], ['baseCostGoldMilli','rateGoldMilliPerSecond']); gold(p.baseCostGoldMilli); gold(p.rateGoldMilliPerSecond);
    if (BigInt(p.baseCostGoldMilli) % 1000n) fail();
  }
  integer(v.priceGrowthPermille, 10000, 1000); integer(v.offlineCapSeconds, 604800, 1); integer(v.clockEveryKills, 1000, 1); integer(v.clockSeconds, 3600, 1);
  for (const [key,size] of [['tapGoldMilli',4],['tapUpgradeCostGoldMilli',3],['organizationUpgradeCostGoldMilli',3]] as const) {
    if (!Array.isArray(v[key]) || v[key].length !== size) fail(); for (const amount of v[key]) gold(amount);
  }
  if (!Array.isArray(v.organizationPermille) || v.organizationPermille.length !== 4) fail();
  for (const multiplier of v.organizationPermille) integer(multiplier, 100000, 1000);
  return structuredClone(value) as ForgeConfig;
}
/** Views contain only committed server values; the browser never advances gold. */
export function validateWorkshopView(value: unknown): WorkshopView {
  const v = object(value, ['schemaVersion','balanceRevision','serverNowMs','settledAtMs','offlineCapSeconds','tapLevel','organizationLevel','tapGoldMilli','productionRate','productions','upgrades','organizationPermille'], ['lastSettlement']);
  if (v.schemaVersion !== 'runner-workshop.1' || typeof v.balanceRevision !== 'string' || !UUID.test(v.balanceRevision)) fail();
  integer(v.serverNowMs); integer(v.settledAtMs); integer(v.offlineCapSeconds, 604800,1); integer(v.tapLevel,3); integer(v.organizationLevel,3); integer(v.organizationPermille,100000,1000); gold(v.tapGoldMilli);
  const rate = object(v.productionRate,['numerator','denominator']);
  if (rate.denominator !== 1000 || typeof rate.numerator !== 'string' || !/^(0|[1-9][0-9]{0,49})$/.test(rate.numerator)) fail();
  if (!Array.isArray(v.productions) || v.productions.length !== 4) fail(); const seen = new Set();
  let expectedRate = 0n;
  for (const raw of v.productions) {
    const p = object(raw,['id','name','owned','rateGoldMilliPerSecond','nextCostGoldMilli']);
    if (!PRODUCTION_IDS.includes(p.id as ProductionId) || seen.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 128) fail(); seen.add(p.id);
    integer(p.owned,2147483647); gold(p.rateGoldMilliPerSecond); nullableGold(p.nextCostGoldMilli);
    expectedRate += BigInt(p.rateGoldMilliPerSecond) * BigInt(p.owned);
  }
  if (expectedRate * BigInt(v.organizationPermille) !== BigInt(rate.numerator)) fail();
  const upgrades = object(v.upgrades,['tap','organization']);
  const tap = object(upgrades.tap,['costGoldMilli','nextGoldMilli']), organization = object(upgrades.organization,['costGoldMilli','nextPermille']);
  nullableGold(tap.costGoldMilli); nullableGold(tap.nextGoldMilli); nullableGold(organization.costGoldMilli);
  if (organization.nextPermille !== null) integer(organization.nextPermille,100000,1000);
  if (v.tapLevel === 3 ? tap.costGoldMilli !== null || tap.nextGoldMilli !== null : tap.costGoldMilli === null || tap.nextGoldMilli === null) fail();
  if (v.organizationLevel === 3 ? organization.costGoldMilli !== null || organization.nextPermille !== null : organization.costGoldMilli === null || organization.nextPermille === null) fail();
  if (v.lastSettlement !== undefined) {
    const s = object(v.lastSettlement,['elapsedMs','creditedMs','discardedMs','goldMilli']);
    integer(s.elapsedMs); integer(s.creditedMs); integer(s.discardedMs); gold(s.goldMilli);
    if (s.creditedMs + s.discardedMs !== s.elapsedMs) fail();
  }
  return structuredClone(value) as WorkshopView;
}
/** numerator / 1000 milli-gold per second = numerator / 1,000,000 gold. */
export function productionRateText(rate: WorkshopView['productionRate']): string {
  const n = BigInt(rate.numerator), fraction = String(n % 1000000n).padStart(6,'0').replace(/0+$/,'');
  return `${n / 1000000n}${fraction ? `,${fraction}` : ''}`;
}
export function settlementDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return hours ? `${hours} ч ${minutes} мин` : minutes ? `${minutes} мин ${seconds % 60} с` : `${seconds} с`;
}
