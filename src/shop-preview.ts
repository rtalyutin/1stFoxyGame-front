import { WorldView } from './presentation/world';
import { RunSimulation } from './game/simulation';
const world=new WorldView(document.querySelector<HTMLCanvasElement>('#game')!);
await world.loadAssets();await world.scene.whenReadyAsync();
let side=4.5,near=false,sim:RunSimulation;
function reset(x:number):void {
 side=x;sim=new RunSimulation('shop-local-review',42,{config:{spawning:false}});
 sim.state.hero={x:near?side:0,z:near?134:120};sim.state.distance=sim.state.hero.z;
 sim.state.time=sim.state.hero.z/2;sim.state.shopCandidates=[{id:'review',at:50,x:side,z:136}];
}
document.querySelector('#left')!.addEventListener('click',()=>reset(-4.5));
document.querySelector('#right')!.addEventListener('click',()=>reset(4.5));
document.querySelector('#near')!.addEventListener('click',()=>{near=!near;reset(side)});
document.querySelector('#open')!.addEventListener('click',()=>sim.enterShop('review'));
document.querySelector('#leave')!.addEventListener('click',()=>{if(sim.leaveShop())sim.resume()});
reset(side);
world.engine.runRenderLoop(()=>{
 world.render(sim,{x:0,z:sim.state.hero.z+20},0);
 document.querySelector('#status')!.textContent=`Локальный визуальный сценарий · ${sim.state.phase} · ${sim.state.hero.z}м · вход ${sim.canEnterShop?'доступен':'недоступен'} · ${world.engine.getFps().toFixed(0)}FPS · ${world.scene.isReady()?'Материалы готовы':'Загрузка'}`;
});
