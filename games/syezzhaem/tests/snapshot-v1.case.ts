import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitial, step, take, place, targetAt, snapshot, retainedFraction } from '../src/core.js';
import { BUILD_CONTEXT, createSnapshotV1, toSnapshotV1, fromSnapshotV1, validateSnapshotV1, scoreSnapshot } from '../src/snapshot-v1.js';
const idle = { left: false, right: false, jump: false };
test('initial transport has no overrides, immutable content reconstructed and input cleared', () => {
  const s = createInitial(); s.player.jumpHeld = true;
  const dto = toSnapshotV1(s);
  assert.deepEqual(dto.house_cells, []); assert.deepEqual(dto.world_cells, []);
  const expected = snapshot(s); expected.player.jumpHeld = false;
  assert.deepEqual(fromSnapshotV1(dto), expected);
  assert.deepEqual(validateSnapshotV1(dto), dto);
});
test('removed wall persists as tombstone; rebuilt cell gets UUID without original identity', () => {
  const s = createInitial();
  assert.equal(take(s, targetAt(s,'house',7,1)).ok, true);
  const removed = toSnapshotV1(s); assert.equal(removed.house_cells[0].operation,'remove');
  assert.equal(place(s, targetAt(s,'house',7,1)).ok,true);
  const rebuilt = toSnapshotV1(s), override = rebuilt.house_cells[0];
  assert.equal(override.operation,'put'); assert.equal(override.base_block_id,'original:7:1');
  assert.match(override.block_id!,/^placed:[0-9a-f-]{36}$/);
  assert.equal(override.original_block_id,null);
  const restored=fromSnapshotV1(rebuilt);
  assert.equal(restored.blocks.find(b=>b.space==='house'&&b.x===7&&b.y===1)!.id,override.block_id);
  assert.equal(retainedFraction(restored),25/26);
});
test('flight preserves velocities and support-loss ticks; restored simulation stays deterministic', () => {
  const s=createInitial(); step(s,{...idle,jump:true});
  for(let i=0;i<9;i++)step(s,idle);
  const r=fromSnapshotV1(toSnapshotV1(s));
  assert.equal(r.player.support,null); assert.equal(r.player.vy,s.player.vy);
  for(let i=0;i<40;i++){step(s,idle);step(r,idle);}
  assert.deepEqual(snapshot(r),snapshot(s));
});
test('reject malformed overrides, unsupported features, minted material and wrong pinned build', () => {
  const base=createSnapshotV1(crypto.randomUUID());
  const reject=(edit:(s:any)=>void)=>{const dto=structuredClone(base);edit(dto);assert.throws(()=>fromSnapshotV1(dto));};
  reject(s=>s.world_cells.push({x:0,y:0,operation:'remove',base_block_id:'terrain:0',block_id:null,original_block_id:null,material:null}));
  reject(s=>s.inventory.wood=1);
  reject(s=>s.player.support.block_id='placed:'+crypto.randomUUID());
  reject(s=>s.player.support.extra=true);
  reject(s=>s.house.support_loss_ticks=.5);
  reject(s=>s.actors.push({kind:'cat'}));
  reject(s=>s.counters.distance=999);
  reject(s=>s.house_cells=[{x:7,y:1,operation:'remove',base_block_id:'original:0:1',block_id:null,original_block_id:null,material:null}]);
  assert.throws(()=>validateSnapshotV1({...base,client_build_id:'other'},BUILD_CONTEXT));
});
test('terminal score is derived from surviving original IDs and ticks; loss score zero', () => {
  const s=createInitial(); s.player.hp=0; s.outcome='lost';s.reason='Падение';
  const result=scoreSnapshot(toSnapshotV1(s));
  assert.equal(result.score,0); assert.equal(result.outcome,'lost');assert.equal(result.cat_saved,false);
});
