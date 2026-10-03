import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, FIXED_STEP } from './config';
import { RunSimulation, resolveHeroProjectileHit, type Command, type Enemy, type GameEvent, type Projectile, type SimulationOptions } from './simulation';

const isolated = (options: SimulationOptions = {}) => new RunSimulation('r2-test', 42, {
  ...options, config: { spawning: false, ...options.config },
});
function advance(simulation: RunSimulation, ticks: number, commands: Command[] = []): GameEvent[] {
  const events: GameEvent[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    simulation.step(commands);
    events.push(...simulation.state.events);
  }
  return events;
}
const projectile = (patch: Partial<Projectile> = {}): Projectile => ({
  id: 'bullet', sourceEnemyId: 'source', x: 0, z: 5,
  velocity: { x: 0, z: -8 }, radius: 0.12, lifetimeRemaining: 8, ...patch,
});
const candidate = (x = 0, z = 36, kind: Enemy['kind'] = 'normal'): Enemy => isolated({
  initialEnemies: [{ id: 'candidate', x, z, kind, shooting: null }],
}).state.enemies[0]!;
const aim = (simulation: RunSimulation, id: string): Command => ({
  type: 'cast', aim: { ...simulation.state.enemies.find((enemy) => enemy.id === id)! },
});

describe('R2 enemy and projectile rules', () => {
  it('requires three separate boss casts; returning hooks never count again', () => {
    const simulation = isolated({ initialEnemies: [{ id: 'boss', kind: 'boss', x: 0, z: 25, shooting: null }] });
    const hitIds: string[] = [];
    for (let attack = 0; attack < 3; attack++) {
      for (let tick = 0; !simulation.canCast && tick < 240; tick++) simulation.step();
      simulation.step([aim(simulation, 'boss')]);
      const events = [...simulation.state.events, ...advance(simulation, 60)];
      const hits = events.filter((event) => event.type === 'hit');
      expect(hits).toHaveLength(1);
      expect(hits[0]!.lethal).toBe(attack === 2);
      hitIds.push(hits[0]!.castId!);
      expect(simulation.state.kills.boss).toBe(attack === 2 ? 1 : 0);
      if (attack < 2) {
        const boss = simulation.state.enemies.find((enemy) => enemy.id === 'boss')!;
        expect(boss.hitsRemaining).toBe(2 - attack);
        expect(boss.status).toBe('alive');
        expect(simulation.state.hook?.capturedEnemyId ?? null).toBeNull();
      }
    }
    expect(new Set(hitIds).size).toBe(3);
    expect(simulation.state.phase).toBe('running');
    expect(simulation.state.enemies).toHaveLength(0);
  });

  it('rejects a boss threshold below three, invalid bullet capacity and hidden normal armor', () => {
    expect(() => isolated({ config: { bossRequiredHits: 2 } })).toThrow();
    expect(() => isolated({ initialEnemies: [{ x: 0, z: 20, kind: 'boss', requiredHits: 2 }] })).toThrow();
    expect(() => isolated({ initialEnemies: [{ x: 0, z: 20, kind: 'strong', requiredHits: 3 }] })).toThrow();
    expect(() => isolated({ config: { maxProjectiles: 2 } })).toThrow();
    expect(() => isolated({ config: { maxBosses: 2 } })).toThrow();
  });

  it('keeps contact lethal after a simultaneous nonlethal boss hit, but a final hit saves the hero', () => {
    const nonlethal = isolated({ initialEnemies: [{ id: 'boss', x: 0, z: 1.35, kind: 'boss', shooting: null }] });
    nonlethal.step([aim(nonlethal, 'boss')]);
    expect(nonlethal.state.events.map((event) => event.type)).toEqual(['cast', 'hit', 'gameOver']);
    expect(nonlethal.state.events[1]!.lethal).toBe(false);
    expect(nonlethal.state.deathReason).toBe('contact');
    const lethal = isolated({ initialEnemies: [{ id: 'boss', x: 0, z: 1.35, kind: 'boss', hitsRemaining: 1, shooting: null }] });
    lethal.step([aim(lethal, 'boss')]);
    expect(lethal.state.kills.boss).toBe(1);
    expect(lethal.state.phase).toBe('running');
  });

  it('telegraphs a strong creep for .8 seconds, locks aim at release and flies without homing', () => {
    const simulation = isolated({ initialEnemies: [{ id: 'strong', kind: 'strong', x: 0, z: 20,
      shooting: { phase: 'cooldown', remaining: 0, directions: [] } }] });
    simulation.step();
    expect(simulation.state.enemies[0]!.shooting?.phase).toBe('telegraph');
    expect(simulation.state.projectiles).toHaveLength(0);
    const telegraphAt = simulation.state.events.find((event) => event.type === 'telegraph')!.at;
    const events = advance(simulation, 47, [{ type: 'move', axis: 1 }]);
    expect(events.find((event) => event.type === 'shoot')!.at - telegraphAt).toBeCloseTo(0.8, 10);
    const velocity = { ...simulation.state.projectiles[0]!.velocity };
    expect(velocity.x).toBeGreaterThan(1);
    expect(Math.hypot(velocity.x, velocity.z)).toBeCloseTo(8, 10);
    advance(simulation, 15, [{ type: 'move', axis: -1 }]);
    expect(simulation.state.projectiles[0]!.velocity).toEqual(velocity);
  });

  it('releases boss directions exactly as warned, with three shots 15 degrees apart', () => {
    const simulation = isolated({ initialEnemies: [{ id: 'boss', kind: 'boss', x: 1, z: 25,
      shooting: { phase: 'cooldown', remaining: 0, directions: [] } }] });
    simulation.step();
    const directions = structuredClone(simulation.state.enemies[0]!.shooting!.directions);
    advance(simulation, 59, [{ type: 'move', axis: 1 }]);
    expect(simulation.state.projectiles).toHaveLength(3);
    simulation.state.projectiles.forEach((bullet, index) => {
      expect(bullet.velocity.x).toBeCloseTo(directions[index]!.x * 8, 10);
      expect(bullet.velocity.z).toBeCloseTo(directions[index]!.z * 8, 10);
    });
    const dot = directions[0]!.x * directions[1]!.x + directions[0]!.z * directions[1]!.z;
    expect(Math.acos(dot) * 180 / Math.PI).toBeCloseTo(15, 8);
  });

  it('does not remove released bullets when the one-hit shooter is killed', () => {
    const simulation = isolated({ initialEnemies: [{ id: 'strong', kind: 'strong', x: 0, z: 20,
      shooting: { phase: 'cooldown', remaining: 0, directions: [] } }] });
    advance(simulation, 49);
    expect(simulation.state.projectiles).toHaveLength(1);
    simulation.step([aim(simulation, 'strong')]);
    advance(simulation, 30);
    expect(simulation.state.kills.strong).toBe(1);
    expect(simulation.state.projectiles).toHaveLength(1);
    expect(simulation.state.phase).toBe('running');
    advance(simulation, 120);
    expect(simulation.state.deathReason).toBe('projectile');
  });

  it('uses swept relative collision for a bullet crossing the hero within one tick', () => {
    const simulation = isolated({ initialProjectiles: [projectile({ velocity: { x: 0, z: -600 } })] });
    simulation.step();
    expect(simulation.state.deathReason).toBe('projectile');
    expect(simulation.state.time).toBeCloseTo((5 - 0.47) / 602, 10);
    const final = structuredClone(simulation.state);
    simulation.resume();
    advance(simulation, 60);
    expect(simulation.state).toEqual(final);
  });

  it('keeps a missed bullet harmless when it passes the hero or expires', () => {
    const simulation = isolated({ initialProjectiles: [projectile({ x: 4, z: 1 })] });
    advance(simulation, 90);
    expect(simulation.state.projectiles).toHaveLength(0);
    expect(simulation.state.phase).toBe('running');
    expect(resolveHeroProjectileHit(simulation.state, 'bullet')).toBe(false);
    expect(simulation.state.deathReason).toBeNull();
  });

  it('never lets the hook intercept a bullet; an equal-time enemy kill retains projectile death', () => {
    const simulation = isolated({ initialEnemies: [{ id: 'enemy', x: 0, z: 0.8 }],
      initialProjectiles: [projectile({ z: 0.47 })] });
    simulation.step([aim(simulation, 'enemy')]);
    expect(simulation.state.kills.normal).toBe(1);
    expect(simulation.state.deathReason).toBe('projectile');
    expect(simulation.state.events.map((event) => event.type)).toEqual(['cast', 'hit', 'gameOver']);
  });

  it('reserves bullet slots before the telegraph and delays further warnings until capacity is free', () => {
    const simulation = isolated({ config: { maxProjectiles: 3 }, initialEnemies: [
      { id: 'a-boss', kind: 'boss', x: 0, z: 25, shooting: { phase: 'cooldown', remaining: 0, directions: [] } },
      { id: 'b-strong', kind: 'strong', x: 3, z: 24, shooting: { phase: 'cooldown', remaining: 0, directions: [] } },
    ] });
    simulation.step();
    expect(simulation.state.enemies[0]!.shooting?.phase).toBe('telegraph');
    expect(simulation.state.enemies[1]!.shooting?.phase).toBe('cooldown');
    const events = advance(simulation, 59);
    expect(events.filter((event) => event.type === 'shoot')).toHaveLength(3);
    expect(simulation.state.projectiles).toHaveLength(3);
    expect(simulation.state.enemies[1]!.shooting?.phase).toBe('cooldown');
  });

  it('does not announce an unavoidable shot when the hero has no reachable lateral escape', () => {
    const simulation = isolated({ config: { lateralSpeed: 0 }, initialEnemies: [{ id: 'strong', kind: 'strong', x: 0, z: 20,
      shooting: { phase: 'cooldown', remaining: 0, directions: [] } }] });
    const events = advance(simulation, 90);
    expect(events.some((event) => event.type === 'telegraph')).toBe(false);
    expect(simulation.state.projectiles).toHaveLength(0);
  });

  it('freezes bullets, warnings, cooldowns and stream under pause; resume does not replay a shot', () => {
    const simulation = isolated({ initialEnemies: [{ id: 'strong', kind: 'strong', x: 2, z: 20,
      shooting: { phase: 'cooldown', remaining: 0, directions: [] } }], initialProjectiles: [projectile({ x: -4 })] });
    simulation.step();
    simulation.pause();
    const before = structuredClone(simulation.state);
    advance(simulation, 600, [{ type: 'cast', aim: { x: 2, z: 20 } }]);
    expect(simulation.state).toEqual(before);
    simulation.resume();
    simulation.step();
    expect(simulation.state.time - before.time).toBeCloseTo(FIXED_STEP, 10);
    expect(simulation.state.enemies[0]!.shooting!.remaining).toBeCloseTo(before.enemies[0]!.shooting!.remaining - FIXED_STEP, 10);
    expect(simulation.state.events.some((event) => event.type === 'cast')).toBe(false);
  });
});

describe('R2 continuous threat scheduler', () => {
  it('rejects individually plausible simultaneous deadlines when the hook can only kill one', () => {
    const simulation = isolated({ initialEnemies: [{ id: 'existing', x: 0, z: 8, shooting: null }] });
    expect(simulation.assessSpawn(candidate(0, 8))).toEqual({ accepted: false, reason: 'deadline' });
    expect(simulation.assessSpawn(candidate(0, 36))).toEqual({ accepted: true, reason: 'ok' });
  });

  it('accounts for three boss casts, return/cooldown and safety, and all existing targets', () => {
    const simulation = isolated();
    expect(simulation.assessSpawn(candidate(0, 12, 'boss')).reason).toBe('deadline');
    expect(simulation.assessSpawn(candidate(0, 36, 'boss')).accepted).toBe(true);
    const busy = isolated({ config: { hookCooldown: 5 }, initialEnemies: [{ id: 'existing', x: 0, z: 12 }] });
    expect(busy.assessSpawn(candidate(0, 36, 'boss')).reason).toBe('deadline');
    const returning = isolated({ config: { hookReturnSpeed: 3 } });
    returning.step([{ type: 'cast', aim: { x: 0, z: 30 } }]);
    expect(returning.assessSpawn(candidate(0, 36, 'boss')).reason).toBe('deadline');
  });

  it('keeps the first 30 active seconds ordinary, and gates the first boss by both time and kills', () => {
    const simulation = new RunSimulation('stream', 7);
    const spawns: Array<{ at: number; kind: string }> = [];
    // This fixture clears threats after observing a spawn to isolate generator
    // pacing; boss/attack interaction is verified separately above.
    for (let tick = 0; tick < 91 * 60; tick++) {
      simulation.step();
      for (const event of simulation.state.events) if (event.type === 'spawn') spawns.push({ at: event.at, kind: event.kind! });
      simulation.state.enemies = [];
    }
    expect(spawns.filter((spawn) => spawn.at < 30).every((spawn) => spawn.kind === 'normal')).toBe(true);
    expect(spawns.some((spawn) => spawn.kind === 'strong')).toBe(true);
    expect(spawns.some((spawn) => spawn.kind === 'boss')).toBe(false);
    simulation.state.kills.normal = 25;
    const after = advance(simulation, 240);
    expect(after.find((event) => event.type === 'spawn' && event.kind === 'boss')!.at).toBeGreaterThanOrEqual(90);
    expect(simulation.state.enemies.filter((enemy) => enemy.kind === 'boss')).toHaveLength(1);
  });

  it('produces path shop data without a wave, pause or automatic game-over cancellation', () => {
    const simulation = new RunSimulation('shops', 8);
    const shops: number[] = [];
    for (let tick = 0; tick < 160 * 60; tick++) {
      simulation.step();
      if (simulation.state.events.some((event) => event.type === 'shopCandidate')) {
        const shop = simulation.state.shopCandidates.at(-1)!;
        shops.push(shop.at);
        expect(shop.z - simulation.state.hero.z).toBeCloseTo(DEFAULT_CONFIG.spawnDistance, 1);
        expect(Math.abs(shop.x)).toBe(DEFAULT_CONFIG.lateralLimit);
      }
      simulation.state.enemies = [];
      simulation.state.projectiles = [];
    }
    expect(shops.length).toBeGreaterThanOrEqual(2);
    for (let index = 0; index < shops.length; index++) {
      const gap = shops[index]! - (shops[index - 1] ?? 0);
      expect(gap).toBeGreaterThanOrEqual(55);
      expect(gap).toBeLessThanOrEqual(75);
    }
    expect(simulation.state.phase).toBe('running');
    expect('waveNumber' in simulation.state).toBe(false);
  });

  it('keeps later bosses rare and never accepts a second simultaneously active boss', () => {
    const simulation = new RunSimulation('rare', 13);
    simulation.state.kills.normal = 25;
    const bosses: number[] = [];
    for (let tick = 0; tick < 400 * 60; tick++) {
      simulation.step();
      for (const event of simulation.state.events) if (event.type === 'spawn' && event.kind === 'boss') bosses.push(event.at);
      simulation.state.enemies = [];
    }
    expect(bosses.length).toBeGreaterThanOrEqual(3);
    expect(bosses[0]).toBeGreaterThanOrEqual(90);
    for (let index = 1; index < bosses.length; index++) {
      expect(bosses[index]! - bosses[index - 1]!).toBeGreaterThanOrEqual(90);
      // The random distance candidate is checked on the next ordinary stream
      // opportunity; it can add one 3.4-second interval to the chosen milestone.
      expect(bosses[index]! - bosses[index - 1]!).toBeLessThanOrEqual(153.4);
    }
    const active = isolated({ initialEnemies: [{ id: 'active', kind: 'boss', x: 0, z: 30, shooting: null }] });
    expect(active.assessSpawn(candidate(0, 36, 'boss'))).toEqual({ accepted: false, reason: 'capacity' });
  });

  it('is deterministic with simultaneous boss volleys, shooter attacks and batched rendering', () => {
    function run(batch: number) {
      const simulation = isolated({ initialEnemies: [
        { id: 'boss', kind: 'boss', x: 0, z: 30 }, { id: 'strong', kind: 'strong', x: 3, z: 28 },
      ] });
      const log: GameEvent[] = [];
      for (let tick = 0; tick < 420;) for (let frame = 0; frame < batch && tick < 420; frame++, tick++) {
        const commands: Command[] = [{ type: 'move', axis: tick % 180 < 90 ? 0.5 : -0.5 }];
        if (tick % 130 === 0) commands.push({ type: 'cast', aim: { x: 0, z: simulation.state.hero.z + 30 } });
        simulation.step(commands);
        if (simulation.state.phase === 'running') log.push(...simulation.state.events);
      }
      return { state: simulation.state, log };
    }
    expect(run(1)).toEqual(run(3));
  });
});
