import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { importModel, ModelLibrary } from './models';
import { PresentationTimeline } from './timeline';
import { RunSimulation } from '../game/simulation';

const durations: Record<string, number> = { idle: 2, run: 1, strafe_left: 1, strafe_right: 1, hook_cast: .8, hook_hold: 1, hook_return_empty: 1, hook_return_capture: 1, death: 1 };
function evidence(name: string, data: unknown) {
  const directory = process.env.RF_HERO_EVIDENCE_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), JSON.stringify(data, null, 2));
}
async function setup() {
  const engine = new NullEngine(); const scene = new Scene(engine); scene.useRightHandedSystem = true;
  new FreeCamera('hero-qa-camera', new Vector3(0, 4, -8), scene);
  const container = await importModel('pudge', readFileSync(new URL('../../public/models/r1/pudge.glb', import.meta.url)), scene);
  const library = new ModelLibrary(new Map([['pudge', container]]), scene); const actor = library.create('pudge', 'hero-qa');
  const meshes = actor.root.getChildMeshes().filter((m): m is Mesh => m instanceof Mesh && !!m.skeleton);
  function vertices() {
    for (const n of actor.root.getDescendants()) if ('computeWorldMatrix' in n) n.computeWorldMatrix(true);
    for (const skeleton of actor.entries.skeletons) skeleton.prepare(true);
    const values: number[] = [];
    for (const mesh of meshes) {
      const points = mesh.getPositionData(true)!; const world = mesh.computeWorldMatrix(true).m;
      for (let i = 0; i < points.length; i += 3) {
        const x = points[i], y = points[i + 1], z = points[i + 2];
        values.push(x * world[0] + y * world[4] + z * world[8] + world[12], x * world[1] + y * world[5] + z * world[9] + world[13], x * world[2] + y * world[6] + z * world[10] + world[14]);
      }
    }
    return values;
  }
  const gap = (a: number[], b: number[]) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
  const close = () => { actor.dispose(); library.dispose(); scene.dispose(); engine.dispose(); };
  return { engine, scene, library, actor, meshes, vertices, gap, close };
}
describe('approved classic hero GLB', () => {
  it('keeps actual skinned poses grounded, loops closed and hook endpoints continuous', async () => {
    const q = await setup(); const { actor, meshes, vertices, gap } = q;
    expect(meshes).toHaveLength(7); expect(meshes.reduce((s, m) => s + m.getTotalIndices() / 3, 0)).toBe(16568);
    expect(new Set(meshes.map(m => m.material)).size).toBe(7);
    expect(actor.entries.skeletons[0].bones.filter(b => b.getIndex() >= 0)).toHaveLength(46);
    expect(actor.entries.animationGroups.map(g => g.name.replace('hero-qa:', '')).sort()).toEqual(Object.keys(durations).sort());
    const clips: Record<string, { samples: number; minY: number }> = {};
    for (const [clip, duration] of Object.entries(durations)) {
      const group = actor.entries.animationGroups.find(g => g.name === 'hero-qa:' + clip)!;
      expect((group.to - group.from) / group.targetedAnimations[0].animation.framePerSecond).toBeCloseTo(duration, 5);
      let lowest = Infinity;
      for (let i = 0; i <= Math.round(duration * 480); i++) {
        actor.pose(clip, i / 480, false); const points = vertices();
        for (let j = 0; j < points.length; j++) { if (!Number.isFinite(points[j])) throw new Error(clip + ': nonfinite'); if (j % 3 === 1) lowest = Math.min(lowest, points[j]); }
      }
      clips[clip] = { samples: Math.round(duration * 480) + 1, minY: lowest };
      expect(lowest, clip + ': ground penetration').toBeGreaterThanOrEqual(-.0001);
    }
    for (const clip of ['idle', 'run', 'strafe_left', 'strafe_right', 'hook_hold']) {
      actor.pose(clip, 0, false); const start = vertices(); actor.pose(clip, durations[clip], false); expect(gap(start, vertices()), clip + ': loop').toBeLessThan(.00001);
    }
    for (const [left, right] of [['hook_cast', 'hook_hold'], ['hook_hold', 'hook_return_empty'], ['hook_hold', 'hook_return_capture'], ['hook_return_empty', 'idle'], ['hook_return_capture', 'idle']]) {
      actor.pose(left, durations[left], false); const end = vertices(), hand = actor.socket('socket_hook_hand');
      actor.pose(right, 0, false); expect(gap(end, vertices()), left + '->' + right).toBeLessThan(.00001); expect(actor.socket('socket_hook_hand').subtract(hand).length()).toBeLessThan(.00001);
    }
    actor.pose('idle', 0, false); const points = vertices(); let low = Infinity, high = -Infinity; for (let i = 1; i < points.length; i += 3) { low = Math.min(low, points[i]); high = Math.max(high, points[i]); } expect(high - low).toBeCloseTo(2.3, 3);
    actor.pose('run', .4125, false); const fresh = vertices();
    for (const [clip, duration] of Object.entries(durations)) { actor.pose(clip, duration * .77, false); actor.pose('run', .4125, false); expect(gap(fresh, vertices())).toBeLessThan(.00001); }
    const other = q.library.create('pudge', 'other'); other.pose('idle', 0, false); const hand = other.socket('socket_hook_hand'); actor.pose('hook_cast', .4, false); expect(other.socket('socket_hook_hand').subtract(hand).length()).toBe(0); expect(other.entries.skeletons[0]).not.toBe(actor.entries.skeletons[0]); other.dispose();
    for (const socket of ['socket_hook_hand', 'socket_weapon', 'socket_head', 'socket_body', 'socket_feet']) expect(actor.socket(socket).asArray().every(Number.isFinite)).toBe(true);
    evidence('hero-babylon-verification.json', { status: 'BABYLON_SKIN_PASS', triangles: 16568, clips, sampleHz: 480 });
    q.close();
  }, 120000);
  it('smooths real close-hit, far-hit and miss switches and freezes at paused clocks', async () => {
    const q = await setup(); const report = [];
    for (const distance of [4, 25, 30]) {
      const sim = new RunSimulation('hero-range-' + distance, 421, { config: { spawning: false }, initialEnemies: distance === 30 ? [] : [{ id: 'target', kind: 'normal', x: 0, z: distance }] });
      const timeline = new PresentationTimeline(); const switches = []; let previous = '';
      for (let tick = 0; tick < 150; tick++) {
        sim.step(tick === 0 ? [{ type: 'cast', aim: { x: 0, z: distance } }] : []); timeline.observe(sim.state);
        const pose = timeline.hero(sim.state, 1 / 60); const before = q.actor.socket('socket_hook_hand');
        q.actor.pose(pose.clip, pose.seconds, pose.loop, sim.state.time); const after = q.actor.socket('socket_hook_hand');
        if (previous && previous !== pose.clip) { switches.push({ from: previous, to: pose.clip, time: sim.state.time, handJump: after.subtract(before).length() }); expect(after.subtract(before).length()).toBeLessThan(.00001); }
        const points = q.vertices(); let min = Infinity; for (let i = 1; i < points.length; i += 3) min = Math.min(min, points[i]); expect(min, 'transition floor at ' + distance + 'm tick' + tick).toBeGreaterThanOrEqual(-.0001);
        if (tick === 6) { const frozen = q.vertices(); q.actor.pose(pose.clip, pose.seconds, pose.loop, sim.state.time); expect(q.gap(frozen, q.vertices())).toBeLessThan(.00001); }
        previous = pose.clip;
      }
      report.push({ distance, switches, kills: sim.state.kills });
    }
    evidence('hero-early-return-verification.json', report);
    q.close(); expect(report).toHaveLength(3);
  });
  it('caches frozen blends, removes support lift and resets for a new run or gallery', async () => {
    const q = await setup(); const actor = q.actor;
    actor.pose('run', .3, true, 1);
    actor.pose('hook_cast', .1, false, 1.01);
    actor.pose('hook_return_capture', .04, false, 1.07);
    actor.pose('hook_return_capture', .1, false, 1.13);
    const frozen = q.vertices();
    const spies = q.meshes.map(mesh => vi.spyOn(mesh, 'getPositionData'));
    for (let i = 0; i < 100; i++) { actor.pose('hook_return_capture', .1, false, 1.13); q.scene.render(); }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    actor.root.position.x = .2; actor.pose('hook_return_capture', .1, false, 1.13);
    for (const spy of spies) { expect(spy).toHaveBeenCalled(); spy.mockRestore(); }
    actor.root.position.x = 0; actor.pose('hook_return_capture', .1, false, 1.13);
    expect(q.gap(frozen, q.vertices())).toBeLessThan(.00001);
    actor.pose('hook_return_capture', .3, false, 1.33); const settled = q.vertices();
    actor.pose('hook_return_capture', .3, false);
    expect(q.gap(settled, q.vertices())).toBeLessThan(.00001);
    actor.pose('hook_cast', .4, false, 1.4); actor.pose('hook_cast', .45, false, 1.45);
    actor.pose('run', 0, true, 0); const restarted = q.vertices();
    actor.pose('idle', .6, false); actor.pose('run', 0, true, 0);
    expect(q.gap(restarted, q.vertices())).toBeLessThan(.00001);
    const counts = { meshes: q.scene.meshes.length, skeletons: q.scene.skeletons.length, groups: q.scene.animationGroups.length };
    for (let i = 0; i < 12; i++) {
      const temporary = q.library.create('pudge', 'temporary-' + i);
      temporary.pose('run', .3, true, 1); temporary.pose('hook_cast', .05, false, 1.01); temporary.dispose();
    }
    expect({ meshes: q.scene.meshes.length, skeletons: q.scene.skeletons.length, groups: q.scene.animationGroups.length }).toEqual(counts);
    q.close();
  });
  it('freezes actual paused and shop phases and finishes death at a fixed terminal clock', async () => {
    const q = await setup();
    for (const phase of ['paused', 'shop'] as const) {
      const sim = new RunSimulation('hero-phase-' + phase, 421, {
        config: { spawning: true, spawnMinSeconds: 1000, spawnMaxSeconds: 1000, maxShooters: 0, maxBosses: 0, lateralLimit: .5, spawnDistance: 2, shopMinInterval: .01, shopMaxInterval: .01 },
      });
      const timeline = new PresentationTimeline();
      const render = () => {
        timeline.observe(sim.state); const pose = timeline.hero(sim.state, 1 / 60);
        q.actor.pose(pose.clip, pose.seconds, pose.loop, sim.state.time + (pose.clip === 'death' ? pose.seconds : 0));
      };
      render();
      for (let i = 0; i < 4; i++) { sim.step(i === 0 ? [{ type: 'cast', aim: { x: 0, z: 25 } }] : []); render(); }
      if (phase === 'paused') sim.pause();
      else { expect(sim.availableShop).not.toBeNull(); expect(sim.enterShop(sim.availableShop!.id)).toBe(true); }
      expect(sim.state.phase).toBe(phase);
      const time = sim.state.time, frozen = q.vertices();
      const spies = q.meshes.map(mesh => vi.spyOn(mesh, 'getPositionData'));
      for (let i = 0; i < 100; i++) { sim.step(); render(); }
      for (const spy of spies) { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); }
      expect(sim.state.time).toBe(time); expect(q.gap(frozen, q.vertices())).toBeLessThan(.00001);
      if (phase === 'shop') {
        expect(sim.leaveShop()).toBe(true); expect(sim.state.phase).toBe('paused'); render();
        expect(sim.state.time).toBe(time); expect(q.gap(frozen, q.vertices())).toBeLessThan(.00001);
      }
      sim.resume(); sim.step(); render(); expect(sim.state.time).toBeGreaterThan(time);
      sim.abandon(); const terminalTime = sim.state.time;
      for (let i = 0; i < 75; i++) render();
      const death = q.vertices(); q.actor.pose('death', 1, false);
      expect(q.gap(death, q.vertices())).toBeLessThan(.00001); expect(sim.state.time).toBe(terminalTime);
    }
    q.close();
  });
});
