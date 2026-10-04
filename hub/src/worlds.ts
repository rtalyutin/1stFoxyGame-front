import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Manifest } from './catalog';

/** Only called for a horizontally and vertically visible world. No timers. */
export class LivingWorld {
  private time = 0;
  private nodes = new Map<string, TransformNode>();
  private origins = new Map<string, { x: number; y: number; z: number }>();
  constructor(readonly container: AssetContainer, readonly root: TransformNode, readonly manifest: Manifest) {
    for (const node of [...container.transformNodes, ...container.meshes]) {
      this.nodes.set(node.name, node);
      this.origins.set(node.name, { x:node.position.x,y:node.position.y,z:node.position.z });
      if(/^(npc_runner$|npc_runner_(leg|arm)_|spark_|knight_|orbit_|throne_crystal$|cat$)/.test(node.name))node.rotationQuaternion=null;
    }
  }
  node(name: string): TransformNode {
    const node = this.nodes.get(name);
    if (!node) throw new Error(`Missing GLB node: ${name}`);
    return node;
  }
  update(dt: number): void {
    this.time += dt; const t = this.time;
    if (this.manifest.behavior === 'forge') {
      const runner = this.node('npc_runner');
      runner.position.x = Math.sin(t * 1.35) * .85;
      runner.rotation.y = Math.cos(t * 1.35) > 0 ? Math.PI/2 : -Math.PI/2;
      for (let i=0;i<2;i++) {
        const leg = this.node(`npc_runner_leg_${i}`);
        leg.rotationQuaternion = null; leg.rotation.x = Math.sin(t*14+i*Math.PI)*.7;
        const arm = this.node(`npc_runner_arm_${i}`);
        arm.rotationQuaternion = null; arm.rotation.x = -leg.rotation.x;
      }
      const hammer = this.node('hammer'); hammer.position.y = 2.76 + Math.sin(t*3)*.15;
      for (let i=0;i<5;i++) {
        const spark = this.node(`spark_${i}`), origin = this.origins.get(spark.name)!;
        spark.position.y = origin.y + (t*.3+i*.13)% .65;
        spark.rotation.y += dt*1.1;
      }
    } else if (this.manifest.behavior === 'throne') {
      for (let i=0;i<4;i++) {
        const knight = this.node(`knight_${i}`), phase = t*.65+i*Math.PI/2;
        knight.position.x = Math.sin(phase)*1.07;
        knight.position.z = -.18 + Math.cos(phase)*.17;
        knight.rotation.y = phase + Math.PI/2;
        knight.position.y = 1.14 + Math.abs(Math.sin(t*8+i))*.035;
        const gem = this.node(`orbit_${i}`), origin = this.origins.get(gem.name)!;
        gem.position.y = origin.y + Math.sin(t*1.4+i)*.13;
        gem.rotation.y += dt*.65;
      }
      this.node('throne_crystal').rotation.y += dt*.4;
    } else {
      const cart = this.node('moving_cart'); cart.position.x = Math.sin(t*.7)*.63;
      const cat = this.node('cat');
      cat.position.x = Math.sin(t*.9)*.85; cat.rotation.y = Math.cos(t*.9)>0 ? 0 : Math.PI;
      cat.position.y = 1.34 + Math.max(0,Math.sin(t*2.7))*.13;
      for (let i=0;i<4;i++) {
        const block = this.node(`floating_block_${i}`), cap = this.node(`grass_cap_${i}`);
        const offset = Math.sin(t+i)*.08;
        block.position.y = this.origins.get(block.name)!.y + offset;
        cap.position.y = this.origins.get(cap.name)!.y + offset;
      }
    }
  }
  dispose(): void { this.root.dispose(); this.container.dispose(); }
}
