import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createInitial} from '../src/core';
import {toSnapshotV1,type SnapshotV1} from '../src/snapshot-v1';
import {Outbox,fromServer,runKey,type DurableRun,type DurableStore} from '../src/outbox';
import {CloudError} from '../src/cloud';
import type {RunDto} from '../src/r1-contracts';
const runId='80ba307c-48e6-4a00-98c7-bd9cd0b1c3d1';
const initial=toSnapshotV1(createInitial(runId));
function snap(tick:number,outcome:'playing'|'won'|'lost'='playing'):SnapshotV1{return{...structuredClone(initial),sim_tick:tick,outcome};}
function dto(revision=1,lifecycle:RunDto['lifecycle']='active'):RunDto{return{run_id:runId,revision,lifecycle,checkpoint:initial,updated_at:'2026-10-04T12:00:00Z',started_at:'2026-10-04T12:00:00Z'};}
function memory(){
  const rows=new Map<string,DurableRun>([[runKey('a',runId),fromServer('a',dto())]]);let fail=false,commits=0;
  const persist=(key:string,row:DurableRun)=>{if(fail)throw new Error('quota');rows.set(key,structuredClone(row));commits++;};
  const store:DurableStore={load:async key=>rows.has(key)?structuredClone(rows.get(key)):undefined,commit:async row=>persist(runKey(row.owner_id,row.run_id),row),update:async(key,fn)=>{const row=rows.get(key);if(!row)throw new Error('missing');const next=fn(structuredClone(row));persist(key,next);return structuredClone(next);}};
  return{store,rows,fail:(value:boolean)=>{fail=value;},commits:()=>commits};
}
test('unknown checkpoint ACK survives reconstruction and retains immutable body/key before newer pending',async()=>{
  const m=memory(),sent:any[]=[];let failed=true;
  const sender=async(operation:string,body:unknown)=>{sent.push(structuredClone({operation,body}));if(failed){failed=false;throw new CloudError('OFFLINE','dropped ACK');}return{revision:sent.length===2?2:3,saved_at:'2026-10-04T12:01:00Z'};};
  const first=new Outbox('a',runId,m.store,sender);await first.capture(snap(300));await first.flush();await first.capture(snap(500));
  const saved=await first.record();assert.equal(saved?.inflight?.body.expected_revision,1);assert.equal(saved?.pending?.snapshot?.sim_tick,500);
  const restored=new Outbox('a',runId,m.store,sender);await restored.flush();assert.deepEqual(sent[0],sent[1]);assert.equal(sent[2].body.expected_revision,2);assert.equal(sent[2].body.snapshot.sim_tick,500);assert.equal((await restored.record())?.revision,3);assert.equal((await restored.record())?.pending,null);
});
test('terminal finish replaces pending checkpoint, survives dropped ACK and cannot be overwritten by autosave',async()=>{
  const m=memory(),sent:any[]=[];let offline=true;
  const sender=async(operation:string,body:unknown)=>{sent.push(structuredClone({operation,body}));if(offline)throw new CloudError('OFFLINE','offline');return{revision:2};};
  const q=new Outbox('a',runId,m.store,sender);await q.capture(snap(100));await q.capture(snap(600,'won'));await q.capture(snap(601));
  assert.equal((await q.record())?.pending?.operation,'run_finish_v1');assert.equal((await q.record())?.snapshot.sim_tick,600);
  await q.flush();await q.capture(snap(700));assert.equal((await q.record())?.snapshot.outcome,'won');
  offline=false;const reloaded=new Outbox('a',runId,m.store,sender);await reloaded.flush();assert.deepEqual(sent[0],sent[1]);assert.equal(sent[0].operation,'run_finish_v1');assert.equal(sent[0].body.outcome,'won');assert.equal((await reloaded.record())?.terminal_ack,true);
});
test('promotion failure never sends; retry resumes the unchanged pending snapshot',async()=>{
  const m=memory(),sent:any[]=[];const q=new Outbox('a',runId,m.store,async(_,body)=>{sent.push(body);return{revision:2};});await q.capture(snap(300));m.fail(true);await q.flush();assert.equal(sent.length,0);m.fail(false);q.allow();await q.flush();assert.equal(sent.length,1);assert.equal((sent[0] as any).snapshot.sim_tick,300);
});
test('ACK local transaction failure keeps immutable inflight even though server committed',async()=>{
  const m=memory(),sent:any[]=[];let first=true;const q=new Outbox('a',runId,m.store,async(_,body)=>{sent.push(structuredClone(body));if(first){first=false;m.fail(true);}return{revision:2};});await q.capture(snap(300));await q.flush();assert.ok((await q.record())?.inflight);m.fail(false);q.allow();await q.flush();assert.deepEqual(sent[0],sent[1]);assert.equal((await q.record())?.revision,2);assert.equal((await q.record())?.inflight,null);
});
test('conflict stops automatic sends; explicitly chosen local copy uses fresh CAS/key',async()=>{
  const m=memory(),sent:any[]=[];let conflict=true;const q=new Outbox('a',runId,m.store,async(_,body)=>{sent.push(structuredClone(body));if(conflict)throw new CloudError('REVISION_CONFLICT','other device');return{revision:5};});await q.capture(snap(300));await q.flush();await q.flush();assert.equal(sent.length,1);assert.equal((await q.record())?.conflict,true);await assert.rejects(q.replaceLocal(dto(4,'won')),/Завершённый/);assert.equal(sent.length,1);await q.replaceLocal(dto(4));conflict=false;await q.flush();assert.equal(sent[1].expected_revision,4);assert.notEqual(sent[1].request_id,sent[0].request_id);assert.equal((await q.record())?.revision,5);
});
test('holding an owner queue prevents requests; another owner cannot capture its record',async()=>{
  const m=memory();let requests=0;const q=new Outbox('a',runId,m.store,async()=>{requests++;return{revision:2};});await q.capture(snap(300));q.hold();await q.flush();assert.equal(requests,0);const other=new Outbox('b',runId,m.store,async()=>{requests++;return{revision:2};});await assert.rejects(other.capture(snap(301)));assert.equal(requests,0);assert.equal((await q.record())?.snapshot.sim_tick,300);
});
test('two same-origin outboxes cannot promote two different requests for one durable pending',async()=>{
  const m=memory(),sent:any[]=[];const sender=async(_:string,body:unknown)=>{sent.push(structuredClone(body));await Promise.resolve();return{revision:2};};const a=new Outbox('a',runId,m.store,sender),b=new Outbox('a',runId,m.store,sender);await a.capture(snap(300));await Promise.all([a.flush(),b.flush()]);assert.ok(sent.length>=1);for(const body of sent)assert.deepEqual(body,sent[0]);assert.equal((await a.record())?.revision,2);
});
