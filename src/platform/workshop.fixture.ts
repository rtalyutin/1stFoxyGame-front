import type { ForgeConfig, WorkshopView } from './workshop';
export function forgeFixture(): ForgeConfig {
  return {
    productions:{apprentice:{baseCostGoldMilli:'25000',rateGoldMilliPerSecond:'50'},smelter:{baseCostGoldMilli:'250000',rateGoldMilliPerSecond:'600'},press:{baseCostGoldMilli:'2500000',rateGoldMilliPerSecond:'7000'},alchemy:{baseCostGoldMilli:'25000000',rateGoldMilliPerSecond:'80000'}},
    priceGrowthPermille:1180,tapGoldMilli:['1000','2000','4000','8000'],tapUpgradeCostGoldMilli:['100000','500000','2500000'],
    organizationPermille:[1000,1250,1500,2000],organizationUpgradeCostGoldMilli:['1000000','10000000','100000000'],offlineCapSeconds:28800,clockEveryKills:10,clockSeconds:30,
  };
}
export function workshopFixture(): WorkshopView {
  return {
    schemaVersion:'runner-workshop.1',balanceRevision:'ca5b0000-0000-5000-a000-000000000025',serverNowMs:1791351000000,settledAtMs:1791351000000,offlineCapSeconds:28800,
    tapLevel:0,organizationLevel:0,tapGoldMilli:'1000',productionRate:{numerator:'0',denominator:1000},organizationPermille:1000,
    productions:[{id:'apprentice',name:'Подмастерье',owned:0,rateGoldMilliPerSecond:'50',nextCostGoldMilli:'25000'},{id:'smelter',name:'Плавильня',owned:0,rateGoldMilliPerSecond:'600',nextCostGoldMilli:'250000'},{id:'press',name:'Золотой пресс',owned:0,rateGoldMilliPerSecond:'7000',nextCostGoldMilli:'2500000'},{id:'alchemy',name:'Алхимическая линия',owned:0,rateGoldMilliPerSecond:'80000',nextCostGoldMilli:'25000000'}],
    upgrades:{tap:{costGoldMilli:'100000',nextGoldMilli:'2000'},organization:{costGoldMilli:'1000000',nextPermille:1250}},
  };
}
