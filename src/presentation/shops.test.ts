import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ModelLibrary, importModel, validateModel } from './models';
import { ShopView } from './shops';
import { toScenePoint } from './coordinates';
import { RunSimulation } from '../game/simulation';

describe('shop model and runtime placement', () => {
  it('anchors both entrances without drift, keeps the road clear and disposes passed stores', async () => {
    const engine = new NullEngine(), scene = new Scene(engine); scene.useRightHandedSystem = true;
    const container = await importModel('shop', readFileSync(new URL('../../public/models/r3/shop.glb', import.meta.url)), scene);
    expect(container.skeletons).toHaveLength(0); expect(container.animationGroups).toHaveLength(0);
    const library = new ModelLibrary(new Map([['shop', container]]), scene), view = new ShopView(library);
    const baseline = [scene.meshes.length, scene.transformNodes.length];
    const sim = new RunSimulation('shop-render', 9, { config: { spawning: false } });
    for (let index = 0; index < 20; index++) {
      const x = index % 2 ? -4.5 : 4.5, distance = index * 100;
      const shop = { id: `store-${index}`, x, z: distance + 36, at: distance / 2 };
      sim.state.shopCandidates = [shop];
      view.render(sim.state, distance);
      const count = [scene.meshes.length, scene.transformNodes.length];
      for (const d of [distance, distance+34, distance+36, distance+10000]) {
        view.render(sim.state, d); view.render(sim.state, d);
        const entry = scene.getTransformNodeByName(`shop-${shop.id}:socket_shop_entry`)!;
        entry.computeWorldMatrix(true);
        expect(entry.getAbsolutePosition().subtract(toScenePoint(shop, d)).length()).toBeLessThan(.00001);
        const root = scene.getTransformNodeByName(`shop-${shop.id}`)!;
        expect(root.rotation.y).toBeCloseTo(Math.sign(x)*Math.PI/2);
        for (const mesh of root.getChildMeshes()) {
          expect(mesh.isPickable).toBe(false);
          mesh.computeWorldMatrix(true);
          if (mesh.getTotalVertices() > 0) {
            const bounds = mesh.getBoundingInfo().boundingBox;
            expect(bounds.minimumWorld.y).toBeGreaterThanOrEqual(-.00001);
            // ±4.5 entry, 2.3 socket offset and nearest 1.772 geometry => clearance ≥5.028.
            expect(x > 0 ? -bounds.maximumWorld.x : bounds.minimumWorld.x).toBeGreaterThanOrEqual(5);
          }
        }
        expect([scene.meshes.length, scene.transformNodes.length]).toEqual(count);
      }
    }
    view.render(undefined, 0); expect([scene.meshes.length, scene.transformNodes.length]).toEqual(baseline);
    const invalid = await importModel('road', readFileSync(new URL('../../public/models/r1/road.glb', import.meta.url)), scene);
    expect(() => validateModel('shop', invalid)).toThrow('missing shop_root'); invalid.dispose();
    view.clear(); library.dispose(); scene.dispose(); engine.dispose();
  });
});
