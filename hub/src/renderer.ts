import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3, Color3, Color4, Matrix } from '@babylonjs/core/Maths/math';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import type { Game, Manifest } from './catalog';
import { validateManifest } from './catalog';
import { LivingWorld } from './worlds';

function material(scene: Scene, name: string, hex: string, glow = false): StandardMaterial {
  const mat = new StandardMaterial(name,scene); mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor.set(.08,.08,.08); if (glow) mat.emissiveColor = mat.diffuseColor;
  return mat;
}
export class ArcadeRenderer {
  readonly engine: Engine; readonly scene: Scene; readonly camera: FreeCamera;
  private shadow: ShadowGenerator; private instrumentation: SceneInstrumentation;
  private hero: AssetContainer | null = null; private heroRoot: TransformNode | null = null;
  private generation = 0; private heroGeneration = 0; private lights: PointLight[] = [];
  private width = 1; private height = 1; private halfWidth = 1;
  private room: TransformNode;
  private run?: AssetContainer['animationGroups'][number];
  constructor(readonly canvas: HTMLCanvasElement, private lost: () => void, restored: () => void) {
    this.engine = new Engine(canvas,true,{preserveDrawingBuffer:false,stencil:true,adaptToDeviceRatio:false});
    this.scene = new Scene(this.engine); this.scene.useRightHandedSystem = true;
    this.scene.clearColor = Color4.FromHexString('#102d45ff');
    this.camera = new FreeCamera('hall-camera',new Vector3(0,6,-17),this.scene);
    this.camera.setTarget(new Vector3(0,2.12,0)); this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = .1; this.camera.maxZ = 100;
    const ambient = new HemisphericLight('hall-ambient',new Vector3(0,1,-.2),this.scene);
    ambient.intensity=.95; ambient.groundColor = Color3.FromHexString('#27364d');
    const key = new DirectionalLight('hall-key',new Vector3(-.35,-1,.35),this.scene);
    key.position = new Vector3(0,9,-6); key.intensity=1.3; key.diffuse = Color3.FromHexString('#ffe2b4');
    this.shadow = new ShadowGenerator(1024,key); this.shadow.usePercentageCloserFiltering=true;
    this.shadow.filteringQuality = ShadowGenerator.QUALITY_LOW; this.shadow.bias=.003;
    this.room = new TransformNode('hall',this.scene);
    this.makeRoom();
    this.instrumentation = new SceneInstrumentation(this.scene); this.instrumentation.captureFrameTime=true;
    this.engine.onContextLostObservable.add(() => { ++this.generation; this.cancelHero(); this.lost(); });
    this.engine.onContextRestoredObservable.add(restored);
  }
  private makeRoom(): void {
    const blue = material(this.scene,'blue masonry','#183e59');
    const mortar = material(this.scene,'mortar','#102b40');
    const floor = material(this.scene,'floor','#566271');
    floor.diffuseColor=Color3.FromHexString('#34414e');
    const grout = material(this.scene,'grout','#313e4e');
    const wall = MeshBuilder.CreateBox('wall',{width:90,height:14,depth:.15},this.scene);
    wall.position.set(0,6,1.8); wall.material=mortar; wall.parent=this.room;
    const bricks: Mesh[]=[];
    for (let row=0;row<10;row++) for (let column=-22;column<=22;column++) {
      const brick=MeshBuilder.CreateBox('brick',{width:1.86,height:.69,depth:.065},this.scene);
      brick.position.set(column*1.9 + (row%2)*.95,.37+row*.73,1.69); brick.material=blue; bricks.push(brick);
    }
    const masonry=Mesh.MergeMeshes(bricks,true,true)!; masonry.parent=this.room; masonry.receiveShadows=true;
    const ground=MeshBuilder.CreateGround('hall-floor',{width:90,height:45},this.scene);
    ground.position.z=-13; ground.material=floor; ground.receiveShadows=true; ground.parent=this.room;
    const seams: Mesh[]=[];
    for (let i=-25;i<=25;i++) {
      const seam=MeshBuilder.CreateBox('floor seam',{width:.014,height:.008,depth:30},this.scene);
      seam.position.set(i*1.75,.004,-13); seam.material=grout; seams.push(seam);
    }
    for (let i=0;i<17;i++) {
      const seam=MeshBuilder.CreateBox('floor seam',{width:90,height:.008,depth:.014},this.scene);
      seam.position.set(0,.004,1-i*1.75); seam.material=grout; seams.push(seam);
    }
    Mesh.MergeMeshes(seams,true,true)!.parent=this.room;
    const baseboard=MeshBuilder.CreateBox('wall-floor joint',{width:90,height:.1,depth:.11},this.scene);
    baseboard.position.set(0,.05,1.58); baseboard.material=grout; baseboard.parent=this.room;
    for (let i=0;i<3;i++) {
      const lamp=MeshBuilder.CreateCylinder('lamp',{diameterTop:.12,diameterBottom:.42,height:.24,tessellation:12},this.scene);
      lamp.position.set((i-1)*4,4.54,1.25); lamp.material=material(this.scene,'lamp metal','#111b27'); lamp.parent=this.room;
      const bulb=MeshBuilder.CreateSphere('bulb',{diameter:.22,segments:8},this.scene);
      bulb.position.set((i-1)*4,4.4,1.24); bulb.material=material(this.scene,'lamp glow','#ffd088',true); bulb.parent=lamp;
      bulb.position.set(0,-.12,0);
      const light=new PointLight('warm wall lamp',new Vector3((i-1)*4,4.1,.9),this.scene);
      light.diffuse=Color3.FromHexString('#ffd09b'); light.intensity=.45; light.range=5; this.lights.push(light);
    }
  }
  resize(): void {
    const rect=this.canvas.getBoundingClientRect(); this.width=rect.width; this.height=rect.height;
    this.engine.setHardwareScalingLevel(1/Math.min(window.devicePixelRatio || 1,1.5)); this.engine.resize();
    this.halfWidth = 2.7 * this.width / this.height;
    this.camera.orthoTop=2.7; this.camera.orthoBottom=-2.7;
    this.camera.orthoLeft=-this.halfWidth; this.camera.orthoRight=this.halfWidth;
    this.scene.updateTransformMatrix(true);
    // Lighting positions follow the room, never individual animated cabinets.
    this.lights.forEach((l,i)=> { l.position.x=(i-1)*this.halfWidth*.73; });
  }
  place(world: LivingWorld, center: number, slotWidth: number): void {
    world.root.position.x = (1-center/this.width*2)*this.halfWidth;
    world.root.scaling.x=slotWidth/(this.height/5.4)*.92/3.23;
    world.root.computeWorldMatrix(true);
  }
  private async container(path: string): Promise<AssetContainer> {
    const response=await fetch(import.meta.env.BASE_URL+path,{signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`Asset HTTP ${response.status}`);
    return LoadAssetContainerAsync(new Uint8Array(await response.arrayBuffer()),this.scene,
      {pluginExtension:'.glb',name:path,pluginOptions:{gltf:{animationStartMode:0}}});
  }
  async load(game: Game): Promise<LivingWorld> {
    const generation=this.generation;
    const response=await fetch(import.meta.env.BASE_URL+game.scene,{signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('Scene manifest unavailable');
    const manifest=validateManifest(await response.json());
    const container=await this.container(manifest.model);
    let root: TransformNode|undefined;
    try {
      if (generation!==this.generation || this.scene.isDisposed) throw new Error('Discarded context generation');
      root=new TransformNode(`slot:${game.id}`,this.scene); root.setEnabled(false);
      const world=new LivingWorld(container,root,manifest);
      for (const name of ['cabinet_root','screen_opening',...manifest.anchors]) world.node(name);
      // Validate the behavior contract before adding the GLB to the live scene.
      world.update(0); container.addAllToScene();
      for (const node of container.rootNodes) node.parent=root;
      for (const mesh of container.meshes) { mesh.receiveShadows=true; this.shadow.addShadowCaster(mesh); mesh.isPickable=false; }
      this.addMarquee(game,root); return world;
    } catch (e) { root?.dispose();container.dispose(); throw e; }
  }
  private addMarquee(game: Game,root: TransformNode): void {
    const sign=MeshBuilder.CreatePlane('cabinet title',{width:2.68,height:.28},this.scene);
    sign.position.set(0,3.945,-.684); sign.parent=root;
    const texture=new DynamicTexture('marquee texture',{width:1024,height:128},this.scene,false);
    texture.drawText(game.title.toUpperCase(),null,91,'bold 80px Arial','#eff6ff','#142031',true,true);
    texture.uScale=-1; texture.uOffset=1;
    const mat=material(this.scene,'marquee','#ffffff'); mat.diffuseTexture=texture; mat.emissiveTexture=texture;
    sign.material=mat; sign.isPickable=false;
    // Root owns its extra material and dynamic texture too.
    root.onDisposeObservable.addOnce(()=> { sign.dispose(); mat.dispose(true,true); });
  }
  async prepareHero(world: LivingWorld): Promise<void> {
    const generation=++this.heroGeneration;
    this.resetHero();
    const hero=await this.container(world.manifest.hero);
    if (generation!==this.heroGeneration || this.scene.isDisposed) { hero.dispose(); throw new Error('Cancelled hero'); }
    try {
      const run=hero.animationGroups.find(g=>g.name==='run');
      if (!run || !hero.animationGroups.some(g=>g.name==='idle') || !hero.transformNodes.some(n=>n.name==='hero_root')) throw new Error('Incompatible hero rig');
      this.hero=hero; this.heroRoot=new TransformNode('entry actor',this.scene);
      this.heroRoot.parent=world.root;
      hero.addAllToScene(); hero.rootNodes.forEach(node=>node.parent=this.heroRoot); hero.meshes.forEach(m=>this.shadow.addShadowCaster(m));
      run.start(true); run.pause(); this.run=run;
    } catch(e) { hero.dispose(); this.resetHero(); throw e; }
  }
  enter(world: LivingWorld, progress: number): void {
    if (!this.heroRoot || !this.run) throw new Error('Hero unavailable');
    const start=world.node('anchor_approach').position;
    const entry=world.node('anchor_entry').position;
    const inside=world.node('anchor_inside').position;
    const d1=Vector3.Distance(start,entry), d2=Vector3.Distance(entry,inside), distance=(d1+d2)*progress;
    this.heroRoot.position.copyFrom(distance<d1 ? Vector3.Lerp(start,entry,distance/d1) : Vector3.Lerp(entry,inside,(distance-d1)/d2));
    this.heroRoot.rotation.x=-Math.atan2(entry.y-start.y,entry.z-start.z)*Math.max(0,Math.min(1,(d1+.08-distance)/.16));
    // A 0.6s rig cycle covers a 0.48m stride; pose follows actual path distance.
    const frame=this.run.from + (distance/.48%1)*(this.run.to-this.run.from);
    this.run.goToFrame(frame);
    this.heroRoot.computeWorldMatrix(true);
  }
  resetHero(): void { this.heroRoot?.dispose(); this.hero?.dispose(); this.heroRoot=null; this.hero=null; this.run=undefined; }
  cancelHero(): void { ++this.heroGeneration; this.resetHero(); }
  render(): void { this.scene.render(); }
  stats(): Record<string,unknown> {
    return {fps:this.engine.getFps(),frameMs:this.instrumentation.frameTimeCounter.current,
      meshes:this.scene.meshes.length,textures:this.scene.textures.length,materials:this.scene.materials.length,
      drawCalls:this.engine._drawCalls.current,buffer:[this.engine.getRenderWidth(),this.engine.getRenderHeight()],
      dpr:window.devicePixelRatio,hardwareScaling:this.engine.getHardwareScalingLevel(),renderer:this.engine.getGlInfo().renderer};
  }
  project(world: LivingWorld, node: string): {x:number;y:number} {
    const p=Vector3.Project(world.node(node).getAbsolutePosition(),Matrix.Identity(),this.scene.getTransformMatrix(),this.camera.viewport.toGlobal(this.width,this.height));
    return {x:p.x,y:p.y};
  }
  floorLine(): number {
    return Vector3.Project(new Vector3(0,0,1.6),Matrix.Identity(),this.scene.getTransformMatrix(),this.camera.viewport.toGlobal(this.width,this.height)).y;
  }
  dispose(): void { ++this.generation; this.resetHero(); this.instrumentation.dispose(); this.shadow.dispose(); this.scene.dispose(); this.engine.dispose(); }
}
