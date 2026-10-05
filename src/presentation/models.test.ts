import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MODEL_NAMES, importModel, ModelLibrary, validateModel, modelPath } from './models';
import type { ModelName } from './models';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { ThreatView } from './threats';
import { RunSimulation } from '../game/simulation';

describe('provided character and environment GLB in Babylon', () => {
  it('keeps the wood creep grounded, closes the run loop and holds the captured pose', async () => {
    const engine = new NullEngine(); const scene = new Scene(engine); scene.useRightHandedSystem = true;
    const bytes = readFileSync(new URL('../../public/models/r1/creep_basic.glb', import.meta.url));
    const container = await importModel('creep_basic', bytes, scene);
    const library = new ModelLibrary(new Map([['creep_basic', container]]), scene);
    const actor = library.create('creep_basic', 'wood');
    const other = library.create('creep_basic', 'wood-other');
    const meshes = actor.root.getChildMeshes().filter((mesh): mesh is Mesh => mesh instanceof Mesh && Boolean(mesh.skeleton));
    expect(meshes.reduce((total, mesh) => total + mesh.getTotalIndices() / 3, 0)).toBe(2859);
    expect(new Set(meshes.map(mesh => mesh.material)).size).toBe(1);
    // Babylon also adds the armature ancestor as a non-skin bone (index -1).
    expect(actor.entries.skeletons[0].bones.filter(bone => bone.getIndex() >= 0)).toHaveLength(40);
    for (const group of actor.entries.animationGroups) {
      const clip = group.name.replace('wood:', '');
      expect((group.to - group.from) / group.targetedAnimations[0].animation.framePerSecond).toBeCloseTo({ run: .8, hit: .6, death_capture: 1 }[clip]!, 5);
    }
    const vertices = () => {
      for (const node of actor.root.getDescendants()) if ('computeWorldMatrix' in node) node.computeWorldMatrix(true);
      // Sampling many poses within one NullEngine frame needs an explicit refresh.
      for (const skeleton of actor.entries.skeletons) skeleton.prepare(true);
      return meshes.flatMap(mesh => {
        const positions = mesh.getPositionData(true)!;
        const world = mesh.computeWorldMatrix(true);
        const values: number[] = [];
        for (let i = 0; i < positions.length; i += 3) {
          const point = Vector3.TransformCoordinates(Vector3.FromArray(positions, i), world);
          values.push(point.x, point.y, point.z);
        }
        return values;
      });
    };
    for (const [clip, duration] of [['run', .8], ['hit', .6], ['death_capture', 1]] as const) {
      let lowest = Infinity;
      for (let sample = 0; sample <= Math.round(duration * 480); sample++) {
        actor.pose(clip, sample / 480, false);
        const points = vertices();
        for (let i = 1; i < points.length; i += 3) lowest = Math.min(lowest, points[i]);
      }
      expect(lowest, `${clip}: ground penetration`).toBeGreaterThanOrEqual(-.0001);
    }
    actor.pose('run', 0, false); const start = vertices();
    actor.pose('run', .8, false); const end = vertices();
    expect(Math.max(...start.map((value, i) => Math.abs(value - end[i])))).toBeLessThan(.00001);
    actor.pose('hit', .6, false); const fallen = vertices(); const socket = actor.socket('socket_creep_capture');
    actor.pose('death_capture', 0, false); const held = vertices();
    expect(Math.max(...fallen.map((value, i) => Math.abs(value - held[i])))).toBeLessThan(.00001);
    expect(actor.socket('socket_creep_capture').subtract(socket).length()).toBeLessThan(.00001);
    const blade = meshes.find(mesh => mesh.name === 'wood:RF_Wood_Creep_Blade')!;
    const otherBlade = other.root.getChildMeshes().find(mesh => mesh.name === 'wood-other:RF_Wood_Creep_Blade')!;
    actor.setPartEnabled('RF_Wood_Creep_Blade', false);
    expect(blade.isEnabled()).toBe(false); expect(otherBlade.isEnabled()).toBe(true);
    actor.setPartEnabled('RF_Wood_Creep_Blade', true); expect(blade.isEnabled()).toBe(true);
    const threats = new ThreatView(scene);
    const sim = new RunSimulation('wood-threat', 9, {
      config: { spawning: false }, initialEnemies: [{ id: 'wood', kind: 'strong', x: 0, z: 11 }],
    });
    const beforeThreat = { meshes: scene.meshes.length, nodes: scene.transformNodes.length };
    threats.render(sim.state, 0, new Map([['wood', actor]]));
    const mount = scene.getTransformNodeByName('weapon-mount-wood')!;
    expect(mount.parent?.name).toBe('wood:weapon1_0');
    actor.pose('run', 0, false); mount.computeWorldMatrix(true); const grip = mount.getAbsolutePosition().clone();
    actor.pose('hit', .4, false); mount.computeWorldMatrix(true);
    expect(mount.getAbsolutePosition().subtract(grip).length()).toBeGreaterThan(.05);
    expect(mount.getAbsolutePosition().subtract(actor.socket('weapon1_0')).length()).toBeLessThan(.00001);
    threats.render(undefined, 0, new Map());
    expect({ meshes: scene.meshes.length, nodes: scene.transformNodes.length }).toEqual(beforeThreat);
    threats.dispose();
    actor.dispose(); other.dispose(); library.dispose(); scene.dispose(); engine.dispose();
  });

  it('imports all contracts and keeps independent rigs, sockets and bounded disposal', async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    const containers = new Map<ModelName, AssetContainer>();
    for (const name of MODEL_NAMES) {
      const bytes = readFileSync(new URL(`../../public/${modelPath(name)}`, import.meta.url));
      containers.set(name, await importModel(name, bytes, scene));
    }
    expect(containers.get('pudge')!.animationGroups).toHaveLength(9);
    expect(containers.get('creep_basic')!.animationGroups).toHaveLength(3);
    const library = new ModelLibrary(containers, scene);
    const baseline = { meshes: scene.meshes.length, nodes: scene.transformNodes.length, groups: scene.animationGroups.length, rigs: scene.skeletons.length };
    const hero = library.create('pudge', 'test-hero');
    hero.pose('idle', 0);
    const handStart = hero.socket('socket_hook_hand');
    hero.pose('hook_cast', 0.4, false);
    expect(hero.socket('socket_hook_hand').subtract(handStart).length()).toBeGreaterThan(0.05);
    const one = library.create('creep_basic', 'one');
    const two = library.create('creep_basic', 'two');
    expect(one.entries.skeletons[0]).not.toBe(two.entries.skeletons[0]);
    expect(one.entries.animationGroups[0].targetedAnimations[0].target).not.toBe(two.entries.animationGroups[0].targetedAnimations[0].target);
    one.pose('hit', 0.5, false); two.pose('run', 0.2);
    expect(one.socket('socket_creep_capture').y).not.toBeCloseTo(two.socket('socket_creep_capture').y, 2);
    hero.dispose(); one.dispose(); two.dispose();
    for (let index = 0; index < 20; index++) {
      const actor = library.create('creep_basic', `recycle-${index}`);
      actor.pose('run', index / 10); actor.dispose();
    }
    expect({ meshes: scene.meshes.length, nodes: scene.transformNodes.length, groups: scene.animationGroups.length, rigs: scene.skeletons.length }).toEqual(baseline);
    const road = library.create('road', 'road-test');
    const bounds = road.entries.rootNodes[0].getHierarchyBoundingVectors();
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(10, 4);
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(12, 4);
    road.dispose(); library.dispose(); scene.dispose(); engine.dispose();
  });

  it('rejects an incomplete model contract', async () => {
    const engine = new NullEngine(); const scene = new Scene(engine); scene.useRightHandedSystem = true;
    const bytes = readFileSync(new URL('../../public/models/r1/road.glb', import.meta.url));
    const container = await importModel('road', bytes, scene);
    expect(() => validateModel('pudge', container)).toThrow('missing hero_root');
    container.dispose(); scene.dispose(); engine.dispose();
  });
});
