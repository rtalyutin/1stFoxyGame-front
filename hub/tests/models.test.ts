import { it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import { LivingWorld } from '../src/worlds';
import { validateManifest } from '../src/catalog';
it.each(['runner-forge','last-throne','syezzhaem'])('imports actual %s GLB and runs its autonomous module',async id=> {
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  const manifest=validateManifest(JSON.parse(readFileSync(new URL(`../public/scenes/${id}.json`,import.meta.url),'utf8')));
  const container=await LoadAssetContainerAsync(new Uint8Array(readFileSync(new URL(`../public/${manifest.model}`,import.meta.url))),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{animationStartMode:0}}});
  const root=container.transformNodes.find(n=>n.name==='cabinet_root')!;
  expect(root).toBeTruthy();const world=new LivingWorld(container,root,manifest);
  for(const name of manifest.anchors)expect(world.node(name)).toBeTruthy();
  expect(container.meshes.length).toBeGreaterThan(30);
  // Count imported instances, including each miniature world, rather than only shared geometry buffers.
  const triangles=container.meshes.reduce((sum,mesh)=>sum+mesh.getTotalIndices()/3,0);
  expect(triangles).toBe({'runner-forge':151600,'last-throne':125600,'syezzhaem':136000}[id]);
  const actor=world.node(manifest.behavior==='forge'?'npc_runner':manifest.behavior==='throne'?'knight_0':'cat');
  actor.computeWorldMatrix(true);const before=actor.getWorldMatrix().m[0];world.update(.1);world.update(3.4);actor.computeWorldMatrix(true);
  expect(actor.rotationQuaternion).toBe(null);expect(actor.getWorldMatrix().m[0]).not.toBe(before);
  world.dispose();scene.dispose();engine.dispose();
});
it('imports the editable fox rig with idle and run animation clips',async()=> {
  const engine=new NullEngine(),scene=new Scene(engine);
  const container=await LoadAssetContainerAsync(new Uint8Array(readFileSync(new URL('../public/models/hero.glb',import.meta.url))),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{animationStartMode:0}}});
  expect(container.animationGroups.map(g=>g.name).sort()).toEqual(['idle','run']);
  expect(container.transformNodes.find(n=>n.name==='hero_root')).toBeTruthy();container.dispose();scene.dispose();engine.dispose();
});
