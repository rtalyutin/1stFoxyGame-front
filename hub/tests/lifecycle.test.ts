import { it,expect,vi } from 'vitest';
import { EntryController } from '../src/entry';
import { ResourceManager } from '../src/resources';
function deferred<T>() {let resolve!:(value:T)=>void;let reject!:(error:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
it('cancellation and repeated clicks cannot complete stale entry preparation',async()=> {
  const gate=deferred<void>(),complete=vi.fn(),prepare=vi.fn(()=>gate.promise);
  const entry=new EntryController({prepare,align:vi.fn(),move:vi.fn(),reset:vi.fn(),changed:vi.fn(),complete},.1);
  const task=entry.select('first');await entry.select('second');expect(prepare).toHaveBeenCalledTimes(1);
  entry.cancel();gate.resolve();await task;entry.tick(1);
  expect(entry.state).toBe('IDLE');expect(complete).not.toHaveBeenCalled();
});
it('completes once; pausing by not ticking preserves progress and failure invalidates callbacks',async()=> {
  const complete=vi.fn(),move=vi.fn();const entry=new EntryController({prepare:async()=>{},align:vi.fn(),move,reset:vi.fn(),changed:vi.fn(),complete},.1);
  await entry.select('first');entry.tick(.05);expect(entry.state).toBe('ENTERING');
  entry.tick(.05);entry.tick(.05);expect(complete).toHaveBeenCalledTimes(1);
  entry.cancel();await entry.select('first');entry.fail();entry.tick(1);expect(entry.state).toBe('ERROR');expect(complete).toHaveBeenCalledTimes(1);
});
it('disposes late detached loads and allows a new generation without destroying it',async()=> {
  const old=deferred<{dispose:()=>void}>(),fresh=deferred<{dispose:()=>void}>();let calls=0;
  const resources=new ResourceManager(1,()=>++calls===1?old.promise:fresh.promise,()=>{});
  const oldTask=resources.ensure(0);resources.reconcile(new Set(),new Set());
  const newTask=resources.ensure(0),disposeOld=vi.fn(),disposeNew=vi.fn();
  old.resolve({dispose:disposeOld});await oldTask;fresh.resolve({dispose:disposeNew});await newTask;
  expect(disposeOld).toHaveBeenCalledTimes(1);expect(resources.slots[0].value?.dispose).toBe(disposeNew);
  resources.reconcile(new Set([0]),new Set());expect(resources.slots[0].state).toBe('ready-paused');
  resources.reconcile(new Set(),new Set());expect(disposeNew).toHaveBeenCalledTimes(1);
});
it('does not loop retries after an asset error',async()=> {
  const load=vi.fn(async()=>{throw new Error('missing GLB');});const resources=new ResourceManager(1,load,()=>{});
  await resources.ensure(0);resources.reconcile(new Set([0]),new Set([0]));await resources.ensure(0);
  expect(load).toHaveBeenCalledTimes(1);await resources.ensure(0,true);expect(load).toHaveBeenCalledTimes(2);
});
