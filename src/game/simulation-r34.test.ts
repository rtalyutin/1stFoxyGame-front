import { describe, expect, it } from 'vitest';
import { FIXED_STEP } from './config';
import { RunSimulation, SimulationRuleError, type EquipmentModifiers, type Command, type SimulationOptions, type Projectile } from './simulation';
const equipment = (change: Partial<EquipmentModifiers> = {}): EquipmentModifiers => ({ rangeMultiplier: 1, outboundSpeedMultiplier: 1, returnSpeedMultiplier: 1, cooldown: 2, lateralSpeedMultiplier: 1, pierceTargets: 1, returnHitTargets: 0, goldMultiplierMilli: 1000, ...change });
const isolated = (options: SimulationOptions = {}) => new RunSimulation('r34-test', 43, { ...options, config: { spawning: false, ...options.config } });
const cast = (x = 0, z = 30): Command => ({ type: 'cast', aim: { x, z } });
const ticks = (sim: RunSimulation, count: number, commands: Command[] = []) => { for (let n = 0; n < count; n++) sim.step(commands); };
const shop = (sim: RunSimulation, id = `${sim.state.runId}:shop:fixture`, x = sim.state.hero.x, z = sim.state.hero.z) => {
  sim.state.shopCandidates.push({ id, x, z, at: sim.state.time }); return id;
};
const bullet = (change: Partial<Projectile> = {}): Projectile => ({ id: 'bullet', sourceEnemyId: 'shooter', x: 0, z: 0.55, velocity: { x: 0, z: -8 }, radius: 0.12, lifetimeRemaining: 8, ...change });

describe('R3 shop timing and snapshot replay', () => {
  it('requires a live hero inside both axes and cannot reopen a visited shop', () => {
    const sim = isolated(); const id = shop(sim, 'shop-1', 4.5, 3);
    expect(sim.canEnterShop).toBe(false); expect(sim.enterShop(id)).toBe(false);
    sim.state.hero.x = 4.5; sim.state.hero.z = 1; sim.state.distance = 1;
    expect(sim.availableShop?.id).toBe(id); expect(sim.canEnterShop).toBe(true);
    expect(sim.enterShop(id)).toBe(true); expect(sim.state.usedShopIds).toEqual([id]);
    expect(sim.leaveShop()).toBe(true); expect(sim.state.phase).toBe('paused');
    const paused = sim.exportSnapshot(); sim.step([cast()]); expect(sim.exportSnapshot()).toEqual(paused);
    sim.resume(); expect(sim.enterShop(id)).toBe(false);
  });
  it('keeps a skipped store harmless and eventually removes its entry candidate', () => {
    const sim = isolated(); shop(sim, 'skipped', 4.5, 0);
    ticks(sim, 120); expect(sim.state.phase).toBe('running'); expect(sim.state.shopCandidates).toEqual([]);
  });
  it('freezes at 2ms before an 8ms projectile collision and resumes that future collision', () => {
    const sim = isolated({ initialProjectiles: [bullet()] }); const id = shop(sim);
    sim.step([{ type: 'enterShop', shopId: id, offset: 0.002 }]);
    expect(sim.state.phase).toBe('shop'); expect(sim.state.time).toBeCloseTo(0.002, 12);
    expect(sim.state.projectiles[0]!.z).toBeCloseTo(0.534, 12);
    sim.leaveShop(); sim.resume(); sim.step();
    expect(sim.state.phase).toBe('gameOver'); expect(sim.state.deathReason).toBe('projectile');
    expect(sim.state.time).toBeCloseTo(0.008, 12);
  });
  it.each([0.008, 0.012])('does not undo death when store entry at %s is equal or later', offset => {
    const sim = isolated({ initialProjectiles: [bullet()] }); const id = shop(sim);
    sim.step([{ type: 'enterShop', shopId: id, offset }]);
    expect(sim.state.phase).toBe('gameOver'); expect(sim.state.usedShopIds).toEqual([]);
    expect(sim.state.time).toBeCloseTo(0.008, 12);
  });
  it('rejects direct entry on an already lethal contact without advancing time/tick', () => {
    const sim = isolated({ initialEnemies: [{ x: 0, z: 0.79 }] }); const id = shop(sim);
    expect(sim.enterShop(id)).toBe(false); expect(sim.state.phase).toBe('gameOver');
    expect(sim.state.time).toBe(0); expect(sim.state.tick).toBe(0);
  });
  it('freezes all gameplay timers, effects, route RNG, pending warnings and flight state', () => {
    const sim = isolated({ initialEnemies: [{ id: 'warning', kind: 'strong', x: 4, z: 25, shooting: { phase: 'telegraph', remaining: 0.8, directions: [{ x: 0, z: -1 }] } }], initialProjectiles: [bullet({ x: 4, z: 20 })] });
    sim.applyConsumable('slow_dust'); sim.applyConsumable('collector_vial'); sim.step([cast()]);
    expect(sim.enterShop(shop(sim))).toBe(true);
    const before = sim.exportSnapshot(); ticks(sim, 500, [cast(), { type: 'move', axis: 1 }]);
    expect(sim.exportSnapshot()).toEqual(before);
    const restored = RunSimulation.restore(JSON.parse(JSON.stringify(before)));
    expect(restored.exportSnapshot()).toEqual(before);
    sim.leaveShop(); restored.leaveShop(); sim.resume(); restored.resume();
    for (let n = 0; n < 120; n++) { sim.step(); restored.step(); expect(restored.exportSnapshot()).toEqual(sim.exportSnapshot()); }
  });
  it('continues identical route and enemy identities after serialization with private RNG/counters', () => {
    const original = new RunSimulation('seeded-stream', 712, { config: { heroSpeed: 0, enemySpeed: 0, bossEnemySpeed: 0, maxEnemies: 30, maxShooters: 0, bossFirstSeconds: 600 } });
    ticks(original, 350); const restored = RunSimulation.restore(JSON.parse(JSON.stringify(original.exportSnapshot())));
    for (let n = 0; n < 600; n++) { original.step(); restored.step(); expect(restored.exportSnapshot()).toEqual(original.exportSnapshot()); }
    expect(original.state.enemies.length).toBeGreaterThan(3);
  });
  it('rejects unknown version, nonfinite/range-invalid state and duplicate or incompatible references', () => {
    const sim = isolated(); sim.step([cast()]); const valid = sim.exportSnapshot();
    const invalid = [
      { ...valid, version: 'r2.1' },
      { ...valid, randomState: -1 },
      { ...valid, state: { ...valid.state, hero: { x: Infinity, z: 0 } } },
      { ...valid, state: { ...valid.state, effects: { ...valid.state.effects, collectorKillsRemaining: 11 } } },
      { ...valid, state: { ...valid.state, usedShopIds: ['x', 'x'] } },
      { ...valid, state: { ...valid.state, hook: { ...valid.state.hook!, config: { ...valid.state.hook!.config, pierceTargets: 2, returnHitTargets: 1 } } } },
    ];
    for (const snapshot of invalid) expect(() => RunSimulation.restore(snapshot)).toThrow(SimulationRuleError);
    expect(sim.exportSnapshot()).toEqual(valid);
  });
  it('invalid entry offsets cannot advance a tick or consume an otherwise valid cast', () => {
    const sim = isolated(); const before = sim.exportSnapshot();
    for (const offset of [-0.1, FIXED_STEP + 0.001, NaN, Infinity]) {
      expect(() => sim.step([cast(), { type: 'enterShop', shopId: 'id', offset }])).toThrow('invalid_shop_command');
      expect(sim.exportSnapshot()).toEqual(before);
    }
  });
});

describe('R4 cast parameters and target modifiers', () => {
  it('applies shop replacement only to future casts, retaining current range/speed/cooldown/gold/mechanics', () => {
    const sim = isolated({ config: { heroSpeed: 0, enemySpeed: 0, hookCooldown: 0.01, hookRange: 6 }, initialEnemies: [{ id: 'next', x: 0, z: 12 }] });
    sim.step([cast()]); const old = sim.state.hook!.config; sim.enterShop(shop(sim));
    sim.setEquipment(equipment({ rangeMultiplier: 2, outboundSpeedMultiplier: 1.2, returnSpeedMultiplier: 1.4, cooldown: 1.6, pierceTargets: 2, goldMultiplierMilli: 1400 }));
    expect(sim.state.hook!.config).toBe(old); expect(old.range).toBe(6); expect(old.goldMultiplierMilli).toBe(1000);
    const restored = RunSimulation.restore(sim.exportSnapshot());
    sim.leaveShop(); restored.leaveShop(); sim.resume(); restored.resume();
    for (let n = 0; n < 100; n++) { sim.step(); restored.step(); }
    expect(sim.state.kills.normal).toBe(0); expect(restored.exportSnapshot()).toEqual(sim.exportSnapshot());
    sim.step([cast()]); expect(sim.state.hook!.config.range).toBe(12); expect(sim.state.hook!.config.pierceTargets).toBe(2); expect(sim.state.hook!.config.cooldown).toBe(1.6);
    ticks(sim, 25); expect(sim.state.kills.normal).toBe(1);
  });
  it('pierces two distinct targets on the outbound path, safely carries both, and removes both on return', () => {
    const sim = isolated({ config: { heroSpeed: 0, enemySpeed: 0, hookOutboundSpeed: 600 }, initialEnemies: [{ id: 'a', x: 0, z: 3 }, { id: 'b', x: 0, z: 6 }, { id: 'c', x: 0, z: 9 }] });
    sim.setEquipment(equipment({ pierceTargets: 2 })); sim.step([cast()]);
    expect(sim.state.kills.normal).toBe(2); expect(sim.state.hook!.capturedEnemyIds).toEqual(['a', 'b']);
    expect(sim.state.hook!.hitEnemyIds).toEqual(['a', 'b']); expect(sim.state.hook!.phase).toBe('returning');
    expect(sim.state.enemies.filter(e => e.status === 'captured')).toHaveLength(2);
    ticks(sim, 30); expect(sim.state.enemies.map(e => e.id)).toEqual(['c']); expect(sim.state.phase).toBe('running');
  });
  it('continues after first boss contact, hits the next target, and never gives that boss a second mark per cast', () => {
    const sim = isolated({ config: { heroSpeed: 0, enemySpeed: 0, bossEnemySpeed: 0, hookCooldown: 0.01 }, initialEnemies: [{ id: 'boss', kind: 'boss', x: 0, z: 5, shooting: null }, { id: 'other', x: 0, z: 10 }] });
    sim.setEquipment(equipment({ pierceTargets: 2 }));
    for (let n = 0; n < 3; n++) {
      sim.step([cast()]); const events = [...sim.state.events];
      for (let t = 0; t < 130; t++) { sim.step(); events.push(...sim.state.events); }
      expect(events.filter(e => e.type === 'hit' && e.enemyId === 'boss')).toHaveLength(1);
      expect(sim.state.kills.boss).toBe(n === 2 ? 1 : 0);
      if (n < 2) expect(sim.state.enemies.find(e => e.id === 'boss')!.hitsRemaining).toBe(2 - n);
    }
    expect(sim.state.kills.normal).toBe(1);
  });
  it('return weapon hits one previously untouched target on the moving-hero return route', () => {
    const sim = isolated({ config: { heroSpeed: 0, enemySpeed: 0, hookRange: 10 }, initialEnemies: [{ id: 'out', x: 0, z: 9 }, { id: 'back', x: 1.5, z: 5 }, { id: 'extra', x: 2, z: 4 }] });
    sim.setEquipment(equipment({ returnHitTargets: 1 })); sim.step([cast(), { type: 'move', axis: 1 }]);
    const events = [...sim.state.events]; for (let n = 0; n < 50; n++) { sim.step([{ type: 'move', axis: 1 }]); events.push(...sim.state.events); }
    expect(events.filter(e => e.type === 'hit').map(e => e.enemyId)).toEqual(['out', 'back']);
    expect(sim.state.kills.normal).toBe(2); expect(sim.state.enemies.map(e => e.id)).toEqual(['extra']);
  });
  it('rejects stacking incompatible weapon mechanics, unknown values, and running loadout changes atomically', () => {
    const sim = isolated(); const before = sim.exportSnapshot();
    for (const patch of [{ pierceTargets: 2, returnHitTargets: 1 }, { rangeMultiplier: NaN }, { pierceTargets: 3 }, { goldMultiplierMilli: 1100.3 }]) expect(() => sim.setEquipment(equipment(patch))).toThrow();
    expect(sim.exportSnapshot()).toEqual(before); sim.step();
    expect(() => sim.setEquipment(equipment({ rangeMultiplier: 2 }))).toThrow('equipment_unavailable');
  });
});

describe('R4 consumable effects and per-kill reward facts', () => {
  it('slows only existing enemies/projectiles by 35%, preserves hero speed, refreshes instead of stacking', () => {
    const sim = isolated({ initialEnemies: [{ id: 'current', x: 4, z: 25 }], initialProjectiles: [bullet({ x: 4, z: 25 })] });
    sim.applyConsumable('slow_dust'); ticks(sim, 60);
    expect(sim.state.hero.z).toBeCloseTo(2, 10); expect(sim.state.enemies[0]!.z).toBeCloseTo(24.35, 10); expect(sim.state.projectiles[0]!.z).toBeCloseTo(19.8, 10);
    sim.applyConsumable('slow_dust'); expect(sim.state.effects.slowRemaining).toBe(3); ticks(sim, 60);
    expect(sim.state.enemies[0]!.z).toBeCloseTo(23.7, 10); expect(sim.state.projectiles[0]!.z).toBeCloseTo(14.6, 10);
    ticks(sim, 120); expect(sim.state.effects.slowRemaining).toBeCloseTo(0, 10);
    const prior = sim.state.enemies[0]!.z; ticks(sim, 60); expect(sim.state.enemies[0]!.z - prior).toBeCloseTo(-1, 10);
  });
  it('leaves newly generated enemies and projectiles at their normal speed until refreshed', () => {
    const sim = isolated(); sim.applyConsumable('slow_dust');
    const fresh = isolated({ initialEnemies: [{ id: 'fresh', x: 4, z: 20 }] }).state.enemies[0]!;
    sim.state.enemies.push(fresh); sim.state.projectiles.push(bullet({ x: 4, z: 20 })); ticks(sim, 60);
    expect(fresh.z).toBeCloseTo(19, 10); expect(sim.state.projectiles[0]!.z).toBeCloseTo(12, 10);
  });
  it('captures collector multiplier before decrement on exactly ten lethal kills, with no component effect', () => {
    const sim = isolated({ config: { heroSpeed: 0, enemySpeed: 0, hookRange: 6, hookCooldown: 0.01, maxEnemies: 20 } });
    sim.setEquipment(equipment({ goldMultiplierMilli: 1200, cooldown: 0.01 })); sim.applyConsumable('collector_vial');
    for (let n = 0; n < 11; n++) {
      sim.state.enemies.push(isolated({ initialEnemies: [{ id: `kill-${n}`, x: 0, z: 3 }] }).state.enemies[0]!);
      sim.step([cast()]); const events = [...sim.state.events];
      for (let t = 0; t < 30; t++) { sim.step(); events.push(...sim.state.events); }
      expect(events.find(e => e.type === 'hit' && e.lethal)!.goldMultiplierMilli).toBe(n < 10 ? 1800 : 1200);
      expect(sim.state.effects.collectorKillsRemaining).toBe(Math.max(0, 9 - n));
    }
  });
  it('rejected activations do not mutate snapshot; used effects end on death or abandonment', () => {
    const sim = isolated(); sim.applyConsumable('collector_vial'); const before = sim.exportSnapshot();
    expect(() => sim.applyConsumable('collector_vial')).toThrow('effect_active'); expect(sim.exportSnapshot()).toEqual(before);
    expect(() => sim.applyConsumable('unknown')).toThrow('invalid_consumable'); expect(sim.exportSnapshot()).toEqual(before);
    sim.pause(); const paused = sim.exportSnapshot(); expect(() => sim.applyConsumable('slow_dust')).toThrow('consumable_unavailable'); expect(sim.exportSnapshot()).toEqual(paused);
    sim.resume(); sim.applyConsumable('slow_dust'); sim.abandon(); expect(sim.state.effects).toEqual({ slowRemaining: 0, slowedEnemyIds: [], slowedProjectileIds: [], collectorKillsRemaining: 0 });
    const dead = RunSimulation.restore(sim.exportSnapshot()); dead.resume(); dead.step([cast()]); expect(dead.exportSnapshot()).toEqual(sim.exportSnapshot());
  });
});
