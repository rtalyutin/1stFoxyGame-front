import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/core/Rendering/edgesRenderer';
import '@babylonjs/core/Culling/ray';
import { RULES, rulesFor, type Snapshot, type Target, type Material, type Cell } from './contracts';
import { worldPosition, targetAt, canTake, canPlace, initialBlocks, canPickActor, canPutActor } from './core';

export type ViewMode='take'|'place'|'item';
export type ItemTarget={actorKey:string}|{cell:Target;heldActorKey:string};
type RenderActor=NonNullable<Snapshot['actors']>[number];
export class GameView {
  engine: Engine; scene: Scene; camera: FreeCamera;
  private meshes = new Map<string, Mesh>();
  private mats: Record<string,StandardMaterial> = {};
  private character: TransformNode; private legs: Mesh[] = [];
  private chassis: TransformNode; private pistons: Mesh[] = [];private feet:Mesh[]=[];
  private heart: Mesh; private ghost: Mesh; private hint: Mesh; private portal: TransformNode; private gapDepth!: Mesh;
  private state?: Snapshot;
  private follow = 10;
  private actors=new Map<string,{node:TransformNode;glow:StandardMaterial}>();
  private lava!:Mesh;private lavaEdge!:Mesh;private actorGhost!:Mesh;private routeDecorations:Mesh[]=[];
  private gapBeds=new Map<number,Mesh>();private contentKey='';
  drawCallsLastFrame = 0;
  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true,antialias:true});
    this.engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 1.5));
    this.scene=new Scene(this.engine);
    // Game pointer roles are handled by the UI, without a second input manager.
    this.scene.detachControl();
    this.scene.clearColor=new Color4(.56,.77,.77,1);
    this.scene.ambientColor=new Color3(.4,.4,.4);
    this.camera=new FreeCamera('camera',new Vector3(10,8,-24),this.scene);
    this.camera.mode=Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.setTarget(new Vector3(10,3,0));
    const hemi=new HemisphericLight('sky',new Vector3(0,1,-.5),this.scene);hemi.intensity=1.15;
    const sun=new DirectionalLight('sun',new Vector3(-.4,-1,.4),this.scene);sun.intensity=.55;
    const palette: Record<string,string>={wood:'#c78e53',newWood:'#d4a366',ground:'#72996c',earth:'#536e5f',rock:'#557b77',trunk:'#758f6c',leaf:'#86ad79',metal:'#365a64',piston:'#a2b9af',heart:'#f88b63',skin:'#e6b889',shirt:'#294a64',boots:'#243c4c',pack:'#b7df78',portal:'#b892f4',portalDark:'#675285',ghost:'#bce97d',guide:'#bce97d',sky:'#b2cfbe',stone:'#9baebc',newStone:'#bccad0',slime:'#89cf5b',newSlime:'#b0ed80',lava:'#ed733b',lavaEdge:'#ffc060',burn:'#f47b39',cat:'#e6ae61',catEye:'#384452',chest:'#a77345',gold:'#efc460',mob:'#7d9e56',mobFace:'#203c31'};
    for(const [key,color] of Object.entries(palette)){const m=new StandardMaterial(key,this.scene);m.diffuseColor=Color3.FromHexString(color);m.specularColor=new Color3(.05,.05,.05);this.mats[key]=m;}
    this.mats.heart.emissiveColor=Color3.FromHexString('#723c1c');
    this.mats.lava.emissiveColor=Color3.FromHexString('#813217');this.mats.lava.alpha=.75;this.mats.lavaEdge.emissiveColor=Color3.FromHexString('#ff9d39');this.mats.lavaEdge.alpha=.8;
    this.mats.burn.emissiveColor=Color3.FromHexString('#aa3211');
    this.mats.portal.emissiveColor=Color3.FromHexString('#513b78');
    this.mats.ghost.alpha=.27;this.mats.ghost.disableDepthWrite=true;
    this.chassis=new TransformNode('house-decoration',this.scene);
    this.box('chassis',6,.25,.75,3,-.62,-.25,'metal',this.chassis);
    for(let i=0;i<4;i++){
      const p=this.box('piston-'+i,.28,.78,.3,1+i*1.65,-1.1,-.75,'piston',this.chassis);this.pistons.push(p);
      this.feet.push(this.box('foot-'+i,.62,.12,.7,1+i*1.65,-1.45,-1.15,'metal',this.chassis));
    }
    // Heart lives behind the playable cutaway; it does not hide selectable cells.
    this.heart=this.box('heart',.58,.58,.5,3,1.1,.75,'heart',this.chassis);
    this.character=new TransformNode('player',this.scene);
    this.box('body',.48,.53,.38,0,.66,-.82,'shirt',this.character);
    this.box('head',.45,.45,.45,0,1.18,-.82,'skin',this.character);
    this.box('hair',.46,.12,.46,0,1.39,-.82,'boots',this.character);
    this.box('backpack',.32,.42,.2,-.04,.7,-.57,'pack',this.character);
    for(const x of [-.14,.14])this.legs.push(this.box('leg',.2,.35,.29,x,.2,-.83,'boots',this.character));
    this.box('eye',.07,.07,.025,.12,1.2,-1.06,'boots',this.character);
    this.box('eye',.07,.07,.025,-.12,1.2,-1.06,'boots',this.character);
    this.ghost=this.box('target',1.02,1.02,1.34,0,0,0,'ghost');
    this.ghost.enableEdgesRendering();this.ghost.edgesWidth=3;this.ghost.edgesColor=new Color4(.7,1,.4,1);this.ghost.setEnabled(false);
    this.hint=this.box('tutorial-target',1.06,1.06,1.4,0,0,0,'guide');this.hint.enableEdgesRendering();this.hint.edgesWidth=4;this.mats.guide.alpha=.15;this.mats.guide.disableDepthWrite=true;this.hint.setEnabled(false);
    this.actorGhost=this.box('item-preview',.8,.8,.65,0,0,0,'ghost');this.actorGhost.enableEdgesRendering();this.actorGhost.edgesWidth=3;this.actorGhost.setEnabled(false);
    this.lava=this.box('lava-boundary',1,8,1,0,3.5,2,'lava');this.lavaEdge=this.box('lava-edge',.16,8.5,.12,0,3.6,-1.4,'lavaEdge');this.lava.setEnabled(false);this.lavaEdge.setEnabled(false);
    this.portal=new TransformNode('portal-decoration',this.scene);this.decorate();this.resize();
  }
  private box(name:string,w:number,h:number,d:number,x:number,y:number,z:number,mat:string,parent?:TransformNode):Mesh{
    const m=CreateBox(name,{width:w,height:h,depth:d},this.scene);m.position.set(x,y,z);m.material=this.mats[mat];m.isPickable=false;if(['distant-rock','distant-crown','tree','leaves'].includes(name))this.routeDecorations.push(m);if(parent)m.parent=parent;return m;
  }
  private decorate(){
    for(let x=-12;x<164;x+=4){
      if(x>10&&x<20)continue;
      const height=1.8+Math.abs(Math.sin(x*13))*3;
      this.box('distant-rock',6,height,3,x,height/2-.2,9,'rock');
      this.box('distant-crown',4,.45,3.2,x,height-.1,9,'trunk');
    }
    for(const x of [-6,21,33,53,77,99,127]){
      this.box('tree',.55,2.7,.55,x,1.2,5,'trunk');
      this.box('leaves',2.3,1.4,1.9,x,3,5,'leaf');
      this.box('leaves',1.6,1.1,1.5,x+.2,3.9,5,'leaf');
    }
    this.box('portal-frame',.65,5,1,1,2.2,1,'portalDark',this.portal);
    this.box('portal-frame',.65,5,1,-1,2.2,1,'portalDark',this.portal);
    this.box('portal-frame',2.7,.65,1,0,4.7,1,'portalDark',this.portal);
    const glow=this.box('portal',1.5,4,.12,0,2.2,1,'portal',this.portal);(glow.material as StandardMaterial).alpha=.65;
    this.box('far-ground',170,.7,7,66,-.7,6,'earth');
    // Dark bed of the gap makes the missing road legible.
    this.gapDepth=this.box('gap-depth',5.1,1.4,3,14,-2.8,0,'metal');
  }
  private syncRoute(s:Snapshot){
    if(this.contentKey===s.contentVersion)return;this.contentKey=s.contentVersion;
    for(const bed of this.gapBeds.values())bed.dispose();this.gapBeds.clear();
    if(s.contentVersion!=='r2-map-1'){this.gapDepth.setEnabled(true);return;}
    this.gapDepth.setEnabled(false);
    const terrain=new Set(initialBlocks(s.contentVersion).filter(b=>b.space==='world'&&b.y===0&&!b.portable).map(b=>b.x)),end=rulesFor(s).portalX+5;
    for(let x=0;x<end;x++)if(!terrain.has(x)){const bed=this.box('gap-bed',1,1.4,3,x,-2.8,0,'metal');this.gapBeds.set(x,bed);}
  }
  private createActor(actor:RenderActor){
    const node=new TransformNode(actor.actorKey,this.scene),kind=actor.kind;
    const box=(name:string,w:number,h:number,d:number,x:number,y:number,z:number,mat:string)=>{const mesh=this.box(name,w,h,d,x,y,z,mat,node);mesh.isPickable=kind!=='mob';mesh.metadata={actorKey:actor.actorKey};return mesh;};
    let body:Mesh;
    if(kind==='cat'){
      body=box('cat-body',.55,.32,.35,0,.2,-.78,'cat');box('cat-head',.3,.3,.32,.25,.41,-.78,'cat');
      box('cat-ear',.1,.14,.1,.16,.62,-.78,'cat');box('cat-ear',.1,.14,.1,.34,.62,-.78,'cat');
      for(const x of[-.2,.2])box('cat-feet',.08,.15,.2,x,.07,-.78,'catEye');
      box('cat-tail',.12,.4,.12,-.32,.37,-.76,'cat');for(const x of[.2,.33])box('cat-eye',.045,.045,.025,x,.46,-.955,'catEye');
    }else if(kind==='chest'){
      body=box('chest-box',.7,.5,.5,0,.25,-.78,'chest');box('chest-lid',.76,.14,.55,0,.53,-.78,'chest');
      for(const x of[-.24,.24])box('chest-band',.055,.58,.56,x,.31,-.78,'gold');box('chest-lock',.12,.15,.035,0,.34,-1.065,'gold');
    }else{
      body=box('mob-body',.55,.67,.42,0,.58,-.76,'mob');box('mob-head',.62,.57,.5,0,1.19,-.76,'mob');
      for(const x of[-.19,.19])box('mob-leg',.2,.29,.3,x,.16,-.76,'mobFace');
      for(const x of[-.17,.17])box('mob-eye',.13,.13,.03,x,1.25,-1.025,'mobFace');
      box('mob-mouth',.15,.2,.03,0,1.05,-1.025,'mobFace');box('mob-mouth',.34,.07,.03,0,1.07,-1.025,'mobFace');
    }
    const glow=(body.material as StandardMaterial).clone('actor-glow:'+actor.actorKey);body.material=glow;
    const result={node,glow};this.actors.set(actor.actorKey,result);return result;
  }
  private syncActors(s:Snapshot){
    const present=new Set((s.actors??[]).map(a=>a.actorKey));for(const[key,value]of this.actors)if(!present.has(key)){value.node.dispose();value.glow.dispose();this.actors.delete(key);}
    for(const actor of s.actors??[]){const visual=this.actors.get(actor.actorKey)??this.createActor(actor),alive=!['destroyed','removed'].includes(actor.state);
      visual.node.setEnabled(alive&&Math.abs(actor.x-this.follow)<Math.abs(this.camera.orthoRight??12)+4);visual.node.position.set(actor.x,actor.y,0);
      visual.glow.emissiveColor=actor.state==='armed'?new Color3(.7+Math.sin(s.tick*.65)*.25,.12,.06):Color3.Black();
      visual.node.scaling.setAll(actor.state==='exploded'?1.3:1);
    }
    for(const[x,bed]of this.gapBeds)bed.setEnabled(Math.abs(x-this.follow)<Math.abs(this.camera.orthoRight??12)+3);
  }
  private syncLava(s:Snapshot){
    if(!s.lava){this.lava.setEnabled(false);this.lavaEdge.setEnabled(false);return;}
    const left=this.follow-Math.abs(this.camera.orthoRight??12)-2,right=s.lava.x,width=Math.max(0,right-left);
    this.lava.setEnabled(width>0);this.lavaEdge.setEnabled(width>0);this.lava.scaling.x=Math.min(width,60);this.lava.position.x=right-Math.min(width,60)/2;this.lavaEdge.position.x=right;
  }
  private showItemTarget(s:Snapshot,target:ItemTarget|null){
    if(!target){this.actorGhost.setEnabled(false);return;}let x:number,y:number,valid:boolean;
    if('actorKey'in target){const actor=s.actors?.find(a=>a.actorKey===target.actorKey);if(!actor){this.actorGhost.setEnabled(false);return;}x=actor.x;y=actor.y+.4;valid=canPickActor(s,target.actorKey).ok;}
    else{const p=worldPosition(s,target.cell);x=p.x;y=p.y+.9;valid=canPutActor(s,target.cell).ok;}
    this.actorGhost.position.set(x,y,-.3);this.actorGhost.setEnabled(true);this.actorGhost.edgesColor=valid?new Color4(1,.85,.4,1):new Color4(1,.35,.3,1);
  }
  projectPoint(x:number,y:number):{x:number;y:number}{const v=Vector3.Project(new Vector3(x,y,-.8),Matrix.Identity(),this.scene.getTransformMatrix(),this.camera.viewport.toGlobal(this.canvas.clientWidth,this.canvas.clientHeight));return{x:v.x,y:v.y};}
  pickItem(x:number,y:number,s:Snapshot,touch=false):ItemTarget|null{
    if(s.player.heldActorKey){
      const hit=this.scene.pick(x,y,m=>Boolean(m.metadata?.cell)),cell=hit?.pickedMesh?.metadata?.cell as Cell|undefined;
      let target=cell?targetAt(s,cell.space,cell.x,cell.y):this.pick(x,y,s,'take',false);
      if(touch&&target&&!canPutActor(s,target).ok){const options:Target[]=[];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const next=targetAt(s,target.space,target.x+dx,target.y+dy);if(canPutActor(s,next).ok)options.push(next);}options.sort((a,b)=>{const pa=this.project(a),pb=this.project(b);return Math.hypot(pa.x-x,pa.y-y)-Math.hypot(pb.x-x,pb.y-y);});const closest=options[0];if(closest&&Math.hypot(this.project(closest).x-x,this.project(closest).y-y)<40)target=closest;}
      return target?{cell:target,heldActorKey:s.player.heldActorKey}:null;
    }
    const hit=this.scene.pick(x,y,m=>Boolean(m.metadata?.actorKey)),key=hit?.pickedMesh?.metadata?.actorKey as string|undefined;
    if(key)return{actorKey:key};
    if(touch){const candidates=(s.actors??[]).filter(a=>a.kind!=='mob'&&canPickActor(s,a.actorKey).ok).map(a=>({actor:a,p:this.projectPoint(a.x,a.y+.35)})).sort((a,b)=>Math.hypot(a.p.x-x,a.p.y-y)-Math.hypot(b.p.x-x,b.p.y-y));const nearest=candidates[0];if(nearest&&Math.hypot(nearest.p.x-x,nearest.p.y-y)<42)return{actorKey:nearest.actor.actorKey};}
    return null;
  }
  resize(){
    this.engine.resize();const aspect=this.canvas.clientWidth/this.canvas.clientHeight;
    const height=this.canvas.clientHeight<600?10.3:11.5;
    this.camera.orthoTop=height/2;this.camera.orthoBottom=-height/2;
    this.camera.orthoLeft=-height*aspect/2;this.camera.orthoRight=height*aspect/2;
  }
  render(s:Snapshot,target:Target|null,mode:ViewMode,guide?:{target:Target;mode:'take'|'place'},material:Material='wood',itemTarget:ItemTarget|null=null){
    this.state=s;const rules=rulesFor(s);this.portal.position.x=rules.portalX;this.gapDepth.position.x=(rules.gapStart+rules.gapEnd)/2;this.gapDepth.scaling.x=(rules.gapEnd-rules.gapStart+1.1)/5.1;
    this.syncRoute(s);
    const extent=Math.abs(this.camera.orthoRight??12)+3;
    for(const mesh of this.routeDecorations)mesh.setEnabled(Math.abs(mesh.position.x-this.follow)<extent+8);
    const present=new Set(s.blocks.map(b=>b.id));
    for(const [id,mesh] of this.meshes)if(!present.has(id)){mesh.dispose();this.meshes.delete(id);}
    for(const b of s.blocks){
      const position=worldPosition(s,b),visible=Math.abs(position.x-this.follow)<extent;
      let mesh=this.meshes.get(b.id);if(!visible){mesh?.setEnabled(false);continue;}
      if(!mesh){
        mesh=this.box(b.id,.98,.98,b.space==='house'?1.1:2.1,0,0,0,b.portable?(b.originalId?b.material:({wood:'newWood',stone:'newStone',slime:'newSlime'} as const)[b.material]):'ground');
        mesh.isPickable=true;mesh.metadata={cell:{space:b.space,x:b.x,y:b.y}};
        mesh.enableEdgesRendering();mesh.edgesWidth=.7;mesh.edgesColor=new Color4(.23,.32,.3,.38);
        this.meshes.set(b.id,mesh);
        if(b.portable&&b.material==='wood'){
          for(const offset of [-.19,.19])this.box('grain',.82,.022,.02,0,offset,-.565,'wood',mesh);
        }
      }
      mesh.setEnabled(true);mesh.position.set(position.x,position.y,0);mesh.material=this.mats[(b.burnTicks??0)>0?'burn':b.portable?(b.originalId?b.material:({wood:'newWood',stone:'newStone',slime:'newSlime'} as const)[b.material]):'ground'];
    }
    this.syncActors(s);this.syncLava(s);
    this.chassis.position.set(s.house.x,s.house.y,0);
    this.character.position.set(s.player.x,s.player.y,0);
    const walk=Math.abs(s.player.vx)>.15&&s.player.support?Math.sin(s.tick*.22)*.055:0;
    this.legs[0].position.y=.2+walk;this.legs[1].position.y=.2-walk;
    this.heart.scaling.setAll(1+Math.sin(s.tick*.07)*.06);
    for(let i=0;i<this.pistons.length;i++){const extra=s.house.y-2;this.pistons[i].position.y=-1.1-extra/2;this.pistons[i].scaling.y=(.78+extra)/.78*(s.house.motion==='moving'?1+Math.sin(s.tick*.12+i*Math.PI)*.08:1);this.feet[i].position.y=.55-s.house.y;}
    const desired=s.house.x+7.8;this.follow+=(desired-this.follow)*.1;
    this.camera.position.set(this.follow,8,-24);this.camera.setTarget(new Vector3(this.follow,3,0));
    if(target&&mode!=='item'){
      const p=worldPosition(s,target);this.ghost.position.set(p.x,p.y,-.02);this.ghost.setEnabled(true);
      const valid=mode==='take'?canTake(s,target).ok:canPlace(s,target,material).ok;
      const col=valid?(target.space==='house'?new Color3(.6,1,.4):new Color3(.4,.9,1)):new Color3(1,.35,.3);
      this.mats.ghost.diffuseColor=col;this.ghost.edgesColor=new Color4(col.r,col.g,col.b,1);
    }else this.ghost.setEnabled(false);
    this.showItemTarget(s,itemTarget);
    if(guide){const p=worldPosition(s,guide.target);this.hint.position.set(p.x,p.y,-.04);this.hint.setEnabled(true);const col=guide.mode==='take'?new Color3(.65,1,.32):new Color3(.32,.9,1);this.mats.guide.diffuseColor=col;this.hint.edgesColor=new Color4(col.r,col.g,col.b,1);}else this.hint.setEnabled(false);
    this.engine.beginFrame();
    const before=this.engine._drawCalls.current;
    this.scene.render();
    this.drawCallsLastFrame=this.engine._drawCalls.current-before;
    this.engine.endFrame();
  }
  project(cell:Cell):{x:number;y:number}{
    if(!this.state)return{x:0,y:0};
    const p=worldPosition(this.state,cell);
    const v=Vector3.Project(new Vector3(p.x,p.y,-.57),Matrix.Identity(),this.scene.getTransformMatrix(),this.camera.viewport.toGlobal(this.canvas.clientWidth,this.canvas.clientHeight));
    return{x:v.x,y:v.y};
  }
  pick(x:number,y:number,s:Snapshot,mode:'take'|'place',touch=false,material:Material='wood'):Target|null{
    const hit=this.scene.pick(x,y,m=>Boolean(m.metadata?.cell));
    const cell=hit?.pickedMesh?.metadata?.cell as Cell|undefined;
    let target:Target|null=null;
    if(cell)target=targetAt(s,cell.space,cell.x,cell.y);
    if(!cell||mode==='place'){
      const ray=this.scene.createPickingRay(x,y,Matrix.Identity(),this.camera);
      const t=(-.57-ray.origin.z)/ray.direction.z;
      if(!Number.isFinite(t)||t<0)return target;
      const p=ray.origin.add(ray.direction.scale(t));
      let cx=Math.round(p.x-s.house.x),cy=Math.round(p.y-s.house.y);
      const inHouse=cx>=0&&cx<8&&cy>=0&&cy<6;
      target=inHouse?targetAt(s,'house',cx,cy):targetAt(s,'world',Math.round(p.x),Math.round(p.y));
    }
    const valid=(t:Target)=>mode==='take'?canTake(s,t).ok:canPlace(s,t,material).ok;
    if(touch&&target&&!valid(target)){
      const options:Target[]=[];
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
        const c=targetAt(s,target.space,target.x+dx,target.y+dy);
        if(valid(c))options.push(c);
      }
      options.sort((a,b)=>{const pa=this.project(a),pb=this.project(b);return Math.hypot(pa.x-x,pa.y-y)-Math.hypot(pb.x-x,pb.y-y);});
      const closest=options[0];if(closest){const p=this.project(closest);if(Math.hypot(p.x-x,p.y-y)<32)target=closest;}
    }
    return target;
  }
}
