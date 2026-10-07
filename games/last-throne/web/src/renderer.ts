import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import '@babylonjs/core/Rendering/outlineRenderer';
import '@babylonjs/core/Culling/ray';
import type { GameContent, Point, BuildingKind } from '../../core/content-r3';
const MeshBuilder = { CreateBox, CreateSphere, CreateCylinder, CreateTorus, CreateLines, CreateTube, CreatePolyhedron, CreatePlane };

/** The renderer observes simulation; it never advances ticks or applies damage. */
interface VisualUnit extends Point { id: string; kind?: string; hp: number; maxHp?: number; level?: number; constructionTicks?: number; readyTicks?: number; respawnTicks?: number; anchorId?: string; padId?: string; stolenSpell?: string | null; lastSpell?: string | null; items?: [string | null, string | null]; expedition?: { kind: string; remainingTicks: number; totalTicks: number; rewardId: string } | null; aegisToken?: boolean; hidden?: boolean; visible?: boolean; shield?: { remainingTicks: number; absorption: number }; slow?: { remainingTicks: number; percent: number }; teleport?: { targetAnchorId?: string; remainingTicks: number; from: Point; to: Point } }
export interface RendererGame { simTick: number; throneHp?: number; heroes: VisualUnit[]; buildings: VisualUnit[]; enemies: VisualUnit[]; summons: VisualUnit[] }
export interface RendererEvent { eventId: string; tick: number; type: string; effectId?: string; sourceId?: string; targetId?: string; source?: Point; target?: Point; position?: Point; durationTicks?: number; amount?: number; kind?: string; spellId?: string; radius?: number }
export type RendererPickKind = 'anchor' | 'pad' | 'hero' | 'building' | 'enemy' | 'expedition' | 'ground';
export interface RendererPick extends Point { kind: RendererPickKind; id?: string }
export interface RendererSelection { kind: RendererPickKind; id: string; previewKind?: BuildingKind; aim?: 'cast' | 'teleport' }
export interface RendererContextState { state: 'lost' | 'restored' | 'error'; message?: string }
interface Actor { root: TransformNode; model: TransformNode; hp: Mesh; hpBack: Mesh; key: string; flashUntil: number; born: number; riseAt?: number; shields?: Mesh[]; slowRing?: Mesh; itemMarkers?: Mesh[]; aegis?: Mesh; cosmeticBuild?: { start: number; ttl: number }; pull?: { from: Point; to: Point; start: number; ttl: number }; baseline: Array<{ mesh: Mesh; position: Vector3 }> }
interface Effect { nodes: Array<Mesh | TransformNode>; start: number; ttl: number; critical: boolean; family?: string; sourceId?: string; update: (t: number, age: number) => void }

export function createRenderer(canvas: HTMLCanvasElement, content: GameContent,
  onPick: (pick: RendererPick) => void,
  onContextState: (state: RendererContextState) => void = () => {}) {
  if (!Engine.IsSupported) throw new Error('Для игровой сцены требуется WebGL 2. Включите аппаратное ускорение браузера.');
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, doNotHandleContextLost: false }, false);
  if (engine.webGLVersion !== 2) { engine.dispose(); throw new Error('Браузер не создал WebGL 2. Партия не запущена; попробуйте Chrome с аппаратным ускорением.'); }
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.035, 0.067, 0.075, 1);
  scene.ambientColor = new Color3(0.12, 0.17, 0.17);
  const camera = new FreeCamera('fixed-siege-view', new Vector3(-0.7, 14, -20), scene);
  camera.setTarget(new Vector3(0, 0, 0)); camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = 0.1; camera.maxZ = 100;
  new HemisphericLight('sky', new Vector3(0.2, 1, 0.1), scene).intensity = 0.65;
  const sun = new DirectionalLight('moon', new Vector3(-0.6, -1, 0.7), scene); sun.intensity = 0.76;
  sun.diffuse = new Color3(0.76, 0.87, 0.82);
  let disposed = false, contextLost = false, clock = 0, lastTick = -1, quality: 'low' | 'high' = 'high';
  let current: RendererGame | undefined, selection: RendererSelection | null = null;
  const scale = content.map.scale;
  const materials = new Map<string, StandardMaterial>();
  const actors = new Map<string, Actor>();
  const placeMeshes = new Map<string, Mesh>();
  const expeditionMeshes = new Map<string, Mesh>();
  const absentGlyphs = new Map<string, { root: TransformNode; segments: Mesh[]; kind: string; progress: number }>();
  const effects: Effect[] = [];
  const visualEventCounts = new Map<string, number>();
  const seenEvents = new Set<string>(), eventOrder: string[] = [];
  let ghost: TransformNode | undefined, ghostKey = '';
  let range: Mesh | undefined;
  const material = (name: string, color: string, emission = 0, alpha = 1) => {
    if (materials.has(name)) return materials.get(name)!;
    const m = new StandardMaterial(name, scene); m.diffuseColor = Color3.FromHexString(color);
    m.emissiveColor = m.diffuseColor.scale(emission); m.specularColor = new Color3(0.08, 0.11, 0.11);
    if (emission >= 0.6) { m.disableLighting = true; m.emissiveColor = m.diffuseColor.clone(); }
    m.alpha = alpha; m.backFaceCulling = false; materials.set(name, m); return m;
  };
  const stone = material('weathered-stone', '#526364'), slate = material('basalt', '#273d42');
  const road = material('road', '#526564'), roadEdge = material('road-edge', '#859083');
  const gold = material('aged-brass', '#cbb06c'), wood = material('timber', '#815334');
  const leather = material('leather', '#3a2d29'), metal = material('iron', '#9caeae');
  const green = material('hero-rune', '#68e2a3', 0.62), amber = material('building-rune', '#e9b76b', 0.36);
  const energy = material('ancient-energy', '#73f6c1', 0.9), blue = material('arc-light', '#92dbe5', 0.85);
  const red = material('enemy-red', '#ba554c'), flesh = material('pudge-skin', '#b6bc89');
  const dark = material('dark', '#182c30'), foliage = material('pine', '#286052');
  const rotten = material('rotting-skin', '#729b72'), violet = material('stolen-shield', '#b9b0ef', 0.8), heal = material('life-sigil', '#83e7af', 0.8), strike = material('strike-rune', '#eb9d68', 0.8);
  const campAmber = material('camp-gold', '#e7bd64', 0.68), shopViolet = material('shop-violet', '#ba94f3', 0.72), roshanRed = material('roshan-sigil', '#df7162', 0.65);
  const expeditionMaterial = (kind?: string) => kind === 'shop' ? shopViolet : kind === 'roshan' ? roshanRed : campAmber;
  const ghostMaterial = material('construction-ghost', '#96e7d2', 0.35, 0.3);
  const rangeMaterial = material('range', '#74e2b1', 0.24, 0.12);
  // Simulation Y grows toward the lower lane. World +Z projects upward in this
  // fixed camera, so every simulation position uses Y → -Z; picking inverts it.
  const worldZ = (simY: number) => -simY * scale;
  const simulationY = (z: number) => -z / scale;
  const unitPos = (p: Point, height = 0) => new Vector3(p.x * scale, height, worldZ(p.y));
  const tag = (node: Mesh, pick?: RendererPick) => { node.isPickable = !!pick; if (pick) node.metadata = { pick }; return node; };
  const box = (name: string, size: [number, number, number], pos: [number, number, number], mat: StandardMaterial, parent?: TransformNode, pick?: RendererPick) => {
    const m = MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene);
    m.position.set(...pos); m.material = mat; if (parent) m.parent = parent; return tag(m, pick);
  };
  const sphere = (name: string, diameter: number, pos: [number, number, number], mat: StandardMaterial, parent?: TransformNode, pick?: RendererPick) => {
    const m = MeshBuilder.CreateSphere(name, { diameter, segments: 5 }, scene); m.convertToFlatShadedMesh(); m.position.set(...pos);
    m.material = mat; if (parent) m.parent = parent; return tag(m, pick);
  };
  const cylinder = (name: string, diameter: number, height: number, pos: [number, number, number], mat: StandardMaterial, parent?: TransformNode, pick?: RendererPick, top?: number) => {
    const m = MeshBuilder.CreateCylinder(name, { diameter, diameterTop: top ?? diameter, height, tessellation: 8 }, scene);
    m.position.set(...pos); m.material = mat; if (parent) m.parent = parent; return tag(m, pick);
  };
  const ring = (name: string, diameter: number, thickness: number, pos: Vector3, mat: StandardMaterial, parent?: TransformNode) => {
    const m = MeshBuilder.CreateTorus(name, { diameter, thickness, tessellation: 28 }, scene); m.position.copyFrom(pos);
    m.material = mat; if (parent) m.parent = parent; return tag(m);
  };
  const line = (name: string, points: Vector3[], color: Color3, old?: LinesMesh) => {
    const m = MeshBuilder.CreateLines(name, { points, instance: old, updatable: true }, scene); m.color = color; m.isPickable = false; return m;
  };
  const segment = (name: string, a: Vector3, b: Vector3, width: number, height: number, mat: StandardMaterial) => {
    const m = box(name, [Vector3.Distance(a, b), height, width], [0, 0, 0], mat);
    m.position.copyFrom(Vector3.Center(a, b)); m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x); return m;
  };
  const b = content.map.bounds, centerX = (b.minX + b.maxX) * scale / 2, centerZ = worldZ((b.minY + b.maxY) / 2);
  const width = (b.maxX - b.minX) * scale + 2, depth = (b.maxY - b.minY) * scale + 2;
  const ground = box('siege-island', [width, 0.72, depth], [centerX, -0.46, centerZ], slate, undefined, { kind: 'ground', x: 0, y: 0 });
  box('moss-cover', [width - 0.25, 0.05, depth - 0.25], [centerX, -0.065, centerZ], material('ground', '#365451'), undefined, { kind: 'ground', x: 0, y: 0 });
  content.map.paths.forEach((path, lane) => {
    for (let i = 1; i < path.length; i++) {
      const a = unitPos(path[i - 1]!, -0.015), z = unitPos(path[i]!, -0.015);
      segment(`lane-${lane}-${i}`, a, z, 0.9, 0.08, road);
      const tangent = z.subtract(a).normalize(), normal = new Vector3(-tangent.z, 0, tangent.x);
      for (const side of [-1, 1]) segment('road-border', a.add(normal.scale(side * 0.45)), z.add(normal.scale(side * 0.45)), 0.035, 0.09, roadEdge);
      const length = Vector3.Distance(a, z);
      for (let k = 0.45; k < length; k += 0.9) {
        const p = a.add(tangent.scale(k)); segment('paving-joint', p.add(normal.scale(-0.4)), p.add(normal.scale(0.4)), 0.025, 0.09, slate);
      }
    }
    const p = unitPos(path[0]!, 0.03);
    const gate = ring(`enemy-gate-${lane}`, 1.05, 0.075, p, red); gate.rotation.x = Math.PI / 2; gate.position.y = 0.55;
  });
  // A narrow stone trail describes the fixed flank; it never changes navigation.
  for (let i = 1; i < content.map.sidePath.length; i++) {
    const a = unitPos(content.map.sidePath[i - 1]!, 0.02), z = unitPos(content.map.sidePath[i]!, 0.02);
    segment(`flank-trail-${i}`, a, z, 0.30, 0.025, slate);
    const direction = z.subtract(a).normalize();
    for (let k = 0.3; k < Vector3.Distance(a, z); k += 0.8) { const p = a.add(direction.scale(k)); box('flank-trail-stone', [0.12, 0.025, 0.10], [p.x, 0.04, p.z], stone); }
  }
  for (const place of content.map.places) {
    const pick: RendererPick = { kind: place.kind === 'hero_anchor' ? 'anchor' : 'pad', id: place.id, x: place.x, y: place.y };
    const p = unitPos(place);
    if (place.kind === 'building_pad') {
      const foundation = box(place.id, [1.02, 0.12, 1.02], [p.x, 0.025, p.z], stone, undefined, pick); placeMeshes.set(place.id, foundation);
      box('foundation-inset', [0.8, 0.028, 0.8], [p.x, 0.10, p.z], slate, undefined, pick);
      for (const x of [-1, 1]) for (const z of [-1, 1]) {
        box('square-corner', [0.25, 0.026, 0.045], [p.x + x * 0.35, 0.13, p.z + z * 0.46], amber, undefined, pick);
        box('square-corner', [0.045, 0.026, 0.25], [p.x + x * 0.46, 0.13, p.z + z * 0.35], amber, undefined, pick);
      }
      box('build-plus-x', [0.33, 0.026, 0.055], [p.x, 0.13, p.z], amber, undefined, pick);
      box('build-plus-z', [0.055, 0.026, 0.33], [p.x, 0.13, p.z], amber, undefined, pick);
    } else {
      const anchor = cylinder(place.id, 1.12, 0.06, [p.x, 0.035, p.z], slate, undefined, pick); placeMeshes.set(place.id, anchor);
      const outer = ring('hero-circle', 1.01, 0.047, unitPos(place, 0.075), green); tag(outer, pick);
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3, rune = box('hero-rune-mark', [0.055, 0.03, 0.12], [p.x + Math.cos(a) * 0.37, 0.075, p.z + Math.sin(a) * 0.37], green, undefined, pick); rune.rotation.y = -a;
      }
    }
  }
  // Border scenery stays outside the paths and does not obscure tactical positions.
  for (let i = 0; i < 16; i++) {
    const x = -10.6 + i * 1.35, z = i % 2 ? 7.65 : -7.6;
    if (content.expeditions.some(destination => Math.hypot(x - destination.position.x * scale, z - worldZ(destination.position.y)) < 1.15)) continue;
    const rock = sphere('edge-rock', 0.65 + (i % 3) * 0.18, [x, 0.10, z], stone); rock.scaling.y = 0.6;
    if (i % 3 === 0) {
      cylinder('tree-trunk', 0.17, 0.75, [x + 0.2, 0.3, z + 0.15], wood);
      cylinder('pine-crown', 0.85, 1.65, [x + 0.2, 1.05, z + 0.15], foliage, undefined, undefined, 0.02);
    }
  }
  for (const [x, z] of [[7.1, -5.8], [7.6, 5.6], [-8.3, 3.4]] as Array<[number, number]>) {
    box('ruin-foot', [0.8, 0.22, 0.8], [x, 0.04, z], stone);
    const ruin = cylinder('broken-column', 0.42, 0.9, [x, 0.59, z], stone); ruin.rotation.z = 0.10;
    box('fallen-column', [1.1, 0.32, 0.35], [x + 0.6, 0.14, z + 0.4], slate).rotation.y = 0.55;
  }
  // Destination props are compact markers on the same battlefield, not forest combat scenes.
  for (const destination of content.expeditions) {
    const p = unitPos(destination.position), mat = expeditionMaterial(destination.kind);
    const pick: RendererPick = { kind: 'expedition', id: destination.kind, ...destination.position };
    const platform = MeshBuilder.CreateCylinder(`expedition-${destination.kind}`, { diameter: 1.28, height: 0.12, tessellation: 6 }, scene);
    platform.position.copyFrom(p.add(new Vector3(0, 0.055, 0))); platform.material = slate; tag(platform, pick); expeditionMeshes.set(destination.kind, platform);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3, mark = box('expedition-sigil-mark', [0.22, 0.026, 0.045], [p.x + Math.cos(a) * 0.55, 0.13, p.z + Math.sin(a) * 0.55], mat, undefined, pick); mark.rotation.y = -a; }
    const prop = new TransformNode(`destination-${destination.kind}`, scene); prop.position.copyFrom(p);
    if (destination.kind === 'camp') {
      box('camp-chest', [0.70, 0.38, 0.42], [0, 0.33, 0], wood, prop, pick);
      box('camp-chest-lid', [0.76, 0.14, 0.46], [0, 0.60, 0.07], gold, prop, pick).rotation.x = -0.25;
      for (const x of [-0.23, 0.23]) box('camp-chest-band', [0.045, 0.39, 0.45], [x, 0.35, 0], gold, prop, pick);
      cylinder('camp-gold-pile', 0.23, 0.11, [0.33, 0.21, -0.18], campAmber, prop, pick);
    } else if (destination.kind === 'shop') {
      for (const x of [-0.42, 0.42]) cylinder('shop-pillar', 0.075, 0.95, [x, 0.56, 0.13], wood, prop, pick);
      const canopy = box('shop-canopy', [1.06, 0.12, 0.70], [0, 1.04, 0.07], material('shop-cloth', '#56436c'), prop, pick); canopy.rotation.z = 0.06;
      box('shop-counter', [0.9, 0.16, 0.35], [0, 0.43, -0.10], gold, prop, pick);
      for (let i = 0; i < 3; i++) { const crystal = MeshBuilder.CreatePolyhedron('shop-crystal', { type: 1, size: 0.10 }, scene); crystal.parent = prop; crystal.position.set((i - 1) * 0.24, 0.63, -0.12); crystal.scaling.y = 1.5; crystal.material = shopViolet; tag(crystal, pick); }
    } else {
      for (const x of [-0.44, 0.44]) { box('roshan-cave-pillar', [0.27, 0.72, 0.34], [x, 0.47, 0.1], stone, prop, pick); cylinder('roshan-horn', 0.13, 0.45, [x, 1.01, 0.1], gold, prop, pick, 0.015); }
      box('roshan-cave-lintel', [1.12, 0.20, 0.37], [0, 0.87, 0.10], stone, prop, pick);
      const aegis = ring('roshan-aegis', 0.44, 0.075, new Vector3(0, 0.55, -0.12), campAmber, prop); aegis.rotation.x = Math.PI / 2; tag(aegis, pick);
      box('roshan-aegis-core', [0.12, 0.25, 0.065], [0, 0.55, -0.12], roshanRed, prop, pick);
    }
  }
  const throne = new TransformNode('ancient-throne', scene); throne.position.copyFrom(unitPos(content.map.throne));
  cylinder('ancient-plinth', 2.0, 0.35, [0, 0.12, 0], stone, throne);
  cylinder('ancient-step', 1.55, 0.2, [0, 0.4, 0], slate, throne);
  const throneCrystal = MeshBuilder.CreatePolyhedron('ancient-heart', { type: 1, size: 0.63 }, scene); throneCrystal.parent = throne;
  throneCrystal.position.y = 1.2; throneCrystal.scaling.set(0.65, 1.5, 0.65); throneCrystal.material = energy; throneCrystal.isPickable = false;
  const throneRing = ring('ancient-orbit', 1.2, 0.048, new Vector3(0, 1.06, 0), green, throne);
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    const pillar = cylinder('ancient-crown', 0.28, 1.45, [Math.cos(a) * 0.63, 0.94, Math.sin(a) * 0.63], stone, throne, undefined, 0.15);
    pillar.rotation.z = Math.cos(a) * 0.12;
    sphere('crown-ember', 0.11, [Math.cos(a) * 0.63, 1.65, Math.sin(a) * 0.63], green, throne);
  }

  function makeModel(kind: string, parent: TransformNode, pick?: RendererPick): TransformNode {
    const model = new TransformNode(`${kind}-model`, scene); model.parent = parent;
    if (kind === 'pudge') {
      box('butcher-boots', [0.65, 0.22, 0.42], [0, 0.2, 0], leather, model, pick);
      const belly = sphere('butcher-belly', 0.88, [0, 0.66, 0], flesh, model, pick); belly.scaling.set(0.92, 1.04, 0.83);
      box('blood-apron', [0.52, 0.58, 0.06], [0, 0.56, -0.34], leather, model, pick);
      sphere('butcher-head', 0.43, [0, 1.2, 0], flesh, model, pick);
      box('butcher-mouth', [0.3, 0.055, 0.10], [0, 1.10, -0.21], dark, model, pick);
      for (const x of [-0.1, 0.1]) sphere('butcher-eye', 0.055, [x, 1.26, -0.2], green, model, pick);
      const arm = sphere('butcher-arm', 0.3, [-0.51, 0.83, 0], flesh, model, pick); arm.scaling.y = 1.65;
      sphere('hook-arm', 0.29, [0.48, 0.87, 0], flesh, model, pick);
      box('cleaver-handle', [0.075, 0.47, 0.075], [-0.57, 0.53, -0.19], wood, model, pick);
      const blade = box('cleaver-blade', [0.35, 0.4, 0.075], [-0.67, 0.88, -0.19], metal, model, pick); blade.rotation.z = -0.15;
      const hook = MeshBuilder.CreateTube('butcher-hook', { path: [new Vector3(0.43, 0.84, -0.1), new Vector3(0.73, 0.67, -0.1), new Vector3(0.88, 0.84, -0.1), new Vector3(0.76, 1.03, -0.1), new Vector3(0.66, 0.91, -0.1)], radius: 0.052, tessellation: 5 }, scene);
      hook.parent = model; hook.material = metal; tag(hook, pick);
      for (let i = 0; i < 5; i++) box('apron-stitch', [0.1, 0.025, 0.02], [-0.20 + i * 0.10, 0.73 - i * 0.025, -0.38], gold, model, pick).rotation.z = 0.5;
    } else if (kind === 'shaman') {
      cylinder('shaman-robe', 0.62, 0.95, [0, 0.65, 0], material('shaman-robe', '#944e35'), model, pick, 0.38);
      box('shaman-shoulders', [0.85, 0.13, 0.3], [0, 1.12, 0], gold, model, pick);
      box('shaman-mask', [0.39, 0.48, 0.13], [0, 1.42, -0.06], gold, model, pick);
      for (const x of [-0.1, 0.1]) sphere('mask-eye', 0.07, [x, 1.46, -0.145], energy, model, pick);
      for (let i = 0; i < 5; i++) {
        const feather = box('shaman-feather', [0.1, 0.48 + (2 - Math.abs(i - 2)) * 0.10, 0.065], [(i - 2) * 0.12, 1.73, 0.06], i % 2 ? blue : red, model, pick); feather.rotation.z = -(i - 2) * 0.2;
      }
      cylinder('shaman-staff', 0.065, 1.8, [0.52, 0.91, -0.07], wood, model, pick);
      ring('staff-ring', 0.37, 0.05, new Vector3(0.52, 1.82, -0.07), gold, model).rotation.x = Math.PI / 2;
      sphere('staff-charge', 0.22, [0.52, 1.82, -0.07], energy, model, pick);
    } else if (kind === 'undying' || kind === 'zombie') {
      const zombie = kind === 'zombie';
      for (const x of [-0.17, 0.17]) box('undead-leg', [0.16, 0.48, 0.20], [x, 0.30, 0], leather, model, pick);
      const torso = sphere('undead-torso', 0.72, [0, 0.91, 0.06], rotten, model, pick); torso.scaling.set(0.8, 1.3, 0.75); torso.rotation.x = -0.12;
      for (let i = 0; i < 4; i++) box('exposed-rib', [0.37 - i * 0.035, 0.038, 0.055], [0, 0.72 + i * 0.11, -0.22], stone, model, pick);
      sphere('undead-head', 0.33, [0, 1.50, -0.07], rotten, model, pick);
      for (const x of [-0.08, 0.08]) sphere('undead-eye', 0.055, [x, 1.54, -0.23], green, model, pick);
      for (const x of [-0.40, 0.40]) { const arm = box('undead-arm', [0.16, 0.72, 0.16], [x, 0.94, -0.06], rotten, model, pick); arm.rotation.x = zombie ? -0.85 : -0.3; arm.rotation.z = x > 0 ? 0.18 : -0.18; }
      if (zombie) model.scaling.setAll(0.6);
      else { box('undying-back-grave', [0.62, 0.8, 0.18], [0, 1.02, 0.35], slate, model, pick); box('undying-shoulder', [0.85, 0.16, 0.26], [0, 1.3, 0.05], stone, model, pick); }
    } else if (kind === 'rubick') {
      cylinder('rubick-robes', 0.6, 0.95, [0, 0.75, 0], material('rubick-robes', '#43436a'), model, pick, 0.29);
      box('rubick-cape', [0.6, 0.9, 0.12], [0, 0.83, 0.23], foliage, model, pick);
      box('rubick-mask', [0.32, 0.40, 0.22], [0, 1.48, 0], gold, model, pick);
      for (const x of [-0.07, 0.07]) sphere('rubick-eye', 0.055, [x, 1.5, -0.13], green, model, pick);
      cylinder('rubick-staff', 0.065, 1.8, [0.48, 1.05, -0.08], gold, model, pick);
      const staff = ring('rubick-staff-crown', 0.4, 0.048, new Vector3(0.48, 1.9, -0.08), green, model); staff.rotation.x = Math.PI / 2;
      sphere('rubick-carried-spell', 0.18, [0.48, 1.9, -0.08], green, model, pick);
      for (let i = 0; i < 3; i++) { const fragment = MeshBuilder.CreatePolyhedron('rubick-floating-fragment', { type: 1, size: 0.10 }, scene); fragment.parent = model; fragment.position.set(Math.cos(i * 2.1) * 0.52, 1.35 + i * 0.1, Math.sin(i * 2.1) * 0.36); fragment.material = green; tag(fragment, pick); }
    } else if (kind === 'sniper') {
      for (const x of [-0.16, 0.16]) box('sniper-boot', [0.21, 0.26, 0.26], [x, 0.20, 0], leather, model, pick);
      cylinder('sniper-coat', 0.55, 0.65, [0, 0.61, 0], wood, model, pick, 0.43);
      sphere('sniper-head', 0.36, [0, 1.13, -0.05], flesh, model, pick);
      cylinder('sniper-beard', 0.33, 0.30, [0, 1.0, -0.18], metal, model, pick, 0.05);
      cylinder('sniper-hat', 0.50, 0.21, [0, 1.38, -0.03], foliage, model, pick);
      cylinder('sniper-hat-brim', 0.65, 0.055, [0, 1.29, -0.03], foliage, model, pick);
      for (const x of [-0.09, 0.09]) sphere('sniper-goggle', 0.10, [x, 1.16, -0.23], gold, model, pick);
      box('rifle-stock', [0.53, 0.16, 0.15], [0.05, 0.86, -0.27], wood, model, pick);
      box('rifle-barrel', [0.92, 0.055, 0.065], [-0.56, 0.90, -0.27], metal, model, pick);
      box('rifle-scope', [0.3, 0.09, 0.08], [-0.25, 1.03, -0.27], dark, model, pick);
    } else if (kind === 'tombstone') {
      box('grave-base', [0.87, 0.15, 0.64], [0, 0.12, 0], slate, model);
      box('grave-slab', [0.60, 1.12, 0.24], [0, 0.73, 0], stone, model).rotation.z = -0.04;
      box('grave-cap', [0.72, 0.16, 0.30], [0, 1.26, 0], slate, model);
      box('grave-rune-vertical', [0.035, 0.52, 0.025], [0, 0.80, -0.14], green, model);
      box('grave-rune-cross', [0.29, 0.04, 0.025], [0, 0.9, -0.14], green, model);
      sphere('grave-skull', 0.19, [0, 0.53, -0.15], flesh, model);
    } else if (kind === 'slow_totem') {
      cylinder('totem-foot', 0.85, 0.2, [0, 0.22, 0], stone, model, pick);
      for (let i = 0; i < 3; i++) { const block = box('carved-totem-block', [0.43, 0.3, 0.43], [0, 0.52 + i * 0.30, 0], wood, model, pick); block.rotation.y = i * 0.12; box('totem-ice-rune', [0.2, 0.065, 0.03], [0, 0.53 + i * 0.30, -0.23], blue, model, pick); }
      const crown = MeshBuilder.CreatePolyhedron('totem-crown', { type: 1, size: 0.22 }, scene); crown.parent = model; crown.position.y = 1.5; crown.material = blue; tag(crown, pick);
      ring('totem-orbit', 0.74, 0.04, new Vector3(0, 1.1, 0), blue, model);
    } else if (kind === 'ballista') {
      box('ballista-base', [0.72, 0.23, 0.83], [0, 0.27, 0], wood, model, pick);
      cylinder('ballista-stand', 0.31, 0.55, [0, 0.57, 0], stone, model, pick);
      const beam = box('ballista-beam', [1.05, 0.16, 0.22], [0, 0.84, 0], wood, model, pick); beam.rotation.z = -0.1;
      const bow = MeshBuilder.CreateTube('ballista-bow', { path: [new Vector3(-0.46, 0.91, -0.57), new Vector3(-0.69, 0.91, 0), new Vector3(-0.46, 0.91, 0.57)], radius: 0.075, tessellation: 5 }, scene); bow.parent = model; bow.material = wood; tag(bow, pick);
      const string = line('ballista-string', [new Vector3(-0.46, 0.91, -0.57), new Vector3(0.15, 0.91, 0), new Vector3(-0.46, 0.91, 0.57)], gold.diffuseColor); string.parent = model;
      box('ballista-bolt', [0.94, 0.04, 0.04], [-0.06, 0.94, 0], metal, model, pick);
      for (const z of [-0.39, 0.39]) for (const x of [-0.25, 0.25]) {
        const wheel = cylinder('ballista-wheel', 0.29, 0.12, [x, 0.28, z], leather, model, pick); wheel.rotation.x = Math.PI / 2;
      }
    } else if (kind === 'magic_tower') {
      cylinder('tower-foot', 0.85, 0.22, [0, 0.23, 0], stone, model, pick);
      cylinder('tower-column', 0.62, 0.8, [0, 0.72, 0], slate, model, pick, 0.43);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2; box('tower-inlay', [0.05, 0.66, 0.05], [Math.cos(a) * 0.24, 0.69, Math.sin(a) * 0.24], blue, model, pick);
      }
      const crystal = MeshBuilder.CreatePolyhedron('tower-crystal', { type: 1, size: 0.30 }, scene); crystal.parent = model; crystal.position.y = 1.4; crystal.scaling.y = 1.55; crystal.material = blue; tag(crystal, pick);
      ring('tower-orbit-a', 0.90, 0.048, new Vector3(0, 1.4, 0), gold, model);
      const tilted = ring('tower-orbit-b', 0.73, 0.038, new Vector3(0, 1.4, 0), blue, model); tilted.rotation.z = 0.7;
    } else if (kind === 'snake') {
      cylinder('snake-plinth', 0.35, 0.16, [0, 0.14, 0], gold, model);
      const coil = MeshBuilder.CreateTube('serpent-body', { path: [new Vector3(-0.13, 0.22, 0), new Vector3(0.1, 0.45, 0), new Vector3(-0.05, 0.66, 0), new Vector3(0, 0.91, 0)], radius: 0.07, tessellation: 5 }, scene); coil.parent = model; coil.material = gold; coil.isPickable = false;
      const head = sphere('serpent-head', 0.28, [0, 0.98, 0], green, model); head.scaling.set(1.2, 0.8, 1);
      box('serpent-tongue', [0.03, 0.035, 0.16], [0, 0.96, -0.19], red, model);
    } else if (kind === 'healer') {
      cylinder('healer-robe', 0.40, 0.64, [0, 0.48, 0], material('healer-cloth', '#536f67'), model, pick, 0.26);
      sphere('healer-hood', 0.31, [0, 0.94, 0], stone, model, pick);
      cylinder('healer-staff', 0.052, 1.20, [0.33, 0.67, -0.03], wood, model, pick);
      box('healer-cross-v', [0.055, 0.27, 0.055], [0.33, 1.32, -0.03], heal, model, pick);
      box('healer-cross-h', [0.24, 0.055, 0.055], [0.33, 1.32, -0.03], heal, model, pick);
      box('healer-satchel', [0.22, 0.25, 0.13], [-0.23, 0.58, 0.05], leather, model, pick);
    } else if (kind === 'saboteur' || kind === 'bypass_commander') {
      const commander = kind === 'bypass_commander';
      cylinder('flanker-cloak', commander ? 0.65 : 0.38, commander ? 0.98 : 0.58, [0, commander ? 0.68 : 0.45, 0], dark, model, pick, 0.20);
      sphere('flanker-hood', commander ? 0.37 : 0.25, [0, commander ? 1.30 : 0.84, 0], slate, model, pick);
      box('flanker-mask', [commander ? 0.31 : 0.18, 0.06, 0.06], [0, commander ? 1.31 : 0.84, commander ? -0.18 : -0.12], red, model, pick);
      for (const x of [-1, 1]) { const knife = box('flanker-dagger', [0.055, commander ? 0.52 : 0.32, 0.06], [x * (commander ? 0.37 : 0.23), commander ? 0.72 : 0.48, -0.14], metal, model, pick); knife.rotation.z = x * 0.40; }
      if (commander) { box('flanker-mantle', [0.95, 0.15, 0.38], [0, 1.09, 0.08], red, model, pick); for (const x of [-0.3, 0.3]) cylinder('flanker-crown', 0.10, 0.28, [x, 1.47, 0], gold, model, pick, 0.015); }
    } else if (kind === 'armored') {
      box('elite-boots', [0.48, 0.19, 0.31], [0, 0.18, 0], leather, model, pick);
      box('elite-plate', [0.57, 0.66, 0.38], [0, 0.61, 0], metal, model, pick);
      sphere('elite-helm', 0.32, [0, 1.10, 0], metal, model, pick);
      box('elite-visor', [0.27, 0.06, 0.035], [0, 1.13, -0.17], red, model, pick);
      box('elite-shield', [0.42, 0.63, 0.12], [-0.35, 0.66, -0.11], slate, model, pick);
      box('elite-shield-stripe', [0.055, 0.50, 0.025], [-0.35, 0.66, -0.19], gold, model, pick);
      box('elite-sword', [0.085, 0.63, 0.055], [0.38, 0.79, -0.12], metal, model, pick);
    } else if (kind === 'arcane_commander' || kind.includes('mage') || kind.includes('caster')) {
      cylinder('commander-robe', 0.84, 1.2, [0, 0.79, 0], red, model, pick, 0.48);
      box('commander-armor', [1.05, 0.22, 0.42], [0, 1.32, 0], metal, model, pick);
      sphere('commander-mask', 0.42, [0, 1.62, 0], dark, model, pick);
      for (const x of [-0.16, 0.16]) cylinder('commander-horn', 0.12, 0.45, [x, 1.96, 0], gold, model, pick, 0.02);
      cylinder('commander-staff', 0.09, 1.85, [0.60, 0.95, -0.08], metal, model, pick);
      sphere('commander-focus', 0.21, [0.60, 1.9, -0.08], strike, model, pick);
      for (let i = 0; i < 3; i++) { const orbit = ring('enhancement-crown', 0.50 + i * 0.2, 0.028, new Vector3(0, 1.88 + i * 0.14, 0), violet, model); orbit.rotation.z = i * 0.40; }
    } else if (kind === 'siege' || kind === 'siege_machine' || kind.includes('commander')) {
      box('siege-frame', [1.12, 0.48, 0.68], [0, 0.49, 0], leather, model, pick);
      box('siege-armor', [0.9, 0.24, 0.76], [0, 0.84, 0], red, model, pick);
      cylinder('siege-mast', 0.07, 1.7, [0.25, 1.07, 0], metal, model, pick);
      box('siege-banner', [0.42, 0.40, 0.035], [0.06, 1.73, 0], red, model, pick);
      for (const x of [-0.42, 0.42]) for (const z of [-0.43, 0.43]) {
        const wheel = cylinder('siege-wheel', 0.55, 0.15, [x, 0.37, z], metal, model, pick); wheel.rotation.x = Math.PI / 2;
      }
      if (kind === 'siege_machine') { box('catapult-arm', [1.28, 0.12, 0.12], [0, 0.97, -0.06], wood, model, pick).rotation.z = -0.45; sphere('catapult-payload', 0.27, [-0.53, 1.20, -0.06], stone, model, pick); }
    } else {
      cylinder('creep-body', 0.32, 0.5, [0, 0.48, 0], red, model, pick, 0.21);
      sphere('creep-head', 0.25, [0, 0.86, 0], kind === 'ranged' ? gold : metal, model, pick);
      box('creep-feet', [0.33, 0.17, 0.26], [0, 0.15, 0], leather, model, pick);
      if (kind === 'ranged') {
        box('creep-crossbow', [0.4, 0.055, 0.08], [0, 0.59, -0.24], wood, model, pick);
        cylinder('creep-quiver', 0.14, 0.36, [0, 0.54, 0.2], leather, model, pick);
      } else box('creep-blade', [0.10, 0.41, 0.055], [0.25, 0.66, -0.12], metal, model, pick).rotation.z = 0.26;
    }
    return model;
  }

  function createActor(unit: VisualUnit, role: RendererPickKind): Actor {
    const root = new TransformNode(unit.id, scene), pick: RendererPick = { kind: role, id: unit.id, x: unit.x, y: unit.y };
    const model = makeModel(unit.kind ?? (role === 'ground' ? 'snake' : 'melee'), root, role === 'ground' ? undefined : pick);
    const hpBack = MeshBuilder.CreatePlane('hp-background', { width: 0.80, height: 0.065 }, scene); hpBack.parent = root; hpBack.position.y = role === 'hero' ? 2.2 : role === 'building' ? 1.92 : unit.kind?.includes('commander') ? 2.45 : 1.32; hpBack.material = dark; hpBack.billboardMode = Mesh.BILLBOARDMODE_ALL; hpBack.isPickable = false;
    const hp = MeshBuilder.CreatePlane('hp', { width: 0.74, height: 0.038 }, scene); hp.parent = hpBack; hp.position.z = -0.006; hp.material = role === 'enemy' ? red : green; hp.isPickable = false;
    const result: Actor = { root, model, hp, hpBack, key: `${role}:${unit.kind ?? ''}:${unit.level ?? 1}`, born: clock, flashUntil: 0,
      baseline: model.getChildMeshes().filter((x): x is Mesh => x instanceof Mesh).map(mesh => ({ mesh, position: mesh.position.clone() })) };
    if ((unit.level ?? 1) > 1) for (let i = 0; i < (unit.level ?? 1) - 1; i++) {
      ring('upgrade-band', role === 'building' ? 0.75 : 0.65, 0.035, new Vector3(0, 0.45 + i * 0.21, 0), gold, model);
    }
    return result;
  }
  function allUnits(): VisualUnit[] { return current ? [...current.heroes, ...current.buildings, ...current.enemies, ...current.summons] : []; }
  const getUnit = (id?: string) => id ? allUnits().find(x => x.id === id) : undefined;
  function updateExpeditionGlyphs(heroes: VisualUnit[]) {
    const absent = new Set<string>();
    for (const hero of heroes) if (hero.expedition) {
      absent.add(hero.id); const expedition = hero.expedition;
      let glyph = absentGlyphs.get(hero.id);
      if (glyph && glyph.kind !== expedition.kind) { glyph.root.dispose(); absentGlyphs.delete(hero.id); glyph = undefined; }
      if (!glyph) {
        const root = new TransformNode(`reserved-expedition-${hero.id}`, scene), segments: Mesh[] = [], mat = expeditionMaterial(expedition.kind);
        const p = content.map.places.find(p => p.id === hero.anchorId) ?? hero; root.position.copyFrom(unitPos(p, 0.10));
        ring('reserved-expedition-outline', 0.88, 0.030, new Vector3(0, 0.015, 0), mat, root);
        for (let i = 0; i < 12; i++) { const a = -Math.PI / 2 + i * Math.PI / 6, segment = box('expedition-progress-segment', [0.15, 0.028, 0.055], [Math.cos(a) * 0.40, 0.035, Math.sin(a) * 0.40], mat, root); segment.rotation.y = -a; segments.push(segment); }
        cylinder('expedition-hourglass-upper', 0.22, 0.21, [0, 0.30, 0], mat, root, undefined, 0.025);
        cylinder('expedition-hourglass-lower', 0.025, 0.21, [0, 0.51, 0], mat, root, undefined, 0.22);
        glyph = { root, segments, kind: expedition.kind, progress: 0 }; absentGlyphs.set(hero.id, glyph);
      }
      glyph.progress = Math.max(0, Math.min(1, 1 - expedition.remainingTicks / Math.max(1, expedition.totalTicks)));
      glyph.segments.forEach((segment, i) => { segment.visibility = i < Math.floor(glyph!.progress * 12) ? 1 : 0.18; });
    }
    for (const [id, glyph] of absentGlyphs) if (!absent.has(id)) { glyph.root.dispose(); absentGlyphs.delete(id); }
  }
  function addEffect(effect: Effect) {
    // Bound transient graphics. Critical ability telegraphs displace secondary bolts first.
    if (effects.length >= 100) {
      const i = effects.findIndex(e => !e.critical); const old = effects.splice(i < 0 ? 0 : i, 1)[0]!; old.nodes.forEach(n => n.dispose());
    }
    effects.push(effect);
  }
  function burst(position: Point, color: StandardMaterial, size = 0.36, ttl = 0.35) {
    const flash = sphere('impact', size, [position.x * scale, 0.65, worldZ(position.y)], color);
    const halo = ring('impact-wave', size * 1.5, 0.024, unitPos(position, 0.12), color);
    addEffect({ nodes: [flash, halo], start: clock, ttl, critical: false, update(t) { flash.scaling.setAll(0.5 + t * 1.5); flash.visibility = 1 - t; halo.scaling.setAll(1 + t * 2.3); halo.visibility = 1 - t; } });
  }
  function spellMaterial(spell?: string | null) { return spell === 'area_heal' ? heal : spell === 'area_strike' ? strike : spell === 'temporary_shield' ? violet : green; }
  function animateEvent(event: RendererEvent) {
    const type = event.effectId ?? event.type, from = event.source ?? getUnit(event.sourceId) ?? event.position ?? content.map.throne;
    if (event.effectId) visualEventCounts.set(type, (visualEventCounts.get(type) ?? 0) + 1);
    // Hidden enemies have no model, health bar, trace or targeting affordance.
    if (type !== 'detection_reveal' && [getUnit(event.sourceId), getUnit(event.targetId)].some(u => u?.hidden && u.visible === false)) return;
    const to = event.target ?? getUnit(event.targetId) ?? event.position ?? from;
    const target = actors.get(event.targetId ?? ''); if (target) target.flashUntil = clock + 0.16;
    if (event.type === 'projectile_hit') { burst(to, type === 'snake_bolt' ? green : type.includes('pudge') || type === 'hook_pull' ? amber : blue, 0.22, 0.2); return; }
    if (type === 'expedition_depart' || type === 'expedition_return') {
      const mat = expeditionMaterial(event.kind), a = unitPos(from, 0.35), z = unitPos(to, 0.35);
      const at = (t: number) => Vector3.Lerp(a, z, t).add(new Vector3(0, Math.sin(t * Math.PI) * 1.5, 0));
      const path = line('expedition-route', Array.from({ length: 16 }, (_, i) => at(i / 15)), mat.diffuseColor);
      const departure = ring('expedition-source-rune', 0.88, 0.035, unitPos(from, 0.14), mat), arrival = ring('expedition-target-rune', 0.88, 0.045, unitPos(to, 0.14), mat);
      const parcel = MeshBuilder.CreatePolyhedron('expedition-travelling-sigil', { type: 1, size: 0.16 }, scene); parcel.material = mat; parcel.isPickable = false;
      addEffect({ nodes: [path, departure, arrival, parcel], start: clock, ttl: type === 'expedition_return' ? 1.15 : 0.95, critical: true, family: type, sourceId: event.sourceId, update(t) { parcel.position.copyFrom(at(Math.min(1, t * 1.15))); parcel.rotation.y = t * 7; parcel.visibility = t < 0.90 ? 1 : (1 - t) * 10; departure.scaling.setAll(1 - t * 0.5); arrival.scaling.setAll(0.6 + t * 0.8); path.visibility = departure.visibility = arrival.visibility = 1 - t * 0.8; } });
    } else if (type === 'aegis_revive') {
      const p = event.position ?? to, lower = ring('aegis-rebirth-lower', 1.0, 0.065, unitPos(p, 0.12), campAmber), upper = ring('aegis-rebirth-crown', 0.7, 0.045, unitPos(p, 1.3), campAmber);
      const wings: Mesh[] = [];
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3, m = box('aegis-rebirth-wing', [0.075, 1.3, 0.055], [p.x * scale + Math.cos(a) * 0.5, 0.85, worldZ(p.y) + Math.sin(a) * 0.5], i % 2 ? campAmber : heal); m.rotation.z = Math.cos(a) * 0.25; wings.push(m); }
      addEffect({ nodes: [lower, upper, ...wings], start: clock, ttl: 1.2, critical: true, family: type, update(t) { lower.scaling.setAll(0.6 + t * 1.7); upper.position.y = 0.45 + Math.min(1, t * 2) * 1.65; upper.rotation.y = t * 3; lower.visibility = upper.visibility = 1 - Math.max(0, t - 0.55) / 0.45; wings.forEach((m, i) => { m.position.y = 0.3 + t * 1.8; m.visibility = 1 - t; m.scaling.y = 0.3 + Math.sin(t * Math.PI) * 0.7; }); } });
    } else if (type === 'item_equipped' || type === 'reward_pending' || type === 'expedition_reward') {
      const p = event.position ?? to, mat = type === 'item_equipped' ? shopViolet : campAmber;
      const halo = ring('reward-seal', 0.8, 0.04, unitPos(p, 0.18), mat);
      const gems = Array.from({ length: 3 }, (_, i) => { const m = MeshBuilder.CreatePolyhedron('reward-rising-token', { type: 1, size: 0.11 }, scene); m.material = mat; m.isPickable = false; m.position.copyFrom(unitPos(p, 0.5)); return m; });
      addEffect({ nodes: [halo, ...gems], start: clock, ttl: 1.0, critical: true, family: type, update(t) { halo.scaling.setAll(0.7 + t * 0.65); halo.visibility = 1 - t; gems.forEach((m, i) => { const a = i * Math.PI * 2 / 3 + t; m.position.set(p.x * scale + Math.cos(a) * 0.35, 0.4 + t * 1.7, worldZ(p.y) + Math.sin(a) * 0.35); m.rotation.y = t * 6; m.visibility = 1 - t; }); } });
    } else if (type === 'healing_aura' || type === 'enemy_heal') {
      const source = unitPos(from, 0.6), targetPos = unitPos(to, 0.6), trace = line('healing-link', [source, Vector3.Center(source, targetPos).add(new Vector3(0, 0.6, 0)), targetPos], heal.diffuseColor);
      const glyphs = [box('aura-cross-v', [0.055, 0.34, 0.055], [targetPos.x, 0.4, targetPos.z], heal), box('aura-cross-h', [0.28, 0.055, 0.055], [targetPos.x, 0.4, targetPos.z], heal)];
      const halo = ring('healing-target', 0.65, 0.032, unitPos(to, 0.11), type === 'enemy_heal' ? amber : heal);
      addEffect({ nodes: [trace, halo, ...glyphs], start: clock, ttl: 0.65, critical: true, family: type, update(t) { trace.visibility = 1 - t; halo.scaling.setAll(0.6 + t); halo.visibility = 1 - t; glyphs.forEach(m => { m.position.y = 0.4 + t; m.visibility = 1 - t; }); } });
    } else if (type === 'detection_reveal') {
      const p = event.position ?? to, halo = ring('detection-reveal-circle', 0.7, 0.045, unitPos(p, 0.11), blue);
      const brackets = [-1, 1].map(side => box('detection-bracket', [0.045, 0.6, 0.05], [p.x * scale + side * 0.36, 0.7, worldZ(p.y)], blue));
      addEffect({ nodes: [halo, ...brackets], start: clock, ttl: 0.65, critical: true, family: type, update(t) { halo.scaling.setAll(1 + t * 0.5); halo.visibility = 1 - t; brackets.forEach((m, i) => { m.position.x = p.x * scale + (i ? 1 : -1) * (0.55 - t * 0.20); m.visibility = 1 - t; }); } });
    } else if (type === 'rubick_steal') {
      const a = unitPos(from, 1.5), z = unitPos(to, 1.9).add(new Vector3(0.48, 0, -0.08)), control = Vector3.Center(a, z).add(new Vector3(0, 1.7, 0));
      const at = (t: number) => a.scale((1 - t) ** 2).add(control.scale(2 * t * (1 - t))).add(z.scale(t * t));
      const arc = line('spell-theft-arc', Array.from({ length: 13 }, (_, i) => at(i / 12)), green.diffuseColor);
      const fragments = Array.from({ length: 6 }, (_, i) => { const m = MeshBuilder.CreatePolyhedron('stolen-magic-fragment', { type: 1, size: i % 2 ? 0.085 : 0.12 }, scene); m.material = i % 2 ? green : spellMaterial(event.spellId); m.isPickable = false; return m; });
      addEffect({ nodes: [arc, ...fragments], start: clock, ttl: Math.max(0.7, (event.durationTicks ?? 18) / content.ticksPerSecond), critical: true, family: 'rubick_theft', update(t) { arc.visibility = Math.sin(t * Math.PI) * 0.85; fragments.forEach((m, i) => { const p = Math.min(1, Math.max(0, t * 1.35 - i * 0.06)); m.position.copyFrom(at(p)); m.rotation.y = t * 7 + i; m.visibility = p >= 1 ? 0 : 1; }); } });
    } else if (type === 'rubick_captured') {
      burst(to, green, 0.25, 0.4);
    } else if (type === 'sniper_aim' || type === 'sniper_shot' || type === 'sniper_bolt' || type === 'sniper_miss') {
      const a = unitPos(from, 1.0).add(new Vector3(-0.62, 0, -0.27)), z = unitPos(to, 0.7), aim = type === 'sniper_aim';
      const trace = line(aim ? 'sniper-aim-trace' : 'sniper-shot-trace', [a, z], aim ? red.diffuseColor : amber.diffuseColor);
      const reticle = ring('sniper-reticle', 0.46, 0.027, unitPos(to, 0.10), aim ? red : amber);
      if (!aim && type === 'sniper_shot') burst(to, amber, 0.4, 0.22);
      addEffect({ nodes: [trace, reticle], start: clock, ttl: aim ? Math.max(0.2, (event.durationTicks ?? 24) / content.ticksPerSecond) : 0.2, critical: type !== 'sniper_bolt', family: type, update(t) { trace.visibility = aim ? 0.35 + t * 0.65 : 1 - t; reticle.scaling.setAll(aim ? 1.25 - t * 0.55 : 0.6 + t * 0.8); reticle.visibility = aim ? 1 : 1 - t; } });
    } else if (['area_heal', 'area_strike', 'temporary_shield', 'slow_pulse'].includes(type)) {
      const p = event.position ?? to, radius = (event.radius ?? content.spells.find(s => s.behaviorId === type)?.radius ?? (type === 'slow_pulse' ? content.buildings.find(b => b.kind === 'slow_totem')?.range ?? 300 : 200)) * scale;
      const mat = type === 'area_heal' ? heal : type === 'area_strike' ? strike : type === 'temporary_shield' ? violet : blue;
      const enemyCast = event.type === 'commander_cast', border = ring(`${type}-area`, radius * 2, 0.04, unitPos(p, 0.11), enemyCast ? amber : green);
      const source = line(`${type}-source`, [unitPos(from, 1.5), unitPos(p, 0.3)], mat.diffuseColor);
      const accents: Mesh[] = [], count = type === 'area_strike' ? 6 : 4;
      for (let i = 0; i < count; i++) { const a = i * Math.PI * 2 / count; const x = p.x * scale + Math.cos(a) * radius * 0.58, z = worldZ(p.y) + Math.sin(a) * radius * 0.58;
        if (type === 'area_heal') { accents.push(box('healing-cross-v', [0.06, 0.26, 0.05], [x, 0.2, z], mat), box('healing-cross-h', [0.23, 0.06, 0.05], [x, 0.2, z], mat)); }
        else if (type === 'area_strike') { const shard = cylinder('strike-lance', 0.10, 1.1, [x, 1.5, z], mat, undefined, undefined, 0.02); accents.push(shard); }
        else if (type === 'temporary_shield') { const panel = box('shield-seal', [0.18, 0.42, 0.045], [x, 0.3, z], mat); panel.rotation.y = -a; accents.push(panel); }
        else { const m = box('slow-wave-mark', [0.15, 0.03, 0.05], [x, 0.15, z], blue); m.rotation.y = -a; accents.push(m); }
      }
      addEffect({ nodes: [border, source, ...accents], start: clock, ttl: type === 'slow_pulse' ? 0.7 : 0.85, critical: true, family: type, update(t) { border.scaling.setAll(type === 'slow_pulse' ? 0.25 + t * 0.75 : 0.9 + t * 0.1); border.visibility = 1 - Math.max(0, t - 0.6) / 0.4; source.visibility = Math.max(0, 1 - t * 3); accents.forEach((m, i) => { m.position.y = type === 'area_strike' ? 1.5 * (1 - Math.min(1, t * 2.8)) + 0.13 : 0.15 + t * (type === 'area_heal' ? 1.4 : 0.7); m.visibility = Math.max(0, 1 - t); m.rotation.y += 0.02; }); } });
    } else if (type === 'tombstone_cast' || type === 'tombstone_rise' || type === 'zombie_rise') {
      const p = event.position ?? to, circle = ring('grave-summon-rune', type === 'zombie_rise' ? 0.55 : 1.8, 0.045, unitPos(p, 0.08), green);
      const cracks: LinesMesh[] = Array.from({ length: type === 'zombie_rise' ? 2 : 5 }, (_, i) => { const a = i * Math.PI * 2 / 5, origin = unitPos(p, 0.085); return line('grave-ground-crack', [origin, origin.add(new Vector3(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4)), origin.add(new Vector3(Math.cos(a + 0.2) * 0.95, 0, Math.sin(a + 0.2) * 0.95))], green.diffuseColor); });
      addEffect({ nodes: [circle, ...cracks], start: clock, ttl: 0.85, critical: true, update(t) { circle.scaling.setAll(0.75 + t * 0.4); circle.visibility = 1 - t; cracks.forEach((m, i) => m.visibility = t > i * 0.04 ? 1 - t : 0); } });
    } else if (type === 'zombie_attack') burst(to, green, 0.20, 0.20);
    else if (['hook_cast', 'hook_pull'].includes(type)) {
      if (type === 'hook_pull' && target) { target.pull = { from, to, start: clock, ttl: (event.durationTicks ?? 15) / content.ticksPerSecond }; target.root.position.copyFrom(unitPos(from)); }
      const chain = line('hook-chain', [unitPos(from, 0.92), unitPos(from, 0.92)], gold.diffuseColor);
      const tip = ring('flying-hook', 0.22, 0.058, unitPos(from, 0.92), metal); tip.rotation.x = Math.PI / 2;
      const links: Mesh[] = Array.from({ length: 10 }, () => { const m = box('chain-link', [0.085, 0.075, 0.055], [0, 0, 0], gold); return m; });
      const ttl = Math.max(0.7, (event.durationTicks ?? 18) / content.ticksPerSecond + 0.3);
      addEffect({ nodes: [chain, tip, ...links], start: clock, ttl, critical: true, update(t) {
        const start = unitPos(getUnit(event.sourceId) ?? from, 0.93), visualVictim = actors.get(event.targetId ?? '')?.root.position;
        const victim = visualVictim ? visualVictim.add(new Vector3(0, 0.65, 0)) : unitPos(getUnit(event.targetId) ?? to, 0.65);
        const reach = type === 'hook_pull' ? 1 : Math.min(1, t / 0.23);
        const end = Vector3.Lerp(start, victim, reach); line('hook-chain', [start, end], gold.diffuseColor, chain); tip.position.copyFrom(end);
        for (let i = 0; i < links.length; i++) { const m = links[i]!; m.position.copyFrom(Vector3.Lerp(start, end, (i + 0.5) / links.length)); m.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x); m.visibility = t > 0.9 ? (1 - t) * 10 : 1; }
        chain.visibility = tip.visibility = t > 0.9 ? (1 - t) * 10 : 1;
      } });
    } else if (type === 'snakes_cast') {
      const circle = ring('serpent-summoning-circle', 1.85, 0.06, unitPos(to, 0.08), green);
      const sigils: Mesh[] = [];
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; const m = box('serpent-sigil', [0.08, 0.035, 0.24], [to.x * scale + Math.cos(a) * 0.83, 0.10, worldZ(to.y) + Math.sin(a) * 0.83], gold); m.rotation.y = -a; sigils.push(m); }
      addEffect({ nodes: [circle, ...sigils], start: clock, ttl: 1.0, critical: true, update(t) { circle.scaling.setAll(0.75 + Math.min(t * 2, 0.3)); circle.rotation.y = t * 0.35; circle.visibility = 1 - Math.max(0, t - 0.6) / 0.4; sigils.forEach((m, i) => { m.visibility = t > i * 0.03 ? circle.visibility : 0; }); } });
    } else if (type === 'snake_rise') {
      burst(event.position ?? to, green, 0.25, 0.5);
    } else if (type === 'construction' || type === 'building_ready') {
      if (type === 'construction') { const actor = actors.get(event.sourceId ?? ''); if (actor) actor.cosmeticBuild = { start: clock, ttl: 1.2 }; }
      const p = event.position ?? to, halo = ring('building-plan', 1.34, 0.045, unitPos(p, 0.10), amber);
      const stones: Mesh[] = [];
      for (let i = 0; i < 6; i++) stones.push(box('levitating-stone', [0.12, 0.18, 0.12], [p.x * scale, 0.2, worldZ(p.y)], i % 2 ? stone : amber));
      const ttl = type === 'building_ready' ? 0.7 : 1.2;
      addEffect({ nodes: [halo, ...stones], start: clock, ttl, critical: true, update(t) {
        halo.scaling.setAll(1 + t * 0.42); halo.visibility = 1 - t;
        stones.forEach((m, i) => { const a = i * Math.PI / 3 + t * 3.1, r = 0.65 * (1 - t); m.position.set(p.x * scale + Math.cos(a) * r, 0.10 + Math.sin(t * Math.PI) * 1.2, worldZ(p.y) + Math.sin(a) * r); m.rotation.y = t * 4; m.visibility = 1 - t; });
      } });
    } else if (type.startsWith('teleport_')) {
      if (type !== 'teleport_start') for (let i = effects.length - 1; i >= 0; i--) { const e = effects[i]!; if (e.family === 'teleport' && e.sourceId === event.sourceId) { e.nodes.forEach(n => n.dispose()); effects.splice(i, 1); } }
      const origin = unitPos(from, 0.12), destination = unitPos(to, 0.12);
      const a = ring('teleport-origin', 1.05, 0.06, origin, blue), b = ring('teleport-destination', 1.05, 0.06, destination, blue);
      const columnA = cylinder('teleport-channel-a', 0.10, 2.5, [origin.x, 1.3, origin.z], blue), columnB = cylinder('teleport-channel-b', 0.10, 2.5, [destination.x, 1.3, destination.z], blue);
      const marks: Mesh[] = []; for (let i = 0; i < 5; i++) marks.push(sphere('teleport-mote', 0.07, [origin.x, 0, origin.z], blue));
      const ttl = type === 'teleport_start' ? Math.max(0.8, (event.durationTicks ?? content.teleportTicks) / content.ticksPerSecond) : 0.5;
      addEffect({ nodes: [a, b, columnA, columnB, ...marks], start: clock, ttl, critical: true, family: 'teleport', sourceId: event.sourceId, update(t) {
        const radius = type === 'teleport_start' ? 1.1 - t * 0.4 : 0.6 + t * 1.2;
        a.scaling.setAll(radius); b.scaling.setAll(radius); a.rotation.y = t * 6; b.rotation.y = -t * 6;
        const visibility = type === 'teleport_start' ? 0.55 + Math.sin(t * Math.PI) * 0.4 : 1 - t;
        a.visibility = b.visibility = visibility; columnA.visibility = columnB.visibility = visibility * (type === 'teleport_start' ? 0.48 : 1);
        marks.forEach((m, i) => { const k = (t + i / 5) % 1, pos = i % 2 ? destination : origin; m.position.set(pos.x + Math.cos(k * 8) * 0.3, 0.15 + k * 2.5, pos.z + Math.sin(k * 8) * 0.3); m.visibility = visibility; });
      } });
    } else if (type === 'chain_lightning') {
      const a = unitPos(from, 1.45), z = unitPos(to, 0.75), path = [a];
      for (let i = 1; i < 7; i++) { const p = Vector3.Lerp(a, z, i / 7); p.y += (i % 2 ? 1 : -1) * 0.10; p.z += (i % 2 ? -1 : 1) * 0.12; path.push(p); } path.push(z);
      const bolt = line('forked-lightning', path, blue.diffuseColor), branch = line('lightning-branch', [path[3]!, path[3]!.add(new Vector3(0.22, 0.24, 0.22)), path[4]!], green.diffuseColor);
      addEffect({ nodes: [bolt, branch], start: clock, ttl: 0.30, critical: false, update(t) { bolt.visibility = branch.visibility = 1 - t; } }); burst(to, blue, 0.28, 0.23);
    } else if (['ballista_shot', 'shaman_bolt', 'rubick_bolt', 'snake_bolt', 'enemy_bolt'].includes(type)) {
      const a = unitPos(from, type === 'ballista_shot' ? 0.9 : 1.0), z = unitPos(to, 0.7), magic = type !== 'ballista_shot';
      const color = type === 'rubick_bolt' || type === 'snake_bolt' ? green : blue;
      const projectile = magic ? sphere(type, 0.10, [a.x, a.y, a.z], color) : box(type, [0.38, 0.04, 0.04], [a.x, a.y, a.z], metal);
      const trail = line('projectile-trail', [a, a], magic ? color.diffuseColor : gold.diffuseColor);
      const ttl = 0.23;
      addEffect({ nodes: [projectile, trail], start: clock, ttl, critical: false, update(t) { const p = Vector3.Lerp(a, z, t); if (magic) p.y += Math.sin(t * Math.PI) * 0.22; projectile.position.copyFrom(p); projectile.rotation.y = -Math.atan2(z.z - a.z, z.x - a.x); line('projectile-trail', [Vector3.Lerp(a, p, 0.82), p], magic ? color.diffuseColor : gold.diffuseColor, trail); } });
    } else if (['pudge_attack', 'undying_attack', 'unit_hit', 'throne_hit', 'hero_returned'].includes(type)) burst(event.position ?? to, type === 'throne_hit' ? red : type === 'undying_attack' ? green : amber, 0.25);
    else if (type === 'unit_died') {
      const p = event.position ?? to;
      const debris: Mesh[] = Array.from({ length: 4 }, (_, i) => box('fallen-fragment', [0.13, 0.13, 0.13], [p.x * scale, 0.4, worldZ(p.y)], i % 2 ? stone : red));
      const pulled = actors.get(event.sourceId ?? '')?.pull, delay = pulled ? Math.max(0, pulled.start + pulled.ttl - clock) : 0;
      if (delay) debris.forEach(m => m.visibility = 0);
      addEffect({ nodes: debris, start: clock + delay, ttl: 0.65, critical: false, update(t) { debris.forEach((m, i) => { const a = i * Math.PI / 2; m.position.set(p.x * scale + Math.cos(a) * t * 0.5, 0.13 + Math.sin(t * Math.PI) * 0.5, worldZ(p.y) + Math.sin(a) * t * 0.5); m.visibility = 1 - t; }); } });
    }
  }
  function updateSelection() {
    const unit = getUnit(selection?.id), place = content.map.places.find(p => p.id === selection?.id);
    const destination = selection?.kind === 'expedition' ? content.expeditions.find(e => e.kind === selection?.id) : undefined;
    const p = unit ?? place ?? destination?.position;
    if (range) { range.dispose(); range = undefined; }
    for (const [id, mesh] of placeMeshes) { mesh.renderOutline = id === selection?.id; mesh.outlineColor = selection?.kind === 'pad' ? amber.diffuseColor : green.diffuseColor; mesh.outlineWidth = 0.04; }
    for (const [kind, mesh] of expeditionMeshes) { mesh.renderOutline = selection?.kind === 'expedition' && selection.id === kind; mesh.outlineColor = expeditionMaterial(kind).diffuseColor; mesh.outlineWidth = 0.05; }
    if (p && selection && selection.kind !== 'expedition' && !unit?.expedition && !unit?.hidden && selection.aim !== 'teleport' && (selection.kind !== 'pad' || selection.previewKind)) {
      let radius = 0.75;
      if (selection.kind === 'hero') { const definition = content.heroes.find(h => h.kind === unit?.kind); radius = (selection.aim === 'cast' ? definition?.abilityRange ?? 100 : (definition?.range ?? 100) + ((unit?.level ?? 1) - 1) * 25) * scale; }
      if (selection.kind === 'building') radius = ((content.buildings.find(h => h.kind === unit?.kind)?.range ?? 100) + ((unit?.level ?? 1) - 1) * 20) * scale;
      if (selection.kind === 'pad' && selection.previewKind) radius = (content.buildings.find(h => h.kind === selection?.previewKind)?.range ?? 100) * scale;
      range = cylinder('selected-range', radius * 2, 0.012, [p.x * scale, 0.16, worldZ(p.y)], rangeMaterial);
    }
    const occupied = !!current?.buildings.some(x => x.padId === selection?.id);
    const key = selection?.kind === 'pad' && selection.previewKind && place && !occupied ? `${selection.id}:${selection.previewKind}` : '';
    if (ghostKey === key) return;
    ghost?.dispose(); ghost = undefined; ghostKey = key;
    if (key && place) {
      ghost = new TransformNode('building-preview', scene); ghost.position.copyFrom(unitPos(place));
      const model = makeModel(selection?.previewKind ?? 'ballista', ghost);
      for (const mesh of model.getChildMeshes()) { mesh.material = ghostMaterial; mesh.isPickable = false; }
    }
  }
  let lastWidth = 0, lastHeight = 0, lastRatio = 0;
  function resize() {
    if (disposed || contextLost) return;
    const rect = canvas.getBoundingClientRect(), cssWidth = Math.max(1, rect.width), cssHeight = Math.max(1, rect.height);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.5);
    if (cssWidth === lastWidth && cssHeight === lastHeight && pixelRatio === lastRatio) return;
    lastWidth = cssWidth; lastHeight = cssHeight;
    lastRatio = pixelRatio; engine.setHardwareScalingLevel(1 / pixelRatio); engine.resize();
    // Fit the playable volume, including unit heights, rather than the decorative
    // island. A lower pitch keeps bodies readable; pixel margins keep the Ancient
    // inside the right edge and reserve space for the existing map legend.
    const view = camera.getViewMatrix(true), bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    const include = (point: Point, radius: number, height: number) => {
      const p = unitPos(point);
      for (const x of [-radius, radius]) for (const z of [-radius, radius]) for (const y of [0, height]) {
        const projected = Vector3.TransformCoordinates(p.add(new Vector3(x, y, z)), view);
        bounds.minX = Math.min(bounds.minX, projected.x); bounds.maxX = Math.max(bounds.maxX, projected.x);
        bounds.minY = Math.min(bounds.minY, projected.y); bounds.maxY = Math.max(bounds.maxY, projected.y);
      }
    };
    for (const point of [...content.map.paths.flat(), ...content.map.sidePath]) include(point, 0.65, 2.65);
    for (const place of content.map.places) include(place, 0.70, 2.65);
    for (const destination of content.expeditions) include(destination.position, 0.72, 1.65);
    include(content.map.throne, 1.25, 2.75);
    const margin = { left: 20, right: 34, top: 22, bottom: 42 };
    const innerWidth = Math.max(1, cssWidth - margin.left - margin.right), innerHeight = Math.max(1, cssHeight - margin.top - margin.bottom);
    const unitsPerPixel = Math.max((bounds.maxX - bounds.minX) / innerWidth, (bounds.maxY - bounds.minY) / innerHeight);
    const midX = (bounds.minX + bounds.maxX) / 2, midY = (bounds.minY + bounds.maxY) / 2;
    camera.orthoLeft = midX - innerWidth * unitsPerPixel / 2 - margin.left * unitsPerPixel;
    camera.orthoRight = camera.orthoLeft + cssWidth * unitsPerPixel;
    camera.orthoBottom = midY - innerHeight * unitsPerPixel / 2 - margin.bottom * unitsPerPixel;
    camera.orthoTop = camera.orthoBottom + cssHeight * unitsPerPixel;
  }
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas); window.addEventListener('resize', resize); resize();
  const lostObserver = engine.onContextLostObservable.add(() => { contextLost = true; onContextState({ state: 'lost', message: 'Графический контекст потерян. Партия приостановлена; ждём восстановления браузером.' }); });
  const restoredObserver = engine.onContextRestoredObservable.add(() => { if (disposed) return; contextLost = false; lastWidth = 0; resize(); onContextState({ state: 'restored' }); });
  const pointer = (event: PointerEvent) => {
    if (disposed || contextLost || event.button !== 0) return;
    const rect = canvas.getBoundingClientRect(), picked = scene.pick(event.clientX - rect.left, event.clientY - rect.top);
    if (!picked?.hit || !picked.pickedPoint) return;
    const meta = picked.pickedMesh?.metadata as { pick?: RendererPick } | null;
    let result = meta?.pick;
    if (!result || result.kind === 'ground') result = { kind: 'ground', x: Math.round(picked.pickedPoint.x / scale), y: Math.round(simulationY(picked.pickedPoint.z)) };
    else result = { ...result, x: Math.round(picked.pickedPoint.x / scale), y: Math.round(simulationY(picked.pickedPoint.z)) };
    onPick(result);
  };
  canvas.addEventListener('pointerdown', pointer);
  const gl = canvas.getContext(engine.webGLVersion === 2 ? 'webgl2' : 'webgl') as WebGLRenderingContext | WebGL2RenderingContext | null;
  const limits = gl ? { maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), maxViewportDimensions: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array) } : null;
  // Compile every R3 model family before the caller starts its simulation. Warm-up
  // meshes are never gameplay entities and are released after shader readiness.
  const warm = new TransformNode('resource-warmup', scene); warm.position.y = -100;
  for (const kind of [...content.heroes.map(h => h.kind), ...content.buildings.map(b => b.kind), 'snake', 'tombstone', 'zombie', ...content.enemies.map(e => e.kind)]) makeModel(kind, warm);
  const readyPromise = scene.whenReadyAsync().then(() => { if (!disposed) warm.dispose(); });
  function projectCss(point: Point, height = 0) { const p = Vector3.Project(unitPos(point, height), Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())); const factor = engine.getHardwareScalingLevel(); return { x: p.x * factor, y: p.y * factor }; }
  return {
    ready() { return readyPromise; },
    setQuality(value: 'low' | 'high') { quality = value; lastWidth = 0; resize(); },
    project: projectCss,
    render(game: RendererGame, events: readonly RendererEvent[] = [], deltaSeconds = 0) {
      if (disposed || contextLost) return;
      resize(); clock += Math.max(0, Math.min(deltaSeconds, 0.1));
      if (lastTick > game.simTick) { for (const actor of actors.values()) actor.root.dispose(); actors.clear(); for (const glyph of absentGlyphs.values()) glyph.root.dispose(); absentGlyphs.clear(); effects.splice(0).forEach(e => e.nodes.forEach(n => n.dispose())); seenEvents.clear(); eventOrder.length = 0; visualEventCounts.clear(); }
      lastTick = game.simTick; current = game;
      updateExpeditionGlyphs(game.heroes);
      const live = new Set<string>();
      const groups: Array<[RendererPickKind, VisualUnit[]]> = [['hero', game.heroes], ['building', game.buildings], ['enemy', game.enemies], ['ground', game.summons]];
      for (const [role, units] of groups) for (const unit of units) {
        if (unit.hp <= 0 || role === 'hero' && unit.expedition || role === 'enemy' && unit.hidden && unit.visible === false) continue;
        live.add(unit.id); const key = `${role}:${unit.kind ?? ''}:${unit.level ?? 1}`;
        let actor = actors.get(unit.id);
        if (actor && actor.key !== key) { actor.root.dispose(); actors.delete(unit.id); actor = undefined; }
        if (!actor) { actor = createActor(unit, role); actors.set(unit.id, actor); }
        const moving = role === 'enemy' || role === 'ground';
        actor.root.position.copyFrom(unitPos(unit));
        if (actor.pull) { const progress = Math.min(1, (clock - actor.pull.start) / actor.pull.ttl); actor.root.position.copyFrom(Vector3.Lerp(unitPos(actor.pull.from), unitPos(actor.pull.to), progress * progress * (3 - 2 * progress))); if (progress >= 1) actor.pull = undefined; }
        actor.model.position.y = moving ? Math.sin(clock * 10 + unit.x * 0.08) * 0.018 : Math.sin(clock * 2) * 0.01;
        if (role === 'ground' && !(unit.readyTicks ?? 0) && actor.riseAt === undefined) actor.riseAt = clock;
        const rise = role === 'ground' ? (unit.readyTicks ?? 0) > 0 ? 0.001 : Math.max(0.001, Math.min(1, (clock - (actor.riseAt ?? clock)) / 0.25)) : 1;
        const buildingDefinition = role === 'building' ? content.buildings.find(b => b.kind === unit.kind) : undefined;
        let build = (unit.constructionTicks ?? 0) > 0 ? Math.max(0.05, 1 - (unit.constructionTicks ?? 0) / (buildingDefinition?.buildTicks ?? 120)) : 1;
        if (actor.cosmeticBuild) { const progress = Math.min(1, (clock - actor.cosmeticBuild.start) / actor.cosmeticBuild.ttl); build = Math.min(build, Math.max(0.01, progress)); if (progress >= 1) actor.cosmeticBuild = undefined; }
        const modelScale = unit.kind === 'zombie' ? 0.6 : 1;
        actor.model.scaling.set(modelScale, modelScale * (role === 'ground' ? rise : 1), modelScale);
        for (let i = 0; i < actor.baseline.length; i++) {
          const item = actor.baseline[i]!; item.mesh.position.copyFrom(item.position);
          if (build < 1) { const t = Math.min(1, build * 1.35 - i * 0.012); item.mesh.position.y = item.position.y - Math.max(0, 1 - t) * 1.4; item.mesh.visibility = Math.max(0.15, t); }
          else item.mesh.visibility = clock < actor.flashUntil ? 0.52 : 1;
          if (unit.kind === 'magic_tower' && item.mesh.name.startsWith('tower-orbit')) item.mesh.rotation.y = clock * (item.mesh.name.endsWith('a') ? 0.85 : -1.15);
          if (unit.kind === 'magic_tower' && item.mesh.name === 'tower-crystal') item.mesh.rotation.y = clock * 0.65;
          if (unit.kind === 'slow_totem' && item.mesh.name === 'totem-orbit') item.mesh.rotation.z = Math.sin(clock) * 0.12;
          if (unit.kind === 'rubick' && item.mesh.name === 'rubick-floating-fragment') { item.mesh.position.x = Math.cos(clock * 0.85 + i) * 0.48; item.mesh.position.z = Math.sin(clock * 0.85 + i) * 0.34; item.mesh.rotation.y = clock * 1.2; }
          if (unit.kind === 'rubick' && item.mesh.name === 'rubick-carried-spell') { item.mesh.setEnabled(!!unit.stolenSpell); item.mesh.material = spellMaterial(unit.stolenSpell); item.mesh.scaling.setAll(0.9 + Math.sin(clock * 3) * 0.15); }
          if (item.mesh.name === 'commander-focus') item.mesh.material = spellMaterial(unit.lastSpell);
          if (item.mesh.name === 'enhancement-crown') item.mesh.rotation.y = clock * 0.8 + i;
        }
        if (role === 'hero') {
          if (!actor.itemMarkers) actor.itemMarkers = [0, 1].map(i => { const m = MeshBuilder.CreatePolyhedron(`hero-item-${i}`, { type: 1, size: 0.095 }, scene); m.parent = actor!.root; m.position.set(i ? 0.38 : -0.38, 0.85, 0.30); m.isPickable = false; return m; });
          actor.itemMarkers.forEach((marker, i) => { const itemId = unit.items?.[i], item = content.items.find(item => item.id === itemId); marker.setEnabled(!!item); marker.material = item?.behaviorId === 'healing_aura' ? heal : item?.behaviorId === 'detection' ? blue : item?.behaviorId === 'cooldown_reduction' ? shopViolet : campAmber; marker.rotation.y = clock * 0.4; });
          if (unit.aegisToken) { actor.aegis ??= ring('hero-aegis-token', 0.29, 0.047, new Vector3(0.50, 1.12, 0.18), campAmber, actor.root); actor.aegis.rotation.x = Math.PI / 2; actor.aegis.scaling.setAll(1 + Math.sin(clock * 2) * 0.08); }
          else if (actor.aegis) { actor.aegis.dispose(); actor.aegis = undefined; }
        }
        if (unit.shield && unit.shield.remainingTicks > 0 && unit.shield.absorption > 0) {
          if (!actor.shields) { actor.shields = [ring('active-shield-lower', 1.0, 0.035, new Vector3(0, 0.32, 0), violet, actor.root), ring('active-shield-upper', 0.9, 0.035, new Vector3(0, 1.5, 0), violet, actor.root)]; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; const panel = box('active-shield-panel', [0.10, 0.46, 0.055], [Math.cos(a) * 0.48, 0.9, Math.sin(a) * 0.48], violet, actor.root); panel.rotation.y = -a; actor.shields.push(panel); } }
          actor.shields.forEach((m, i) => { m.visibility = 0.55 + Math.sin(clock * 2 + i) * 0.18; });
        } else if (actor.shields) { actor.shields.forEach(m => m.dispose()); actor.shields = undefined; }
        if (unit.slow && unit.slow.remainingTicks > 0) { actor.slowRing ??= ring('active-slow-anklet', 0.53, 0.026, new Vector3(0, 0.10, 0), blue, actor.root); actor.slowRing.scaling.setAll(0.9 + Math.sin(clock * 3) * 0.1); }
        else if (actor.slowRing) { actor.slowRing.dispose(); actor.slowRing = undefined; }
        actor.hp.scaling.x = Math.max(0.02, Math.min(1, unit.hp / (unit.maxHp ?? unit.hp)));
        actor.hpBack.setEnabled(role !== 'ground' && build >= 1);
        if (unit.teleport) actor.model.scaling.setAll(Math.max(0.1, unit.teleport.remainingTicks < 10 ? unit.teleport.remainingTicks / 10 : 1));
      }
      for (const event of events) if (!seenEvents.has(event.eventId)) {
        seenEvents.add(event.eventId); eventOrder.push(event.eventId); animateEvent(event);
        if (eventOrder.length > 2048) seenEvents.delete(eventOrder.shift()!);
      }
      for (const [id, actor] of actors) if (!live.has(id)) {
        // A lethal hook still carries its visible victim down the actual chain.
        // This short cosmetic death tail cannot become a simulation target.
        if (actor.pull && !getUnit(id)?.expedition && !(getUnit(id)?.hidden && getUnit(id)?.visible === false) && clock < actor.pull.start + actor.pull.ttl) { const t = (clock - actor.pull.start) / actor.pull.ttl; actor.root.position.copyFrom(Vector3.Lerp(unitPos(actor.pull.from), unitPos(actor.pull.to), t * t * (3 - 2 * t))); actor.hpBack.setEnabled(false); actor.model.getChildMeshes().forEach(m => m.isPickable = false); }
        else { actor.root.dispose(); actors.delete(id); }
      }
      for (let i = effects.length - 1; i >= 0; i--) { const e = effects[i]!, age = clock - e.start; if (age < 0) continue; if (age >= e.ttl) { e.nodes.forEach(n => n.dispose()); effects.splice(i, 1); } else e.update(age / e.ttl, age); }
      for (const place of content.map.places) if (place.kind === 'hero_anchor') { const mesh = placeMeshes.get(place.id)!; const occupied = game.heroes.some(h => h.anchorId === place.id || h.teleport?.targetAnchorId === place.id); mesh.material = selection?.aim === 'teleport' && !occupied ? material('eligible-anchor', '#458565', 0.3) : slate; }
      const nextGhostKey = selection?.kind === 'pad' && selection.previewKind && !game.buildings.some(x => x.padId === selection?.id) ? `${selection.id}:${selection.previewKind}` : '';
      if (nextGhostKey !== ghostKey) updateSelection();
      if (range && selection?.kind === 'hero') { const unit = getUnit(selection.id); if (unit?.expedition) { range.dispose(); range = undefined; } else if (unit) range.position.copyFrom(unitPos(unit, 0.16)); }
      throneCrystal.rotation.y = clock * 0.26; throneRing.rotation.z = Math.sin(clock * 0.7) * 0.14;
      throneCrystal.scaling.set(0.65, 1.5 + Math.sin(clock * 2.1) * 0.055, 0.65);
      if ((game.throneHp ?? 1) <= 0) throneCrystal.scaling.y = 0.08;
      try { engine.beginFrame(); scene.render(); engine.endFrame(); }
      catch (error) { contextLost = true; onContextState({ state: 'error', message: `Графика остановлена: ${error instanceof Error ? error.message : 'ошибка WebGL'}` }); }
    },
    select(value: RendererSelection | null) { selection = value; if (!disposed && !contextLost) updateSelection(); },
    getDiagnostics() {
      return { renderer: 'Babylon.js 9.29.0 / WebGL', coordinates: 'simulation X→+X; simulation Y→−Z; map.scale', webGLVersion: engine.webGLVersion, contextLost, disposed, quality, pixelRatioCap: quality === 'low' ? 1 : 1.5,
        cssWidth: lastWidth, cssHeight: lastHeight, drawingBufferWidth: gl?.drawingBufferWidth ?? engine.getRenderWidth(), drawingBufferHeight: gl?.drawingBufferHeight ?? engine.getRenderHeight(),
        meshes: scene.meshes.length, materials: scene.materials.length, actors: actors.size, effects: effects.length, seenEvents: seenEvents.size, limits, glInfo: engine.getGlInfo(), ready: scene.isReady(),
        camera: { pitchDegrees: Math.atan2(camera.position.y, Math.hypot(camera.position.x, camera.position.z)) * 180 / Math.PI, orthoLeft: camera.orthoLeft, orthoRight: camera.orthoRight, orthoTop: camera.orthoTop, orthoBottom: camera.orthoBottom },
        projectedPlaces: content.map.places.map(p => ({ id: p.id, kind: p.kind, ...projectCss(p, 0.14) })),
        projectedGroundTargets: content.map.paths.map((path, lane) => ({ lane, point: { ...path[1]! }, height: -0.04, ...projectCss(path[1]!, -0.04) })),
        projectedDestinations: content.expeditions.map(d => ({ kind: d.kind, ...projectCss(d.position, 0.16) })),
        projectedAncientCorners: [-1.25, 1.25].flatMap(x => [-1.25, 1.25].flatMap(y => [0, 2.75].map(height => projectCss({ x: content.map.throne.x + x / scale, y: content.map.throne.y + y / scale }, height)))),
        actorKinds: Array.from(actors.values()).map(a => a.key), visualEventCounts: Object.fromEntries(visualEventCounts),
        destinations: Array.from(expeditionMeshes).map(([kind, mesh]) => ({ kind, x: mesh.position.x, z: mesh.position.z, selected: mesh.renderOutline })),
        absentHeroes: Array.from(absentGlyphs).map(([id, glyph]) => ({ id, kind: glyph.kind, progress: glyph.progress, completedSegments: glyph.segments.filter(m => m.visibility === 1).length, x: glyph.root.position.x, z: glyph.root.position.z })),
        itemMarkers: Array.from(actors).filter(([, a]) => a.itemMarkers).map(([id, a]) => ({ id, enabled: a.itemMarkers!.map(m => m.isEnabled()), aegis: !!a.aegis })),
        actorPositions: Array.from(actors).map(([id, a]) => ({ id, x: a.root.position.x, z: a.root.position.z, modelScaleY: a.model.scaling.y })),
        shieldActors: Array.from(actors).filter(([, a]) => a.shields).map(([id]) => id), slowActors: Array.from(actors).filter(([, a]) => a.slowRing).map(([id]) => id),
        carriedSpells: allUnits().filter(u => u.kind === 'rubick' && !!u.stolenSpell).map(u => ({ id: u.id, spellId: u.stolenSpell, enabled: actors.get(u.id)?.model.getChildMeshes().some(m => m.name === 'rubick-carried-spell' && m.isEnabled()) ?? false })),
        effectShapes: effects.filter(e => e.critical).map(e => ({ family: e.family ?? e.nodes[0]?.name, progress: (clock - e.start) / e.ttl, nodes: e.nodes.slice(0, 8).map(m => ({ name: m.name, x: m.position.x, y: m.position.y, z: m.position.z, visibility: m instanceof Mesh ? m.visibility : 1 })) })),
        pullingActors: Array.from(actors).filter(([, a]) => a.pull).map(([id, a]) => ({ id, x: a.root.position.x, z: a.root.position.z, from: a.pull!.from, to: a.pull!.to, progress: (clock - a.pull!.start) / a.pull!.ttl })), islandWidth: ground.getBoundingInfo().boundingBox.extendSize.x * 2 };
    },
    dispose() {
      if (disposed) return; disposed = true; resizeObserver.disconnect(); window.removeEventListener('resize', resize); canvas.removeEventListener('pointerdown', pointer);
      engine.onContextLostObservable.remove(lostObserver); engine.onContextRestoredObservable.remove(restoredObserver); scene.dispose(); engine.dispose(); actors.clear(); absentGlyphs.clear(); expeditionMeshes.clear(); effects.length = 0; seenEvents.clear(); eventOrder.length = 0;
    }
  };
}
