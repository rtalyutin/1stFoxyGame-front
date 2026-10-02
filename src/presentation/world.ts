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
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import '@babylonjs/core/Culling/ray';
import type { Point, RunSimulation } from '../game/simulation';

/** Presentation is deliberately disposable: gameplay never reads a mesh position. */
export class WorldView {
  readonly engine: Engine;
  readonly scene: Scene;
  private camera: FreeCamera;
  private hero: TransformNode;
  private limbs: Mesh[] = [];
  private enemies = new Map<string, TransformNode>();
  private scenery: TransformNode[] = [];
  private hook: TransformNode;
  private chain: LinesMesh;
  private aimLine: LinesMesh;
  private marker: Mesh;
  private materials: Record<string, StandardMaterial> = {};
  private lastDistance = 0;
  private resizeObserver: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false }, true);
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.65));
    this.scene = new Scene(this.engine);
    this.scene.clearColor = Color4.FromHexString('#101919ff');
    this.scene.fogMode = Scene.FOGMODE_LINEAR;
    this.scene.fogColor = Color3.FromHexString('#101919');
    this.scene.fogStart = 24;
    this.scene.fogEnd = 66;
    this.camera = new FreeCamera('camera', new Vector3(0, 11, -15), this.scene);
    this.configureCamera();
    this.camera.minZ = 0.1;
    this.camera.maxZ = 110;
    const ambient = new HemisphericLight('sky', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 1.05;
    ambient.diffuse = new Color3(0.63, 0.82, 0.78);
    ambient.groundColor = new Color3(0.1, 0.12, 0.12);
    const moon = new DirectionalLight('moon', new Vector3(-0.5, -1, 0.5), this.scene);
    moon.intensity = 1.65;
    moon.diffuse = new Color3(0.8, 0.88, 0.86);
    for (const [name, color] of Object.entries({
      ground: '#162523', path: '#34403a', stone: '#41504a', dark: '#17201e',
      flesh: '#a9af86', apron: '#543b33', iron: '#73837f', hook: '#e4c782',
      enemy: '#bdcf8f', enemyDark: '#536b42', glow: '#d7a55d',
    })) {
      const material = new StandardMaterial(name, this.scene);
      material.diffuseColor = Color3.FromHexString(color);
      material.specularColor = new Color3(0.08, 0.1, 0.08);
      this.materials[name] = material;
    }
    this.materials.glow.emissiveColor = Color3.FromHexString('#bf7734').scale(0.45);
    this.materials.hook.emissiveColor = Color3.FromHexString('#d6ab61').scale(0.18);
    const ground = MeshBuilder.CreateGround('ground', { width: 180, height: 160 }, this.scene);
    ground.position.z = 35;
    ground.material = this.materials.ground;
    const path = MeshBuilder.CreateGround('path', { width: 10, height: 140 }, this.scene);
    path.position.set(0, 0.01, 35);
    path.material = this.materials.path;
    this.buildScenery();
    this.hero = this.buildHero();
    this.hook = new TransformNode('hook', this.scene);
    const arc = Array.from({ length: 15 }, (_, i) => {
      const angle = -Math.PI / 2 + i / 14 * Math.PI * 1.65;
      return new Vector3(Math.cos(angle) * 0.32, 0, Math.sin(angle) * 0.32);
    });
    const claw = MeshBuilder.CreateTube('hook-claw', { path: arc, radius: 0.07, tessellation: 6 }, this.scene);
    claw.material = this.materials.hook;
    claw.parent = this.hook;
    this.hook.setEnabled(false);
    this.chain = MeshBuilder.CreateLines('chain', { points: [Vector3.Zero(), Vector3.Zero()], updatable: true }, this.scene);
    this.chain.color = Color3.FromHexString('#e9cd8b');
    this.chain.isPickable = false;
    this.aimLine = MeshBuilder.CreateDashedLines('aim', { points: [Vector3.Zero(), new Vector3(0, 0, 20)], dashSize: 0.35, gapSize: 0.24, dashNb: 26, updatable: true }, this.scene);
    this.aimLine.color = Color3.FromHexString('#c29458');
    this.aimLine.alpha = 0.65;
    this.aimLine.isPickable = false;
    this.marker = MeshBuilder.CreateTorus('aim-marker', { diameter: 0.65, thickness: 0.035, tessellation: 4 }, this.scene);
    this.marker.material = this.materials.hook;
    this.marker.rotation.y = Math.PI / 4;
    this.marker.isPickable = false;
    this.resizeObserver = new ResizeObserver(() => { this.engine.resize(); this.configureCamera(); });
    this.resizeObserver.observe(canvas);
  }

  private configureCamera(): void {
    const portrait = this.engine.getRenderHeight() > this.engine.getRenderWidth();
    this.camera.position.set(0, portrait ? 15 : 11, portrait ? -23 : -15);
    this.camera.fovMode = portrait ? Camera.FOVMODE_VERTICAL_FIXED : Camera.FOVMODE_HORIZONTAL_FIXED;
    this.camera.fov = portrait ? 0.9 : 0.83;
    this.camera.setTarget(new Vector3(0, 0, portrait ? 13 : 6));
  }

  private box(name: string, size: Vector3, position: Vector3, material: string, parent?: TransformNode): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, this.scene);
    mesh.position.copyFrom(position);
    mesh.material = this.materials[material];
    if (parent) mesh.parent = parent;
    return mesh;
  }

  private buildHero(): TransformNode {
    const root = new TransformNode('pudge-blockout', this.scene);
    const belly = MeshBuilder.CreateSphere('belly', { diameter: 1.25, segments: 5 }, this.scene);
    belly.scaling.set(1, 1.13, 0.84);
    belly.position.y = 1.05;
    belly.material = this.materials.flesh;
    belly.parent = root;
    const head = MeshBuilder.CreateSphere('head', { diameter: 0.63, segments: 4 }, this.scene);
    head.position.set(0, 1.97, 0.1);
    head.material = this.materials.flesh;
    head.parent = root;
    this.box('apron', new Vector3(0.9, 0.93, 0.16), new Vector3(0, 0.78, 0.43), 'apron', root);
    this.box('apron-strap', new Vector3(0.17, 1, 0.98), new Vector3(-0.25, 1.34, 0), 'apron', root);
    for (const x of [-0.75, 0.75]) {
      const arm = this.box('arm', new Vector3(0.38, 0.82, 0.4), new Vector3(x, 1.18, 0.12), 'flesh', root);
      arm.rotation.z = x < 0 ? -0.17 : 0.17;
    }
    for (const x of [-0.3, 0.3]) this.limbs.push(this.box('boot', new Vector3(0.43, 0.49, 0.65), new Vector3(x, 0.25, 0.09), 'dark', root));
    const shadow = MeshBuilder.CreateDisc('hero-shadow', { radius: 0.83, tessellation: 24 }, this.scene);
    shadow.rotation.x = Math.PI / 2;
    shadow.position.y = 0.025;
    shadow.parent = root;
    shadow.material = this.materials.dark;
    return root;
  }

  private buildEnemy(id: string): TransformNode {
    const root = new TransformNode(id, this.scene);
    const body = MeshBuilder.CreateCylinder(`${id}-body`, { height: 1.15, diameterTop: 0.6, diameterBottom: 0.9, tessellation: 5 }, this.scene);
    body.position.y = 0.8;
    body.material = this.materials.enemyDark;
    body.parent = root;
    const head = MeshBuilder.CreateSphere(`${id}-head`, { diameter: 0.67, segments: 3 }, this.scene);
    head.position.set(0, 1.55, 0);
    head.material = this.materials.enemy;
    head.parent = root;
    for (const x of [-0.27, 0.27]) this.box('leg', new Vector3(0.24, 0.43, 0.32), new Vector3(x, 0.2, 0), 'enemyDark', root);
    for (const x of [-0.22, 0.22]) {
      const horn = MeshBuilder.CreateCylinder('horn', { height: 0.4, diameterTop: 0, diameterBottom: 0.16, tessellation: 4 }, this.scene);
      horn.position.set(x, 1.99, 0);
      horn.rotation.z = -x;
      horn.material = this.materials.enemy;
      horn.parent = root;
    }
    this.box('cleaver', new Vector3(0.13, 0.65, 0.35), new Vector3(-0.62, 0.9, -0.1), 'iron', root);
    return root;
  }

  private buildScenery(): void {
    for (let index = 0; index < 15; index++) {
      const section = new TransformNode(`road-section-${index}`, this.scene);
      section.position.z = index * 5;
      for (const sign of [-1, 1]) {
        this.box('verge', new Vector3(0.35, 0.15, 1.4), new Vector3(sign * 5.45, 0.1, 0), 'stone', section);
        const rock = this.box('rock', new Vector3(1.2 + index % 3, 0.6 + index % 4 * 0.28, 1.4), new Vector3(sign * (7.8 + index % 3), 0.3, 1.2), 'stone', section);
        rock.rotation.set(0.08, index * 1.3, 0.12);
        if (index % 2 === 0) {
          const trunk = this.box('dead-tree', new Vector3(0.28, 4.5, 0.28), new Vector3(sign * 12, 2.2, 1), 'dark', section);
          trunk.rotation.z = sign * 0.12;
          const branch = this.box('branch', new Vector3(0.17, 2.2, 0.17), new Vector3(sign * 12.45, 3, 1), 'dark', section);
          branch.rotation.z = sign * -0.6;
          this.box('lantern-post', new Vector3(0.12, 1.6, 0.12), new Vector3(sign * 6.1, 0.8, 0), 'dark', section);
          this.box('lantern', new Vector3(0.29, 0.4, 0.29), new Vector3(sign * 6.1, 1.75, 0), 'glow', section);
        }
      }
      this.box('road-slab', new Vector3(1.2, 0.025, 0.5), new Vector3((index % 5) * 1.4 - 2.8, 0.025, 1.5), 'stone', section).rotation.y = index;
      this.scenery.push(section);
    }
  }

  aim(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    // Babylon's createPickingRay already applies engine hardware scaling.
    // Its input must stay in CSS pixels, including on high-DPR phones.
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera, false);
    const distance = ray.intersectsPlane(new Plane(0, 1, 0, -0.65));
    const point = distance !== null && distance > 0 ? ray.origin.add(ray.direction.scale(distance)) : new Vector3(0, 0, 30);
    return { x: Math.max(-35, Math.min(35, point.x)), z: this.lastDistance + Math.max(0.6, Math.min(60, point.z)) };
  }

  render(sim: RunSimulation | null, aim: Point, moving: boolean): void {
    const state = sim?.state;
    const distance = state?.hero.z ?? 0;
    this.lastDistance = distance;
    const heroX = state?.hero.x ?? 0;
    this.hero.position.x = heroX;
    const animation = moving ? (state?.time ?? 0) : 0;
    this.hero.position.y = moving ? Math.sin(animation * 9) * 0.025 : 0;
    this.limbs.forEach((limb, index) => { limb.rotation.x = Math.sin(animation * 9 + index * Math.PI) * 0.22; });
    this.scenery.forEach((section, index) => { section.position.z = ((index * 5 - distance + 15) % 75 + 75) % 75 - 15; });
    const alive = new Set<string>();
    for (const enemy of state?.enemies ?? []) {
      alive.add(enemy.id);
      let mesh = this.enemies.get(enemy.id);
      if (!mesh) { mesh = this.buildEnemy(enemy.id); this.enemies.set(enemy.id, mesh); }
      mesh.position.set(enemy.x, enemy.status === 'captured' ? 0.6 : Math.sin(animation * 7 + enemy.z) * 0.03, enemy.z - distance);
      mesh.rotation.x = enemy.status === 'captured' ? Math.PI / 2 : 0;
      mesh.rotation.y = Math.PI;
    }
    for (const [id, mesh] of this.enemies) if (!alive.has(id)) { mesh.dispose(false, false); this.enemies.delete(id); }
    const hook = state?.hook;
    this.hook.setEnabled(Boolean(hook));
    this.chain.setEnabled(Boolean(hook));
    if (hook) {
      this.hook.position.set(hook.x, 0.9, hook.z - distance);
      this.hook.rotation.y = Math.atan2(hook.direction.x, hook.direction.z);
      MeshBuilder.CreateLines('chain', { points: [new Vector3(heroX + 0.72, 1.15, 0.25), this.hook.position.clone()], instance: this.chain }, this.scene);
    }
    const showAim = state?.phase === 'running' && !hook;
    this.aimLine.setEnabled(showAim);
    this.marker.setEnabled(showAim);
    if (showAim) {
      const direction = new Vector3(aim.x - heroX, 0, Math.max(0.6, aim.z - distance)).normalize();
      const length = Math.min(30, Math.hypot(aim.x - heroX, aim.z - distance));
      const target = new Vector3(heroX + direction.x * length, 0.055, direction.z * length);
      this.marker.position.copyFrom(target);
      MeshBuilder.CreateDashedLines('aim', { points: [new Vector3(heroX, 0.055, 0.65), target], instance: this.aimLine }, this.scene);
    }
    this.scene.render();
  }

  dispose(): void { this.resizeObserver.disconnect(); this.scene.dispose(); this.engine.dispose(); }
}
