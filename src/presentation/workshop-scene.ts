import {Engine} from '@babylonjs/core/Engines/engine';
import {Scene} from '@babylonjs/core/scene';
import {FreeCamera} from '@babylonjs/core/Cameras/freeCamera';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Viewport} from '@babylonjs/core/Maths/math.viewport';
import {Color3,Color4} from '@babylonjs/core/Maths/math.color';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import type {AssetContainer,InstantiatedEntries} from '@babylonjs/core/assetContainer';
import type {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {PRODUCTION_IDS,type ProductionId,type WorkshopView} from '../platform/workshop';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import {assetBytes} from './asset-bytes';

/** One existing native device per productionId, regardless of economic owned. */
export class WorkshopPresentation {
  readonly root:TransformNode;
  readonly nodes=new Map<string,TransformNode>();
  readonly groups=new Map<string,AnimationGroup>();
  private samples=new Map<string,number>();
  private working=new Map<ProductionId,boolean>();
  private receipts:string[]=[];
  private strikeAt=-Infinity;
  private apprentice:TransformNode|null=null;
  private merchant:TransformNode|null=null;
  private merchantYaw=0;
  seconds=0;
  confirmedStrikes=0;
  view:WorkshopView|null=null;
  constructor(readonly entries:InstantiatedEntries,scene:Scene,private reducedMotion=false){
    this.root=new TransformNode('workshop-actor',scene);
    for(const root of entries.rootNodes){
      root.parent=this.root;
      for(const node of [root,...root.getDescendants()])if(node instanceof TransformNode)this.nodes.set(node.name.slice('workshop:'.length),node);
    }
    for(const group of entries.animationGroups)this.groups.set(group.name.slice('workshop:'.length),group);
    for(const id of PRODUCTION_IDS){
      const node=this.nodes.get(id+'_root');if(!node)throw new Error('Missing workshop device '+id);
      for(const mesh of node.getChildMeshes())mesh.metadata={productionId:id};
      for(const clip of [id+'_production_idle',id+'_production_work'])if(!this.groups.has(clip))throw new Error('Missing workshop clip '+clip);
    }
    const tap=this.nodes.get('forge_tap_root');if(!tap||!this.groups.has('forge_strike'))throw new Error('Missing native forge');
    for(const mesh of tap.getChildMeshes())mesh.metadata={forgeTap:true};
    for(const socket of ['socket_forge_strike','socket_forge_feedback','socket_preview_hero'])if(!this.nodes.has(socket))throw new Error('Missing '+socket);
    for(let level=0;level<4;level++)for(const prefix of ['tap_tier_','organization_tier_'])if(!this.nodes.has(prefix+level))throw new Error('Missing '+prefix+level);
    this.merchant=this.nodes.get('RF_Shop_Merchant')??null;
    if(this.merchant){
      this.merchantYaw=this.merchant.rotationQuaternion?.toEulerAngles().y??this.merchant.rotation.y;
      this.merchant.rotationQuaternion=null;
      // Reuse the approved merchant geometry once as the apprentice. Owned is
      // economic data; it never allocates a character for each purchased unit.
      this.apprentice=this.merchant.clone('workshop-apprentice',this.root);
      if(this.apprentice){this.apprentice.position.set(-3,.024,0);this.apprentice.scaling.scaleInPlace(.78);this.apprentice.rotationQuaternion=null;}
    }
    this.update(null);
  }
  update(view:WorkshopView|null):void{
    this.view=view;
    for(let level=0;level<4;level++){
      this.nodes.get('tap_tier_'+level)!.setEnabled(level===(view?.tapLevel??0));
      this.nodes.get('organization_tier_'+level)!.setEnabled(level===(view?.organizationLevel??0));
    }
    for(const id of PRODUCTION_IDS){
      const device=view?.productions.find(p=>p.id===id);
      const working=Boolean(device&&device.owned>0&&BigInt(device.rateGoldMilliPerSecond)>0n);
      for(const mesh of this.nodes.get(id+'_root')!.getChildMeshes())mesh.visibility=working?1:.42;
      if(this.working.get(id)!==working){
        for(const mode of ['idle','work']){this.groups.get(id+'_production_'+mode)!.stop();this.samples.delete(id+'_production_'+mode);}
        this.sample(id+'_production_work',0,false);
        this.working.set(id,working);
      }
    }
  }
  confirmTap(operationId:string):boolean{
    if(this.receipts.includes(operationId))return false;
    this.receipts.push(operationId);if(this.receipts.length>128)this.receipts.shift();
    this.confirmedStrikes++;this.strikeAt=this.seconds;return true;
  }
  private sample(name:string,seconds:number,loop=true):void{
    const group=this.groups.get(name)!;const fps=group.targetedAnimations[0].animation.framePerSecond;
    const duration=(group.to-group.from)/fps;
    const frame=group.from+(loop&&duration>0?seconds%duration:Math.min(seconds,duration))*fps;
    if(this.samples.get(name)===frame)return;
    if(!group.isStarted){group.start(false);group.pause();}
    group.goToFrame(frame);this.samples.set(name,frame);
  }
  render(delta:number):void{
    this.seconds+=Math.min(Math.max(delta,0),.1);
    if(this.merchant)this.merchant.rotation.y=this.merchantYaw+(this.reducedMotion?0:Math.sin(this.seconds*.6)*.035);
    if(this.apprentice){
      const working=this.working.get('apprentice');
      for(const mesh of this.apprentice.getChildMeshes(false))mesh.visibility=working?1:.42;
      if('visibility' in this.apprentice)(this.apprentice as TransformNode & {visibility:number}).visibility=working?1:.42;
      this.apprentice.rotation.y=this.merchantYaw+(working&&!this.reducedMotion?Math.sin(this.seconds*2.4)*.1:0);
    }
    for(const id of PRODUCTION_IDS)this.sample(id+'_production_'+(this.working.get(id)?'work':'idle'),this.reducedMotion?0:this.seconds);
    const elapsed=this.seconds-this.strikeAt,group=this.groups.get('forge_strike')!,fps=group.targetedAnimations[0].animation.framePerSecond,duration=(group.to-group.from)/fps;
    this.sample('forge_strike',this.reducedMotion||elapsed>=duration?0:Math.max(0,elapsed),false);
  }
  dispose():void{this.apprentice?.dispose();this.entries.dispose();this.root.dispose();}
}

export class WorkshopScene {
  readonly engine:Engine;
  readonly scene:Scene;
  readonly camera:FreeCamera;
  presentation:WorkshopPresentation|null=null;
  private container:AssetContainer|null=null;
  private pending:Promise<void>|null=null;
  private resize:ResizeObserver;
  private contextHealthy=true;
  private disposed=false;
  private view:WorkshopView|null=null;
  private pointer:{id:number;x:number;y:number;dragged:boolean;productionId?:ProductionId;tap?:boolean}|null=null;
  active=false;
  error='';
  get ready():boolean{return Boolean(this.presentation)&&this.contextHealthy;}
  constructor(private canvas:HTMLCanvasElement,private choose:(id:ProductionId)=>void,private tap:()=>void,private changed:()=>void){
    if(import.meta.env.DEV&&new URLSearchParams(location.search).has('probe-qa'))Object.assign(window,{runnerWorkshopProbe:this});
    this.engine=new Engine(canvas,true,{stencil:true},true);this.engine.setHardwareScalingLevel(1/Math.min(devicePixelRatio||1,1.65));
    this.scene=new Scene(this.engine);this.scene.useRightHandedSystem=true;this.scene.clearColor=Color4.FromHexString('#263331ff');
    this.camera=new FreeCamera('workshop-camera',new Vector3(5.1,4.9,10.6),this.scene);this.camera.minZ=.1;this.camera.maxZ=60;
    const sky=new HemisphericLight('workshop-sky',new Vector3(0,1,0),this.scene);sky.intensity=.7;sky.groundColor=new Color3(.18,.13,.08);
    const light=new DirectionalLight('workshop-key',new Vector3(-.3,-1,-.4),this.scene);light.intensity=1.1;light.diffuse=new Color3(1,.88,.7);
    this.resize=new ResizeObserver(()=>{this.engine.resize();this.cameraFrame();});this.resize.observe(canvas);
    for(const [type,handler]of [['pointerdown',this.down],['pointermove',this.move],['pointerup',this.up],['pointercancel',this.cancel],['webglcontextlost',this.lost],['webglcontextrestored',this.restored]] as const)canvas.addEventListener(type,handler as EventListener);
  }
  setActive(active:boolean):void{
    if(this.active===active)return;this.active=active;this.canvas.hidden=!active;this.cancel();
    if(active)void this.load().catch(()=>{}).finally(()=>this.changed());
  }
  update(view:WorkshopView|null):void{this.view=view;this.presentation?.update(view);}
  async load():Promise<void>{
    if(this.presentation)return;if(this.pending)return this.pending;
    this.pending=(async()=>{
      try{
        const container=await LoadAssetContainerAsync(await assetBytes('models/runner-3d/workshop-r5.glb'),this.scene,{pluginExtension:'.glb',pluginOptions:{gltf:{animationStartMode:0}}});
        if(this.disposed){container.dispose();return;}this.container=container;
        this.presentation=new WorkshopPresentation(container.instantiateModelsToScene(n=>'workshop:'+n,false),this.scene,matchMedia('(prefers-reduced-motion: reduce)').matches);
        this.presentation.update(this.view);this.cameraFrame();this.error='';
      }catch(error){this.presentation?.dispose();this.presentation=null;this.container?.dispose();this.container=null;this.error='Не удалось открыть 3D-мастерскую. Имущество сохранено; можно вернуться назад.';throw error;}
    })();try{await this.pending;}finally{this.pending=null;}
  }
  confirmTap(operationId:string):void{this.presentation?.confirmTap(operationId);}
  renderFrame(delta:number):boolean{
    if(!this.active||!this.ready)return false;if(!document.hidden){this.presentation!.render(delta);this.scene.render();}return true;
  }
  private cameraFrame():void{
    if(this.canvas.clientWidth<800){this.camera.viewport=new Viewport(0,0,1,1);this.camera.position.set(1.2,4.7,10.8);this.camera.fov=1.1114;this.camera.setTarget(new Vector3(0,1.15,.2));}
    else{this.camera.viewport=new Viewport(0,0,.71,1);this.camera.position.set(3.7,4.9,11.8);this.camera.fov=.63;this.camera.setTarget(new Vector3(0,1.2,-.2));}
  }
  private down=(e:PointerEvent):void=>{
    if(!this.active||!this.ready||this.pointer||e.button!==0)return;e.preventDefault();e.stopPropagation();
    const rect=this.canvas.getBoundingClientRect(),hit=this.scene.pick(e.clientX-rect.left,e.clientY-rect.top,m=>m.isEnabled()&&m.isVisible);
    this.pointer={id:e.pointerId,x:e.clientX,y:e.clientY,dragged:false,productionId:hit?.pickedMesh?.metadata?.productionId,tap:hit?.pickedMesh?.metadata?.forgeTap};
    this.canvas.setPointerCapture(e.pointerId);
  };
  private move=(e:PointerEvent):void=>{if(this.pointer?.id===e.pointerId)this.pointer.dragged||=Math.hypot(e.clientX-this.pointer.x,e.clientY-this.pointer.y)>8;};
  private up=(e:PointerEvent):void=>{
    const p=this.pointer;if(!p||p.id!==e.pointerId)return;this.cancel();if(this.canvas.hasPointerCapture(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);
    if(!p.dragged){if(p.tap)this.tap();else if(p.productionId)this.choose(p.productionId);}
  };
  private cancel=():void=>{this.pointer=null;};
  private lost=(e:Event):void=>{e.preventDefault();this.contextHealthy=false;this.cancel();this.error='Графика временно недоступна. Имущество сохранено; можно вернуться назад.';this.changed();};
  private restored=():void=>{this.contextHealthy=true;this.error='';this.changed();};
  dispose():void{
    this.disposed=true;this.resize.disconnect();
    for(const [type,handler]of [['pointerdown',this.down],['pointermove',this.move],['pointerup',this.up],['pointercancel',this.cancel],['webglcontextlost',this.lost],['webglcontextrestored',this.restored]] as const)this.canvas.removeEventListener(type,handler as EventListener);
    this.presentation?.dispose();this.container?.dispose();this.scene.dispose();this.engine.dispose();
  }
}
