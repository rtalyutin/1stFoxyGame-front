import type { Command, SimulationSnapshot } from './simulation';
import type { PinnedBalance } from '../platform/balance';
import type { ProductionId, WorkshopView } from '../platform/workshop';

export type GoldMilli = string;
export type Slot = 'weapon' | 'body' | 'legs' | 'talisman';
export type HeroId = 'pudge';
export type ComponentId = 'steel' | 'ember' | 'core';
export type ItemDefinitionId = 'fast_reel' | 'long_link' | 'piercing_tooth' | 'return_sickle' | 'conductor_cuffs' | 'side_step_boots' | 'trophy_counter' | 'debt_clock';
export type ConsumableId = 'slow_dust' | 'collector_vial';
export type Components = Record<ComponentId, number>;
export interface Recipe { goldMilli: GoldMilli; components: Components; }
export interface EquipmentModifiers {
  readonly rangeMultiplier: number;
  readonly outboundSpeedMultiplier: number;
  readonly returnSpeedMultiplier: number;
  readonly cooldown: number;
  readonly lateralSpeedMultiplier: number;
  readonly pierceTargets: number;
  readonly returnHitTargets: number;
  readonly goldMultiplierMilli: number;
}
export interface ItemLevel { level: number; recipe: Recipe; modifiers: Partial<EquipmentModifiers>; }
export interface ItemDefinition { id: ItemDefinitionId; name: string; slot: Slot; hero: HeroId | 'all'; levels: ItemLevel[]; }
export type ConsumableEffect = { type: 'slow'; durationSeconds: number; speedMultiplier: number } | { type: 'collector'; kills: number; goldMultiplierMilli: number };
export interface ConsumableDefinition { id: ConsumableId; name: string; recipe: Recipe; effect: ConsumableEffect; }
export interface EquipmentCatalog { version: 'r34.1'; items: ItemDefinition[]; consumables: ConsumableDefinition[]; }
export interface ItemInstance { id: string; definitionId: ItemDefinitionId; level: number; }
export interface HeroLoadout { weapon: string | null; body: string | null; legs: string | null; talisman: string | null; quick: [ConsumableId | null, ConsumableId | null]; }
export interface Profile {
  accountId: string;
  revision: number;
  goldMilli: GoldMilli;
  components: Components;
  items: ItemInstance[];
  loadouts: { pudge: HeroLoadout };
  consumables: Record<ConsumableId, number>;
  stats: { runs: number; totalKills: number; bestDistance: number };
}
export interface RunView { runId: string; loot: { goldMilli: GoldMilli; components: Components }; snapshot: SimulationSnapshot; balance: PinnedBalance; control: 'owner' | 'readOnly'; ownerEpoch: number; updatedAt: string; }
export type RunOwnership = { runId: string; ownerEpoch: number };
export type OperationAction =
  | { type: 'start_run'; payload: Record<string, never> }
  | { type: 'advance_run'; payload: RunOwnership & { frames: Command[][] } }
  | { type: 'pause_run' | 'resume_run' | 'leave_shop' | 'end_run'; payload: RunOwnership }
  | { type: 'takeover_run'; payload: { runId: string } }
  | { type: 'craft'; payload: { definitionId: ItemDefinitionId | ConsumableId } }
  | { type: 'upgrade'; payload: { itemId: string } }
  | { type: 'equip'; payload: { slot: Slot; itemId: string | null } }
  | { type: 'quick_slots'; payload: { slots: [ConsumableId | null, ConsumableId | null] } }
  | { type: 'consume'; payload: RunOwnership & { definitionId: ConsumableId } }
  | { type: 'forge_settle'; payload: Record<string, never> }
  | { type: 'forge_tap'; payload: { balanceRevision: string } }
  | { type: 'forge_buy'; payload: { productionId: ProductionId; balanceRevision: string } }
  | { type: 'forge_upgrade'; payload: { upgrade: 'tap' | 'organization'; balanceRevision: string } };
export type Operation = { operationId: string; expectedRevision: number; clientId: string } & OperationAction;
export interface ConfirmedReward {enemyId:string;kind:'normal'|'strong'|'boss';at:number;goldMilli:GoldMilli;components:Components;clockGoldMilli?:GoldMilli;clockSeconds?:number;}
export interface OperationResult { operationId: string; status: 'committed'; profile: Profile; run: RunView | null; replayed: boolean; workshop?: WorkshopView; visualRewards?:ConfirmedReward[]; }

/** Exact wallet limits align with PostgreSQL signed bigint / component integer columns. */
export const GOLD_MAX_MILLI = '9223372036854775807';
export const COMPONENT_MAX = 2147483647;
export const EQUIPMENT_SLOTS: readonly Slot[] = Object.freeze(['weapon', 'body', 'legs', 'talisman']);
export const COMPONENT_IDS: readonly ComponentId[] = Object.freeze(['steel', 'ember', 'core']);
export const CONSUMABLE_IDS: readonly ConsumableId[] = Object.freeze(['slow_dust', 'collector_vial']);
export const BASE_MODIFIERS: Readonly<EquipmentModifiers> = Object.freeze({
  rangeMultiplier: 1, outboundSpeedMultiplier: 1, returnSpeedMultiplier: 1,
  cooldown: 2, lateralSpeedMultiplier: 1, pierceTargets: 1, returnHitTargets: 0, goldMultiplierMilli: 1000,
});
const ITEM_RULES = {
  fast_reel: { slot: 'weapon', hero: 'pudge', levels: 3, keys: ['returnSpeedMultiplier', 'cooldown'] },
  long_link: { slot: 'weapon', hero: 'pudge', levels: 1, keys: ['rangeMultiplier', 'outboundSpeedMultiplier'] },
  piercing_tooth: { slot: 'weapon', hero: 'pudge', levels: 1, keys: ['pierceTargets'] },
  return_sickle: { slot: 'weapon', hero: 'pudge', levels: 1, keys: ['returnHitTargets'] },
  conductor_cuffs: { slot: 'body', hero: 'all', levels: 3, keys: ['outboundSpeedMultiplier'] },
  side_step_boots: { slot: 'legs', hero: 'all', levels: 3, keys: ['lateralSpeedMultiplier'] },
  trophy_counter: { slot: 'talisman', hero: 'all', levels: 3, keys: ['goldMultiplierMilli'] },
  debt_clock: { slot: 'talisman', hero: 'all', levels: 1, keys: [] },
} as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(input: unknown, keys: readonly string[]): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected equipment object');
  const actual = Object.keys(input);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) throw new Error('Unexpected or missing equipment field');
}
function integer(input: unknown, max = COMPONENT_MAX): asserts input is number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0 || input > max) throw new Error('Invalid nonnegative integer');
}
function finite(input: unknown, minimum: number, maximum: number): asserts input is number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < minimum || input > maximum) throw new Error('Invalid equipment number');
}
function nonempty(input: unknown): asserts input is string {
  if (typeof input !== 'string' || input.trim().length < 1 || input.length > 128) throw new Error('Invalid equipment name');
}
function id(input: unknown): asserts input is string {
  if (typeof input !== 'string' || !UUID.test(input)) throw new Error('Invalid instance/account ID');
}
export function parseGoldMilli(input: unknown): bigint {
  if (typeof input !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(input)) throw new Error('Invalid goldMilli');
  const value = BigInt(input);
  if (value > BigInt(GOLD_MAX_MILLI)) throw new Error('Gold overflow');
  return value;
}
export function validateConfirmedRewards(input:unknown):ConfirmedReward[]{
  if(!Array.isArray(input)||input.length>10000)throw new Error('Invalid visual reward receipts');
  for(const reward of input){
    if(!reward||typeof reward!=='object'||typeof reward.enemyId!=='string'||reward.enemyId.length<1||reward.enemyId.length>256||!['normal','strong','boss'].includes(reward.kind)||!Number.isFinite(reward.at)||reward.at<0)throw new Error('Invalid reward identity');
    parseGoldMilli(reward.goldMilli);validateComponents(reward.components);
    if(reward.clockGoldMilli!==undefined){parseGoldMilli(reward.clockGoldMilli);if(!Number.isSafeInteger(reward.clockSeconds)||reward.clockSeconds<1)throw new Error('Invalid clock receipt');}
    else if(reward.clockSeconds!==undefined)throw new Error('Incomplete clock receipt');
  }
  return structuredClone(input);
}
export function addGoldMilli(a: GoldMilli, b: GoldMilli): GoldMilli {
  const sum = parseGoldMilli(a) + parseGoldMilli(b);
  if (sum > BigInt(GOLD_MAX_MILLI)) throw new Error('Gold overflow');
  return sum.toString();
}
function validateComponents(input: unknown): asserts input is Components {
  object(input, COMPONENT_IDS);
  for (const key of COMPONENT_IDS) integer(input[key]);
}
export function validateRecipe(input: unknown): Recipe {
  object(input, ['goldMilli', 'components']);
  parseGoldMilli(input.goldMilli);
  validateComponents(input.components);
  return structuredClone(input) as unknown as Recipe;
}
/** Rejects unknown slots/heroes/modifiers, impossible recipes, and boss-hit bypasses. */
export function validateCatalog(input: unknown): EquipmentCatalog {
  object(input, ['version', 'items', 'consumables']);
  if (input.version !== 'r34.1') throw new Error('Unsupported equipment version');
  if (!Array.isArray(input.items) || input.items.length !== 7 && input.items.length !== 8) throw new Error('R34/R5 requires seven base items and an optional debt clock');
  const seen = new Set<string>();
  for (const item of input.items) {
    object(item, ['id', 'name', 'slot', 'hero', 'levels']);
    if (typeof item.id !== 'string' || !(item.id in ITEM_RULES) || seen.has(item.id)) throw new Error('Unknown/duplicate item');
    seen.add(item.id);
    const rule = ITEM_RULES[item.id as ItemDefinitionId];
    if (item.slot !== rule.slot || item.hero !== rule.hero) throw new Error('Incompatible item slot/hero');
    nonempty(item.name);
    if (!Array.isArray(item.levels) || item.levels.length !== rule.levels) throw new Error('Invalid item levels');
    for (const [index, level] of item.levels.entries()) {
      object(level, ['level', 'recipe', 'modifiers']);
      if (level.level !== index + 1) throw new Error('Noncontiguous item levels');
      validateRecipe(level.recipe);
      object(level.modifiers, rule.keys);
      for (const [key, value] of Object.entries(level.modifiers)) {
        if (key === 'pierceTargets') { integer(value, 2); if (value < 1) throw new Error('Invalid pierce target cap'); }
        else if (key === 'returnHitTargets') integer(value, 1);
        else if (key === 'goldMultiplierMilli') { integer(value, 2000); if (value < 1000) throw new Error('Invalid gold multiplier'); }
        else if (key === 'cooldown') finite(value, 0.1, 2);
        else finite(value, 1, 2);
      }
    }
  }
  if (seen.size === 7 && seen.has('debt_clock')) throw new Error('Missing base equipment item');
  if (!Array.isArray(input.consumables) || input.consumables.length !== 2) throw new Error('R34 requires two consumables');
  const consumables = new Set<string>();
  for (const consumable of input.consumables) {
    object(consumable, ['id', 'name', 'recipe', 'effect']);
    if (!CONSUMABLE_IDS.includes(consumable.id as ConsumableId) || consumables.has(consumable.id as string)) throw new Error('Unknown/duplicate consumable');
    consumables.add(consumable.id as string);
    nonempty(consumable.name); validateRecipe(consumable.recipe);
    if (consumable.id === 'slow_dust') {
      object(consumable.effect, ['type', 'durationSeconds', 'speedMultiplier']);
      if (consumable.effect.type !== 'slow') throw new Error('Invalid slow effect');
      finite(consumable.effect.durationSeconds, 0.1, 30); finite(consumable.effect.speedMultiplier, 0.1, 1);
    } else {
      object(consumable.effect, ['type', 'kills', 'goldMultiplierMilli']);
      if (consumable.effect.type !== 'collector') throw new Error('Invalid collector effect');
      integer(consumable.effect.kills, 100); if (consumable.effect.kills < 1) throw new Error('Invalid collector length');
      integer(consumable.effect.goldMultiplierMilli, 2000); if (consumable.effect.goldMultiplierMilli < 1000) throw new Error('Invalid collector multiplier');
    }
  }
  return structuredClone(input) as unknown as EquipmentCatalog;
}
function freezeCatalog<T>(input: T): T {
  if (input && typeof input === 'object') {
    for (const child of Object.values(input)) freezeCatalog(child);
    Object.freeze(input);
  }
  return input;
}
export function getItemDefinition(definitionId: string, catalog: EquipmentCatalog = EQUIPMENT_CATALOG): ItemDefinition {
  const item = catalog.items.find((candidate) => candidate.id === definitionId);
  if (!item) throw new Error('Unknown item definition');
  return item;
}
export function getConsumableDefinition(definitionId: string, catalog: EquipmentCatalog = EQUIPMENT_CATALOG): ConsumableDefinition {
  const item = catalog.consumables.find((candidate) => candidate.id === definitionId);
  if (!item) throw new Error('Unknown consumable definition');
  return item;
}
/** Level 0 means craft; levels 1/2 request the cost of upgrading that existing level. */
export function recipeCost(definitionId: string, currentLevel = 0, catalog: EquipmentCatalog = EQUIPMENT_CATALOG): Recipe {
  validateCatalog(catalog);
  integer(currentLevel, 3);
  if (CONSUMABLE_IDS.includes(definitionId as ConsumableId)) {
    if (currentLevel !== 0) throw new Error('Consumables cannot be upgraded');
    return structuredClone(getConsumableDefinition(definitionId, catalog).recipe);
  }
  const next = getItemDefinition(definitionId, catalog).levels.find((candidate) => candidate.level === currentLevel + 1);
  if (!next) throw new Error('Item has no further level');
  return structuredClone(next.recipe);
}
export const cost = recipeCost;
export function canCraft(profile: Pick<Profile, 'goldMilli' | 'components'>, recipe: Recipe): boolean {
  validateRecipe(recipe); validateComponents(profile.components);
  return parseGoldMilli(profile.goldMilli) >= parseGoldMilli(recipe.goldMilli)
    && COMPONENT_IDS.every((component) => profile.components[component] >= recipe.components[component]);
}
export function createEmptyProfile(accountId: string): Profile {
  id(accountId);
  return { accountId, revision: 0, goldMilli: '0', components: { steel: 0, ember: 0, core: 0 }, items: [],
    loadouts: { pudge: { weapon: null, body: null, legs: null, talisman: null, quick: [null, null] } },
    consumables: { slow_dust: 0, collector_vial: 0 }, stats: { runs: 0, totalKills: 0, bestDistance: 0 } };
}
/** Corrupted authority is rejected; this function never repairs with an empty profile. */
export function validateProfile(input: unknown, catalog: EquipmentCatalog = EQUIPMENT_CATALOG): Profile {
  validateCatalog(catalog);
  object(input, ['accountId', 'revision', 'goldMilli', 'components', 'items', 'loadouts', 'consumables', 'stats']);
  id(input.accountId); integer(input.revision, Number.MAX_SAFE_INTEGER); parseGoldMilli(input.goldMilli); validateComponents(input.components);
  if (!Array.isArray(input.items) || input.items.length > 10000) throw new Error('Invalid item inventory');
  const instances = new Map<string, ItemInstance>();
  for (const item of input.items) {
    object(item, ['id', 'definitionId', 'level']); id(item.id);
    if (instances.has(item.id)) throw new Error('Duplicate item instance');
    const definition = item.definitionId === 'debt_clock' && !catalog.items.some(d => d.id === 'debt_clock') ? getItemDefinition('debt_clock') : getItemDefinition(item.definitionId as string, catalog);
    if (!definition.levels.some((level) => level.level === item.level)) throw new Error('Invalid owned item level');
    instances.set(item.id, item as unknown as ItemInstance);
  }
  object(input.loadouts, ['pudge']); object(input.loadouts.pudge, [...EQUIPMENT_SLOTS, 'quick']);
  for (const slot of EQUIPMENT_SLOTS) {
    const instanceId = input.loadouts.pudge[slot];
    if (instanceId === null) continue;
    id(instanceId);
    const instance = instances.get(instanceId);
    if (!instance || (instance.definitionId === 'debt_clock' && !catalog.items.some(d => d.id === 'debt_clock') ? getItemDefinition('debt_clock') : getItemDefinition(instance.definitionId, catalog)).slot !== slot) throw new Error('Unowned/incompatible equipped item');
  }
  const quick = input.loadouts.pudge.quick;
  if (!Array.isArray(quick) || quick.length !== 2 || quick.some((entry) => entry !== null && !CONSUMABLE_IDS.includes(entry as ConsumableId))) throw new Error('Invalid quick slots');
  object(input.consumables, CONSUMABLE_IDS); for (const key of CONSUMABLE_IDS) integer(input.consumables[key]);
  object(input.stats, ['runs', 'totalKills', 'bestDistance']); integer(input.stats.runs, Number.MAX_SAFE_INTEGER); integer(input.stats.totalKills, Number.MAX_SAFE_INTEGER);
  finite(input.stats.bestDistance, 0, Number.MAX_SAFE_INTEGER);
  return structuredClone(input) as unknown as Profile;
}
/** Starts from base for every call. Owned but unequipped items have no effect. */
export function computeModifiers(profile: Profile, catalog: EquipmentCatalog = EQUIPMENT_CATALOG, base: Readonly<EquipmentModifiers> = BASE_MODIFIERS): Readonly<EquipmentModifiers> {
  validateProfile(profile, catalog);
  let rangeMultiplier = base.rangeMultiplier, outboundSpeedMultiplier = base.outboundSpeedMultiplier, returnSpeedMultiplier = base.returnSpeedMultiplier, cooldown = base.cooldown;
  let lateralSpeedMultiplier = base.lateralSpeedMultiplier, pierceTargets = base.pierceTargets, returnHitTargets = base.returnHitTargets, goldMultiplierMilli = base.goldMultiplierMilli;
  for (const slot of EQUIPMENT_SLOTS) {
    const instanceId = profile.loadouts.pudge[slot];
    if (instanceId === null) continue;
    const instance = profile.items.find((candidate) => candidate.id === instanceId)!;
    if (instance.definitionId === 'debt_clock' && !catalog.items.some(item => item.id === 'debt_clock')) continue;
    const level = getItemDefinition(instance.definitionId, catalog).levels.find((candidate) => candidate.level === instance.level)!;
    const effect = level.modifiers;
    rangeMultiplier *= effect.rangeMultiplier ?? 1;
    outboundSpeedMultiplier *= effect.outboundSpeedMultiplier ?? 1;
    returnSpeedMultiplier *= effect.returnSpeedMultiplier ?? 1;
    cooldown = effect.cooldown ?? cooldown;
    lateralSpeedMultiplier *= effect.lateralSpeedMultiplier ?? 1;
    pierceTargets = effect.pierceTargets ?? pierceTargets;
    returnHitTargets = effect.returnHitTargets ?? returnHitTargets;
    goldMultiplierMilli = Number(BigInt(goldMultiplierMilli) * BigInt(effect.goldMultiplierMilli ?? 1000) / 1000n);
  }
  return Object.freeze({ rangeMultiplier, outboundSpeedMultiplier, returnSpeedMultiplier, cooldown, lateralSpeedMultiplier, pierceTargets, returnHitTargets, goldMultiplierMilli });
}
export const calculateEquipment = computeModifiers;

// Generated from backend content/equipment.json. The test parity gate rejects drift.
export const EQUIPMENT_CATALOG: EquipmentCatalog = freezeCatalog(validateCatalog({
  "version": "r34.1",
  "items": [
    {
      "id": "fast_reel",
      "name": "Быстрая катушка",
      "slot": "weapon",
      "hero": "pudge",
      "levels": [
        {
          "level": 1,
          "recipe": {
            "goldMilli": "100000",
            "components": {
              "steel": 2,
              "ember": 0,
              "core": 0
            }
          },
          "modifiers": {
            "returnSpeedMultiplier": 1.2,
            "cooldown": 1.8
          }
        },
        {
          "level": 2,
          "recipe": {
            "goldMilli": "200000",
            "components": {
              "steel": 4,
              "ember": 0,
              "core": 0
            }
          },
          "modifiers": {
            "returnSpeedMultiplier": 1.3,
            "cooldown": 1.7
          }
        },
        {
          "level": 3,
          "recipe": {
            "goldMilli": "400000",
            "components": {
              "steel": 8,
              "ember": 0,
              "core": 1
            }
          },
          "modifiers": {
            "returnSpeedMultiplier": 1.4,
            "cooldown": 1.6
          }
        }
      ]
    },
    {
      "id": "long_link",
      "name": "Длинное звено",
      "slot": "weapon",
      "hero": "pudge",
      "levels": [
        {
          "level": 1,
          "recipe": {
            "goldMilli": "140000",
            "components": {
              "steel": 3,
              "ember": 0,
              "core": 0
            }
          },
          "modifiers": {
            "rangeMultiplier": 1.2,
            "outboundSpeedMultiplier": 1.2
          }
        }
      ]
    },
    {
      "id": "piercing_tooth",
      "name": "Сквозной зуб",
      "slot": "weapon",
      "hero": "pudge",
      "levels": [
        {
          "level": 1,
          "recipe": {
            "goldMilli": "320000",
            "components": {
              "steel": 4,
              "ember": 0,
              "core": 1
            }
          },
          "modifiers": {
            "pierceTargets": 2
          }
        }
      ]
    },
    {
      "id": "return_sickle",
      "name": "Возвратный серп",
      "slot": "weapon",
      "hero": "pudge",
      "levels": [
        {
          "level": 1,
          "recipe": {
            "goldMilli": "400000",
            "components": {
              "steel": 3,
              "ember": 2,
              "core": 1
            }
          },
          "modifiers": {
            "returnHitTargets": 1
          }
        }
      ]
    },
    {
      "id": "conductor_cuffs",
      "name": "Манжеты проводника",
      "slot": "body",
      "hero": "all",
      "levels": [
        {
          "level": 1,
          "recipe": {
            "goldMilli": "120000",
            "components": {
              "steel": 0,
              "ember": 2,
              "core": 0
            }
          },
          "modifiers": {
            "outboundSpeedMultiplier": 1.15
          }
        },
        {
          "level": 2,
          "recipe": {
            "goldMilli": "240000",
            "components": {
              "steel": 0,
              "ember": 4,
              "core": 0
            }
          },
          "modifiers": {
            "outboundSpeedMultiplier": 1.22
          }
        },
        {
          "level": 3,
          "recipe": {
            "goldMilli": "480000",
            "components": {
              "steel": 0,
              "ember": 8,
              "core": 1
            }
          },
          "modifiers": {
            "outboundSpeedMultiplier": 1.3
          }
        }
      ]
    },
    {
      "id": "side_step_boots",
      "name": "Сапоги бокового шага",
      "slot": "legs",
      "hero": "all",
      "levels": [
        {
          "level": 1,
          "recipe": {
            "goldMilli": "90000",
            "components": {
              "steel": 2,
              "ember": 0,
              "core": 0
            }
          },
          "modifiers": {
            "lateralSpeedMultiplier": 1.15
          }
        },
        {
          "level": 2,
          "recipe": {
            "goldMilli": "180000",
            "components": {
              "steel": 4,
              "ember": 0,
              "core": 0
            }
          },
          "modifiers": {
            "lateralSpeedMultiplier": 1.22
          }
        },
        {
          "level": 3,
          "recipe": {
            "goldMilli": "360000",
            "components": {
              "steel": 8,
              "ember": 0,
              "core": 1
            }
          },
          "modifiers": {
            "lateralSpeedMultiplier": 1.3
          }
        }
      ]
    },
    {
      "id": "trophy_counter",
      "name": "Трофейный счётчик",
      "slot": "talisman",
      "hero": "all",
      "levels": [
        {
          "level": 1,
          "recipe": {
            "goldMilli": "180000",
            "components": {
              "steel": 0,
              "ember": 2,
              "core": 0
            }
          },
          "modifiers": {
            "goldMultiplierMilli": 1200
          }
        },
        {
          "level": 2,
          "recipe": {
            "goldMilli": "360000",
            "components": {
              "steel": 0,
              "ember": 4,
              "core": 0
            }
          },
          "modifiers": {
            "goldMultiplierMilli": 1300
          }
        },
        {
          "level": 3,
          "recipe": {
            "goldMilli": "720000",
            "components": {
              "steel": 0,
              "ember": 8,
              "core": 1
            }
          },
          "modifiers": {
            "goldMultiplierMilli": 1400
          }
        }
      ]
    },
    {
      "id": "debt_clock",
      "name": "Часы должника",
      "slot": "talisman",
      "hero": "all",
      "levels": [
        {
          "level": 1,
          "recipe": {
            "goldMilli": "450000",
            "components": {
              "steel": 0,
              "ember": 3,
              "core": 1
            }
          },
          "modifiers": {}
        }
      ]
    }
  ],
  "consumables": [
    {
      "id": "slow_dust",
      "name": "Пыль торможения",
      "recipe": {
        "goldMilli": "60000",
        "components": {
          "steel": 0,
          "ember": 1,
          "core": 0
        }
      },
      "effect": {
        "type": "slow",
        "durationSeconds": 3,
        "speedMultiplier": 0.65
      }
    },
    {
      "id": "collector_vial",
      "name": "Флакон сборщика",
      "recipe": {
        "goldMilli": "80000",
        "components": {
          "steel": 1,
          "ember": 0,
          "core": 0
        }
      },
      "effect": {
        "type": "collector",
        "kills": 10,
        "goldMultiplierMilli": 1500
      }
    }
  ]
}));
