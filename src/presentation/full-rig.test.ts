import {readFileSync,writeFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {importModel,ModelLibrary} from './models';
import {APPEARANCES,applyAppearance,type AppearanceLoadout} from './appearance';
import {getItemDefinition} from '../game/equipment';

it('imports all 41 current-rig parts; switches all 16 states and unequip without leaving another level visible',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
 const container=await importModel('pudge',readFileSync(new URL('../../public/models/runner-3d/pudge-equipment.glb',import.meta.url)),scene);
 const library=new ModelLibrary(new Map([['pudge',container]]),scene),actor=library.create('pudge','series');
 const parts=APPEARANCES.flatMap(a=>a.parts),nodes=actor.root.getDescendants();
 expect(parts).toHaveLength(41);expect(APPEARANCES).toHaveLength(16);
 for(const part of parts)expect(nodes.some(n=>n.name==='series:'+part),part).toBe(true);
 const wearing=actor.root.getChildMeshes().filter(m=>m.name.startsWith('series:wear_'));
 for(const appearance of APPEARANCES){
  const loadout:AppearanceLoadout={weapon:null,body:null,legs:null,talisman:null};
  loadout[getItemDefinition(appearance.key.definitionId).slot]=appearance.key;
  applyAppearance(actor,loadout);
  for(const mesh of wearing)expect(mesh.isEnabled(),mesh.name).toBe(appearance.parts.some(p=>mesh.name==='series:'+p||mesh.name.startsWith('series:'+p+'_')));
 }
 applyAppearance(actor,{weapon:{definitionId:'fast_reel',level:3},body:{definitionId:'conductor_cuffs',level:3},legs:{definitionId:'side_step_boots',level:3},talisman:{definitionId:'trophy_counter',level:3}});
 expect(wearing.filter(m=>m.isEnabled())).not.toHaveLength(0);
 const clips:Record<string,{samples:number,minY:number}>={};
 // Inspect actual exported positions for every part, including hidden alternatives.
 const meshes=actor.root.getChildMeshes().filter((m):m is Mesh=>m instanceof Mesh&&!!m.skeleton);
 for(const group of actor.entries.animationGroups){
  const clip=group.name.slice('series:'.length),duration=actor.clipDuration(clip);let minY=Infinity;
  for(let i=0;i<=Math.round(duration*60);i++){
   actor.pose(clip,i/60,false);
   for(const node of actor.root.getDescendants())if('computeWorldMatrix'in node)node.computeWorldMatrix(true);
   for(const skeleton of actor.entries.skeletons)skeleton.prepare(true);
   for(const mesh of meshes){
    const positions=mesh.getPositionData(true)!,world=mesh.computeWorldMatrix(true).m;
    for(let j=0;j<positions.length;j+=3){const y=positions[j]*world[1]+positions[j+1]*world[5]+positions[j+2]*world[9]+world[13];if(!Number.isFinite(y))throw new Error(clip+': nonfinite skin vertex');minY=Math.min(minY,y);}
   }
  }
  expect(minY,clip).toBeGreaterThanOrEqual(-.0001);
  expect(actor.socket('socket_foot_l').subtract(actor.socket('socket_foot_r')).length()).toBeGreaterThan(.05);
  clips[clip]={samples:Math.round(duration*60)+1,minY};
 }
 expect(Object.keys(clips)).toHaveLength(9);
 const other=library.create('pudge','other');other.pose('idle',0);const foot=other.socket('socket_foot_l');
 actor.pose('run',.5);expect(other.socket('socket_foot_l').subtract(foot).length()).toBeLessThan(1e-6);
 expect(other.entries.skeletons[0]).not.toBe(actor.entries.skeletons[0]);
 applyAppearance(actor,{weapon:null,body:null,legs:null,talisman:null});expect(wearing.every(m=>!m.isEnabled())).toBe(true);
 writeFileSync(new URL('../../../../docs/full-babylon-rig.json',import.meta.url),JSON.stringify({status:'FULL_BABYLON_RIG_PASS',states:16,parts:41,joints:46,sampleHz:60,clips,independentActors:true},null,2)+'\n');
 actor.dispose();other.dispose();library.dispose();scene.dispose();engine.dispose();
},30000);
