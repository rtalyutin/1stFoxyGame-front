import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer';
import type { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/instancedMesh';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';

export const MODEL_NAMES = ['pudge', 'creep_basic', 'hook', 'chain', 'road', 'shoulder_0', 'shoulder_1', 'shoulder_2', 'tree', 'bush', 'rock', 'grass', 'shop'] as const;
export type ModelName = typeof MODEL_NAMES[number];
export function modelPath(name: ModelName): string {
  if (name === 'shop') return 'models/r3/shop.glb';
  const environment = name === 'road' || name === 'rock' || name === 'grass' || name.startsWith('shoulder_');
  return `models/${environment ? 'environment/road-v1' : 'r1'}/${name}.glb`;
}
const CONTRACT: Partial<Record<ModelName, { root: string; sockets: string[]; clips: string[] }>> = {
  pudge: { root: 'hero_root', sockets: ['socket_hook_hand', 'socket_weapon', 'socket_head', 'socket_body', 'socket_feet'], clips: ['idle', 'run', 'strafe_left', 'strafe_right', 'hook_cast', 'hook_hold', 'hook_return_empty', 'hook_return_capture', 'death'] },
  creep_basic: { root: 'enemy_root', sockets: ['socket_creep_capture'], clips: ['run', 'hit', 'death_capture'] },
  shop: { root: 'shop_root', sockets: ['socket_shop_entry', 'socket_shop_focus'], clips: [] },
  hook: { root: 'hook_root', sockets: ['socket_chain_hook', 'socket_target_hook'], clips: [] },
};

export function validateModel(name: ModelName, container: AssetContainer): void {
  const contract = CONTRACT[name] ?? { root: `${name}_root`, sockets: [], clips: [] };
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
  private clips = new Map<string, AnimationGroup>();

  constructor(readonly entries: InstantiatedEntries, name: string, scene: Scene) {
    this.root = new TransformNode(name, scene);
    for (const root of entries.rootNodes) {
      root.parent = this.root;
      for (const node of [root, ...root.getDescendants()]) {
        if (node instanceof TransformNode) this.nodes.set(node.name.slice(name.length + 1), node);
      }
    }
    for (const group of entries.animationGroups) this.clips.set(group.name.slice(name.length + 1), group);
  }

  pose(clip: string, seconds: number, loop = true): void {
    const group = this.clips.get(clip);
    if (!group) throw new Error(`Missing animation ${clip}`);
    if (this.active !== group) {
      this.active?.stop();
      group.start(loop);
      group.pause();
      this.active = group;
    }
    const fps = group.targetedAnimations[0].animation.framePerSecond;
    const duration = (group.to - group.from) / fps;
    const elapsed = loop && duration > 0 ? Math.max(0, seconds) % duration : Math.max(0, Math.min(duration, seconds));
    group.goToFrame(group.from + elapsed * fps);
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
    this.nodes.get(name)?.setEnabled(enabled);
  }

  attachToNode(part: TransformNode, name: string): boolean {
    const node = this.nodes.get(name);
    if (!node) return false;
    part.parent = node;
    return true;
  }

  dispose(): void { this.entries.dispose(); this.root.dispose(); }
}

export class ModelLibrary {
  constructor(private containers: Map<ModelName, AssetContainer>, private scene: Scene) {}

  static async load(scene: Scene): Promise<ModelLibrary> {
    const results = await Promise.allSettled(MODEL_NAMES.map(async name => {
      const response = await fetch(`${import.meta.env.BASE_URL}${modelPath(name)}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      return [name, await importModel(name, new Uint8Array(await response.arrayBuffer()), scene)] as const;
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
      doNotInstantiate: name === 'pudge' || name === 'creep_basic',
    });
    return new ModelActor(entries, id, this.scene);
  }

  dispose(): void { for (const container of this.containers.values()) container.dispose(); }
}
