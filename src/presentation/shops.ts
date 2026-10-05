import type { RunState } from '../game/simulation';
import { ModelLibrary, type ModelActor } from './models';
import { toScenePoint } from './coordinates';

/** Static shops use simulation coordinates; the entrance is the interaction zone. */
export class ShopView {
  private actors = new Map<string, ModelActor>();
  constructor(private library: ModelLibrary) {}

  render(state: RunState | undefined, distance: number): void {
    const visible = new Set<string>();
    for (const shop of state?.shopCandidates ?? []) {
      visible.add(shop.id);
      let actor = this.actors.get(shop.id);
      if (!actor) {
        actor = this.library.create('shop', `shop-${shop.id}`);
        for (const mesh of actor.root.getChildMeshes()) mesh.isPickable = false;
        this.actors.set(shop.id, actor);
      }
      const entry = toScenePoint(shop, distance);
      actor.root.rotation.set(0, -Math.sign(entry.x) * Math.PI / 2, 0);
      actor.root.position.copyFrom(entry);
      actor.root.position.addInPlace(entry.subtract(actor.socket('socket_shop_entry')));
    }
    for (const [id, actor] of this.actors) if (!visible.has(id)) {
      actor.dispose(); this.actors.delete(id);
    }
  }

  clear(): void {
    for (const actor of this.actors.values()) actor.dispose();
    this.actors.clear();
  }
}
