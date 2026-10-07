/** R1 simulation contract. House coordinates are local, world coordinates are absolute. */
import rulesDefinition from '../public/content/r1-rules-1.json' with { type: 'json' };
import tutorialRules from '../public/content/r1-rules-2.json' with { type: 'json' };
import routeRules from '../public/content/r2-rules-1.json' with { type: 'json' };
import materialDefinitions from '../public/content/r2-materials-1.json' with { type: 'json' };
export type ContentVersion = 'r1-map-1' | 'r1-map-2' | 'r2-map-1';
export type RulesVersion = 'r1-rules-1' | 'r1-rules-2' | 'r2-rules-1';
export type Space = 'house' | 'world';
export type Material = 'wood' | 'stone' | 'slime';
export type Outcome = 'playing' | 'won' | 'lost';
export interface Cell { space: Space; x: number; y: number }
export interface Block extends Cell {
  id: string; material: Material; originalId: string | null; portable: boolean;
  durability?: number; burnTicks?: number;
}
export interface Support extends Cell { blockId: string }
export interface Player {
  x: number; y: number; vx: number; vy: number; hp: number;
  support: Support | null; jumpHeld: boolean;
  heldActorKey?: string | null; actionCooldownTicks?: number;
}
export interface Inventory { wood: number; stone?: number; slime?: number }
export type ActorState = 'idle' | 'falling' | 'held' | 'destroyed' | 'patrol' | 'chase' | 'armed' | 'exploded' | 'removed';
export interface Actor {
  actorKey: string; kind: 'cat' | 'chest' | 'mob'; x: number; y: number; vx: number; vy: number;
  hp: number; support: Support | null; state: ActorState; direction: -1 | 1;
  fuseTicks: number; explosionApplied: boolean;
}
export interface Lava { x: number; playerDamageTicks: number; coreDamageTicks: number }
export interface House {
  x: number; y: number; heartHp: number;
  motion: 'moving' | 'gap' | 'unsupported' | 'portal'; supportTimer: number;
}
export interface Snapshot {
  schemaVersion: 1; contentVersion: ContentVersion; rulesVersion: RulesVersion;
  runId: string; tick: number; outcome: Outcome; reason: string | null;
  house: House; player: Player; inventory: Inventory; blocks: Block[];
  nextBlockId: number;
  actors?: Actor[]; lava?: Lava; tutorialPlacements?: number; destroyedMaterials?: Required<Inventory>;
}
export interface Input { left: boolean; right: boolean; jump: boolean }
export interface Target extends Cell { blockId: string | null }
export type ActionResult = { ok: true; block?: Block; actor?: Actor } | { ok: false; reason: string };
export const RULES = Object.freeze(rulesDefinition);
export const TUTORIAL_RULES = Object.freeze(tutorialRules);
export const R2_RULES = Object.freeze(routeRules);
export const MATERIALS = Object.freeze(Object.fromEntries(materialDefinitions.materials.map(material => [material.key, {durability: material.durability, burnTicks: material.burn_ticks}])) as Record<Material, {durability: number; burnTicks: number}>);
export function isR2(s: {contentVersion: ContentVersion}): boolean { return s.contentVersion === 'r2-map-1'; }
export function compatibleContent(content: unknown, rules: unknown): boolean {
  return content === 'r1-map-1' && rules === 'r1-rules-1' || content === 'r1-map-2' && rules === 'r1-rules-2' || content === 'r2-map-1' && rules === 'r2-rules-1';
}
export function rulesFor(s: {rulesVersion: RulesVersion}) {
  return s.rulesVersion === 'r2-rules-1' ? R2_RULES : s.rulesVersion === 'r1-rules-2' ? TUTORIAL_RULES : RULES;
}
declare const __SYEZZHAEM_BUILD_ID__: string;
export const BUILD_ID = typeof __SYEZZHAEM_BUILD_ID__ === 'string' ? __SYEZZHAEM_BUILD_ID__ : 'r2-route-001';
