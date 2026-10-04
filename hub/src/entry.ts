export type EntryState = 'IDLE' | 'PREPARING' | 'ENTERING' | 'ENTRY_COMPLETE' | 'ERROR';
export interface EntryHooks {
  prepare(id: string): Promise<void>;
  align(id: string): void;
  move(id: string, progress: number): void;
  reset(): void;
  changed(state: EntryState, id: string | null): void;
  complete(id: string): void;
}
/** A generation invalidates asynchronous preparation and prevents late navigation. */
export class EntryController {
  state: EntryState = 'IDLE'; id: string | null = null;
  private generation = 0; private elapsed = 0;
  constructor(private hooks: EntryHooks, private duration = 3.8) {}
  private set(state: EntryState): void { this.state = state; this.hooks.changed(state, this.id); }
  async select(id: string): Promise<void> {
    if (this.state !== 'IDLE' && this.state !== 'ERROR') return;
    const generation = ++this.generation;
    this.id = id; this.elapsed = 0; this.set('PREPARING');
    try {
      await this.hooks.prepare(id);
      if (generation !== this.generation) return;
      this.hooks.align(id); this.set('ENTERING'); this.hooks.move(id, 0);
    } catch {
      if (generation === this.generation) { this.hooks.reset(); this.set('ERROR'); }
    }
  }
  tick(dt: number): void {
    if (this.state !== 'ENTERING' || !this.id) return;
    this.elapsed += Math.max(0, Math.min(.05, dt));
    this.hooks.move(this.id, Math.min(1, this.elapsed / this.duration));
    if (this.elapsed >= this.duration) { const id = this.id; this.set('ENTRY_COMPLETE'); this.hooks.complete(id); }
  }
  cancel(): void {
    ++this.generation; this.elapsed = 0; this.id = null;
    this.hooks.reset(); this.set('IDLE');
  }
  fail(): void { ++this.generation; this.hooks.reset(); this.set('ERROR'); }
}
