import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BASE_MODIFIERS, COMPONENT_MAX, EQUIPMENT_CATALOG, GOLD_MAX_MILLI,
  addGoldMilli, canCraft, computeModifiers, createEmptyProfile, parseGoldMilli,
  recipeCost, validateCatalog, validateProfile, validateRecipe,
  type ItemDefinitionId, type Profile, type Slot,
} from './equipment';

const accountId = '8ad384a3-2f4e-4ea5-ae7a-1bed94cbf887';
const instanceId = (n: number) => `85a3415a-301b-4cba-aa86-${n.toString().padStart(12, '0')}`;
const equip = (profile: Profile, definitionId: ItemDefinitionId, level: number, slot: Slot, n = 1) => {
  const id = instanceId(n);
  profile.items.push({ id, definitionId, level });
  profile.loadouts.pudge[slot] = id;
};

describe('R3/R4/R5 equipment domain', () => {
  it('ships the paired source catalog with the R5 debt clock', () => {
    expect(createHash('sha256').update(JSON.stringify(EQUIPMENT_CATALOG)).digest('hex'))
      .toBe('3fe4c539150ab93104033fbf34994b424e0c44d2b490234b8e1e6e532b5eb8ba');
    expect(EQUIPMENT_CATALOG.items.map((item) => item.id)).toEqual([
      'fast_reel', 'long_link', 'piercing_tooth', 'return_sickle',
      'conductor_cuffs', 'side_step_boots', 'trophy_counter', 'debt_clock',
    ]);
    expect(EQUIPMENT_CATALOG.consumables.map((item) => item.id)).toEqual(['slow_dust', 'collector_vial']);
  });
  it('keeps old saved catalogs valid when a profile owns the new clock', () => {
    const old = structuredClone(EQUIPMENT_CATALOG); old.items = old.items.filter(item => item.id !== 'debt_clock');
    const profile = createEmptyProfile(accountId); equip(profile,'debt_clock',1,'talisman');
    expect(validateCatalog(old).items).toHaveLength(7); expect(validateProfile(profile,old)).toEqual(profile);
    expect(computeModifiers(profile,old)).toEqual(BASE_MODIFIERS);
    expect(recipeCost('debt_clock')).toEqual({goldMilli:'450000',components:{steel:0,ember:3,core:1}});
    expect(() => recipeCost('debt_clock',1)).toThrow('no further level');
    const missing = structuredClone(EQUIPMENT_CATALOG); missing.items = missing.items.filter(item => item.id !== 'fast_reel');
    expect(() => validateCatalog(missing)).toThrow('Missing base equipment');
  });

  it('creates a completely empty permanent profile', () => {
    const profile = createEmptyProfile(accountId);
    expect(profile.goldMilli).toBe('0');
    expect(profile.items).toEqual([]);
    expect(profile.components).toEqual({ steel: 0, ember: 0, core: 0 });
    expect(profile.consumables).toEqual({ slow_dust: 0, collector_vial: 0 });
    expect(profile.loadouts.pudge.quick).toEqual([null, null]);
    expect(computeModifiers(profile)).toEqual(BASE_MODIFIERS);
  });

  it('keeps recipes exact and charges the transition rather than total sunk cost', () => {
    expect(recipeCost('fast_reel', 0)).toEqual({ goldMilli: '100000', components: { steel: 2, ember: 0, core: 0 } });
    expect(recipeCost('fast_reel', 1)).toEqual({ goldMilli: '200000', components: { steel: 4, ember: 0, core: 0 } });
    expect(recipeCost('fast_reel', 2)).toEqual({ goldMilli: '400000', components: { steel: 8, ember: 0, core: 1 } });
    expect(recipeCost('conductor_cuffs', 2)).toEqual({ goldMilli: '480000', components: { steel: 0, ember: 8, core: 1 } });
    expect(recipeCost('side_step_boots', 2).goldMilli).toBe('360000');
    expect(recipeCost('trophy_counter', 2).goldMilli).toBe('720000');
    expect(() => recipeCost('fast_reel', 3)).toThrow('no further level');
    expect(() => recipeCost('long_link', 1)).toThrow('no further level');
    expect(() => recipeCost('piercing_tooth', 1)).toThrow('no further level');
    expect(() => recipeCost('slow_dust', 1)).toThrow('cannot be upgraded');
  });

  it.each([
    [1, 1.2, 1.8, 1.15, 1.15, 1200],
    [2, 1.3, 1.7, 1.22, 1.22, 1300],
    [3, 1.4, 1.6, 1.3, 1.3, 1400],
  ])('applies level %s from equipped instances without stacking old levels', (level, returnSpeed, cooldown, outbound, lateral, gold) => {
    const profile = createEmptyProfile(accountId);
    equip(profile, 'fast_reel', level, 'weapon', 1);
    equip(profile, 'conductor_cuffs', level, 'body', 2);
    equip(profile, 'side_step_boots', level, 'legs', 3);
    equip(profile, 'trophy_counter', level, 'talisman', 4);
    profile.items.push({ id: instanceId(5), definitionId: 'fast_reel', level: 1 });
    expect(computeModifiers(profile)).toEqual({
      ...BASE_MODIFIERS, returnSpeedMultiplier: returnSpeed, cooldown,
      outboundSpeedMultiplier: outbound, lateralSpeedMultiplier: lateral, goldMultiplierMilli: gold,
    });
  });

  it('starts from the base after a weapon switch and multiplies effects from different slots', () => {
    const profile = createEmptyProfile(accountId);
    equip(profile, 'fast_reel', 3, 'weapon', 1);
    const oldCastParameters = computeModifiers(profile);
    equip(profile, 'long_link', 1, 'weapon', 2);
    equip(profile, 'conductor_cuffs', 1, 'body', 3);
    const nextCastParameters = computeModifiers(profile);
    expect(nextCastParameters.outboundSpeedMultiplier).toBeCloseTo(1.38);
    expect(nextCastParameters.rangeMultiplier).toBe(1.2);
    expect(nextCastParameters.returnSpeedMultiplier).toBe(1);
    expect(nextCastParameters.cooldown).toBe(2);
    expect(oldCastParameters.returnSpeedMultiplier).toBe(1.4);
    expect(Object.isFrozen(oldCastParameters)).toBe(true);
    expect(() => Reflect.set(oldCastParameters, 'cooldown', 0)).not.toThrow();
    expect(oldCastParameters.cooldown).toBe(1.6);
  });

  it('requires every cost without mutating inventory or wallet', () => {
    const profile = createEmptyProfile(accountId);
    profile.goldMilli = '400000';
    profile.components = { steel: 3, ember: 2, core: 0 };
    const before = structuredClone(profile);
    expect(canCraft(profile, recipeCost('return_sickle'))).toBe(false);
    expect(profile).toEqual(before);
    profile.components.core = 1;
    expect(canCraft(profile, recipeCost('return_sickle'))).toBe(true);
    profile.goldMilli = '399999';
    expect(canCraft(profile, recipeCost('return_sickle'))).toBe(false);
  });

  it('rejects unknown and incompatible catalog fields and boss-rule bypasses', () => {
    for (const mutate of [
      (catalog: any) => { catalog.items[0].levels[0].modifiers.bossHits = 1; },
      (catalog: any) => { catalog.items[0].slot = 'hat'; },
      (catalog: any) => { catalog.items[0].hero = 'lina'; },
      (catalog: any) => { catalog.items[0].id = 'debt_clock'; },
      (catalog: any) => { catalog.items[2].levels[0].modifiers.pierceTargets = 3; },
      (catalog: any) => { catalog.items[3].levels[0].modifiers.returnHitTargets = 2; },
      (catalog: any) => { catalog.items[0].levels[0].modifiers.pierceTargets = 2; },
    ]) {
      const catalog = structuredClone(EQUIPMENT_CATALOG);
      mutate(catalog);
      expect(() => validateCatalog(catalog)).toThrow();
    }
  });

  it('rejects corrupt ownership and does not invent a replacement profile', () => {
    const profile = createEmptyProfile(accountId);
    profile.loadouts.pudge.weapon = instanceId(1);
    expect(() => validateProfile(profile)).toThrow('Unowned');
    equip(profile, 'side_step_boots', 1, 'weapon', 1);
    expect(() => validateProfile(profile)).toThrow('incompatible');
    const empty = createEmptyProfile(accountId);
    (empty.loadouts as unknown as Record<string, unknown>).lina = {};
    expect(() => validateProfile(empty)).toThrow('equipment field');
  });

  it('uses exact integer gold beyond the JS safe integer range and rejects overflow', () => {
    expect(addGoldMilli('9007199254740992', '1')).toBe('9007199254740993');
    expect(parseGoldMilli(GOLD_MAX_MILLI)).toBe(9223372036854775807n);
    expect(() => addGoldMilli(GOLD_MAX_MILLI, '1')).toThrow('overflow');
    for (const invalid of ['-1', '0.5', '01', '9223372036854775808', 1, Infinity]) {
      expect(() => parseGoldMilli(invalid)).toThrow();
    }
    expect(() => validateRecipe({ goldMilli: '9223372036854775808', components: { steel: 0, ember: 0, core: 0 } })).toThrow();
    expect(() => validateRecipe({ goldMilli: '0', components: { steel: COMPONENT_MAX + 1, ember: 0, core: 0 } })).toThrow();
  });
});
