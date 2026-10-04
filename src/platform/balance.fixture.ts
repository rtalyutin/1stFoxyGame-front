/** Representative wire fixture. Runtime values always come from the server. */
import { DEFAULT_CONFIG, DEFAULT_SHOP_ZONE } from '../game/config';
import { BASE_MODIFIERS, EQUIPMENT_CATALOG } from '../game/equipment';
import type { BalanceDocument } from './balance';
export function balanceFixture(): BalanceDocument {
  return structuredClone({
    schemaVersion:'runner-balance.1', revision:'ca5b0000-0000-5000-a000-000000000001',
    values:{'runtime.shopMinDistance':250,'runtime.shopMaxDistance':250,'config.spawning':true,'items.fast_reel.levels.1.recipe.goldMilli':'100000'},
    parameters:[
      {key:'runtime.shopMinDistance',label:'Минимальное расстояние между магазинами',group:'Магазин',unit:'м',type:'number',min:1,max:100000,step:.01},
      {key:'runtime.shopMaxDistance',label:'Максимальное расстояние между магазинами',group:'Магазин',unit:'м',type:'number',min:1,max:100000,step:.01},
      {key:'config.spawning',label:'Появление врагов',group:'Бой',unit:'',type:'boolean'},
      {key:'items.fast_reel.levels.1.recipe.goldMilli',label:'Стоимость',group:'Предметы',unit:'тысячные золота',type:'goldMilli'},
    ],
    compiled:{config:DEFAULT_CONFIG,shopZone:DEFAULT_SHOP_ZONE,equipment:EQUIPMENT_CATALOG,baseModifiers:BASE_MODIFIERS,
      rewards:{version:'r34.1',components:[{id:'steel',label:'Сталь'},{id:'ember',label:'Жар'},{id:'core',label:'Ядро'}],rewards:[
        {kind:'normal',baseGoldMilli:'5000',commonDrops:0,coreDrops:0,steelProbability:.5},
        {kind:'strong',baseGoldMilli:'20000',commonDrops:1,coreDrops:0,steelProbability:.5},
        {kind:'boss',baseGoldMilli:'100000',commonDrops:2,coreDrops:1,steelProbability:.5},
      ]},runtime:{shopMinDistance:250,shopMaxDistance:250,shopRightProbability:.5,shooterChanceStart:.2,shooterChanceMax:.45,shooterChanceRampSeconds:1080,slowDurationSeconds:8,slowSpeedMultiplier:.65,collectorKills:5,collectorGoldMultiplierMilli:1500},
    },
  });
}
