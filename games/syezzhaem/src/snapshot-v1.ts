import { BUILD_ID, RULES, type Snapshot, type Space } from './contracts.js';
import { createInitial, initialBlocks, restore, retainedFraction } from './core.js';

export interface BuildContext {
  client_build_id: string; content_version: string; rules_version: string; level_id: string;
}
export const BUILD_CONTEXT: Readonly<BuildContext> = Object.freeze({
  client_build_id: BUILD_ID, content_version: 'r1-map-1', rules_version: 'r1-rules-1', level_id: 'house-bridge-portal',
});
export interface CellOverride {
  x: number; y: number; operation: 'remove' | 'put'; base_block_id: string | null;
  block_id: string | null; original_block_id: string | null; material: 'wood' | null;
}
export interface SnapshotV1 extends BuildContext {
  schema_version: 1; run_id: string; sim_tick: number; rng_state: number;
  outcome: 'playing' | 'won' | 'lost'; reason: string | null;
  player: { x: number; y: number; vx: number; vy: number; hp: number;
    support: null | { coordinate_space: Space; x: number; y: number; block_id: string };
    held_actor_key: null; timers: Record<string, never> };
  house: { x: number; y: number; core_hp: number; movement_state: Snapshot['house']['motion']; support_loss_ticks: number };
  house_cells: CellOverride[]; world_cells: CellOverride[];
  inventory: { wood: number }; actors: never[]; lava: null;
  counters: { distance: number; placed_sequence: number };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected object`);
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: string[], path: string): Record<string, unknown> {
  const r = object(value, path);
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r, k))) throw new Error(`${path}: missing or unexpected field`);
  return r;
}
function int(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`${path}: invalid integer`);
  return value;
}
function context(value: unknown): BuildContext {
  const r = object(value, 'snapshot');
  if (typeof r.client_build_id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(r.client_build_id)) throw new Error('client_build_id: invalid build');
  if (r.content_version !== BUILD_CONTEXT.content_version || r.rules_version !== BUILD_CONTEXT.rules_version || r.level_id !== BUILD_CONTEXT.level_id) throw new Error('content_version: incompatible content/rules/level');
  return { client_build_id: r.client_build_id, content_version: r.content_version as string, rules_version: r.rules_version as string, level_id: r.level_id as string };
}

/** Encode only deviations; a removed base cell remains a tombstone even after rebuilding. */
export function toSnapshotV1(state: Snapshot, build: BuildContext = BUILD_CONTEXT): SnapshotV1 {
  const s = restore(state);
  context(build);
  if (!uuid.test(s.runId)) throw new Error('run_id: expected UUID');
  const baseline = initialBlocks();
  const diff = (space: Space): CellOverride[] => {
    const cells: CellOverride[] = [];
    for (const b of baseline.filter(b => b.space === space)) {
      if (s.blocks.some(current => current.id === b.id)) continue;
      const replacement = s.blocks.find(current => current.space === space && current.x === b.x && current.y === b.y);
      cells.push({ x: b.x, y: b.y, operation: replacement ? 'put' : 'remove', base_block_id: b.id,
        block_id: replacement?.id ?? null, original_block_id: replacement?.originalId ?? null, material: replacement?.material ?? null });
    }
    for (const b of s.blocks.filter(b => b.space === space && !baseline.some(base => base.space === space && base.x === b.x && base.y === b.y))) {
      cells.push({ x: b.x, y: b.y, operation: 'put', base_block_id: null, block_id: b.id, original_block_id: b.originalId, material: b.material });
    }
    return cells.sort((a, b) => a.x - b.x || a.y - b.y);
  };
  return { schema_version: 1, ...build, run_id: s.runId, sim_tick: s.tick, rng_state: 1, outcome: s.outcome, reason: s.reason,
    player: { x: s.player.x, y: s.player.y, vx: s.player.vx, vy: s.player.vy, hp: s.player.hp,
      support: s.player.support ? { coordinate_space: s.player.support.space, x: s.player.support.x, y: s.player.support.y, block_id: s.player.support.blockId } : null,
      held_actor_key: null, timers: {} },
    house: { x: s.house.x, y: s.house.y, core_hp: s.house.heartHp, movement_state: s.house.motion, support_loss_ticks: Math.round(s.house.supportTimer * RULES.tickRate) },
    house_cells: diff('house'), world_cells: diff('world'), inventory: { ...s.inventory }, actors: [], lava: null,
    counters: { distance: s.house.x - 2, placed_sequence: s.nextBlockId } };
}

/** Validate transport, apply overrides to this immutable version, then validate the whole world. */
export function fromSnapshotV1(raw: unknown): Snapshot {
  const r = exact(raw, ['schema_version','client_build_id','content_version','rules_version','level_id','run_id','sim_tick','rng_state','outcome','reason','player','house','house_cells','world_cells','inventory','actors','lava','counters'], 'snapshot');
  const c = context(r);
  if (r.schema_version !== 1 || typeof r.run_id !== 'string' || !uuid.test(r.run_id)) throw new Error('schema_version/run_id: invalid');
  int(r.rng_state, 1, 1, 'rng_state');
  if (!Array.isArray(r.actors) || r.actors.length || r.lava !== null) throw new Error('actors/lava: unsupported R1 state');
  const p = exact(r.player, ['x','y','vx','vy','hp','support','held_actor_key','timers'], 'player');
  if (p.held_actor_key !== null) throw new Error('player.held_actor_key: unsupported R1 state');
  exact(p.timers, [], 'player.timers');
  const h = exact(r.house, ['x','y','core_hp','movement_state','support_loss_ticks'], 'house');
  int(h.support_loss_ticks, 0, Math.round(RULES.supportGrace * RULES.tickRate), 'house.support_loss_ticks');
  const counts = exact(r.counters, ['distance','placed_sequence'], 'counters');
  if (typeof h.x !== 'number' || counts.distance !== h.x - 2) throw new Error('counters.distance: inconsistent house position');
  const blocks = initialBlocks();
  const baseline = initialBlocks();
  for (const space of ['house','world'] as const) {
    const cells = r[`${space}_cells`];
    if (!Array.isArray(cells) || cells.length > 650) throw new Error(`${space}_cells: invalid list`);
    const seen = new Set<string>();
    cells.forEach((value, i) => {
      const path = `${space}_cells[${i}]`;
      const o = exact(value, ['x','y','operation','base_block_id','block_id','original_block_id','material'], path);
      int(o.x, -10, 40, `${path}.x`); int(o.y, 0, 12, `${path}.y`);
      const key = `${o.x}:${o.y}`;
      if (seen.has(key)) throw new Error(`${path}: duplicate cell`);
      seen.add(key);
      const base = baseline.find(b => b.space === space && b.x === o.x && b.y === o.y);
      if (o.base_block_id !== (base?.id ?? null)) throw new Error(`${path}.base_block_id: wrong base identity`);
      if (base && !base.portable) throw new Error(`${path}: immutable terrain`);
      const index = blocks.findIndex(b => b.space === space && b.x === o.x && b.y === o.y);
      if (index >= 0) blocks.splice(index, 1);
      if (o.operation === 'remove') {
        if (!base || o.block_id !== null || o.original_block_id !== null || o.material !== null) throw new Error(`${path}: invalid tombstone`);
      } else if (o.operation === 'put') {
        if (typeof o.block_id !== 'string' || o.original_block_id !== null || o.material !== 'wood' || !/^placed:/.test(o.block_id)) throw new Error(`${path}: invalid new block`);
        blocks.push({ space, x: o.x as number, y: o.y as number, id: o.block_id, originalId: null, material: 'wood', portable: true });
      } else throw new Error(`${path}.operation: invalid`);
    });
  }
  let support = null;
  if (p.support !== null) {
    const s = exact(p.support, ['coordinate_space','x','y','block_id'], 'player.support');
    support = { space: s.coordinate_space, x: s.x, y: s.y, blockId: s.block_id };
  }
  return restore({ schemaVersion: 1, contentVersion: c.content_version, rulesVersion: c.rules_version,
    runId: r.run_id, tick: r.sim_tick, outcome: r.outcome, reason: r.reason,
    house: { x: h.x, y: h.y, heartHp: h.core_hp, motion: h.movement_state, supportTimer: (h.support_loss_ticks as number) / RULES.tickRate },
    player: { x: p.x, y: p.y, vx: p.vx, vy: p.vy, hp: p.hp, support, jumpHeld: false },
    inventory: r.inventory, blocks, nextBlockId: counts.placed_sequence });
}
export function validateSnapshotV1(raw: unknown, expected?: BuildContext): SnapshotV1 {
  const s = fromSnapshotV1(raw);
  const c = context(raw);
  if (expected && Object.keys(expected).some(k => c[k as keyof BuildContext] !== expected[k as keyof BuildContext])) throw new Error('client_build_id: snapshot is not pinned to this run');
  return toSnapshotV1(s, c);
}
export function createSnapshotV1(runId: string, build: BuildContext = BUILD_CONTEXT): SnapshotV1 {
  return toSnapshotV1(createInitial(runId), build);
}
export function scoreSnapshot(raw: SnapshotV1): { outcome: 'playing' | 'won' | 'lost'; score: number; elapsed_seconds: number; retained_fraction: number; distance: number; cat_saved: false; chest_saved: false } {
  const s = fromSnapshotV1(raw), fraction = retainedFraction(s), elapsed = s.tick / RULES.tickRate;
  return { outcome: s.outcome, score: s.outcome === 'won' ? 1000 + Math.floor(400 * fraction) + Math.max(0, 300 - Math.floor(elapsed)) : 0,
    elapsed_seconds: elapsed, retained_fraction: fraction, distance: s.house.x - 2, cat_saved: false, chest_saved: false };
}
