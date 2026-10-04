import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MODEL_NAMES, importModel, ModelLibrary, validateModel, modelPath } from './models';
import type { ModelName } from './models';
import type { AssetContainer } from '@babylonjs/core/assetContainer';

describe('provided character and environment GLB in Babylon', () => {
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
