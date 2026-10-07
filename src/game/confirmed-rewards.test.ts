import {it,expect} from 'vitest';
import {validateConfirmedRewards} from './equipment';
it('accepts exact committed reward amounts and rejects incomplete or corrupt clock receipts',()=>{
 const receipt={enemyId:'run:enemy:10',kind:'normal',at:2,goldMilli:'2000',components:{steel:1,ember:0,core:0},clockGoldMilli:'6000',clockSeconds:60};
 expect(validateConfirmedRewards([receipt])).toEqual([receipt]);
 for(const invalid of [{...receipt,goldMilli:'1.5'},{...receipt,clockGoldMilli:undefined},{...receipt,clockSeconds:0},{...receipt,components:{steel:-1,ember:0,core:0}}])expect(()=>validateConfirmedRewards([invalid])).toThrow();
});
