import type { ItemDefinitionId, Profile, Slot } from '../game/equipment';
import { EQUIPMENT_APPEARANCES } from './equipment-registry';

export interface AppearanceKey { definitionId: ItemDefinitionId; level: number; }
export type AppearanceLoadout = Record<Slot, AppearanceKey | null>;
export interface Appearance { key: AppearanceKey; parts: readonly string[]; displayPath: string; }

/** First through-rig probe. Further levels are added after G-RIG/G-SHOP. */
export const PROBE_APPEARANCES: readonly Appearance[] = [
  { key: { definitionId: 'side_step_boots', level: 1 }, parts: ['wear_side_step_boots_L','wear_side_step_boots_R','wear_side_step_boots_L_shell','wear_side_step_boots_R_shell'], displayPath: 'models/runner-3d/side_step_boots_1.glb' },
  { key: { definitionId: 'conductor_cuffs', level: 1 }, parts: ['wear_conductor_cuffs_L','wear_conductor_cuffs_R'], displayPath: 'models/runner-3d/conductor_cuffs_1.glb' },
  { key: { definitionId: 'fast_reel', level: 1 }, parts: ['wear_fast_reel_single'], displayPath: 'models/runner-3d/fast_reel_1.glb' },
  { key: { definitionId: 'debt_clock', level: 1 }, parts: ['wear_debt_clock_single'], displayPath: 'models/runner-3d/debt_clock_1.glb' },
];
export const APPEARANCES = EQUIPMENT_APPEARANCES;
export function findAppearance(key: AppearanceKey): Appearance | undefined {
  return APPEARANCES.find(a => a.key.definitionId === key.definitionId && a.key.level === key.level);
}
export function committedAppearance(profile: Profile): AppearanceLoadout {
  const result: AppearanceLoadout = { weapon: null, body: null, legs: null, talisman: null };
  for (const slot of Object.keys(result) as Slot[]) {
    const item = profile.items.find(i => i.id === profile.loadouts.pudge[slot]);
    if (item) result[slot] = { definitionId: item.definitionId, level: item.level };
  }
  return result;
}
export function applyAppearance(actor: { setPartEnabled(name: string, enabled: boolean): void }, loadout: AppearanceLoadout, appearances:readonly Appearance[]=APPEARANCES): void {
  for (const appearance of appearances) for (const part of appearance.parts) actor.setPartEnabled(part, false);
  for (const key of Object.values(loadout)) {
    if (key) for (const part of appearances.find(a=>a.key.definitionId===key.definitionId&&a.key.level===key.level)?.parts ?? []) actor.setPartEnabled(part, true);
  }
}
