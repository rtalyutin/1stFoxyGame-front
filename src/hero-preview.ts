import { WorldView } from './presentation/world';
import { ModelActor } from './presentation/models';
import { RunSimulation, type Command } from './game/simulation';
import { FIXED_STEP } from './game/config';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
const world = new WorldView(document.querySelector<HTMLCanvasElement>('#game')!);
await world.loadAssets(); await world.scene.whenReadyAsync();
const hero = (world as unknown as { hero: ModelActor }).hero;
const camera = world.scene.activeCamera as FreeCamera;
const durations: Record<string, number> = {idle:2,run:1,strafe_left:1,strafe_right:1,hook_cast:.8,hook_hold:1,hook_return_empty:1,hook_return_capture:1,death:1};
let clip='idle', seconds=0, playing=false, closeup=true, mode='model', sim:RunSimulation|null=null, last=performance.now(),accumulator=0,sequence=0;
let firstStep=false, aimDistance=25, lastClip='', maxChainError=0,maxCaptureError=0;
const switches:Array<{from:string;to:string;time:number;handJump:number}>=[];
const pending:Command[]=[];
const status=document.querySelector('#status')!;
const activeName=()=> (hero as unknown as {active:AnimationGroup|null}).active?.name.replace('hero:','')??'';
world.scene.onBeforeRenderObservable.add(()=>{
  if(!sim)hero.pose(clip,seconds,false);
  if(closeup){
    const aspect=world.engine.getRenderWidth()/world.engine.getRenderHeight();
    const distanceScale=Math.max(1,1.1/aspect);
    camera.position.set(3.3*distanceScale,1.15+2.05*distanceScale,5.2*distanceScale);
    camera.setTarget(new Vector3(0,1.15,0));camera.fov=.53;
  }
});
function resetCamera(){const portrait=world.engine.getRenderHeight()>world.engine.getRenderWidth();camera.position.set(0,portrait?15:11,portrait?-23:-15);camera.fov=portrait?.9:.85;}
function model(next:string){sim=null;mode='model';clip=next;seconds=0;playing=false;accumulator=0;document.querySelector('#pause')!.textContent='Пуск';}
function scenario(distance:number|null){mode=distance===null?'run':'target-'+distance;clip='run';closeup=false;resetCamera();playing=true;accumulator=0;seconds=0;lastClip='';switches.length=0;maxChainError=0;maxCaptureError=0;aimDistance=distance??25;firstStep=distance!==null;
  sim=new RunSimulation('hero-preview-'+(++sequence),421,distance===null?{}:{config:{spawning:false},initialEnemies:distance===30?[]:[{id:'target',kind:'normal',x:0,z:distance}]});document.querySelector('#pause')!.textContent='Пауза';}
document.querySelector('#clip')!.addEventListener('change',e=>model((e.target as HTMLSelectElement).value));
for(const [id,at] of [['start',0],['middle',.5],['end',1]] as const)document.querySelector('#'+id)!.addEventListener('click',()=>{sim=null;mode='model';playing=false;seconds=durations[clip]*at;document.querySelector('#pause')!.textContent='Пуск';});
document.querySelector('#closeup')!.addEventListener('click',()=>{closeup=true;});
document.querySelector('#camera')!.addEventListener('click',()=>{closeup=false;resetCamera();});
document.querySelector('#pause')!.addEventListener('click',()=>{playing=!playing;if(sim){if(playing)sim.resume();else sim.pause();}document.querySelector('#pause')!.textContent=playing?'Пауза':'Пуск';});
for(const [id,distance] of [['near',4],['far',25],['miss',30],['run',null]] as const)document.querySelector('#'+id)!.addEventListener('click',()=>scenario(distance));
const snapshot=()=>{
  const meshes=hero.root.getChildMeshes().filter((m):m is Mesh=>m instanceof Mesh&&!!m.skeleton);
  return {mode,clip:activeName(),seconds:sim?.state.time??seconds,playing,phase:sim?.state.phase??'model',ready:world.scene.isReady(),fps:world.engine.getFps(),width:world.engine.getRenderWidth(),height:world.engine.getRenderHeight(),triangles:meshes.reduce((s,m)=>s+m.getTotalIndices()/3,0),meshes:meshes.map(m=>({name:m.name,material:m.material?.name,textures:m.material?.getActiveTextures().map(t=>({name:t.name,ready:t.isReady()}))})),hand:hero.socket('socket_hook_hand').asArray(),kills:sim?.state.kills,switches:[...switches],maxChainError,maxCaptureError,hookPhase:sim?.state.hook?.phase};
};
(window as unknown as {heroPreview:{snapshot:typeof snapshot}}).heroPreview={snapshot};
let statusAt=0;
world.engine.runRenderLoop(()=>{
 const now=performance.now(),delta=Math.min((now-last)/1000,.1);last=now;
 if(playing){
  if(sim){accumulator+=delta;while(accumulator>=FIXED_STEP){const commands=pending.splice(0);if(firstStep){commands.push({type:'cast',aim:{x:0,z:aimDistance}});firstStep=false;}sim.step(commands);world.observe(sim.state);accumulator-=FIXED_STEP;}}
  else seconds=(seconds+delta)%durations[clip];
 }
 const before=hero.socket('socket_hook_hand');world.render(sim,{x:0,z:(sim?.state.hero.z??0)+aimDistance},playing?delta:0);const after=hero.socket('socket_hook_hand');const current=activeName();
 if(sim){
  if(lastClip&&lastClip!==current)switches.push({from:lastClip,to:current,time:sim.state.time,handJump:after.subtract(before).length()});lastClip=current;
  const hook=sim.state.hook;
  if(hook){
   const chain=world.scene.getTransformNodeByName('hook:socket_chain_hook')!;chain.computeWorldMatrix(true);const end=chain.getAbsolutePosition();
   const links=world.scene.transformNodes.filter(n=>/^link-\d+$/.test(n.name)&&n.isEnabled());const first=world.scene.getTransformNodeByName('link-0');
   if(first&&links.length){first.computeWorldMatrix(true);maxChainError=Math.max(maxChainError,first.getAbsolutePosition().subtract(Vector3.Lerp(after,end,.5/links.length)).length());}
   if(hook.capturedEnemyId){const target=world.scene.getTransformNodeByName('hook:socket_target_hook');const capture=world.scene.getTransformNodeByName(hook.capturedEnemyId+':socket_creep_capture');if(target&&capture){target.computeWorldMatrix(true);capture.computeWorldMatrix(true);maxCaptureError=Math.max(maxCaptureError,target.getAbsolutePosition().subtract(capture.getAbsolutePosition()).length());}}
  }
  if(mode!=='run'&&sim.state.time>=2.3){playing=false;document.querySelector('#pause')!.textContent='Пуск';}
 }
 if(now-statusAt>250){status.textContent=`${mode} · ${current} · ${(sim?.state.time??seconds).toFixed(2)} с · ${world.engine.getFps().toFixed(0)} FPS · ${world.scene.isReady()?'Материалы готовы':'Шейдеры загружаются'}`;statusAt=now;}
});
