import { describe, expect, it, vi } from 'vitest';
import { ApiError, GameApi, TransportError } from './api';
import { BalanceEditor, parameterError, validateBalanceDocument, validatePinnedBalance } from './balance';
import { balanceFixture } from './balance.fixture';
const json = (value: unknown, status=200) => Response.json(value,{status});
describe('editable balance protocol', () => {
  it('accepts numeric tuning and rejects incompatible schema or corrupted catalog shape', () => {
    const tuned=balanceFixture(); tuned.compiled.config.heroSpeed=3; tuned.compiled.equipment.items[0].levels[0].recipe.goldMilli='9223372036854775807';
    expect(validateBalanceDocument(tuned).compiled.config.heroSpeed).toBe(3);
    expect(() => validateBalanceDocument({...tuned,schemaVersion:'runner-balance.2'})).toThrow(ApiError);
    const corrupt=balanceFixture(); corrupt.compiled.equipment.items[0].levels[0].recipe.goldMilli='-1'; expect(() => validateBalanceDocument(corrupt)).toThrow(ApiError);
    const missing=balanceFixture(); delete (missing.compiled.config as unknown as Record<string,unknown>).heroSpeed; expect(() => validateBalanceDocument(missing)).toThrow(ApiError);
    const legacy={schemaVersion:tuned.schemaVersion,revision:'legacy-r34.1',compiled:{...tuned.compiled,runtime:undefined}};
    expect(validatePinnedBalance(legacy).revision).toBe('legacy-r34.1'); expect(() => validatePinnedBalance({...legacy,revision:tuned.revision})).toThrow(ApiError);
  });
  it('validates milli-gold strings exactly at the bigint boundary', () => {
    const p=balanceFixture().parameters.find(p=>p.type==='goldMilli')!;
    expect(parameterError(p,'9223372036854775807')).toBeNull();
    for(const value of ['9223372036854775808','1.5','01',9223372036854775807]) expect(parameterError(p,value)).not.toBeNull();
  });
  it('rejects malformed simulation/economy numbers before rendering or restoring', () => {
    const cases = [
      (b:ReturnType<typeof balanceFixture>) => {b.compiled.baseModifiers={...b.compiled.baseModifiers,goldMultiplierMilli:1000.5};},
      (b:ReturnType<typeof balanceFixture>) => {b.compiled.baseModifiers={...b.compiled.baseModifiers,pierceTargets:.5};},
      (b:ReturnType<typeof balanceFixture>) => {b.compiled.runtime!.shopRightProbability=2;},
      (b:ReturnType<typeof balanceFixture>) => {b.compiled.runtime!.collectorKills=1.5;},
      (b:ReturnType<typeof balanceFixture>) => {b.compiled.rewards.rewards[0].commonDrops=.5;},
      (b:ReturnType<typeof balanceFixture>) => {b.compiled.rewards.rewards[0].steelProbability=2;},
    ];
    for (const mutate of cases) {const b=balanceFixture();mutate(b);expect(()=>validatePinnedBalance(b)).toThrow(ApiError);}
  });
  it('uses authenticated same-origin PUT with CSRF and expected revision, preserving exact prices', async () => {
    const initial=balanceFixture(),saved=balanceFixture(); saved.revision='ca5b0000-0000-5000-a000-000000000009'; saved.values['items.fast_reel.levels.1.recipe.goldMilli']='9223372036854775807';
    const request=vi.fn(async (_url:unknown,init?:RequestInit)=>json(init?.method==='PUT'?saved:initial));
    const api=new GameApi(request); api.csrfToken='csrf-session'; const editor=new BalanceEditor(api); await editor.load(); editor.draft['items.fast_reel.levels.1.recipe.goldMilli']='9223372036854775807'; await editor.save();
    expect(request.mock.calls[1]).toEqual(['/api/v1/admin/balance',expect.objectContaining({method:'PUT',credentials:'same-origin',cache:'no-store',headers:expect.objectContaining({'X-CSRF-Token':'csrf-session'}),body:JSON.stringify({expectedRevision:initial.revision,values:saved.values})})]);
    expect(editor.document!.revision).toBe(saved.revision); expect(editor.dirty).toBe(false);
  });
  it('retains a dirty draft on CAS conflict and never retries or silently overwrites', async () => {
    const request=vi.fn(async (_url:unknown,init?:RequestInit)=>init?.method==='PUT'?json({error:{code:'BALANCE_REVISION_CONFLICT',message:'changed'}},409):json(balanceFixture()));
    const editor=new BalanceEditor(new GameApi(request)); await editor.load(); editor.draft['runtime.shopMinDistance']=300;
    await expect(editor.save()).rejects.toMatchObject({status:409}); expect(editor.draft['runtime.shopMinDistance']).toBe(300); expect(editor.dirty).toBe(true); expect(editor.document!.revision).toBe(balanceFixture().revision); expect(editor.error).toContain('Черновик сохранён'); expect(request).toHaveBeenCalledTimes(2);
  });
  it('reports server authorization and an uncertain write without pretending it committed', async () => {
    const forbidden=new BalanceEditor(new GameApi(async()=>json({error:{code:'BALANCE_FORBIDDEN',message:'Нет права'}},403)));
    await expect(forbidden.load()).rejects.toMatchObject({status:403}); expect(forbidden.document).toBeNull();
    const editor=new BalanceEditor(new GameApi(async(_url,init)=>{if(init?.method==='PUT') throw new Error('lost response'); return json(balanceFixture());})); await editor.load(); editor.draft['runtime.shopMinDistance']=300;
    await expect(editor.save()).rejects.toBeInstanceOf(TransportError); expect(editor.dirty).toBe(true); expect(editor.error).toContain('могли сохраниться');
  });
});
