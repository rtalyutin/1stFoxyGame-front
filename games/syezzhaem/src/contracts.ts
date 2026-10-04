/** R1 simulation contract. House coordinates are local, world coordinates are absolute. */
import rulesDefinition from '../public/content/r1-rules-1.json' with { type: 'json' };
export type Space = 'house' | 'world';
export type Material = 'wood';
export type Outcome = 'playing' | 'won' | 'lost';
export interface Cell { space: Space; x: number; y: number }
export interface Block extends Cell {
  id: string; material: Material; originalId: string | null; portable: boolean;
}
export interface Support extends Cell { blockId: string }
export interface Player {
  x: number; y: number; vx: number; vy: number; hp: number;
  support: Support | null; jumpHeld: boolean;
}
export interface House {
  x: number; y: number; heartHp: number;
  motion: 'moving' | 'gap' | 'unsupported' | 'portal'; supportTimer: number;
}
export interface Snapshot {
  schemaVersion: 1; contentVersion: 'r1-map-1'; rulesVersion: 'r1-rules-1';
  runId: string; tick: number; outcome: Outcome; reason: string | null;
  house: House; player: Player; inventory: { wood: number }; blocks: Block[];
  nextBlockId: number;
}
export interface Input { left: boolean; right: boolean; jump: boolean }
export interface Target extends Cell { blockId: string | null }
export type ActionResult = { ok: true; block?: Block } | { ok: false; reason: string };
export const RULES = Object.freeze(rulesDefinition);
declare const __SYEZZHAEM_BUILD_ID__: string;
export const BUILD_ID = typeof __SYEZZHAEM_BUILD_ID__ === 'string' ? __SYEZZHAEM_BUILD_ID__ : 'r1-local-001';
