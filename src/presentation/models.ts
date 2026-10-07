import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer';
import type { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/instancedMesh';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import {assetBytes} from './asset-bytes';

export const MODEL_NAMES = ['pudge', 'creep_basic', 'enemy_shooter', 'enemy_boss', 'hook', 'hook_long_link','hook_piercing_tooth','hook_return_sickle', 'chain', 'road', 'shoulder_0', 'shoulder_1', 'shoulder_2', 'tree', 'bush', 'rock', 'grass', 'shop','loot_gold','loot_steel','loot_ember','loot_core','enemy_projectile','warning_ring','hit_marker','aim_strip'] as const;
export type ModelName = typeof MODEL_NAMES[number];
export function modelPath(name: ModelName): string {
  if (name === 'pudge') return 'models/runner-3d/pudge-equipment.glb';
  if(name.startsWith('hook_'))return `models/r4/${name==='hook_long_link'?'long_link_1':name.slice(5)}.glb`;
  if(name.startsWith('loot_'))return `models/r3/${name}.glb`;
  if (['enemy_shooter','enemy_boss','enemy_projectile','warning_ring','hit_marker','aim_strip'].includes(name)) return `models/r2/${name}.glb`;
  if (name === 'shop') return 'models/r3/shop.glb';
  const environment = name === 'road' || name === 'rock' || name === 'grass' || name.startsWith('shoulder_');
  return `models/${environment ? 'environment/road-v1' : 'r1'}/${name}.glb`;
}
const CONTRACT: Partial<Record<ModelName, { root: string; sockets: string[]; clips: string[] }>> = {
  pudge: { root: 'hero_root', sockets: ['socket_hook_hand', 'socket_weapon', 'socket_head', 'socket_body', 'socket_feet'], clips: ['idle', 'run', 'strafe_left', 'strafe_right', 'hook_cast', 'hook_hold', 'hook_return_empty', 'hook_return_capture', 'death'] },
  creep_basic: { root: 'enemy_root', sockets: ['socket_creep_capture'], clips: ['run', 'hit', 'death_capture'] },
  enemy_shooter: { root: 'enemy_root', sockets: ['socket_creep_capture','socket_projectile','socket_weapon'], clips: ['idle','run','shoot_prepare','shoot','hit','death_capture'] },
  enemy_boss: { root: 'enemy_root', sockets: ['socket_creep_capture','socket_projectile','socket_weapon'], clips: ['idle','run','shoot_prepare','shoot','hit_recover','break_free','death','death_capture'] },
  shop: { root: 'shop_root', sockets: ['socket_shop_entry', 'socket_shop_focus'], clips: [] },
  hook: { root: 'hook_root', sockets: ['socket_chain_hook', 'socket_target_hook'], clips: [] },
};

export function validateModel(name: ModelName, container: AssetContainer): void {
  const contract = CONTRACT[name] ?? (name.startsWith('hook_')?CONTRACT.hook!:{ root: `${name}_root`, sockets: [], clips: [] });
  const nodes = new Set([...container.transformNodes, ...container.meshes].map(node => node.name));
  const clips = new Set(container.animationGroups.map(group => group.name));
  for (const node of [contract.root, ...contract.sockets]) if (!nodes.has(node)) throw new Error(`${name}: missing ${node}`);
  for (const clip of contract.clips) if (!clips.has(clip)) throw new Error(`${name}: missing ${clip}`);
}

export async function importModel(name: ModelName, bytes: Uint8Array, scene: Scene): Promise<AssetContainer> {
  const container = await LoadAssetContainerAsync(bytes, scene, {
    pluginExtension: '.glb', name: `${name}.glb`, pluginOptions: { gltf: { animationStartMode: 0 } },
  });
  try { validateModel(name, container); return container; }
  catch (error) { container.dispose(); throw error; }
}

/** Each actor owns its rig. Geometry and materials stay shared with the library. */
export class ModelActor {
  readonly root: TransformNode;
  private active: AnimationGroup | null = null;
  private nodes = new Map<string, TransformNode>();
  private parts = new Map<string, TransformNode[]>();
  private clips = new Map<string, AnimationGroup>();
  private transitionClock: number | null = null;
  private transitionStart = 0;
  private supportLift = 0;
  private transitionOriginLift = 0;
  private supportNode: TransformNode | null = null;
  private transitionPose: Array<{ node: TransformNode; position: Vector3; rotation: Quaternion; scale: Vector3 }> | null = null;
  private sampledPose: { clip: string; seconds: number; loop: boolean; clock?: number } | null = null;
  private sampledWorld = Matrix.Identity();

  constructor(readonly entries: InstantiatedEntries, name: string, scene: Scene) {
    this.root = new TransformNode(name, scene);
    for (const root of entries.rootNodes) {
      root.parent = this.root;
      for (const node of [root, ...root.getDescendants()]) {
        if (node instanceof TransformNode) {
          // Multi-material glTF meshes have a named parent and primitive children
          // with the same name. Keep the parent so toggling a part hides all of it.
          const key = node.name.slice(name.length + 1);
          if (!this.nodes.has(key)) this.nodes.set(key, node);
          const parts = this.parts.get(key) ?? [];
          parts.push(node); this.parts.set(key, parts);
        }
      }
    }
    for (const group of entries.animationGroups) this.clips.set(group.name.slice(name.length + 1), group);
    this.supportNode = this.nodes.get('RF_Pudge_Rig') ?? null;
  }

  pose(clip: string, seconds: number, loop = true, transitionClock?: number): void {
    // Paused simulation clocks must also pause the CPU skinning floor check.
    const sampled = this.sampledPose;
    if (sampled && sampled.clip === clip && sampled.seconds === seconds && sampled.loop === loop &&
      sampled.clock === transitionClock && this.root.computeWorldMatrix(true).equals(this.sampledWorld)) return;
    const previousLift = this.supportLift;
    if (this.supportNode) this.supportNode.position.y -= previousLift;
    this.supportLift = 0;
    const group = this.clips.get(clip);
    if (!group) throw new Error(`Missing animation ${clip}`);
    const canBlend = transitionClock !== undefined && this.transitionClock !== null && transitionClock >= this.transitionClock;
    if (!canBlend) this.transitionPose = null;
    if (this.active !== group) {
      // Capture the currently displayed pose before stop() resets the old clip.
      // The caller supplies a simulation clock, so pause/SHOP freeze the blend.
      if (canBlend && this.active) {
        const nodes = new Set(group.targetedAnimations.map(animation => animation.target));
        this.transitionPose = [...nodes].filter((node): node is TransformNode => node instanceof TransformNode && node.rotationQuaternion !== null)
          .map(node => ({ node, position: node.position.clone(), rotation: node.rotationQuaternion!.clone(), scale: node.scaling.clone() }));
        this.transitionStart = transitionClock!;
        this.transitionOriginLift = previousLift;
      }
      this.active?.stop();
      group.start(loop);
      group.pause();
      this.active = group;
    }
    const fps = group.targetedAnimations[0].animation.framePerSecond;
    const duration = (group.to - group.from) / fps;
    const elapsed = loop && duration > 0 ? Math.max(0, seconds) % duration : Math.max(0, Math.min(duration, seconds));
    group.goToFrame(group.from + elapsed * fps);
    if (this.transitionPose && transitionClock !== undefined) {
      const progress = Math.max(0, Math.min(1, (transitionClock - this.transitionStart) / .12));
      const amount = progress * progress * (3 - 2 * progress);
      for (const pose of this.transitionPose) {
        Vector3.LerpToRef(pose.position, pose.node.position, amount, pose.node.position);
        Quaternion.SlerpToRef(pose.rotation, pose.node.rotationQuaternion!, amount, pose.node.rotationQuaternion!);
        Vector3.LerpToRef(pose.scale, pose.node.scaling, amount, pose.node.scaling);
      }
      if (progress >= 1) this.transitionPose = null;
      else if (this.supportNode) {
        // Bone interpolation can put a sole below the ground even when both
        // source poses are grounded. Check only during the short transition.
        this.supportLift = this.transitionOriginLift * (1 - amount);
        this.supportNode.position.y += this.supportLift;
        for (const node of this.root.getDescendants()) if (node instanceof TransformNode) node.computeWorldMatrix(true);
        for (const skeleton of this.entries.skeletons) skeleton.prepare(true);
        let floor = Infinity;
        for (const mesh of this.root.getChildMeshes()) {
          if (!(mesh instanceof Mesh) || !mesh.skeleton || !mesh.isEnabled() || !mesh.isVisible) continue;
          const positions = mesh.getPositionData(true)!;
          const world = mesh.computeWorldMatrix(true).m;
          for (let i = 0; i < positions.length; i += 3) floor = Math.min(floor, positions[i] * world[1] + positions[i + 1] * world[5] + positions[i + 2] * world[9] + world[13]);
        }
        const extra = Math.max(0, this.root.position.y + .001 - floor);
        this.supportNode.position.y += extra;
        this.supportLift += extra;
      }
    }
    this.transitionClock = transitionClock ?? null;
    this.sampledPose = { clip, seconds, loop, clock: transitionClock };
    this.sampledWorld.copyFrom(this.root.computeWorldMatrix(true));
  }

  clipDuration(name: string): number {
    const group = this.clips.get(name);
    if (!group) throw new Error(`Missing animation ${name}`);
    return (group.to - group.from) / group.targetedAnimations[0].animation.framePerSecond;
  }

  socket(name: string): Vector3 {
    // Recompute parents too: sockets are read after explicitly sampling the rig.
    this.root.computeWorldMatrix(true);
    const node = this.nodes.get(name);
    if (!node) throw new Error(`Missing socket ${name}`);
    node.computeWorldMatrix(true);
    return node.getAbsolutePosition().clone();
  }

  /** Optional authoring parts can be hidden without altering a shared material. */
  setPartEnabled(name: string, enabled: boolean): void {
    // Loader skin adapters can also duplicate a named transform. Toggle every
    // matching branch, including the branch owning the rendered primitives.
    for (const node of this.parts.get(name) ?? []) node.setEnabled(enabled);
  }

  attachToNode(part: TransformNode, name: string): boolean {
    const node = this.nodes.get(name);
    if (!node) return false;
    part.parent = node;
    return true;
  }

  dispose(): void { this.transitionPose = null; this.sampledPose = null; this.entries.dispose(); this.root.dispose(); }
}

export class ModelLibrary {
  constructor(private containers: Map<ModelName, AssetContainer>, private scene: Scene) {}

  static async load(scene: Scene): Promise<ModelLibrary> {
    const results = await Promise.allSettled(MODEL_NAMES.map(async name => {
      return [name, await importModel(name, await assetBytes(modelPath(name)), scene)] as const;
    }));
    const containers = new Map<ModelName, AssetContainer>();
    for (const result of results) if (result.status === 'fulfilled') containers.set(...result.value);
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') {
      for (const container of containers.values()) container.dispose();
      throw failed.reason;
    }
    return new ModelLibrary(containers, scene);
  }

  create(name: ModelName, id: string): ModelActor {
    const entries = this.containers.get(name)!.instantiateModelsToScene(n => `${id}:${n}`, false, {
      doNotInstantiate: name === 'pudge' || name === 'creep_basic' || name === 'enemy_shooter' || name === 'enemy_boss',
    });
    return new ModelActor(entries, id, this.scene);
  }

  dispose(): void { for (const container of this.containers.values()) container.dispose(); }
}
