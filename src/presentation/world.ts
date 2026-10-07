import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import {Viewport} from '@babylonjs/core/Maths/math.viewport';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import '@babylonjs/core/Culling/ray';
import type { Point, RunSimulation, RunState } from '../game/simulation';
import { ModelLibrary, type ModelActor } from './models';
import { ShopView } from './shops';
import { PresentationTimeline } from './timeline';
import { toScenePoint, toCombatAim } from './coordinates';
import { ThreatView } from './threats';
import { Ray } from '@babylonjs/core/Culling/ray';
import { createDistantTerrainMaterial } from './terrain-material';
import type { Profile,ConfirmedReward } from '../game/equipment';
import { applyAppearance, committedAppearance, type AppearanceLoadout } from './appearance';
import '@babylonjs/core/Rendering/outlineRenderer';

/** Models present the pure simulation; no collider depends on a mesh or a clip. */
export class WorldView {
  readonly engine: Engine;
  readonly scene: Scene;
  private camera: FreeCamera;
  private library: ModelLibrary | null = null;
  private hero: ModelActor | null = null;
  private hook: ModelActor | null = null;
  private links: ModelActor[] = [];
  private enemies = new Map<string, ModelActor>();
  private scenery: TransformNode[] = [];
  private staticActors: ModelActor[] = [];
  private timeline = new PresentationTimeline();
  private aimLine: LinesMesh;
  private marker: Mesh;
  private lastDistance = 0;
  private gallerySeconds = 0;
  private resizeObserver: ResizeObserver;
  private loadPromise: Promise<void> | null = null;
  private threats: ThreatView;
  private shops: ShopView | null = null;
  private equipment: AppearanceLoadout | null = null;
  private hookVariants=new Map<string,ModelActor>();
  private mode:'gallery'|'results'|'run'='run';
  private galleryYaw=0;
  private galleryPointer:{id:number;x:number}|null=null;
  private podium:TransformNode;
  private rewardEffects:{actor:ModelActor;age:number;clock:boolean}[]=[];
  private rewardReceipts=new Set<string>();
  private clockPulse=0;
  private eventReceipts=new Set<string>();
  private eventEffects:{actor:ModelActor;age:number;duration:number}[]=[];
  private pendingEffects:{type:'cast'|'returned'|'hit'|'consumed';enemyId?:string;lethal?:boolean}[]=[];

  constructor(private canvas: HTMLCanvasElement) {
    if(import.meta.env.DEV&&new URLSearchParams(location.search).has('probe-qa'))Object.assign(window,{runnerWorldProbe:this});
    this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false }, true);
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.65));
    this.scene = new Scene(this.engine);
    // GLB axes stay native: Y up, +Z forward, no importer half-turn root.
    this.scene.useRightHandedSystem = true;
    this.threats = new ThreatView(this.scene);
    this.scene.clearColor = Color4.FromHexString('#8ac3dfff');
    this.scene.fogMode = Scene.FOGMODE_LINEAR;
    this.scene.fogColor = Color3.FromHexString('#8ac3df');
    this.scene.fogStart = 60;
    this.scene.fogEnd = 105;
    this.camera = new FreeCamera('camera', new Vector3(0, 11, -15), this.scene);
    this.configureCamera();
    this.camera.minZ = 0.1;
    this.camera.maxZ = 110;
    const ambient = new HemisphericLight('sky', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.85;
    ambient.groundColor = Color3.FromHexString('#667a52');
    const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.5), this.scene);
    sun.intensity = 1.2;
    const groundMaterial = createDistantTerrainMaterial(this.scene);
    const ground = MeshBuilder.CreateGround('distant-ground', { width: 220, height: 220 }, this.scene);
    ground.position.set(0, -0.095, 35);
    ground.material = groundMaterial;
    ground.isPickable = false;
    this.podium=new TransformNode('gallery-podium',this.scene);this.podium.position.y=.16;this.podium.setEnabled(false);
    canvas.addEventListener('pointerdown',this.galleryDown);canvas.addEventListener('pointermove',this.galleryMove);canvas.addEventListener('pointerup',this.galleryUp);canvas.addEventListener('pointercancel',this.galleryUp);
    const aimMaterial = new StandardMaterial('aim-color', this.scene);
    aimMaterial.diffuseColor = Color3.FromHexString('#f8b43b');
    aimMaterial.emissiveColor = Color3.FromHexString('#805300');
    this.aimLine = MeshBuilder.CreateDashedLines('aim', { points: [Vector3.Zero(), new Vector3(0, 0, 20)], dashSize: 0.35, gapSize: 0.24, dashNb: 26, updatable: true }, this.scene);
    this.aimLine.color = Color3.FromHexString('#694316');
    this.aimLine.alpha = 0.8;
    this.aimLine.isPickable = false;
    this.marker = MeshBuilder.CreateTorus('aim-marker', { diameter: 0.65, thickness: 0.035, tessellation: 4 }, this.scene);
    this.marker.material = aimMaterial;
    this.marker.rotation.y = Math.PI / 4;
    this.marker.isPickable = false;
    this.resizeObserver = new ResizeObserver(() => { this.engine.resize(); this.configureCamera(); });
    this.resizeObserver.observe(canvas);
  }

  async loadAssets(): Promise<void> {
    if (this.library) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.installAssets();
    try { await this.loadPromise; } finally { this.loadPromise = null; }
  }

  private async installAssets(): Promise<void> {
    const library = await ModelLibrary.load(this.scene);
    this.library = library;
    this.threats.installLibrary(library);
    this.shops = new ShopView(library);
    try {
      this.hero = library.create('pudge', 'hero');
      const podium=library.create('road','gallery-native-podium');podium.root.scaling.set(.38,1,2.5/12);podium.root.parent=this.podium;this.staticActors.push(podium);
      this.hook = library.create('hook', 'hook');
      this.hook.root.setEnabled(false);
      this.hookVariants.set('hook',this.hook);
      for(const id of ['long_link','piercing_tooth','return_sickle'] as const){const actor=library.create(`hook_${id}`,`flight-${id}`);actor.root.setEnabled(false);this.hookVariants.set(id,actor);}
      for (let index = 0; index < 220; index++) {
        const link = library.create('chain', `link-${index}`);
        link.root.setEnabled(false);
        this.links.push(link);
      }
      // Nine reusable 12 m chunks: geometry stays bounded as distance grows.
      for (let index = 0; index < 9; index++) {
        const section = new TransformNode(`section-${index}`, this.scene);
        this.scenery.push(section);
        const shoulderName = (['shoulder_0', 'shoulder_1', 'shoulder_2'] as const)[index % 3];
        let terrain: ModelActor | null = null;
        for (const name of [shoulderName, 'road'] as const) {
          const actor = library.create(name, `${name}-${index}`);
          actor.root.parent = section;
          this.staticActors.push(actor);
          if (name === shoulderName) terrain = actor;
        }
        for (const sign of [-1, 1]) {
          for (const [offset, name] of (['tree', 'bush', 'rock', 'grass'] as const).entries()) {
            if (name === 'grass' && index % 3 !== 0) continue;
            const actor = library.create(name, `${name}-${index}-${sign}`);
            actor.root.parent = section;
            const x = name === 'grass' ? 5.9 : name === 'rock' ? 8.2 + index % 3 * 1.7 : 7 + (index + offset) % 5 * 1.8;
            actor.root.position.set(sign * x, 0, 1 + offset * 2.6);
            actor.root.rotation.y = index * 1.3 + offset;
            // Place props on the actual new surface once, before the chunk moves.
            const ray = new Ray(new Vector3(actor.root.position.x, 20, actor.root.position.z), new Vector3(0, -1, 0), 40);
            for (const mesh of terrain!.root.getChildMeshes()) {
              mesh.computeWorldMatrix(true);
              const hit = ray.intersectsMesh(mesh);
              if (hit.hit && hit.pickedPoint) { actor.root.position.y = hit.pickedPoint.y - (name === 'rock' ? 0.04 : 0); break; }
            }
            this.staticActors.push(actor);
          }
        }
      }
      for (const mesh of this.scene.meshes) mesh.isPickable = false;
      this.hero.pose('idle', 0);
      applyAppearance(this.hero, this.equipment ?? {weapon:null,body:null,legs:null,talisman:null});
    } catch (error) { this.clearAssets(); throw error; }
  }

  private configureCamera(): void {
    const portrait = this.engine.getRenderHeight() > this.engine.getRenderWidth();
    this.camera.position.set(0, portrait ? 15 : 11, portrait ? -23 : -15);
    // Keep the entire forward warning/mark area in frame on wide displays too.
    this.camera.fovMode = Camera.FOVMODE_VERTICAL_FIXED;
    this.camera.fov = portrait ? 0.9 : 0.85;
    this.camera.setTarget(new Vector3(0, 0, portrait ? 13 : 10));
  }

  aim(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    // createPickingRay applies hardware scaling. Its input stays in CSS pixels.
    const ray = this.scene.createPickingRay(clientX - rect.left, clientY - rect.top, Matrix.Identity(), this.camera, false);
    const distance = ray.intersectsPlane(new Plane(0, 1, 0, -0.65));
    const point = distance !== null && distance > 0 ? ray.origin.add(ray.direction.scale(distance)) : new Vector3(0, 0, 30);
    return toCombatAim(point, this.lastDistance);
  }

  observe(state: RunState): void {
    this.timeline.observe(state);
    for(const event of state.events){
      if(!['cast','returned','hit','consumed'].includes(event.type))continue;
      const id=`${state.runId}:${event.type}:${event.at}:${event.castId??''}:${event.enemyId??''}`;if(this.eventReceipts.has(id))continue;this.eventReceipts.add(id);
      if(this.eventReceipts.size>2048)this.eventReceipts.delete(this.eventReceipts.values().next().value!);
      if(this.pendingEffects.length<24)this.pendingEffects.push({type:event.type as 'cast'|'returned'|'hit'|'consumed',enemyId:event.enemyId,lethal:event.lethal});
    }
  }

  setEquipment(profile: Profile): void {
    this.equipment = committedAppearance(profile);
    if(this.equipment.talisman?.definitionId!=='debt_clock'){this.clockPulse=0;for(const mesh of this.hero?.root.getChildMeshes()??[])if(mesh.name.includes('wear_debt_clock_'))mesh.renderOutline=false;}
    if (this.hero) applyAppearance(this.hero, this.equipment);
    const weapon=this.equipment.weapon?.definitionId;
    const next=this.hookVariants.get(weapon??'hook')??this.hookVariants.get('hook');
    if(next&&next!==this.hook){this.hook?.root.setEnabled(false);this.hook=next;}
  }

  setMode(mode:'gallery'|'results'|'run'):void{if(this.mode!==mode){this.mode=mode;this.galleryPointer=null;this.configureCamera();if(mode!=='run'){for(const effect of [...this.rewardEffects,...this.eventEffects])effect.actor.dispose();this.rewardEffects=[];this.eventEffects=[];this.pendingEffects=[];this.clockPulse=0;for(const mesh of this.hero?.root.getChildMeshes()??[])mesh.renderOutline=false;}}}
  rotateGallery(delta:number):void{if(this.mode==='gallery')this.galleryYaw+=delta;}
  private galleryDown=(e:PointerEvent):void=>{if(this.mode!=='gallery'||e.button!==0||this.galleryPointer)return;this.galleryPointer={id:e.pointerId,x:e.clientX};this.canvas.setPointerCapture(e.pointerId);};
  private galleryMove=(e:PointerEvent):void=>{if(this.galleryPointer?.id===e.pointerId){this.galleryYaw+=(e.clientX-this.galleryPointer.x)*.012;this.galleryPointer.x=e.clientX;}};
  private galleryUp=(e:PointerEvent):void=>{if(this.galleryPointer?.id===e.pointerId){this.galleryPointer=null;if(this.canvas.hasPointerCapture(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);}};
  confirmRewards(operationId:string,rewards:readonly ConfirmedReward[]):void{
    if(!this.library)return;
    for(const receipt of rewards){
      const id=operationId+':'+receipt.enemyId;if(this.rewardReceipts.has(id))continue;this.rewardReceipts.add(id);
      if(this.rewardReceipts.size>1024)this.rewardReceipts.delete(this.rewardReceipts.values().next().value!);
      const types=['gold',...(['steel','ember','core'] as const).filter(id=>receipt.components[id]>0)] as const;
      if(receipt.clockGoldMilli!==undefined){this.clockPulse=1;this.clockGoldMilli=receipt.clockGoldMilli;}
      for(const type of types){
        if(this.rewardEffects.length>=24)break;
        const actor=this.library.create(`loot_${type}`,`reward-${id}-${type}`);actor.root.position.set((this.rewardEffects.length%3-1)*.35,1.3,.6);actor.root.scaling.setAll(.45);
        this.rewardEffects.push({actor,age:0,clock:receipt.clockGoldMilli!==undefined});
      }
    }
  }
  clockGoldMilli:string|null=null;

  render(sim: RunSimulation | null, aim: Point, delta: number): void {
    const state = sim?.state;
    const gallery=this.mode==='gallery'||this.mode==='results';
    const distance = state?.hero.z ?? 0;
    this.lastDistance = distance;
    const heroX = -(state?.hero.x ?? 0);
    const portrait = this.engine.getRenderHeight() > this.engine.getRenderWidth();
    const closestShop = Math.min(Infinity, ...(state?.shopCandidates ?? []).map(shop => Math.abs(shop.z - distance)));
    // On narrow screens, reveal the stall as the hero approaches its entrance.
    const shopFraming = Math.max(0, Math.min(1, (16 - closestShop) / 8));
    const cameraX = portrait ? heroX * .75 * shopFraming : 0;
    if(gallery){const portraitResults=portrait&&this.mode==='results';this.camera.viewport=new Viewport(0,0,portrait?1:.73,1);this.camera.position.set(portraitResults?4.6:portrait?3.3:4.3,portraitResults?3.9:portrait?3:3.4,portraitResults?7.5:portrait?5.3:6.3);this.camera.fov=portraitResults?.95:portrait?.82:.6;this.camera.setTarget(new Vector3(portraitResults?.2:0,portraitResults?.8:1.1,0));}
    else{this.camera.viewport=new Viewport(0,0,1,1);this.camera.position.x += (cameraX - this.camera.position.x) * .12;this.camera.setTarget(new Vector3(this.camera.position.x, 0, portrait ? 13 : 10));}
    this.podium.setEnabled(gallery);this.scene.getMeshByName('distant-ground')?.setEnabled(!gallery);
    for(const section of this.scenery)section.setEnabled(!gallery);
    if (this.hero && this.hook) {
      this.hero.root.position.set(gallery?0:heroX,gallery?.16:0,0);this.hero.root.rotation.y=this.mode==='gallery'?this.galleryYaw:0;
      if (state&&this.mode!=='gallery') {
        this.observe(state);
        const pose = this.timeline.hero(state, delta);
        this.hero.pose(pose.clip, pose.seconds, pose.loop, state.time + (pose.clip === 'death' ? pose.seconds : 0));
      } else {
        this.timeline.reset();
        this.gallerySeconds += Math.min(delta, 0.1);
        this.hero.pose('idle', this.gallerySeconds);
      }
      this.scenery.forEach((section, index) => {
        section.position.z = ((index * 12 - distance + 24) % 108 + 108) % 108 - 24;
      });
      this.shops?.render(gallery?undefined:state, distance);
      const hook = gallery?null:state?.hook;
      this.hook.root.setEnabled(Boolean(hook));
      let capturePoint: Vector3 | null = null;
      if (hook) {
        const hand = this.hero.socket('socket_hook_hand');
        this.hook.root.position.copyFrom(toScenePoint(hook, distance, 0.95));
        this.hook.root.rotation.y = Math.atan2(-hook.direction.x, hook.direction.z);
        // Anchor the visible hit socket at the simulation point.
        const target = toScenePoint(hook, distance, 0.95);
        if (hook.phase === 'returning') {
          const remaining = Math.hypot(-hook.x - heroX, hook.z - distance);
          target.copyFrom(Vector3.Lerp(hand, target, Math.min(1, remaining / 1.2)));
        }
        this.hook.root.position.addInPlace(target.subtract(this.hook.socket('socket_target_hook')));
        capturePoint = this.hook.socket('socket_target_hook');
        this.renderChain(hand, this.hook.socket('socket_chain_hook'));
      } else for (const link of this.links) link.root.setEnabled(false);
      const visible = new Set<string>();
      for (const enemy of (gallery?[]:state?.enemies) ?? []) {
        visible.add(enemy.id);
        let actor = this.enemies.get(enemy.id);
        if (!actor) {
          actor = this.library!.create(enemy.kind === 'boss' ? 'enemy_boss' : enemy.kind === 'strong' ? 'enemy_shooter' : 'creep_basic', enemy.id);
          actor.setPartEnabled('RF_Wood_Creep_Blade', enemy.kind === 'normal');
          if (enemy.kind === 'boss') actor.root.scaling.setAll(1.65);
          this.enemies.set(enemy.id, actor);
        }
        actor.root.position.copyFrom(toScenePoint(enemy, distance));
        actor.root.rotation.y = Math.PI;
        const pose = this.timeline.enemy(enemy, state!.time, enemy.kind === 'boss' ? sim!.config.bossTelegraph : sim!.config.shooterTelegraph, clip => actor!.clipDuration(clip));
        actor.pose(pose.clip, pose.seconds, pose.loop);
        if (enemy.status === 'captured' && capturePoint) {
          actor.root.position.addInPlace(capturePoint.subtract(actor.socket('socket_creep_capture')));
        }
      }
      for (const [id, actor] of this.enemies) if (!visible.has(id)) { actor.dispose(); this.enemies.delete(id); }
      this.threats.render(gallery?undefined:state, distance, this.enemies);
      for(const event of this.pendingEffects.splice(0)){
        if(gallery||this.eventEffects.length>=24)continue;
        const actor=this.library!.create(event.type==='hit'?'hit_marker':'warning_ring','event-fx-'+this.eventReceipts.size+'-'+this.eventEffects.length);
        const target=event.enemyId?this.enemies.get(event.enemyId)?.socket('socket_creep_capture'):undefined;
        actor.root.position.copyFrom(target??(event.type==='consumed'?new Vector3(heroX,.05,0):this.hero.socket('socket_hook_hand')));
        actor.root.scaling.setAll(event.type==='hit'?(event.lethal?.65:.35):.5);this.eventEffects.push({actor,age:0,duration:.45});
      }
    }
    const showAim = Boolean(!gallery&&this.hero && state?.phase === 'running' && !state.hook);
    this.aimLine.setEnabled(showAim);
    this.marker.setEnabled(showAim);
    if (showAim) {
      const dz = Math.max(0.6, aim.z - distance);
      const dx = -aim.x - heroX;
      const length = Math.hypot(dx, dz);
      const range = Math.min(sim!.config.hookRange, length);
      const endpoint = new Vector3(heroX + dx / length * range, 0.04, dz / length * range);
      MeshBuilder.CreateDashedLines('aim', { points: [new Vector3(heroX, 0.04, 0), endpoint], instance: this.aimLine });
      this.marker.position.copyFrom(endpoint);
    }
    const active=state?.phase==='running'&&!document.hidden;
    if(active){
      for(const effect of this.eventEffects){effect.age+=delta;effect.actor.root.scaling.scaleInPlace(1+delta*1.2);}
      this.eventEffects=this.eventEffects.filter(effect=>{if(effect.age>effect.duration){effect.actor.dispose();return false;}return true;});
      this.clockPulse=Math.max(0,this.clockPulse-delta);
      const clockMeshes=this.hero?.root.getChildMeshes().filter(m=>m.isEnabled()&&m.name.includes('wear_debt_clock_'))??[];
      for(const mesh of clockMeshes){mesh.renderOutline=this.clockPulse>0;mesh.outlineColor=Color3.FromHexString('#ffcb65');mesh.outlineWidth=.008;}
      for(const effect of this.rewardEffects){effect.age+=delta;effect.actor.root.position.y=1.3+effect.age*1.1;effect.actor.root.rotation.y=effect.age*5;effect.actor.root.scaling.setAll(.45*Math.max(0,1-effect.age/1.1));}
      this.rewardEffects=this.rewardEffects.filter(effect=>{if(effect.age>1.1){effect.actor.dispose();return false;}return true;});
    }
    this.scene.render();
  }

  private renderChain(start: Vector3, end: Vector3): void {
    const vector = end.subtract(start);
    const length = vector.length();
    const count = Math.min(this.links.length, Math.max(1, Math.ceil(length / 0.14)));
    const spacing = length / count;
    const yaw = Math.atan2(vector.x, vector.z);
    const pitch = -Math.atan2(vector.y, Math.hypot(vector.x, vector.z));
    this.links.forEach((link, index) => {
      link.root.setEnabled(index < count);
      if (index >= count) return;
      link.root.position.copyFrom(Vector3.Lerp(start, end, (index + 0.5) / count));
      link.root.rotation.set(pitch, yaw, index % 2 * Math.PI / 2);
      link.root.scaling.z = spacing / 0.17;
    });
  }

  private clearAssets(): void {
    this.threats.clear();
    this.shops?.clear(); this.shops = null;
    for(const effect of this.rewardEffects)effect.actor.dispose();this.rewardEffects=[];
    for(const effect of this.eventEffects)effect.actor.dispose();this.eventEffects=[];this.pendingEffects=[];
    for (const actor of [this.hero, ...this.hookVariants.values(), ...this.links, ...this.staticActors, ...this.enemies.values()]) actor?.dispose();
    this.hookVariants.clear();
    for (const section of this.scenery) section.dispose();
    this.library?.dispose(); this.library = null; this.hero = null; this.hook = null;
    this.links = []; this.staticActors = []; this.scenery = []; this.enemies.clear();
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown',this.galleryDown);this.canvas.removeEventListener('pointermove',this.galleryMove);this.canvas.removeEventListener('pointerup',this.galleryUp);this.canvas.removeEventListener('pointercancel',this.galleryUp);
    this.resizeObserver.disconnect(); this.clearAssets(); this.threats.dispose(); this.scene.dispose(); this.engine.dispose();
  }
}
