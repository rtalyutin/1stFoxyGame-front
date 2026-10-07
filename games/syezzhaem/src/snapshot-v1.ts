import { BUILD_ID, MATERIALS, RULES, isR2, rulesFor, compatibleContent, type Actor, type ContentVersion, type Inventory, type Material, type Snapshot, type Space, type Support } from './contracts.js';
import { actorSaved, createInitial, initialBlocks, restore, retainedFraction } from './core.js';

export interface BuildContext { client_build_id: string; content_version: string; rules_version: string; level_id: string }
export const BUILD_CONTEXT: Readonly<BuildContext> = Object.freeze({client_build_id: BUILD_ID, content_version: 'r1-map-1', rules_version: 'r1-rules-1', level_id: 'house-bridge-portal'});
export const INTRO_BUILD_CONTEXT: Readonly<BuildContext> = Object.freeze({client_build_id: BUILD_ID, content_version: 'r1-map-2', rules_version: 'r1-rules-2', level_id: 'house-bridge-portal-intro'});
export const TUTORIAL_BUILD_CONTEXT = INTRO_BUILD_CONTEXT;
export const CURRENT_BUILD_CONTEXT: Readonly<BuildContext> = Object.freeze({client_build_id: BUILD_ID, content_version: 'r2-map-1', rules_version: 'r2-rules-1', level_id: 'house-full-route'});
export interface CellOverride {
  x: number; y: number; operation: 'remove' | 'put'; base_block_id: string | null;
  block_id: string | null; original_block_id: string | null; material: Material | null;
  durability?: number | null; burn_ticks?: number | null;
}
export type SupportV1 = null | {coordinate_space: Space; x: number; y: number; block_id: string};
export interface ActorV1 {
  actor_key: string; kind: Actor['kind']; x: number; y: number; vx: number; vy: number; hp: number;
  state: Actor['state']; support: SupportV1; direction: -1 | 1; fuse_ticks: number; explosion_applied: boolean;
}
export interface SnapshotV1 extends BuildContext {
  schema_version: 1; run_id: string; sim_tick: number; rng_state: number;
  outcome: 'playing' | 'won' | 'lost'; reason: string | null;
  player: {x: number; y: number; vx: number; vy: number; hp: number; support: SupportV1; held_actor_key: string | null; timers: {action_cooldown_ticks?: number}};
  house: {x: number; y: number; core_hp: number; movement_state: Snapshot['house']['motion']; support_loss_ticks: number};
  house_cells: CellOverride[]; world_cells: CellOverride[]; inventory: Inventory; actors: ActorV1[];
  lava: null | {x: number; player_damage_ticks: number; core_damage_ticks: number};
  counters: {distance: number; placed_sequence: number; tutorial_placements?: number; destroyed_wood?: number; destroyed_stone?: number; destroyed_slime?: number};
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
  const level = r.content_version === 'r2-map-1' ? CURRENT_BUILD_CONTEXT.level_id : r.content_version === 'r1-map-2' ? INTRO_BUILD_CONTEXT.level_id : BUILD_CONTEXT.level_id;
  if (!compatibleContent(r.content_version, r.rules_version) || r.level_id !== level) throw new Error('content_version: incompatible content/rules/level');
  return {client_build_id: r.client_build_id, content_version: r.content_version as string, rules_version: r.rules_version as string, level_id: r.level_id as string};
}
const supportV1 = (support: Support | null): SupportV1 => support ? {coordinate_space: support.space, x: support.x, y: support.y, block_id: support.blockId} : null;
function readSupport(value: unknown, path: string): Support | null {
  if (value === null) return null;
  const support = exact(value, ['coordinate_space','x','y','block_id'], path);
  return {space: support.coordinate_space as Space, x: support.x as number, y: support.y as number, blockId: support.block_id as string};
}

/** R1 retains its exact shape. R2 adds version-gated typed fields, never a renamed old snapshot. */
export function toSnapshotV1(state: Snapshot, build?: BuildContext): SnapshotV1 {
  const s = restore(state), rules = rulesFor(s), r2 = isR2(s);
  build ??= r2 ? CURRENT_BUILD_CONTEXT : s.contentVersion === 'r1-map-2' ? INTRO_BUILD_CONTEXT : BUILD_CONTEXT;
  context(build);
  if (s.contentVersion !== build.content_version || s.rulesVersion !== build.rules_version) throw new Error('content_version: state/build mismatch');
  if (!uuid.test(s.runId)) throw new Error('run_id: expected UUID');
  const baseline = initialBlocks(s.contentVersion);
  const diff = (space: Space): CellOverride[] => {
    const cells: CellOverride[] = [];
    const add = (base: (typeof baseline)[number] | undefined, current: (typeof baseline)[number] | undefined, x: number, y: number) => {
      const cell: CellOverride = {x, y, operation: current ? 'put' : 'remove', base_block_id: base?.id ?? null, block_id: current?.id ?? null, original_block_id: current?.originalId ?? null, material: current?.material ?? null};
      if (r2) {cell.durability = current?.durability ?? null; cell.burn_ticks = current?.burnTicks ?? null;}
      cells.push(cell);
    };
    for (const base of baseline.filter(block => block.space === space)) {
      const current = s.blocks.find(block => block.space === space && block.x === base.x && block.y === base.y);
      if (current?.id === base.id && (!r2 || current.durability === base.durability && current.burnTicks === base.burnTicks)) continue;
      add(base, current, base.x, base.y);
    }
    for (const block of s.blocks.filter(block => block.space === space && !baseline.some(base => base.space === space && base.x === block.x && base.y === block.y))) add(undefined, block, block.x, block.y);
    return cells.sort((a,b) => a.x-b.x || a.y-b.y);
  };
  const dto: SnapshotV1 = {schema_version: 1, ...build, run_id: s.runId, sim_tick: s.tick, rng_state: 1, outcome: s.outcome, reason: s.reason,
    player: {x: s.player.x, y: s.player.y, vx: s.player.vx, vy: s.player.vy, hp: s.player.hp, support: supportV1(s.player.support), held_actor_key: null, timers: {}},
    house: {x: s.house.x, y: s.house.y, core_hp: s.house.heartHp, movement_state: s.house.motion, support_loss_ticks: Math.round(s.house.supportTimer * rules.tickRate)},
    house_cells: diff('house'), world_cells: diff('world'), inventory: {...s.inventory}, actors: [], lava: null,
    counters: {distance: s.house.x-2, placed_sequence: s.nextBlockId}};
  if (r2) {
    dto.player.held_actor_key = s.player.heldActorKey!; dto.player.timers = {action_cooldown_ticks: s.player.actionCooldownTicks!};
    dto.actors = [...s.actors!].sort((a,b) => a.actorKey.localeCompare(b.actorKey)).map(actor => ({actor_key: actor.actorKey, kind: actor.kind, x: actor.x, y: actor.y, vx: actor.vx, vy: actor.vy, hp: actor.hp, state: actor.state, support: supportV1(actor.support), direction: actor.direction, fuse_ticks: actor.fuseTicks, explosion_applied: actor.explosionApplied}));
    dto.lava = {x: s.lava!.x, player_damage_ticks: s.lava!.playerDamageTicks, core_damage_ticks: s.lava!.coreDamageTicks};
    Object.assign(dto.counters, {tutorial_placements: s.tutorialPlacements, destroyed_wood: s.destroyedMaterials!.wood, destroyed_stone: s.destroyedMaterials!.stone, destroyed_slime: s.destroyedMaterials!.slime});
  }
  return dto;
}
export function fromSnapshotV1(raw: unknown): Snapshot {
  const r = exact(raw, ['schema_version','client_build_id','content_version','rules_version','level_id','run_id','sim_tick','rng_state','outcome','reason','player','house','house_cells','world_cells','inventory','actors','lava','counters'], 'snapshot');
  const c = context(r), rules = rulesFor({rulesVersion: c.rules_version as Snapshot['rulesVersion']}), r2 = c.content_version === 'r2-map-1';
  if (r.schema_version !== 1 || typeof r.run_id !== 'string' || !uuid.test(r.run_id)) throw new Error('schema_version/run_id: invalid');
  int(r.rng_state, 1, 1, 'rng_state');
  const p = exact(r.player, ['x','y','vx','vy','hp','support','held_actor_key','timers'], 'player');
  if (!r2 && p.held_actor_key !== null) throw new Error('player.held_actor_key: unsupported R1 state');
  const timers = exact(p.timers, r2 ? ['action_cooldown_ticks'] : [], 'player.timers');
  const h = exact(r.house, ['x','y','core_hp','movement_state','support_loss_ticks'], 'house');
  int(h.support_loss_ticks, 0, Math.round(rules.supportGrace*rules.tickRate), 'house.support_loss_ticks');
  const counts = exact(r.counters, r2 ? ['distance','placed_sequence','tutorial_placements','destroyed_wood','destroyed_stone','destroyed_slime'] : ['distance','placed_sequence'], 'counters');
  if (typeof h.x !== 'number' || counts.distance !== h.x-2) throw new Error('counters.distance: inconsistent house position');
  const blocks = initialBlocks(c.content_version as ContentVersion), baseline = initialBlocks(c.content_version as ContentVersion);
  for (const space of ['house','world'] as const) {
    const cells = r[`${space}_cells`]; if (!Array.isArray(cells) || cells.length > 650) throw new Error(`${space}_cells: invalid list`);
    const seen = new Set<string>();
    cells.forEach((value,i) => {
      const path = `${space}_cells[${i}]`, fields = ['x','y','operation','base_block_id','block_id','original_block_id','material'];
      if (r2) fields.push('durability','burn_ticks');
      const o = exact(value, fields, path); int(o.x,-10,r2 ? 140 : 40,`${path}.x`); int(o.y,0,12,`${path}.y`);
      const key = `${o.x}:${o.y}`; if (seen.has(key)) throw new Error(`${path}: duplicate cell`); seen.add(key);
      const base = baseline.find(block => block.space === space && block.x === o.x && block.y === o.y);
      if (o.base_block_id !== (base?.id ?? null)) throw new Error(`${path}.base_block_id: wrong base identity`);
      if (base && !base.portable && !r2) throw new Error(`${path}: immutable terrain`);
      const index = blocks.findIndex(block => block.space === space && block.x === o.x && block.y === o.y); if (index >= 0) blocks.splice(index,1);
      if (o.operation === 'remove') {
        if (!base || o.block_id !== null || o.original_block_id !== null || o.material !== null || r2 && (o.durability !== null || o.burn_ticks !== null)) throw new Error(`${path}: invalid tombstone`);
      } else if (o.operation === 'put') {
        const material = o.material as Material;
        if (typeof o.block_id !== 'string' || !Object.hasOwn(MATERIALS,material) || !r2 && material !== 'wood') throw new Error(`${path}: invalid block`);
        const sameBase = r2 && base && o.block_id === base.id;
        if (sameBase) { if (o.original_block_id !== base.originalId || material !== base.material) throw new Error(`${path}: base identity modified`); }
        else if (o.original_block_id !== null || !/^placed:/.test(o.block_id)) throw new Error(`${path}: invalid new block identity`);
        const block = {space, x:o.x as number, y:o.y as number, id:o.block_id, originalId:o.original_block_id as string|null, material, portable:sameBase ? base!.portable : true};
        if (r2) Object.assign(block,{durability:int(o.durability,1,MATERIALS[material].durability,`${path}.durability`), burnTicks:int(o.burn_ticks,0,MATERIALS[material].burnTicks,`${path}.burn_ticks`)});
        blocks.push(block);
      } else throw new Error(`${path}.operation: invalid`);
    });
  }
  const state: Record<string,unknown> = {schemaVersion:1, contentVersion:c.content_version, rulesVersion:c.rules_version, runId:r.run_id, tick:r.sim_tick, outcome:r.outcome, reason:r.reason,
    house:{x:h.x,y:h.y,heartHp:h.core_hp,motion:h.movement_state,supportTimer:(h.support_loss_ticks as number)/rules.tickRate},
    player:{x:p.x,y:p.y,vx:p.vx,vy:p.vy,hp:p.hp,support:readSupport(p.support,'player.support'),jumpHeld:false},
    inventory:r.inventory,blocks,nextBlockId:counts.placed_sequence};
  if (!Array.isArray(r.actors)) throw new Error('actors: invalid list');
  if (r2) {
    const lava = exact(r.lava,['x','player_damage_ticks','core_damage_ticks'],'lava');
    Object.assign(state.player as object,{heldActorKey:p.held_actor_key,actionCooldownTicks:timers.action_cooldown_ticks});
    state.actors = r.actors.map((value,i) => {const actor = exact(value,['actor_key','kind','x','y','vx','vy','hp','state','support','direction','fuse_ticks','explosion_applied'],`actors[${i}]`); return {actorKey:actor.actor_key,kind:actor.kind,x:actor.x,y:actor.y,vx:actor.vx,vy:actor.vy,hp:actor.hp,state:actor.state,support:readSupport(actor.support,`actors[${i}].support`),direction:actor.direction,fuseTicks:actor.fuse_ticks,explosionApplied:actor.explosion_applied};});
    state.lava = {x:lava.x,playerDamageTicks:lava.player_damage_ticks,coreDamageTicks:lava.core_damage_ticks};
    state.tutorialPlacements = counts.tutorial_placements; state.destroyedMaterials = {wood:counts.destroyed_wood,stone:counts.destroyed_stone,slime:counts.destroyed_slime};
  } else if (r.actors.length || r.lava !== null) throw new Error('actors/lava: unsupported R1 state');
  return restore(state);
}
export function validateSnapshotV1(raw: unknown, expected?: BuildContext): SnapshotV1 {
  const state = fromSnapshotV1(raw), build = context(raw);
  if (expected && Object.keys(expected).some(key => build[key as keyof BuildContext] !== expected[key as keyof BuildContext])) throw new Error('client_build_id: snapshot is not pinned to this run');
  return toSnapshotV1(state,build);
}
export function createSnapshotV1(runId: string, build: BuildContext = BUILD_CONTEXT): SnapshotV1 { return toSnapshotV1(createInitial(runId,context(build).content_version as ContentVersion),build); }
export function scoreSnapshot(raw: SnapshotV1): {outcome: 'playing'|'won'|'lost';score:number;elapsed_seconds:number;retained_fraction:number;distance:number;cat_saved:boolean;chest_saved:boolean} {
  const state = fromSnapshotV1(raw), fraction = retainedFraction(state), elapsed = state.tick/rulesFor(state).tickRate, cat = actorSaved(state,'cat'), chest = actorSaved(state,'chest');
  return {outcome:state.outcome, score:state.outcome === 'won' ? 1000 + (cat ? 300 : 0) + (chest ? 300 : 0) + Math.floor(400*fraction) + Math.max(0,300-Math.floor(elapsed)) : 0, elapsed_seconds:elapsed,retained_fraction:fraction,distance:state.house.x-2,cat_saved:cat,chest_saved:chest};
}
