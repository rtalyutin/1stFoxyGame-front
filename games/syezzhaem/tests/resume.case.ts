import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSnapshotV1} from '../src/snapshot-v1';
import {fromServer} from '../src/outbox';
import {chooseResume} from '../src/resume';
import type {RunDto} from '../src/r1-contracts';
const a='041785fe-2a18-483c-8259-253a8732cf96',b='8a1df2c2-7aeb-4e52-929d-182cd4b59f61';
function run(id:string,build='r1-local-001',lifecycle:RunDto['lifecycle']='active'):RunDto{return{run_id:id,revision:1,lifecycle,checkpoint:createSnapshotV1(id,{client_build_id:build,content_version:'r1-map-1',rules_version:'r1-rules-1',level_id:'house-bridge-portal'}),updated_at:'2026-10-04T10:00:00Z',started_at:'2026-10-04T10:00:00Z'};}
test('explicit server B selection ignores local pending A and preserves A body/build',async()=>{
  const local=fromServer('owner',run(a,'older-build'));local.pending={operation:'checkpoint_save_v1',snapshot:local.snapshot};const before=structuredClone(local);let reads=0;
  const selected=await chooseResume('owner',b,local,run(b,'newer-build'),async()=>{reads++;throw new Error('unexpected');});
  assert.equal(selected?.record.run_id,b);assert.equal(selected?.record.client_build_id,'newer-build');assert.equal(selected?.persist,true);assert.equal(reads,0);assert.deepEqual(local,before);
});
test('explicit local A selection retains its pending request although server active B differs',async()=>{
  const local=fromServer('owner',run(a));local.inflight={operation:'checkpoint_save_v1',request_id:'a0c97c6b-e767-4709-9d1f-a90f2ca80a9c',base_revision:1,status:'inflight',body:{run_id:a,expected_revision:1}};const before=structuredClone(local);
  const selected=await chooseResume('owner',a,local,run(b),async()=>{throw new Error('unexpected');});assert.equal(selected?.record.run_id,a);assert.equal(selected?.persist,false);assert.deepEqual(local,before);
});
test('selected own terminal run is loaded explicitly rather than active other run',async()=>{
  const selected=await chooseResume('owner',a,null,run(b),async id=>{assert.equal(id,a);return run(a,'r1-local-001','abandoned');});assert.equal(selected?.record.run_id,a);assert.equal(selected?.record.terminal_ack,true);assert.equal(selected?.record.lifecycle,'abandoned');
});
test('unavailable requested run never falls back to a different active or foreign local copy',async()=>{
  const foreign=fromServer('other-owner',run(a));await assert.rejects(chooseResume('owner',a,foreign,run(b),async()=>{throw new Error('NOT_FOUND');}),/NOT_FOUND/);
});
