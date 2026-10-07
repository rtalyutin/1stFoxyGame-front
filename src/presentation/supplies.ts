import type {ConsumableId,ComponentId,ItemDefinitionId} from '../game/equipment';
export type SupplyId=ConsumableId|ComponentId|'gold';
export type ShopGraphicId=ItemDefinitionId|SupplyId;
export interface ShopGraphicKey {definitionId:ShopGraphicId;level:number;}
export const SUPPLIES:Record<SupplyId,{path:string;label:string;icon:string}>={
 slow_dust:{path:'models/r4/slowing_powder.glb',label:'Пыль замедления',icon:'slow_dust'},
 collector_vial:{path:'models/r4/collectors_vial.glb',label:'Флакон сборщика',icon:'collector_vial'},
 gold:{path:'models/r3/loot_gold.glb',label:'Золото',icon:'gold'},
 steel:{path:'models/r3/loot_steel.glb',label:'Сталь',icon:'steel'},
 ember:{path:'models/r3/loot_ember.glb',label:'Жар',icon:'ember'},
 core:{path:'models/r3/loot_core.glb',label:'Ядра',icon:'core'},
};
export const isSupply=(id:ShopGraphicId):id is SupplyId=>id in SUPPLIES;
export const iconPath=(id:string):string=>import.meta.env.BASE_URL+'models/runner-3d/icons/'+id+'.png';
