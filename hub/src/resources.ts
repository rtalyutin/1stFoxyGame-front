export type ResourceState = 'unloaded' | 'loading' | 'ready-paused' | 'active' | 'disposed' | 'error';
export interface Disposable { dispose(): void }
type Slot<T> = { state: ResourceState; generation: number; value?: T; task?: Promise<T | undefined> };
/** Ownership is per slot: unloading never destroys another slot's GPU assets. */
export class ResourceManager<T extends Disposable> {
  readonly slots: Slot<T>[];
  constructor(count: number, private load: (index: number) => Promise<T>, private changed: (index: number, state: ResourceState) => void) {
    this.slots = Array.from({ length: count }, () => ({ state: 'unloaded', generation: 0 }));
  }
  private set(index: number, state: ResourceState): void { if(this.slots[index].state===state)return;this.slots[index].state = state; this.changed(index, state); }
  async ensure(index: number, retry = false): Promise<T | undefined> {
    const slot = this.slots[index];
    if (slot.value) return slot.value;
    if (slot.task) return slot.task;
    if (slot.state === 'error' && !retry) return;
    const generation = ++slot.generation; this.set(index, 'loading');
    const task = this.load(index).then(value => {
      if (generation !== slot.generation) { value.dispose(); return; }
      slot.value = value; this.set(index, 'ready-paused'); return value;
    }, () => { if (generation === slot.generation) this.set(index, 'error'); return undefined; });
    slot.task = task;
    try { return await task; } finally { if (slot.task === task) slot.task = undefined; }
  }
  reconcile(resident: Set<number>, active: Set<number>): void {
    this.slots.forEach((slot, i) => {
      if (!resident.has(i)) {
        if (slot.state !== 'unloaded' && slot.state !== 'disposed' && slot.state !== 'error') {
          ++slot.generation; slot.task = undefined; slot.value?.dispose(); slot.value = undefined; this.set(i, 'disposed');
        }
      } else {
        if (slot.value) this.set(i, active.has(i) ? 'active' : 'ready-paused');
        else void this.ensure(i);
      }
    });
  }
  dispose(): void {
    this.slots.forEach((slot,i) => { ++slot.generation; slot.value?.dispose(); slot.value = undefined; slot.task = undefined; this.set(i,'disposed'); });
  }
}
