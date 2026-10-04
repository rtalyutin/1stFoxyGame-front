import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
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
import { PresentationTimeline } from './timeline';
import { toScenePoint, toCombatAim } from './coordinates';
import { ThreatView } from './threats';
import { Ray } from '@babylonjs/core/Culling/ray';
import { createDistantTerrainMaterial } from './terrain-material';

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

  constructor(private canvas: HTMLCanvasElement) {
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
    try {
      this.hero = library.create('pudge', 'hero');
      this.hook = library.create('hook', 'hook');
      this.hook.root.setEnabled(false);
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

  observe(state: RunState): void { this.timeline.observe(state); }

  render(sim: RunSimulation | null, aim: Point, delta: number): void {
    const state = sim?.state;
    const distance = state?.hero.z ?? 0;
    this.lastDistance = distance;
    const heroX = -(state?.hero.x ?? 0);
    if (this.hero && this.hook) {
      this.hero.root.position.set(heroX, 0, 0);
      if (state) {
        this.timeline.observe(state);
        const pose = this.timeline.hero(state, delta);
        this.hero.pose(pose.clip, pose.seconds, pose.loop);
      } else {
        this.timeline.reset();
        this.gallerySeconds += Math.min(delta, 0.1);
        this.hero.pose('idle', this.gallerySeconds);
      }
      this.scenery.forEach((section, index) => {
        section.position.z = ((index * 12 - distance + 24) % 108 + 108) % 108 - 24;
      });
      const hook = state?.hook;
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
      for (const enemy of state?.enemies ?? []) {
        visible.add(enemy.id);
        let actor = this.enemies.get(enemy.id);
        if (!actor) {
          actor = this.library!.create('creep_basic', enemy.id);
          if (enemy.kind === 'boss') actor.root.scaling.setAll(1.65);
          this.enemies.set(enemy.id, actor);
        }
        actor.root.position.copyFrom(toScenePoint(enemy, distance));
        actor.root.rotation.y = Math.PI;
        const pose = this.timeline.creep(enemy.id, state!.time, enemy.status === 'captured');
        actor.pose(pose.clip, pose.seconds, pose.loop);
        if (enemy.status === 'captured' && capturePoint) {
          actor.root.position.addInPlace(capturePoint.subtract(actor.socket('socket_creep_capture')));
        }
      }
      for (const [id, actor] of this.enemies) if (!visible.has(id)) { actor.dispose(); this.enemies.delete(id); }
      this.threats.render(state, distance, this.enemies);
    }
    const showAim = Boolean(this.hero && state?.phase === 'running' && !state.hook);
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
    for (const actor of [this.hero, this.hook, ...this.links, ...this.staticActors, ...this.enemies.values()]) actor?.dispose();
    for (const section of this.scenery) section.dispose();
    this.library?.dispose(); this.library = null; this.hero = null; this.hook = null;
    this.links = []; this.staticActors = []; this.scenery = []; this.enemies.clear();
  }

  dispose(): void {
    this.resizeObserver.disconnect(); this.clearAssets(); this.threats.dispose(); this.scene.dispose(); this.engine.dispose();
  }
}
