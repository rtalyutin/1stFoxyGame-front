import { getItemDefinition, type EquipmentCatalog, type ItemDefinitionId, type Profile } from '../game/equipment';
import { committedAppearance, type AppearanceKey, type AppearanceLoadout } from './appearance';

export type SelectedItem = AppearanceKey & { mode: 'catalog' | 'inventory'; instanceId?: string };

/** Selection and preview own no wallet/inventory state and issue no operations. */
export class ShopSelection {
  selected: SelectedItem | null = null;
  previewing = false;

  selectCatalog(definitionId: ItemDefinitionId, catalog: EquipmentCatalog): void {
    getItemDefinition(definitionId, catalog);
    this.selected = { mode: 'catalog', definitionId, level: 1 };
    this.previewing = true;
  }

  selectOwned(instanceId: string, profile: Profile): void {
    const item = profile.items.find(i => i.id === instanceId);
    if (!item) throw new Error('Selected item is not in the current inventory');
    this.selected = { mode: 'inventory', instanceId, definitionId: item.definitionId, level: item.level };
    this.previewing = true;
  }

  reconcile(profile: Profile): void {
    if (this.selected?.mode !== 'inventory') return;
    const item = profile.items.find(i => i.id === this.selected!.instanceId);
    if (!item) { this.clear(); return; }
    this.selected = { ...this.selected, definitionId: item.definitionId, level: item.level };
  }

  previewLoadout(profile: Profile, catalog: EquipmentCatalog): AppearanceLoadout {
    const actual = committedAppearance(profile);
    if (this.previewing && this.selected) {
      const definition = this.selected.mode === 'inventory' && !catalog.items.some(i => i.id === this.selected!.definitionId)
        ? getItemDefinition(this.selected.definitionId) : getItemDefinition(this.selected.definitionId, catalog);
      actual[definition.slot] = { definitionId: this.selected.definitionId, level: this.selected.level };
    }
    return actual;
  }

  restoreCommitted(): void { this.previewing = false; }
  clear(): void { this.selected = null; this.previewing = false; }
}
