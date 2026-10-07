import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import {WorkshopPresentation} from './workshop-scene';
import {PRODUCTION_IDS,type WorkshopView} from '../platform/workshop';

it('imports native workshop clips, bounds devices for huge owned and deduplicates confirmed strike receipts',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
 const container=await LoadAssetContainerAsync(readFileSync(new URL('../../public/models/runner-3d/workshop-r5.glb',import.meta.url)),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{animationStartMode:0}}});
 const actor=new WorkshopPresentation(container.instantiateModelsToScene(n=>'workshop:'+n,false),scene);
 const count=scene.meshes.length;
 const view:WorkshopView={schemaVersion:'runner-workshop.1',balanceRevision:'a0e14124-86c9-4310-b330-96e45dde3f89',serverNowMs:1000,settledAtMs:1000,offlineCapSeconds:3600,tapLevel:3,organizationLevel:3,tapGoldMilli:'1000',productionRate:{numerator:'4000000000000000',denominator:1000},productions:PRODUCTION_IDS.map(id=>({id,name:id,owned:1000000000,rateGoldMilliPerSecond:'1000',nextCostGoldMilli:null})),upgrades:{tap:{costGoldMilli:null,nextGoldMilli:null},organization:{costGoldMilli:null,nextPermille:null}},organizationPermille:1000};
 actor.update(view);actor.render(.1);expect(scene.meshes.length).toBe(count);
 for(let i=0;i<4;i++){expect(actor.nodes.get('tap_tier_'+i)!.isEnabled()).toBe(i===3);expect(actor.nodes.get('organization_tier_'+i)!.isEnabled()).toBe(i===3);}
 expect(actor.confirmTap('receipt-1')).toBe(true);expect(actor.confirmTap('receipt-1')).toBe(false);
 expect(actor.confirmedStrikes).toBe(1);
 const pivot=actor.nodes.get('tap_hammer_pivot')!;const before=pivot.rotationQuaternion!.clone();
 for(let i=0;i<7;i++)actor.render(.1);
 expect(pivot.rotationQuaternion!.equals(before)).toBe(false);
 for(const group of actor.groups.values()){
  const fps=group.targetedAnimations[0].animation.framePerSecond;expect((group.to-group.from)/fps).toBeGreaterThan(0);
 }
 for(const node of actor.nodes.values()){const m=node.computeWorldMatrix(true).m;expect(Array.from(m).every(Number.isFinite),node.name).toBe(true);}
 const reportDirectory=new URL('../../test-results/rig/',import.meta.url);mkdirSync(reportDirectory,{recursive:true});
 writeFileSync(new URL('workshop-babylon.json',reportDirectory),JSON.stringify({status:'WORKSHOP_IMPORT_PASS',clips:[...actor.groups.keys()],productionDevices:4,ownedFixture:1000000000,meshCount:count,meshCountAfter:scene.meshes.length,receiptReplayStrikes:actor.confirmedStrikes,upgradeStates:[0,1,2,3]},null,2)+'\n');
 actor.dispose();container.dispose();scene.dispose();engine.dispose();
});
