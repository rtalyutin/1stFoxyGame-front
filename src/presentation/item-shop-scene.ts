import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer';
import type { ItemDefinitionId } from '../game/equipment';
import { APPEARANCES, applyAppearance, findAppearance, type AppearanceKey, type AppearanceLoadout } from './appearance';
import { importModel, ModelActor } from './models';
import {SUPPLIES,isSupply,type ShopGraphicId,type ShopGraphicKey} from './supplies';
import '@babylonjs/core/Rendering/outlineRenderer';
import {assetBytes} from './asset-bytes';

export interface DisplayItem extends ShopGraphicKey { instanceId?:string; }
const SHELVES:[number,number,number][]=[[-2.6,1,-.55],[.5,1.1,-.75],[-1.1,1.2,-1.9],[1.1,.93,1.65]];
const OWNED_STANDS:[number,number,number][]=[[-.05,.6975,3.1],[1.05,.6975,3.1],[2.15,.6975,3.1]];
const keyOf=(key:ShopGraphicKey)=>key.definitionId+':'+key.level;
const displayPath=(key:ShopGraphicKey)=>isSupply(key.definitionId)?SUPPLIES[key.definitionId].path:findAppearance(key as AppearanceKey)?.displayPath;

/** Lazily loaded presentation only. No operation or combat clock is owned here. */
export class ItemShopScene {
  private engine:Engine;
  private scene:Scene;
  private camera:FreeCamera;
  private hero:ModelActor|null=null;
  private containers=new Map<string,AssetContainer>();
  private pendingModels=new Map<string,Promise<AssetContainer>>();
  private entries:InstantiatedEntries[]=[];
  private displays=new Map<string,TransformNode>();
  private displayEntries:InstantiatedEntries[]=[];
  private catalogKey='';
  private inventoryDisplays=new Map<string,{root:TransformNode;entries:InstantiatedEntries}>();
  private inventoryKey='';
  private inspector:TransformNode|null=null;
  private inspectorEntries:InstantiatedEntries|null=null;
  private currentKey='';
  private loadPromise:Promise<void>|null=null;
  private seconds=0;
  private merchant:TransformNode|null=null;
  private merchantYaw=0;
  private confirmedOperations=new Set<string>();
  private craftPulseUntil=0;
  private ownedStands:TransformNode[]=[];
  private disposed=false;
  private pointer:{id:number;x:number;y:number;lastX:number;dragged:boolean;inspection:boolean;definitionId?:ShopGraphicId;instanceId?:string}|null=null;
  private resize:ResizeObserver;
  ready=false;
  error='';
  active=false;

  constructor(private canvas:HTMLCanvasElement,private choose:(id:ShopGraphicId,instanceId?:string)=>void,private changed:()=>void=()=>{}) {
    if(import.meta.env.DEV&&new URLSearchParams(location.search).has('probe-qa'))Object.assign(window,{runnerShopProbe:this});
    this.engine=new Engine(canvas,true,{stencil:true},true);
    this.engine.setHardwareScalingLevel(1/Math.min(window.devicePixelRatio||1,1.65));
    this.scene=new Scene(this.engine);this.scene.useRightHandedSystem=true;
    this.scene.clearColor=Color4.FromHexString('#263331ff');
    this.camera=new FreeCamera('item-shop-camera',new Vector3(5.1,4.9,10.6),this.scene);this.camera.minZ=.1;this.camera.maxZ=60;
    const ambient=new HemisphericLight('item-shop-sky',new Vector3(0,1,0),this.scene);ambient.intensity=.7;ambient.groundColor=new Color3(.18,.13,.08);
    const sun=new DirectionalLight('item-shop-key',new Vector3(-.3,-1,-.4),this.scene);sun.intensity=1.1;sun.diffuse=new Color3(1,.88,.7);
    this.resize=new ResizeObserver(()=>{this.engine.resize();this.configureCamera();});this.resize.observe(canvas);
    canvas.addEventListener('pointerdown',this.down);canvas.addEventListener('pointermove',this.move);
    canvas.addEventListener('pointerup',this.up);canvas.addEventListener('pointercancel',this.cancel);
    canvas.addEventListener('webglcontextlost',this.contextLost);canvas.addEventListener('webglcontextrestored',this.contextRestored);
    canvas.style.touchAction='none';
  }

  appearanceReady(key:ShopGraphicKey|null):boolean{return this.ready&&(!key||this.containers.has(keyOf(key)));}
  async load():Promise<void>{
    if(this.ready)return;if(this.loadPromise)return this.loadPromise;
    this.loadPromise=this.install();try{await this.loadPromise;}finally{this.loadPromise=null;}
  }
  private async bytes(path:string):Promise<Uint8Array>{
    return assetBytes(path);
  }
  private async install():Promise<void>{
    this.error='';const loaded:AssetContainer[]=[];
    try{
      const hero=await importModel('pudge',await this.bytes('models/runner-3d/pudge-equipment.glb'),this.scene);loaded.push(hero);
      const nodes=new Set([...hero.transformNodes,...hero.meshes].map(n=>n.name));
      for(const a of APPEARANCES)for(const part of a.parts)if(!nodes.has(part))throw new Error('Missing wearing mesh '+part);
      for(const socket of ['socket_foot_l','socket_foot_r','socket_cuff_l','socket_cuff_r','socket_talisman'])if(!nodes.has(socket))throw new Error('Missing attachment '+socket);
      const heroEntries=hero.instantiateModelsToScene(n=>'shop-hero:'+n,false,{doNotInstantiate:true});
      this.hero=new ModelActor(heroEntries,'shop-hero',this.scene);this.hero.root.position.set(-1.15,.024,1.45);this.containers.set('hero',hero);
      applyAppearance(this.hero,{weapon:null,body:null,legs:null,talisman:null});
      const shell=await LoadAssetContainerAsync(await this.bytes('models/runner-3d/shop-interior-probe.glb'),this.scene,{pluginExtension:'.glb'});loaded.push(shell);
      if(this.disposed){for(const container of loaded)container.dispose();return;}
      const entry=shell.instantiateModelsToScene(n=>'shop-shell:'+n,false);this.entries.push(entry);this.containers.set('shell',shell);
      for(const mesh of entry.rootNodes.flatMap(n=>n.getChildMeshes()))mesh.isPickable=false;
      this.merchant=entry.rootNodes.flatMap(n=>[n,...n.getDescendants()]).find(n=>n.name==='shop-shell:RF_Shop_Merchant') as TransformNode??null;
      if(this.merchant){this.merchantYaw=this.merchant.rotationQuaternion?.toEulerAngles().y??this.merchant.rotation.y;this.merchant.rotationQuaternion=null;}
      const standParts=entry.rootNodes.flatMap(n=>n.getChildMeshes()).filter(n=>n.name.startsWith('shop-shell:inspection_stand_'));
      for(const [index,target]of OWNED_STANDS.entries()){
        const root=new TransformNode('owned-stand-'+index,this.scene);root.scaling.setAll(.75);root.position.set(target[0]-1.1*.75,0,target[2]-1.65*.75);
        for(const part of standParts){const clone=part.clone('owned-stand-'+index+':'+part.name,root);if(clone)clone.isPickable=false;}
        root.setEnabled(false);this.ownedStands.push(root);
      }
      this.ready=true;this.configureCamera();
    }catch(error){
      this.hero?.dispose();this.hero=null;for(const entry of this.entries)entry.dispose();this.entries=[];
      for(const container of loaded)container.dispose();this.containers.clear();
      this.error='Не удалось открыть витрину. Забег сохранён; можно выйти и повторить вход.';
      throw error;
    }
  }
  private ensureModel(key:ShopGraphicKey):void{
    const id=keyOf(key),path=displayPath(key);
    if(!path||this.containers.has(id)||this.pendingModels.has(id)||this.disposed)return;
    const pending=(async()=>{
      const container=await LoadAssetContainerAsync(await this.bytes(path),this.scene,{pluginExtension:'.glb'});
      if(this.disposed){container.dispose();return container;}
      this.containers.set(id,container);return container;
    })();
    this.pendingModels.set(id,pending);
    void pending.then(()=>{if(!this.disposed){this.error='';this.changed();}}).catch(()=>{
      if(!this.disposed){this.error='Модель вещи пока недоступна. Имущество сохранено; можно выбрать другую вещь или выйти.';this.changed();}
    }).finally(()=>this.pendingModels.delete(id));
  }
  private display(key:ShopGraphicKey,name:string,target:[number,number,number],metadata:Record<string,unknown>):{root:TransformNode;entries:InstantiatedEntries}|null{
    const container=this.containers.get(keyOf(key));if(!container)return null;
    const entries=container.instantiateModelsToScene(n=>name+':'+n,false),root=new TransformNode(name,this.scene);
    for(const node of entries.rootNodes)node.parent=root;
    for(const mesh of root.getChildMeshes())mesh.computeWorldMatrix(true);
    const bounds=root.getHierarchyBoundingVectors(),size=bounds.max.subtract(bounds.min);
    const scale=Math.min(1,.82/Math.max(size.x,.001),.52/Math.max(size.y,.001),.72/Math.max(size.z,.001));
    root.scaling.setAll(scale);
    root.position.set(target[0]-(bounds.min.x+bounds.max.x)*.5*scale,target[1]-bounds.min.y*scale,target[2]-(bounds.min.z+bounds.max.z)*.5*scale);
    for(const mesh of root.getChildMeshes()){mesh.isPickable=true;mesh.metadata=metadata;}
    return{root,entries};
  }

  show(key:ShopGraphicKey|null,loadout:AppearanceLoadout,visible:readonly DisplayItem[]):void{
    if(!this.ready||!this.hero)return;
    applyAppearance(this.hero,loadout);
    for(const item of visible)this.ensureModel(item);if(key)this.ensureModel(key);
    const catalog=visible.filter(i=>!i.instanceId),catalogKey=JSON.stringify([catalog,key?.definitionId,catalog.map(i=>this.containers.has(keyOf(i)))]);
    if(catalogKey!==this.catalogKey){
      this.catalogKey=catalogKey;for(const e of this.displayEntries)e.dispose();this.displayEntries=[];
      for(const root of this.displays.values())root.dispose();this.displays.clear();
      const shelves=key?catalog.filter(i=>i.definitionId!==key.definitionId):catalog;
      for(const [index,item]of shelves.entries()){
        const position=key?SHELVES[index%4]:[SHELVES[3],...SHELVES.slice(0,3)][index%4];
        const display=this.display(item,'shelf-'+item.definitionId,position,{definitionId:item.definitionId,inspection:false});
        if(display){this.displays.set(item.definitionId,display.root);this.displayEntries.push(display.entries);}
      }
    }
    const owned=visible.filter(i=>i.instanceId),inventoryKey=JSON.stringify([owned,owned.map(i=>this.containers.has(keyOf(i)))]);
    this.ownedStands.forEach((stand,index)=>stand.setEnabled(index<owned.length));
    if(inventoryKey!==this.inventoryKey){
      this.inventoryKey=inventoryKey;
      for(const display of this.inventoryDisplays.values()){display.entries.dispose();display.root.dispose();}this.inventoryDisplays.clear();
      for(const [index,item]of owned.entries()){
        const display=this.display(item,'owned-'+item.instanceId,OWNED_STANDS[index%3],{definitionId:item.definitionId,instanceId:item.instanceId,inspection:false});
        if(display)this.inventoryDisplays.set(item.instanceId!,display);
      }
    }
    const id=key&&displayPath(key)?keyOf(key):'';
    if(id===this.currentKey)return;
    this.inspectorEntries?.dispose();this.inspector?.dispose();this.inspectorEntries=null;this.inspector=null;this.currentKey='';
    if(!id||!key)return;
    const display=this.display(key,'inspection-item',[1.1,.93,1.65],{definitionId:key.definitionId,inspection:true});
    if(display){this.inspectorEntries=display.entries;this.inspector=display.root;this.currentKey=id;}
  }
  private configureCamera():void{
    if(this.canvas.clientWidth<800){this.camera.position.set(2.25,3.7,7.3);this.camera.fov=1.1114;this.camera.setTarget(new Vector3(-.35,1.15,1));}
    else{this.camera.position.set(5.1,4.9,10.6);this.camera.fov=.52343;this.camera.setTarget(new Vector3(0,1.4,-.2));}
  }
  private down=(e:PointerEvent):void=>{
    if(!this.active||!this.ready||e.button!==0||this.pointer)return;e.preventDefault();e.stopPropagation();
    const rect=this.canvas.getBoundingClientRect(),hit=this.scene.pick(e.clientX-rect.left,e.clientY-rect.top,m=>m.isEnabled()&&m.isVisible);
    const meta=hit?.pickedMesh?.metadata;
    this.pointer={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,dragged:false,inspection:Boolean(meta?.inspection),definitionId:meta?.definitionId,instanceId:meta?.instanceId};
    this.canvas.setPointerCapture(e.pointerId);
  };
  private move=(e:PointerEvent):void=>{
    const p=this.pointer;if(!p||p.id!==e.pointerId)return;e.preventDefault();
    p.dragged||=Math.hypot(e.clientX-p.x,e.clientY-p.y)>8;
    if(p.dragged&&p.inspection&&this.inspector)this.inspector.rotation.y+=(e.clientX-p.lastX)*.012;p.lastX=e.clientX;
  };
  private up=(e:PointerEvent):void=>{
    const p=this.pointer;if(!p||p.id!==e.pointerId)return;this.cancel();
    if(this.canvas.hasPointerCapture(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);
    if(!p.dragged&&!p.inspection&&p.definitionId)this.choose(p.definitionId,p.instanceId);
  };
  private cancel=(e?:PointerEvent):void=>{if(!e||e.pointerId===this.pointer?.id)this.pointer=null;};
  private contextLost=(e:Event):void=>{e.preventDefault();this.ready=false;this.cancel();this.error='Графика временно недоступна. Забег сохранён; можно выйти.';this.changed();};
  private contextRestored=():void=>{this.ready=Boolean(this.hero&&this.containers.has('shell'));this.error='';this.changed();};
  render(delta:number):void{
    if(!this.active||!this.ready||document.hidden)return;
    this.seconds+=Math.min(delta,.1);this.hero?.pose('idle',this.seconds);
    if(this.merchant)this.merchant.rotation.y=this.merchantYaw+(this.currentKey?-.13:Math.sin(this.seconds*.6)*.035);
    for(const mesh of this.inspector?.getChildMeshes()??[]){mesh.renderOutline=this.seconds<this.craftPulseUntil;mesh.outlineColor=Color3.FromHexString('#ffcb65');mesh.outlineWidth=.012;}
    this.scene.render();
  }
  confirmOperation(id:string):void{if(this.confirmedOperations.has(id))return;this.confirmedOperations.add(id);if(this.confirmedOperations.size>128)this.confirmedOperations.delete(this.confirmedOperations.values().next().value!);this.craftPulseUntil=this.seconds+.8;}
  leave():void{this.active=false;this.cancel();}
  dispose():void{
    this.disposed=true;this.resize.disconnect();
    this.canvas.removeEventListener('pointerdown',this.down);this.canvas.removeEventListener('pointermove',this.move);this.canvas.removeEventListener('pointerup',this.up);this.canvas.removeEventListener('pointercancel',this.cancel);
    this.canvas.removeEventListener('webglcontextlost',this.contextLost);this.canvas.removeEventListener('webglcontextrestored',this.contextRestored);
    this.hero?.dispose();this.inspectorEntries?.dispose();this.inspector?.dispose();
    for(const d of this.inventoryDisplays.values()){d.entries.dispose();d.root.dispose();}
    for(const e of [...this.entries,...this.displayEntries])e.dispose();for(const d of this.displays.values())d.dispose();
    for(const c of this.containers.values())c.dispose();this.containers.clear();this.pendingModels.clear();
    this.scene.dispose();this.engine.dispose();
  }
}
