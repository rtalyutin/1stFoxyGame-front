import { describe, expect, it } from 'vitest';
import { createEmptyProfile, EQUIPMENT_CATALOG } from '../game/equipment';
import { applyAppearance, committedAppearance } from './appearance';
import { ShopSelection } from './shop-selection';

const account='8ad384a3-2f4e-4ea5-ae7a-1bed94cbf887';
const first='85a3415a-301b-4cba-aa86-000000000001', second='85a3415a-301b-4cba-aa86-000000000002';
describe('local 3D item selection', () => {
  it('previews a recipe without changing wallet, inventory, revision or actual loadout', () => {
    const profile=createEmptyProfile(account);profile.goldMilli='500000';
    const before=structuredClone(profile), state=new ShopSelection();
    state.selectCatalog('side_step_boots',EQUIPMENT_CATALOG);
    expect(state.previewLoadout(profile,EQUIPMENT_CATALOG).legs).toEqual({definitionId:'side_step_boots',level:1});
    expect(profile).toEqual(before);state.restoreCommitted();
    expect(state.previewLoadout(profile,EQUIPMENT_CATALOG)).toEqual(committedAppearance(profile));
  });
  it('keeps same-definition instances separate and follows only a committed level change', () => {
    const profile=createEmptyProfile(account), state=new ShopSelection();
    profile.items=[{id:first,definitionId:'side_step_boots',level:1},{id:second,definitionId:'side_step_boots',level:2}];
    state.selectOwned(second,profile);expect(state.selected?.instanceId).toBe(second);
    profile.items[0].level=3;state.reconcile(profile);expect(state.selected?.level).toBe(2);
    profile.items[1].level=3;state.reconcile(profile);expect(state.selected?.level).toBe(3);
    profile.items.pop();state.reconcile(profile);expect(state.selected).toBeNull();
    expect(()=>state.selectOwned(second,profile)).toThrow();
  });
  it('replaces only the selected slot; restoring/switching off removes old meshes', () => {
    const profile=createEmptyProfile(account),state=new ShopSelection();
    profile.items=[{id:first,definitionId:'debt_clock',level:1}];profile.loadouts.pudge.talisman=first;
    state.selectCatalog('conductor_cuffs',EQUIPMENT_CATALOG);
    const loadout=state.previewLoadout(profile,EQUIPMENT_CATALOG);
    expect(loadout.talisman).toEqual({definitionId:'debt_clock',level:1});
    const enabled=new Set<string>(),actor={setPartEnabled:(n:string,on:boolean)=>{if(on)enabled.add(n);else enabled.delete(n);}};
    applyAppearance(actor,loadout);expect(enabled.has('wear_conductor_cuffs_1_00')).toBe(true);expect(enabled.has('wear_conductor_cuffs_1_01')).toBe(true);
    state.restoreCommitted();applyAppearance(actor,state.previewLoadout(profile,EQUIPMENT_CATALOG));
    expect([...enabled]).toEqual(['wear_debt_clock_1_00']);
  });
});
