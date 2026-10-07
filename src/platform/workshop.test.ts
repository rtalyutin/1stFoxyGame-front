import { describe, expect, it, vi } from 'vitest';
import { createEmptyProfile } from '../game/equipment';
import type { Operation } from '../game/equipment';
import { ApiError, GameApi } from './api';
import { ProfileSession } from './profile';
import { productionRateText, settlementDuration, validateForgeConfig, validateWorkshopView } from './workshop';
import { forgeFixture, workshopFixture } from './workshop.fixture';
import { parameterError, validatePinnedBalance } from './balance';
import { balanceFixture } from './balance.fixture';
const accountId='69e7e09c-c672-47e0-8a6b-b26b3e9966cb';
const profile=(revision=0)=>({...createEmptyProfile(accountId),revision});
const result=(op:Operation,view=workshopFixture(),revision=op.expectedRevision+1)=>({operationId:op.operationId,status:'committed',profile:profile(revision),run:null,replayed:false,workshop:view});

describe('server workshop protocol', () => {
  it('validates accepted economics while retaining old saved run balances', () => {
    expect(validateForgeConfig(forgeFixture())).toEqual(forgeFixture());
    const old=balanceFixture(); expect(validatePinnedBalance(old).compiled.forge).toBeUndefined();
    old.compiled.forge=forgeFixture(); expect(validatePinnedBalance(old).compiled.forge?.tapGoldMilli).toEqual(['1000','2000','4000','8000']);
    old.compiled.forge.tapGoldMilli=['1000'] as unknown as typeof old.compiled.forge.tapGoldMilli; expect(()=>validatePinnedBalance(old)).toThrow(ApiError);
    const p={key:'forge.productions.apprentice.baseCostGoldMilli',label:'Цена',group:'Мастерская',unit:'тысячные золота',type:'goldMilli' as const};
    expect(parameterError(p,'25000')).toBeNull(); expect(parameterError(p,'25001')).toContain('целом золоте');
  });
  it('rejects corrupted rates, duplicate production rows, impossible levels and receipt durations', () => {
    expect(validateWorkshopView(workshopFixture())).toEqual(workshopFixture());
    const corruptions=[
      (v:ReturnType<typeof workshopFixture>)=>{v.productionRate.denominator=999 as 1000;},
      (v:ReturnType<typeof workshopFixture>)=>{v.productions[1].id='apprentice';},
      (v:ReturnType<typeof workshopFixture>)=>{v.productions[0].owned=.5;},
      (v:ReturnType<typeof workshopFixture>)=>{v.productions[0].owned=1;},
      (v:ReturnType<typeof workshopFixture>)=>{v.productions[0].nextCostGoldMilli='-1';},
      (v:ReturnType<typeof workshopFixture>)=>{v.tapLevel=3;},
      (v:ReturnType<typeof workshopFixture>)=>{v.serverNowMs=NaN;},
      (v:ReturnType<typeof workshopFixture>)=>{v.lastSettlement={elapsedMs:1000,creditedMs:1001,discardedMs:0,goldMilli:'1'};},
    ];
    for(const mutate of corruptions){const value=workshopFixture();mutate(value);expect(()=>validateWorkshopView(value)).toThrow(ApiError);}
    const capped=workshopFixture();capped.lastSettlement={elapsedMs:36000000,creditedMs:28800000,discardedMs:7200000,goldMilli:'1440000'};
    expect(validateWorkshopView(capped).lastSettlement?.discardedMs).toBe(7200000);
  });
  it('renders exact rational rates without floating-point wallet estimates', () => {
    expect(productionRateText({numerator:'62500',denominator:1000})).toBe('0,0625');
    expect(productionRateText({numerator:'1',denominator:1000})).toBe('0,000001');
    expect(productionRateText({numerator:'9223372036854775807000',denominator:1000})).toBe('9223372036854775,807');
    expect(settlementDuration(28800000)).toBe('8 ч 0 мин');
  });
  it('recovers a lost tap response under the same operation id and live price revision', async () => {
    let saved!:ReturnType<typeof result>;const bodies:string[]=[];
    const request=vi.fn(async(url:unknown,init?:RequestInit)=>{
      if(String(url).endsWith('/operations')){bodies.push(String(init?.body));saved=result(JSON.parse(bodies[0]));throw new Error('lost response');}
      return Response.json(saved);
    });
    const state=new ProfileSession(new GameApi(request));state.acceptProfile(profile());state.workshop=workshopFixture();
    const response=await state.operate('forge_tap',{balanceRevision:state.workshop.balanceRevision});
    expect(bodies).toHaveLength(1);expect(response.operationId).toBe(saved.operationId);expect(state.workshop?.balanceRevision).toBe(workshopFixture().balanceRevision);expect(state.pending).toBeNull();
    expect(JSON.parse(bodies[0]).payload).toEqual({balanceRevision:workshopFixture().balanceRevision});
  });
  it('fences a late workshop read after logout and a newer committed purchase', async () => {
    let finish!:(r:Response)=>void;
    const request=vi.fn((url:unknown,init?:RequestInit)=>String(url).endsWith('/workshop')?new Promise<Response>(done=>{finish=done;}):Promise.resolve(Response.json(result(JSON.parse(String(init?.body))))));
    const state=new ProfileSession(new GameApi(request));state.acceptProfile(profile());
    const stale=state.refreshWorkshop();await state.operate('forge_buy',{productionId:'apprentice',balanceRevision:workshopFixture().balanceRevision});
    const obsolete=workshopFixture();obsolete.tapGoldMilli='8000';finish(Response.json(obsolete));await stale;expect(state.workshop?.tapGoldMilli).toBe('1000');
    const logoutRead=state.refreshWorkshop();state.clearIdentity();finish(Response.json(workshopFixture()));await logoutRead;expect(state.profile).toBeNull();expect(state.workshop).toBeNull();
  });
  it('cannot roll current workshop prices back with a historic receipt or silently rebuy on conflict', async () => {
    let op!:Operation;const request=vi.fn(async(_url:unknown,init?:RequestInit)=>{op=JSON.parse(String(init?.body));return Response.json(result(op,workshopFixture(),1));});
    const state=new ProfileSession(new GameApi(request));state.acceptProfile(profile(4));state.workshop=workshopFixture();state.workshop.tapGoldMilli='8000';
    await state.operate('forge_settle',{});expect(state.profile?.revision).toBe(4);expect(state.workshop?.tapGoldMilli).toBe('8000');
    const conflict=new ProfileSession(new GameApi(async()=>Response.json({error:{code:'FORGE_BALANCE_CONFLICT',message:'Цены изменились'}},{status:409})));conflict.acceptProfile(profile());
    await expect(conflict.operate('forge_buy',{productionId:'apprentice',balanceRevision:workshopFixture().balanceRevision})).rejects.toMatchObject({status:409});expect(conflict.pending).toBeNull();expect(conflict.profile?.revision).toBe(0);
  });
});
