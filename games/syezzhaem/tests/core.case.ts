import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, type Input, type Snapshot, type Support } from '../src/contracts.js';
import { canPlace, createInitial, houseSupported, initialBlocks, place, resolveBlock, restore, retainedFraction, snapshot, step, take, targetAt, worldPosition } from '../src/core.js';

const idle: Input = { left: false, right: false, jump: false };
function ticks(s: Snapshot, count: number, input = idle): void { for (let i = 0; i < count; i++) step(s, input); }
function remove(s: Snapshot, x: number, y: number): void {
  const result = take(s, targetAt(s, 'house', x, y));
  assert.equal(result.ok, true, !result.ok ? result.reason : '');
}
function front(s = createInitial('test-run')): Snapshot {
  // Move by real input; wall removal precedes crossing the doorway.
  remove(s, 7, 1); remove(s, 7, 2);
  remove(s, 5, 5); remove(s, 6, 5); remove(s, 7, 3);
  for (let i = 0; i < 37; i++) step(s, { ...idle, right: true });
  assert.ok(s.player.x - s.house.x > 6.65 && s.player.x - s.house.x < 6.75);
  remove(s, 7, 0);
  step(s, idle);
  assert.equal(s.player.support?.space, 'house');
  ticks(s, 900);
  assert.equal(s.house.motion, 'gap');
  return s;
}

test('initial snapshot round-trips and original blocks have stable unique identity', () => {
  const state = createInitial('initial');
  assert.deepEqual(restore(JSON.parse(JSON.stringify(state))), state);
  assert.equal(new Set(initialBlocks().map(b => b.id)).size, initialBlocks().length);
  assert.equal(retainedFraction(state), 1);
});

test('AT-01: a moving house block is transferred once and placed bridge stays in world space', () => {
  const state = front();
  const before = state.inventory.wood;
  const target = targetAt(state, 'world', 12, 0);
  const result = place(state, target);
  assert.equal(result.ok, true, !result.ok ? result.reason : '');
  assert.equal(state.inventory.wood, before - 1);
  assert.equal(place(state, target).ok, false);
  const bridge = resolveBlock(state, target)!;
  assert.equal(bridge.originalId, null);
  const position = worldPosition(state, bridge);
  ticks(state, 60);
  assert.ok(state.house.x > 5.5);
  assert.deepEqual(worldPosition(state, bridge), position);
});

test('AT-02: full inventory and invalid placement preserve all state', () => {
  const state = createInitial('invalid');
  // The request validator additionally rejects this fixture's minted resources.
  state.inventory.wood = RULES.inventoryCap;
  const before = snapshot(state);
  assert.equal(take(state, targetAt(state, 'house', 7, 1)).ok, false);
  assert.equal(place(state, targetAt(state, 'house', 4, 0)).ok, false);
  assert.equal(place(state, targetAt(state, 'world', 30, 7)).ok, false);
  assert.deepEqual(state, before);
  state.inventory.wood = 1;
  const next = snapshot(state);
  assert.equal(place(state, targetAt(state, 'house', 4, 1)).ok, false, 'no construction inside player');
  assert.deepEqual(state, next);
});

test('AT-03 partial: house stops before unsupported gap then whole R1 route is playable', () => {
  const state = front();
  const stoppedX = state.house.x;
  ticks(state, 120);
  assert.equal(state.house.x, stoppedX);
  assert.ok(houseSupported(state));
  for (let x = 12; x <= 16; x++) {
    const target = targetAt(state, 'world', x, 0);
    assert.equal(canPlace(state, target).ok, true, `bridge cell ${x} reachable from real front-floor position`);
    assert.equal(place(state, target).ok, true);
    ticks(state, 100);
    assert.ok(state.house.x > stoppedX);
    assert.equal(state.player.support?.space, 'house');
  }
  assert.equal(state.inventory.wood, 1);
  ticks(state, 1600);
  assert.equal(state.outcome, 'won');
  assert.equal(state.house.motion, 'portal');
  assert.equal(state.house.x, 22);
  assert.deepEqual(restore(snapshot(state)), state);
});

test('AT-04 partial: removed chassis support has a recoverable countdown, distinct from floor removal', () => {
  const state = front();
  assert.equal(place(state, targetAt(state, 'world', 12, 0)).ok, true);
  ticks(state, 80);
  ticks(state, 14, { ...idle, left: true });
  remove(state, 6, 0);
  step(state, idle);
  const bridgeTarget = targetAt(state, 'world', 12, 0);
  const removed = take(state, bridgeTarget);
  assert.equal(removed.ok, true, !removed.ok ? removed.reason : '');
  ticks(state, 30);
  assert.equal(state.house.motion, 'unsupported');
  assert.ok(state.house.supportTimer < RULES.supportGrace && state.house.supportTimer > 0);
  assert.equal(state.outcome, 'playing');
  assert.equal(place(state, targetAt(state, 'world', 12, 0)).ok, true);
  step(state, idle);
  assert.equal(state.house.supportTimer, RULES.supportGrace);
  assert.equal(state.outcome, 'playing');
  assert.equal(take(state, targetAt(state, 'world', 12, 0)).ok, true);
  ticks(state, 91);
  assert.equal(state.outcome, 'lost');
  assert.equal(state.reason, 'Дом потерял опору');

  const floorState = createInitial('floor-removal');
  remove(floorState, 4, 0);
  assert.equal(floorState.player.support, null);
  ticks(floorState, 5);
  assert.ok(floorState.player.y < RULES.houseY + .5);
  assert.equal(floorState.house.supportTimer, RULES.supportGrace);
});

test('AT-16 movement partial: airborne velocity, platform carry and support countdown restore exactly', () => {
  const state = createInitial('flight');
  ticks(state, 30);
  assert.ok(Math.abs(state.player.x - state.house.x - 4) < 1e-8);
  step(state, { ...idle, jump: true });
  assert.equal(state.player.support, null);
  assert.ok(state.player.vx > .64, 'jump inherits platform velocity');
  ticks(state, 8);
  const restored = restore(JSON.parse(JSON.stringify(snapshot(state))));
  assert.deepEqual(restored, state);
  ticks(restored, 120); ticks(state, 120);
  assert.deepEqual(restored, state);
  assert.equal((state.player.support as Support | null)?.space, 'house');

  const warning = front();
  assert.equal(place(warning, targetAt(warning, 'world', 12, 0)).ok, true);
  ticks(warning, 80);
  ticks(warning, 14, { ...idle, left: true });
  remove(warning, 6, 0);
  step(warning, idle);
  assert.equal(take(warning, targetAt(warning, 'world', 12, 0)).ok, true);
  ticks(warning, 20);
  const warningRestored = restore(snapshot(warning));
  ticks(warning, 10); ticks(warningRestored, 10);
  assert.deepEqual(warningRestored, warning);
});

test('AT-26: repairing same floor cell preserves new ID and support, never original score', () => {
  const state = createInitial('repair');
  const original = targetAt(state, 'house', 4, 0);
  remove(state, 4, 0);
  const retained = retainedFraction(state);
  const result = place(state, targetAt(state, 'house', 4, 0));
  assert.equal(result.ok, true, !result.ok ? result.reason : '');
  assert.equal(retainedFraction(state), retained);
  assert.notEqual(resolveBlock(state, original)?.id, original.blockId);
  assert.equal(resolveBlock(state, original)?.originalId, null);
  step(state, idle);
  assert.equal(state.player.support?.x, 4);
  assert.match(state.player.support!.blockId, /^placed:/);
  assert.deepEqual(restore(snapshot(state)).player.support, state.player.support);
});

test('AT-28: bound target follows house-local cell and safely fails after deletion/replacement', () => {
  const state = createInitial('bound');
  const captured = targetAt(state, 'house', 7, 1);
  ticks(state, 30);
  assert.equal(take(state, captured).ok, true, 'same house-local block after movement');
  const after = snapshot(state);
  assert.equal(take(state, captured).ok, false, 'gesture cannot repeat deletion');
  assert.deepEqual(state, after);
  assert.equal(place(state, targetAt(state, 'house', 7, 1)).ok, true);
  const repaired = snapshot(state);
  assert.equal(take(state, captured).ok, false, 'old ID cannot target repaired block');
  assert.deepEqual(state, repaired);
});

test('snapshot validation rejects type, identity, reference, cell and conservation violations atomically', () => {
  const state = createInitial('validation');
  const mutate = (fn: (s: any) => void) => { const bad = snapshot(state); fn(bad); assert.throws(() => restore(bad)); assert.deepEqual(state, createInitial('validation')); };
  mutate(s => { s.player.vx = '0'; });
  mutate(s => { s.house.supportTimer = -1; });
  mutate(s => { s.blocks.push({ ...s.blocks[0] }); });
  mutate(s => { s.blocks[s.blocks.length - 1].id = 'placed:99'; });
  mutate(s => { s.blocks.splice(0, 1); });
  mutate(s => { s.player.support.blockId = 'missing'; });
  mutate(s => { s.inventory.wood = 1; });
  mutate(s => { s.blocks.find((b: any) => b.id === 'original:4:0').originalId = null; });
  mutate(s => { s.rulesVersion = 'r1-rules-2'; });
  mutate(s => { delete s.player.jumpHeld; });
});

test('G-09: interaction ray cannot pass through the supporting floor', () => {
  const state = createInitial('floor-ray');
  ticks(state, 6, { ...idle, right: true });
  assert.equal(state.player.support?.x, 4);
  const blocked = take(state, targetAt(state, 'house', 3, 0));
  assert.equal(blocked.ok, false);
  assert.match(!blocked.ok ? blocked.reason : '', /другой блок/);
});

test('G-07/AT-02: placement cannot enter chassis, but removed house floor can be repaired', () => {
  const state = createInitial('chassis-reservation');
  remove(state, 4, 0);
  const before = snapshot(state);
  const target = targetAt(state, 'world', 6, 1);
  const result = place(state, target);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.reason : '', /шасси/);
  assert.deepEqual(state, before, 'failed chassis placement is atomic');
  const repair = place(state, targetAt(state, 'house', 4, 0));
  assert.equal(repair.ok, true, !repair.ok ? repair.reason : '');
  assert.deepEqual(restore(snapshot(state)), state);
  const badSnapshot = snapshot(before);
  badSnapshot.inventory.wood--;
  badSnapshot.blocks.push({ space: 'world', x: 6, y: 1, id: `placed:${crypto.randomUUID()}`, material: 'wood', originalId: null, portable: true });
  assert.throws(() => restore(badSnapshot), /chassis/);
});

test('G-03: fixed obstacle blocks moving house, including a floating block above chassis', () => {
  const state = front();
  assert.equal(place(state, targetAt(state, 'world', 12, 0)).ok, true);
  assert.equal(place(state, targetAt(state, 'world', 13, 0)).ok, true);
  assert.equal(place(state, targetAt(state, 'world', 13, 1)).ok, true);
  // A disconnected block is allowed by G-08; its lower support may have been taken earlier.
  resolveBlock(state, { space: 'world', x: 13, y: 1 })!.y = 2;
  assert.deepEqual(restore(snapshot(state)), state);
  ticks(state, 300);
  assert.equal(state.house.motion, 'gap');
  assert.ok(state.house.x < 6.001 && state.house.x > 5.98);
  const stoppedX = state.house.x;
  assert.equal(take(state, targetAt(state, 'world', 13, 2)).ok, true);
  ticks(state, 30);
  assert.ok(state.house.x > stoppedX);
});

test('valid flight off the fixed map still saves and restores terminal position', () => {
  const state = createInitial('outside-map');
  state.player.x = -10; state.player.y = .5;
  state.player.support = { space: 'world', x: -10, y: 0, blockId: 'terrain:-10' };
  ticks(state, 100, { ...idle, left: true });
  assert.equal(state.outcome, 'lost');
  assert.ok(state.player.x < -11);
  assert.deepEqual(restore(snapshot(state)), state);
});

test('fixed tick does not simulate wall-clock suspension and terminal outcome stays fixed', () => {
  const state = createInitial('time');
  assert.throws(() => step(state, idle, 3));
  assert.equal(state.tick, 0);
  state.player.hp = 0;
  step(state, idle);
  assert.equal(state.outcome, 'lost');
  const terminal = snapshot(state);
  ticks(state, 120, { left: true, right: false, jump: true });
  assert.deepEqual(state, terminal);
});
