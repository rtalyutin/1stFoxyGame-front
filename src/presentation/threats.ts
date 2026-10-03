import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { RunState } from '../game/simulation';
import type { ModelActor } from './models';
import { toScenePoint } from './coordinates';

type Signals = { root: TransformNode; marks: Mesh[]; warnings: Mesh[]; muzzle: Mesh };

/** Bounded technical R2 attachments. Visuals never change combat colliders. */
export class ThreatView {
  private enemies = new Map<string, Signals>();
  private bullets = new Map<string, Mesh>();
  private warning: StandardMaterial;
  private metal: StandardMaterial;
  private marker: StandardMaterial;
  private bullet: StandardMaterial;

  constructor(private scene: Scene) {
    const material = (name: string, color: string, light: string) => {
      const result = new StandardMaterial(name, scene);
      result.diffuseColor = Color3.FromHexString(color);
      result.emissiveColor = Color3.FromHexString(light);
      result.specularColor = Color3.Black();
      return result;
    };
    this.warning = material('shot-warning', '#efbe4e', '#7c5418');
    this.metal = material('enemy-weapon', '#29353a', '#080b0d');
    this.marker = material('boss-marks', '#fff2c2', '#8f652c');
    this.bullet = material('enemy-projectile', '#ff6e34', '#db3811');
  }

  private create(id: string, boss: boolean, requiredHits: number, actor: ModelActor): Signals {
    const root = new TransformNode(`threat-${id}`, this.scene);
    root.parent = actor.root;
    const weapon = MeshBuilder.CreateBox(`weapon-${id}`, { width: .32, height: .32, depth: 1.35 }, this.scene);
    weapon.parent = root; weapon.position.set(.65, 1, .35); weapon.material = this.metal;
    const muzzle = MeshBuilder.CreateCylinder(`muzzle-${id}`, { diameterTop: 0, diameterBottom: .65, height: .45, tessellation: 3 }, this.scene);
    muzzle.parent = root; muzzle.position.set(.65, 1, 1.2); muzzle.rotation.x = Math.PI / 2; muzzle.material = this.warning;
    const marks: Mesh[] = [];
    if (boss) for (let i = 0; i < requiredHits; i++) {
      const mark = MeshBuilder.CreateTorus(`boss-hit-${id}-${i}`, { diameter: .4, thickness: .12, tessellation: 4 }, this.scene);
      mark.parent = root; mark.position.set((i - (requiredHits - 1) / 2) * .55, 2.5, 0); mark.rotation.x = Math.PI / 2;
      mark.billboardMode = Mesh.BILLBOARDMODE_ALL; mark.material = this.marker; marks.push(mark);
    }
    const warnings: Mesh[] = [];
    for (let i = 0; i < (boss ? 3 : 1); i++) {
      const stripe = MeshBuilder.CreateBox(`shot-path-${id}-${i}`, { width: .13, height: .04, depth: 1 }, this.scene);
      stripe.material = this.warning; stripe.setEnabled(false); warnings.push(stripe);
    }
    for (const mesh of [weapon, muzzle, ...marks, ...warnings]) mesh.isPickable = false;
    return { root, marks, warnings, muzzle };
  }

  render(state: RunState | undefined, distance: number, actors: ReadonlyMap<string, ModelActor>): void {
    const present = new Set<string>();
    for (const enemy of state?.enemies ?? []) {
      if (enemy.kind === 'normal') continue;
      present.add(enemy.id);
      let signals = this.enemies.get(enemy.id);
      const actor = actors.get(enemy.id);
      if (!actor) continue;
      if (!signals) { signals = this.create(enemy.id, enemy.kind === 'boss', enemy.requiredHits, actor); this.enemies.set(enemy.id, signals); }
      const preparing = enemy.status === 'alive' && enemy.shooting?.phase === 'telegraph';
      signals.muzzle.setEnabled(preparing);
      // Progress follows simulation time, therefore pause freezes the warning.
      signals.muzzle.scaling.setAll(preparing ? .8 + .2 * Math.sin(state!.time * 18) : 1);
      signals.marks.forEach((mark, i) => mark.setEnabled(enemy.status === 'alive' && i < enemy.hitsRemaining));
      signals.warnings.forEach((stripe, i) => {
        stripe.setEnabled(Boolean(preparing));
        if (!preparing) return;
        const direction = (enemy.kind === 'boss' ? enemy.shooting!.directions[i] : undefined) ?? {
          x: state!.hero.x - enemy.x, z: state!.hero.z - enemy.z,
        };
        const length = Math.hypot(direction.x, direction.z) || 1;
        const ray = new Vector3(-direction.x / length, 0, direction.z / length);
        const reach = Math.min(42, Math.max(4, enemy.z - state!.hero.z + 3));
        const start = toScenePoint(enemy, distance, .055);
        stripe.position.copyFrom(start.add(ray.scale(reach / 2)));
        stripe.rotation.y = Math.atan2(ray.x, ray.z); stripe.scaling.z = reach;
      });
    }
    for (const [id, signals] of this.enemies) if (!present.has(id)) {
      signals.root.dispose(); signals.warnings.forEach(mesh => mesh.dispose()); this.enemies.delete(id);
    }
    const flying = new Set<string>();
    for (const projectile of state?.projectiles ?? []) {
      flying.add(projectile.id);
      let mesh = this.bullets.get(projectile.id);
      if (!mesh) {
        mesh = MeshBuilder.CreateSphere(`bullet-${projectile.id}`, { diameter: projectile.radius * 2, segments: 6 }, this.scene);
        mesh.material = this.bullet; mesh.isPickable = false; this.bullets.set(projectile.id, mesh);
      }
      mesh.position.copyFrom(toScenePoint(projectile, distance, .8));
      mesh.scaling.z = 1.7;
      mesh.rotation.y = Math.atan2(-projectile.velocity.x, projectile.velocity.z);
    }
    for (const [id, mesh] of this.bullets) if (!flying.has(id)) { mesh.dispose(); this.bullets.delete(id); }
  }

  clear(): void {
    for (const signals of this.enemies.values()) {
      signals.root.dispose(); signals.warnings.forEach(mesh => mesh.dispose());
    }
    this.enemies.clear();
    for (const mesh of this.bullets.values()) mesh.dispose();
    this.bullets.clear();
  }

  dispose(): void { this.clear(); for (const material of [this.warning, this.metal, this.marker, this.bullet]) material.dispose(); }
}
