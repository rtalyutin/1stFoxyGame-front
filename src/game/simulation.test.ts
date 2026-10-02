import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, FIXED_STEP } from './config';
import { RunSimulation, type Command, type SimulationOptions } from './simulation';

const cast = (x = 0, z = 30): Command => ({ type: 'cast', aim: { x, z } });
const move = (axis: number): Command => ({ type: 'move', axis });
const isolated = (options: SimulationOptions = {}) => new RunSimulation('test-run', 42, {
  ...options, config: { spawning: false, ...options.config },
});
const advance = (simulation: RunSimulation, ticks: number, commands: Command[] = []) => {
  for (let tick = 0; tick < ticks; tick++) simulation.step(commands);
};

describe('fixed-step R1 combat', () => {
  it('uses the accepted world speeds and clamps smooth lateral movement', () => {
    const simulation = isolated();
    advance(simulation, 60, [move(1)]);
    expect(simulation.state.hero.x).toBe(DEFAULT_CONFIG.lateralLimit);
    expect(simulation.state.distance).toBeCloseTo(2, 10);
    advance(simulation, 90, [move(-1)]);
    expect(simulation.state.hero.x).toBeCloseTo(-4.5, 10);
    simulation.step();
    expect(simulation.state.hero.x).toBeCloseTo(-4.5, 10);
  });

  it('casts only on an explicit command; holding/aim updates are not simulated attacks', () => {
    const simulation = isolated();
    advance(simulation, 180);
    expect(simulation.state.hook).toBeNull();
    simulation.step([cast()]);
    expect(simulation.state.hook?.castId).toBe('test-run:cast:1');
    advance(simulation, 180);
    expect(simulation.state.hook).toBeNull();
    expect(simulation.canCast).toBe(true);
    simulation.step([cast(0, 60)]);
    expect(simulation.state.hook?.castId).toBe('test-run:cast:2');
  });

  it('hits the first moving target once and immediately makes its body safe', () => {
    const simulation = isolated({ initialEnemies: [{ id: 'near', x: 0, z: 5 }, { id: 'far', x: 0, z: 8 }] });
    simulation.step([cast()]);
    advance(simulation, 10);
    expect(simulation.state.kills.normal).toBe(1);
    expect(simulation.state.enemies.find((enemy) => enemy.id === 'near')?.status).toBe('captured');
    expect(simulation.state.enemies.find((enemy) => enemy.id === 'far')?.status).toBe('alive');
    expect(simulation.state.hook?.phase).toBe('returning');
    advance(simulation, 30);
    expect(simulation.state.kills.normal).toBe(1);
    expect(simulation.state.enemies.map((enemy) => enemy.id)).toEqual(['far']);
    expect(simulation.state.phase).toBe('running');
  });

  it('does not redirect a launched hook when the hero moves or another cast is attempted', () => {
    const simulation = isolated();
    simulation.step([cast(0, 30)]);
    const snapshot = simulation.state.hook!.config;
    advance(simulation, 10, [move(1)]);
    simulation.step([cast(4, 15), move(1)]);
    expect(simulation.state.hook?.x).toBe(0);
    expect(simulation.state.hook?.direction).toEqual({ x: 0, z: 1 });
    expect(simulation.state.hook?.config).toBe(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(simulation.state.events.some((event) => event.type === 'castRejected')).toBe(true);
  });

  it('returns a miss to the current moving hero and waits for the launch cooldown', () => {
    const simulation = isolated();
    simulation.step([cast(), move(1)]);
    advance(simulation, 99, [move(1)]);
    expect(simulation.state.hook).toBeNull();
    expect(simulation.state.hero.x).toBe(4.5);
    expect(simulation.canCast).toBe(false);
    simulation.step([cast(4.5, 40)]);
    expect(simulation.state.hook).toBeNull();
    advance(simulation, 20);
    expect(simulation.canCast).toBe(true);
  });

  it('does not allow a new hook until it returns even when its cooldown already elapsed', () => {
    const simulation = isolated({ config: { hookCooldown: 0.01 } });
    simulation.step([cast()]);
    expect(simulation.state.cooldownRemaining).toBe(0);
    expect(simulation.canCast).toBe(false);
    simulation.step([cast(3, 30)]);
    expect(simulation.state.hook?.castId).toBe('test-run:cast:1');
  });

  it('does not damage a target crossed only by the returning hook', () => {
    const simulation = isolated({
      config: { heroSpeed: 0, enemySpeed: 0, hookRange: 10 },
      initialEnemies: [{ x: 1.5, z: 5 }],
    });
    simulation.step([cast(), move(1)]);
    advance(simulation, 39, [move(1)]);
    expect(simulation.state.hook).toBeNull();
    expect(simulation.state.enemies[0]?.status).toBe('alive');
    expect(simulation.state.kills.normal).toBe(0);
  });

  it('uses swept collision for a fast hook that passes through a target within one tick', () => {
    const simulation = isolated({ config: { hookOutboundSpeed: 600 }, initialEnemies: [{ x: 0, z: 5 }] });
    simulation.step([cast()]);
    expect(simulation.state.kills.normal).toBe(1);
    expect(simulation.state.events.find((event) => event.type === 'hit')?.at).toBeCloseTo((5 - 0.8) / 601, 10);
  });

  it('uses swept relative movement for a fast enemy crossing the hero', () => {
    const simulation = isolated({ config: { enemySpeed: 600 }, initialEnemies: [{ x: 0, z: 5 }] });
    simulation.step();
    expect(simulation.state.deathReason).toBe('contact');
    expect(simulation.state.time).toBeCloseTo((5 - 0.8) / 602, 10);
    expect(simulation.state.time).toBeLessThan(FIXED_STEP);
  });

  it('ends the run when a living enemy passes the rear plane outside contact range', () => {
    const simulation = isolated({ initialEnemies: [{ x: 4, z: -0.99 }] });
    simulation.step();
    expect(simulation.state.deathReason).toBe('breach');
    expect(simulation.state.time).toBeCloseTo(0.01 / 3, 10);
  });

  it('gives a lethal hook hit priority over exactly simultaneous contact', () => {
    const simulation = isolated({ initialEnemies: [{ x: 0, z: 0.8 }] });
    simulation.step([cast()]);
    expect(simulation.state.kills.normal).toBe(1);
    expect(simulation.state.phase).toBe('running');
    expect(simulation.state.deathReason).toBeNull();
    advance(simulation, 60);
    expect(simulation.state.phase).toBe('running');
  });

  it('resolves equal-time targets by stable ID and preserves a kill before another enemy kills the hero', () => {
    const simulation = isolated({ initialEnemies: [{ id: 'b', x: 0, z: 0.8 }, { id: 'a', x: 0, z: 0.8 }] });
    simulation.step([cast()]);
    expect(simulation.state.kills.normal).toBe(1);
    expect(simulation.state.events.find((event) => event.type === 'hit')?.enemyId).toBe('a');
    expect(simulation.state.events.find((event) => event.type === 'gameOver')?.enemyId).toBe('b');
    expect(simulation.state.deathReason).toBe('contact');
    expect(simulation.state.hook).toBeNull();
  });

  it('resolves other same-time deaths even when a hit occurs exactly at the end of a tick', () => {
    const simulation = isolated({
      config: { hookOutboundSpeed: 2 },
      initialEnemies: [{ id: 'a', x: 0, z: 0.85 }, { id: 'b', x: 0, z: 0.85 }],
    });
    simulation.step([cast()]);
    expect(simulation.state.kills.normal).toBe(1);
    expect(simulation.state.deathReason).toBe('contact');
    expect(simulation.state.time).toBeCloseTo(FIXED_STEP, 10);
  });

  it('does not permit a later same-tick hit to cancel an earlier death', () => {
    const simulation = isolated({
      initialEnemies: [{ id: 'killer', x: 0, z: 0.81 }, { id: 'target', x: 1.1, z: 0.005 }],
    });
    simulation.step([cast(2, 0.01)]);
    expect(simulation.state.deathReason).toBe('contact');
    expect(simulation.state.kills.normal).toBe(0);
  });

  it('freezes positions, cooldown, generator and time while paused, with no queued commands', () => {
    const simulation = new RunSimulation('pause-test', 4);
    simulation.step([cast()]);
    simulation.pause();
    const before = structuredClone(simulation.state);
    advance(simulation, 600, [cast(2, 20), move(1)]);
    expect(simulation.state).toEqual(before);
    simulation.resume();
    simulation.step();
    expect(simulation.state.hero.x).toBe(before.hero.x);
    expect(simulation.state.time - before.time).toBeCloseTo(FIXED_STEP, 10);
    expect(simulation.state.hook?.castId).toBe(before.hook?.castId);
  });

  it('makes game over terminal, including pause/resume and cast attempts', () => {
    const simulation = isolated({ initialEnemies: [{ x: 0, z: 0.7 }] });
    simulation.step();
    const final = structuredClone(simulation.state);
    simulation.pause();
    simulation.resume();
    advance(simulation, 60, [cast(), move(1)]);
    expect(simulation.state).toEqual(final);
  });

  it('creates independent new runs with distinct run/cast identities', () => {
    const old = isolated({ initialEnemies: [{ x: 0, z: 0.7 }] });
    old.step();
    const fresh = new RunSimulation('new-run', 42, { config: { spawning: false } });
    fresh.step([cast()]);
    expect(fresh.state.phase).toBe('running');
    expect(fresh.state.runId).not.toBe(old.state.runId);
    expect(fresh.state.hook?.castId).toBe('new-run:cast:1');
    expect(fresh.state.kills.normal).toBe(0);
  });

  it('produces identical combat events and snapshots when render frames batch one or two fixed steps', () => {
    const run = (stepsPerFrame: number) => {
      const simulation = new RunSimulation('replay', 20261002);
      const log = [];
      for (let tick = 0; tick < 900;) {
        for (let batched = 0; batched < stepsPerFrame && tick < 900; batched++, tick++) {
          const commands: Command[] = [move(tick % 180 < 90 ? 0.2 : -0.2)];
          if (tick % 130 === 0) commands.push(cast(1.2, simulation.state.hero.z + 30));
          simulation.step(commands);
          log.push(...simulation.state.events);
        }
      }
      return { state: simulation.state, log };
    };
    expect(run(1)).toEqual(run(2));
  });

  it('generates normal enemies at the visible forward distance with seeded continuous intervals', () => {
    const simulation = new RunSimulation('stream', 8);
    const spawns: number[] = [];
    for (let tick = 0; tick < 600; tick++) {
      simulation.step();
      for (const event of simulation.state.events.filter((item) => item.type === 'spawn')) {
        spawns.push(event.at);
        const enemy = simulation.state.enemies.find((candidate) => candidate.id === event.enemyId)!;
        const elapsedAfterSpawn = simulation.state.time - event.at;
        expect(enemy.z - simulation.state.hero.z).toBeCloseTo(36 - 3 * elapsedAfterSpawn, 9);
      }
    }
    expect(spawns.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < spawns.length; i++) {
      const interval = spawns[i]! - (spawns[i - 1] ?? 0);
      expect(interval).toBeGreaterThanOrEqual(2.8);
      expect(interval).toBeLessThanOrEqual(3.4);
    }
  });

  it('respects the live-enemy budget', () => {
    const simulation = new RunSimulation('cap', 8, {
      config: { heroSpeed: 0, enemySpeed: 0, maxEnemies: 2, spawnMinSeconds: 0.1, spawnMaxSeconds: 0.1 },
    });
    advance(simulation, 600);
    expect(simulation.state.enemies).toHaveLength(2);
  });

  it('rejects invalid/rearward aims without consuming cooldown or corrupting positions', () => {
    const simulation = isolated();
    simulation.step([cast(NaN, 20), cast(0, 0), cast(0, -10), move(Infinity)]);
    expect(simulation.state.hook).toBeNull();
    expect(simulation.state.cooldownRemaining).toBe(0);
    expect(simulation.state.hero.x).toBe(0);
  });
});
