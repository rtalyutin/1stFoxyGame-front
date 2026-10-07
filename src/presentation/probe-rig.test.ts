import {readFileSync,writeFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {importModel,ModelLibrary} from './models';
import {PROBE_APPEARANCES,applyAppearance} from './appearance';

it('imports the exported wearable rig, samples nine clips and keeps per-leg sockets independent',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
 const container=await importModel('pudge',readFileSync(new URL('../../public/models/runner-3d/pudge-probe.glb',import.meta.url)),scene);
 const library=new ModelLibrary(new Map([['pudge',container]]),scene),actor=library.create('pudge','probe');
 const meshes=actor.root.getChildMeshes().filter((m):m is Mesh=>m instanceof Mesh&&!!m.skeleton);
 const wearing=[...new Map(actor.root.getDescendants().filter(n=>PROBE_APPEARANCES.some(a=>a.parts.some(p=>n.name==='probe:'+p))).reverse().map(n=>[n.name,n])).values()];
 expect(wearing).toHaveLength(8);
 expect(actor.entries.skeletons[0].bones.filter(b=>b.getIndex()>=0)).toHaveLength(46);
 const duration:Record<string,number>={idle:2,run:1,strafe_left:1,strafe_right:1,hook_cast:.8,hook_hold:1,hook_return_empty:1,hook_return_capture:1,death:1};
 const clips:Record<string,{samples:number,minY:number,maxFootSeparation:number}>={};
 for(const [clip,seconds]of Object.entries(duration)){
  const group=actor.entries.animationGroups.find(g=>g.name==='probe:'+clip)!;
  expect((group.to-group.from)/group.targetedAnimations[0].animation.framePerSecond).toBeCloseTo(seconds,5);
  let minY=Infinity,maxFootSeparation=0;
  for(let i=0;i<=Math.round(seconds*60);i++){
   actor.pose(clip,i/60,false);
   for(const n of actor.root.getDescendants())if('computeWorldMatrix'in n)n.computeWorldMatrix(true);
   for(const s of actor.entries.skeletons)s.prepare(true);
   for(const m of meshes){const p=m.getPositionData(true)!,w=m.computeWorldMatrix(true).m;
    for(let j=0;j<p.length;j+=3){const y=p[j]*w[1]+p[j+1]*w[5]+p[j+2]*w[9]+w[13];if(!Number.isFinite(y))throw new Error(clip+': nonfinite skinned vertex');minY=Math.min(minY,y);}
   }
   maxFootSeparation=Math.max(maxFootSeparation,actor.socket('socket_foot_l').subtract(actor.socket('socket_foot_r')).length());
  }
  expect(minY,clip+': exported sole must stay above ground').toBeGreaterThanOrEqual(-.0001);
  expect(maxFootSeparation).toBeGreaterThan(.05);
  clips[clip]={samples:Math.round(seconds*60)+1,minY,maxFootSeparation};
 }
 applyAppearance(actor,{weapon:null,body:null,legs:{definitionId:'side_step_boots',level:1},talisman:null},PROBE_APPEARANCES);
 for(const a of PROBE_APPEARANCES)for(const p of a.parts){const part=wearing.find(m=>m.name==='probe:'+p)!;expect(part.isEnabled()).toBe(a.key.definitionId==='side_step_boots');}
 for(const mesh of meshes.filter(m=>m.name.startsWith('probe:wear_')))expect(mesh.isEnabled(),mesh.name).toBe(mesh.name.includes('wear_side_step_boots_'));
 const other=library.create('pudge','independent');other.pose('idle',0,false);const foot=other.socket('socket_foot_l');actor.pose('run',.4,false);expect(other.socket('socket_foot_l').subtract(foot).length()).toBe(0);
 writeFileSync(new URL('../../../../docs/probe-babylon-rig.json',import.meta.url),JSON.stringify({status:'BABYLON_IMPORT_SKIN_PASS',sampleHz:60,clips,perActorRig:true,wearParts:8,joints:46},null,2));
 other.dispose();actor.dispose();library.dispose();scene.dispose();engine.dispose();
},120000);
