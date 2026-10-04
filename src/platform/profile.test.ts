import { afterEach, describe, expect, it, vi } from 'vitest';
import { EQUIPMENT_CATALOG, createEmptyProfile } from '../game/equipment';
import type { Operation, Profile } from '../game/equipment';
import { ApiError, GameApi } from './api';
import type { TabChannel } from './profile';
import { FrameJournal, ProfileSession, clientId, goldText, validateEquipmentCatalog, validateProfile, validateRunView, TabIdentity } from './profile';
import { balanceFixture } from './balance.fixture';
import { RunSimulation } from '../game/simulation';
import { recipeCost } from '../game/equipment';
const accountId = '69e7e09c-c672-47e0-8a6b-b26b3e9966cb';
const otherAccountId = '9ce360de-6e08-4a53-8f3e-0e98811a9c43';
const profile = (revision = 0): Profile => ({...createEmptyProfile(accountId),revision});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value),{status});
class MemoryStorage implements Storage {
  data = new Map<string,string>(); get length(): number { return this.data.size; } clear(): void { this.data.clear(); } getItem(k:string): string|null { return this.data.get(k)??null; } key(i:number): string|null { return [...this.data.keys()][i]??null; } removeItem(k:string): void { this.data.delete(k); } setItem(k:string,v:string): void { this.data.set(k,v); }
}
const result = (op: Operation,p = profile(op.expectedRevision+1)) => ({operationId:op.operationId,status:'committed',profile:p,run:null,replayed:false});
describe('server profile and operation recovery', () => {
  it('validates all domain ownership/resources and refuses client repairs on corruption', () => {
    expect(validateProfile(profile())).toEqual(profile());
    expect(() => validateProfile({...profile(),goldMilli:'-1'})).toThrow(ApiError);
    expect(() => validateProfile({...profile(),loadouts:{pudge:{...profile().loadouts.pudge,weapon:crypto.randomUUID()}}})).toThrow(ApiError);
    expect(() => validateEquipmentCatalog({...EQUIPMENT_CATALOG,version:'r34.0'})).toThrow(ApiError);
    expect(validateEquipmentCatalog(structuredClone(EQUIPMENT_CATALOG))).toEqual(EQUIPMENT_CATALOG);
  });
  it('retains trusted run metadata even when the simulation snapshot is incompatible', () => {
    const view = {runId:crypto.randomUUID(),loot:{goldMilli:'7500',components:{steel:1,ember:0,core:0}},control:'owner',ownerEpoch:2,updatedAt:'2026-10-03T10:00:00Z',snapshot:null,balance:balanceFixture()};
    expect(validateRunView(view)?.runId).toBe(view.runId);
    expect(() => validateRunView({...view,runId:undefined})).toThrow(ApiError);
    expect(() => validateRunView({...view,ownerEpoch:NaN})).toThrow(ApiError);
    expect(() => validateRunView({...view,loot:{...view.loot,goldMilli:'-1'}})).toThrow(ApiError);
  });
  it('uses exact milli-gold text without precision loss', () => {
    expect(goldText('9223372036854775807')).toBe('9223372036854775,807'); expect(goldText('1200')).toBe('1,2'); expect(goldText('1000')).toBe('1');
  });
  it('uses a stable tab client id across reloads and never stores the wallet', async () => {
    const storage = new MemoryStorage(); expect(clientId(storage)).toBe(clientId(storage));
    const request = vi.fn(async (_url: unknown,options?: RequestInit) => json(result(JSON.parse(String(options?.body)))));
    const state = new ProfileSession(new GameApi(request),storage); state.acceptProfile(profile()); await state.operate('start_run',{});
    expect([...storage.data.keys()]).toEqual(['foxy-r34-client']); expect([...storage.data.values()].join('')).not.toContain('goldMilli');
  });
  it('looks up a timed-out commit under the same id instead of granting a second purchase', async () => {
    let saved: ReturnType<typeof result>; let posts = 0;
    const request = vi.fn(async (url: unknown,options?: RequestInit) => {
      if (String(url).endsWith('/operations')) { posts++; saved = result(JSON.parse(String(options?.body))); throw new Error('lost response'); }
      return json(saved!);
    });
    const state = new ProfileSession(new GameApi(request)); state.acceptProfile(profile()); const response = await state.operate('craft',{definitionId:'fast_reel'});
    expect(posts).toBe(1); expect(String(request.mock.calls[1][0]).endsWith(response.operationId)).toBe(true); expect(state.profile?.revision).toBe(1); expect(state.pending).toBeNull();
  });
  it('retries the identical payload after lookup confirms there is no result', async () => {
    const bodies: string[] = [];
    const request = vi.fn(async (url: unknown,options?: RequestInit) => {
      if (String(url).endsWith('/operations')) { bodies.push(String(options?.body)); if (bodies.length === 1) throw new Error('offline'); return json(result(JSON.parse(bodies[1]))); }
      return json({error:{code:'OPERATION_NOT_FOUND',message:'unknown'}},404);
    });
    const state = new ProfileSession(new GameApi(request)); state.acceptProfile(profile(7)); await state.operate('upgrade',{itemId:crypto.randomUUID()});
    expect(bodies[0]).toBe(bodies[1]); expect(JSON.parse(bodies[1]).expectedRevision).toBe(7);
  });
  it('preserves an uncertain operation across reload and isolates it from another login', async () => {
    const storage = new MemoryStorage();
    const offline = new ProfileSession(new GameApi(vi.fn(async () => { throw new Error('offline'); })),storage); offline.acceptProfile(profile());
    await expect(offline.operate('craft',{definitionId:'slow_dust'})).rejects.toThrow();
    const savedId = offline.pending!.operationId;
    const restored = new ProfileSession(new GameApi(vi.fn(async () => json(result(offline.pending!)))),storage); restored.acceptProfile(profile()); await restored.recover(); expect(restored.pending).toBeNull();
    expect(savedId).toBeTruthy();
    await expect(offline.operate('craft',{definitionId:'slow_dust'})).rejects.toMatchObject({code:'OPERATION_PENDING'});
    // A new account must never replay an old account's pending purchase.
    const oldOp = offline.pending!; storage.setItem('foxy-r34-pending',JSON.stringify({accountId,operation:oldOp}));
    const request = vi.fn(async (url: unknown) => String(url).endsWith('/profile') ? json(createEmptyProfile(otherAccountId)) : String(url).endsWith('/balance') ? json(balanceFixture()) : json(null));
    const other = new ProfileSession(new GameApi(request),storage); await other.load(); expect(other.pending).toBeNull(); expect(request).toHaveBeenCalledTimes(3);
  });
  it('historic replay does not roll back a current profile revision', async () => {
    let op: Operation;
    const storage = new MemoryStorage(); const uncertain = new ProfileSession(new GameApi(vi.fn(async (_u,options) => { if (options?.body) op = JSON.parse(String(options.body)); throw new Error('offline'); })),storage); uncertain.acceptProfile(profile(2));
    await expect(uncertain.operate('equip',{slot:'weapon',itemId:null})).rejects.toThrow();
    const restored = new ProfileSession(new GameApi(vi.fn(async () => json(result(op!,profile(3))))),storage); restored.acceptProfile(profile(9));
    await restored.recover(); expect(restored.profile!.revision).toBe(9); expect(restored.pending).toBeNull();
  });
  it('a definitive conflict never retries with a fresh id or stale revision', async () => {
    const request = vi.fn(async () => json({error:{code:'REVISION_CONFLICT',message:'refresh'}},409));
    const state = new ProfileSession(new GameApi(request)); state.acceptProfile(profile(4));
    await expect(state.operate('craft',{definitionId:'long_link'})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
    expect(request).toHaveBeenCalledTimes(1); expect(state.pending).toBeNull(); expect(state.profile?.revision).toBe(4);
  });
  it('renders saved-run prices and modifiers from its pinned revision until start_run returns a new one', async () => {
    const old=balanceFixture(),latest=balanceFixture(); latest.revision='ca5b0000-0000-5000-a000-000000000010'; latest.compiled.config.heroSpeed=3; latest.compiled.config.hookCooldown=1; latest.compiled.baseModifiers={...latest.compiled.baseModifiers,cooldown:1};
    latest.compiled.equipment.items[0].levels[0].recipe.goldMilli='200000';
    const runId=crypto.randomUUID(); const view=(balance:typeof old)=>({runId,loot:{goldMilli:'0',components:{steel:0,ember:0,core:0}},control:'owner',ownerEpoch:1,updatedAt:'2026-10-03T10:00:00Z',balance,snapshot:new RunSimulation(runId,7,{config:balance.compiled.config,shopZone:balance.compiled.shopZone,runtimeBalance:balance.compiled.runtime}).exportSnapshot()});
    const request=vi.fn(async (url:unknown,options?:RequestInit)=>String(url).endsWith('/profile')?json(profile()):String(url).endsWith('/balance')?json(latest):String(url).endsWith('/operations')?json({...result(JSON.parse(String(options?.body))),run:view(latest)}):json(view(old)));
    const state=new ProfileSession(new GameApi(request)); await state.load();
    expect(state.balance!.revision).toBe(latest.revision); expect(state.pinnedBalance!.revision).toBe(old.revision); expect(recipeCost('fast_reel',0,state.catalog!).goldMilli).toBe('100000'); expect(state.pinnedBalance!.compiled.baseModifiers.cooldown).toBe(2); expect(RunSimulation.restore(state.run!.snapshot).config.heroSpeed).toBe(2);
    await state.operate('start_run',{}); expect(state.pinnedBalance!.revision).toBe(latest.revision); expect(recipeCost('fast_reel',0,state.catalog!).goldMilli).toBe('200000'); expect(state.pinnedBalance!.compiled.baseModifiers.cooldown).toBe(1); expect(RunSimulation.restore(state.run!.snapshot).config.heroSpeed).toBe(3);
  });
  it('refreshes no-run preview after a committed end_run and keeps that commit when the independent read fails', async () => {
    const old=balanceFixture(),latest=balanceFixture(); latest.revision='ca5b0000-0000-5000-a000-000000000011'; latest.compiled.config.heroSpeed=3;
    latest.compiled.equipment.items[0].levels[0].recipe.goldMilli='200000'; latest.values['items.fast_reel.levels.1.recipe.goldMilli']='200000';
    const runId=crypto.randomUUID(),run={runId,loot:{goldMilli:'0',components:{steel:0,ember:0,core:0}},control:'owner',ownerEpoch:1,updatedAt:'2026-10-03T10:00:00Z',balance:old,snapshot:new RunSimulation(runId,7,{runtimeBalance:old.compiled.runtime}).exportSnapshot()};
    let balanceReads=0,posts=0;
    const request=vi.fn(async (url:unknown,options?:RequestInit)=>{
      if (String(url).endsWith('/balance')) { balanceReads++; return balanceReads===1?json(old):balanceReads===2?json({error:{code:'BALANCE_STORAGE_UNAVAILABLE',message:'unavailable'}},503):json(latest); }
      if (String(url).endsWith('/profile')) return json(profile());
      if (String(url).endsWith('/operations')) { posts++; return json(result(JSON.parse(String(options?.body)))); }
      return json(run);
    });
    const state=new ProfileSession(new GameApi(request)); await state.load(); expect(state.balance!.revision).toBe(old.revision);
    await state.operate('end_run',{runId,ownerEpoch:1});
    expect(state.run).toBeNull(); expect(state.pending).toBeNull(); expect(state.profile!.revision).toBe(1);
    const refresh=state.refreshBalancePreview(); expect(state.previewState).toBe('loading'); expect(state.catalog).toBeNull(); await refresh;
    expect(state.previewState).toBe('error'); expect(state.previewError).toContain('Подтверждённые действия сохранены'); expect(state.catalog).toBeNull(); expect(posts).toBe(1); expect(state.pending).toBeNull();
    await state.refreshBalancePreview(); expect(state.previewState).toBe('ready'); expect(state.balance!.revision).toBe(latest.revision); expect(recipeCost('fast_reel',0,state.catalog!).goldMilli).toBe('200000'); expect(posts).toBe(1); expect(state.profile!.revision).toBe(1);
  });
  it('does not let an obsolete preview read restore the previous account after logout', async () => {
    let resolve!: (value:Response)=>void;
    const state=new ProfileSession(new GameApi(()=>new Promise<Response>(done=>{resolve=done;}))); state.acceptProfile(profile()); state.balance=balanceFixture(); state.previewState='ready';
    const refresh=state.refreshBalancePreview(); state.clearIdentity(); resolve(json(balanceFixture())); await refresh;
    expect(state.profile).toBeNull(); expect(state.balance).toBeNull(); expect(state.previewState).toBe('idle');
  });
});
describe('fixed frame journal', () => {
  it('preserves each movement and cast while a previous batch awaits confirmation', () => {
    const journal = new FrameJournal(); const cast = {type:'cast',aim:{x:3,z:20}} as const;
    journal.append([{type:'move',axis:1},cast]); journal.append([{type:'move',axis:-1}]);
    const batch = journal.begin(); journal.append([{type:'move',axis:0},cast]);
    expect(batch).toHaveLength(2); expect(journal.queued).toHaveLength(1); expect(journal.length).toBe(3);
    journal.acknowledge(); expect(journal.length).toBe(1); expect(journal.begin()[0]).toEqual([{type:'move',axis:0},cast]);
  });
  it('bounds batches at 120 frames and does not drop in-flight frames after failure', () => {
    const journal = new FrameJournal(); for (let i=0;i<133;i++) journal.append([{type:'move',axis:i%2}]);
    expect(journal.begin(1000)).toHaveLength(120); expect(journal.queued).toHaveLength(13); expect(journal.length).toBe(133);
    expect(() => journal.begin()).toThrow(); journal.acknowledge(); expect(journal.begin(120)).toHaveLength(13);
  });
  it('deep-copies commands so pointer movement cannot change the submitted aim', () => {
    const journal = new FrameJournal(), aim = {x:1,z:20}; journal.append([{type:'cast',aim}]); aim.x=4;
    expect(journal.begin()[0]).toEqual([{type:'cast',aim:{x:1,z:20}}]);
  });
});

class TestBus {
  readonly peers = new Set<TestChannel>();
  create = (): TestChannel => { const peer = new TestChannel(this); this.peers.add(peer); return peer; };
}
class TestChannel implements TabChannel {
  listeners = new Set<(event: MessageEvent) => void>();
  constructor(private readonly bus: TestBus) {}
  postMessage(data: unknown): void { for (const peer of this.bus.peers) if (peer !== this) queueMicrotask(() => { for (const listener of peer.listeners) listener({ data } as MessageEvent); }); }
  addEventListener(_type: 'message',callback: (event: MessageEvent) => void): void { this.listeners.add(callback); }
  removeEventListener(_type: 'message',callback: (event: MessageEvent) => void): void { this.listeners.delete(callback); }
  close(): void { this.listeners.clear(); this.bus.peers.delete(this); }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('tab ownership arbitration', () => {
  it('keeps the live tab id, rotates a cloned tab, and keeps a normal reload stable', async () => {
    vi.useFakeTimers(); const bus = new TestBus(), storage = new MemoryStorage();
    const owner = new TabIdentity(storage,bus.create); await vi.advanceTimersByTimeAsync(100); await owner.ready;
    const clonedStorage = new MemoryStorage(); for (const [key,value] of storage.data) clonedStorage.setItem(key,value);
    const clone = new TabIdentity(clonedStorage,bus.create); await vi.advanceTimersByTimeAsync(100); await clone.ready;
    expect(clone.id).not.toBe(owner.id); expect(clientId(storage)).toBe(owner.id);
    owner.close(); const reloaded = new TabIdentity(storage,bus.create); await vi.advanceTimersByTimeAsync(100); await reloaded.ready;
    expect(reloaded.id).toBe(owner.id); clone.close(); reloaded.close();
  });
  it('uses deterministic nonce ordering if two cloned documents initialize together', async () => {
    vi.useFakeTimers(); const bus = new TestBus(), firstStorage = new MemoryStorage(), secondStorage = new MemoryStorage();
    const initialId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; firstStorage.setItem('foxy-r34-client',initialId); secondStorage.setItem('foxy-r34-client',initialId);
    vi.spyOn(crypto,'randomUUID').mockReturnValueOnce('00000000-0000-4000-8000-000000000002').mockReturnValueOnce('00000000-0000-4000-8000-000000000001').mockReturnValueOnce('00000000-0000-4000-8000-000000000003');
    const first = new TabIdentity(firstStorage,bus.create), second = new TabIdentity(secondStorage,bus.create);
    await vi.advanceTimersByTimeAsync(100); await Promise.all([first.ready,second.ready]);
    expect(first.id).not.toBe(initialId); expect(second.id).toBe(initialId); first.close(); second.close();
  });
  it('drops a copied pending command before the duplicate tab can load or retry it', async () => {
    vi.useFakeTimers(); const bus = new TestBus(), originalStorage = new MemoryStorage();
    const original = new TabIdentity(originalStorage,bus.create); await vi.advanceTimersByTimeAsync(100); await original.ready;
    const clonedStorage = new MemoryStorage(); for (const [key,value] of originalStorage.data) clonedStorage.setItem(key,value);
    clonedStorage.setItem('foxy-r34-pending',JSON.stringify({accountId,operation:{operationId:crypto.randomUUID(),expectedRevision:0,clientId:original.id,type:'craft',payload:{definitionId:'fast_reel'}}}));
    const request = vi.fn(async (url: unknown) => String(url).endsWith('/profile') ? json(profile()) : String(url).endsWith('/balance') ? json(balanceFixture()) : json(null));
    const clone = new ProfileSession(new GameApi(request),clonedStorage,bus.create); const loading = clone.load();
    expect(request).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(100); await loading;
    expect(clone.clientId).not.toBe(original.id); expect(clone.pending).toBeNull(); expect(request).toHaveBeenCalledTimes(3); expect(request.mock.calls.some(([url]) => String(url).includes('/operations'))).toBe(false); original.close();
  });
});
