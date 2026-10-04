import { RULES, type ActionResult, type Block, type Cell, type Input, type Snapshot, type Space, type Target } from './contracts.js';
import worldDefinition from '../public/content/r1-map-1.json' with { type: 'json' };
import houseDefinition from '../public/content/r1-house-1.json' with { type: 'json' };

const EPS = 1e-7;
const stationary: Input = { left: false, right: false, jump: false };
const key = (cell: Cell) => `${cell.space}:${cell.x}:${cell.y}`;
const originalKey = (x: number, y: number) => `original:${x}:${y}`;

/** Logical map. Z, piston animation and all drawing are deliberately outside the simulation. */
export function initialBlocks(): Block[] {
  return structuredClone([...worldDefinition.blocks, ...houseDefinition.blocks]) as Block[];
}

const baseline = initialBlocks();
const baselineById = new Map(baseline.map(block => [block.id, block]));
const originalCount = baseline.filter(block => block.originalId !== null).length;

export function randomId(): string {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  // getRandomValues also works on a phone visiting a plain HTTP development host.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createInitial(id = randomId()): Snapshot {
  return {
    schemaVersion: 1, contentVersion: 'r1-map-1', rulesVersion: 'r1-rules-1', runId: id,
    tick: 0, outcome: 'playing', reason: null,
    house: { x: 2, y: RULES.houseY, heartHp: 100, motion: 'moving', supportTimer: RULES.supportGrace },
    player: { x: 6, y: RULES.houseY + .5, vx: 0, vy: 0, hp: 3, support: { space: 'house', x: 4, y: 0, blockId: originalKey(4, 0) }, jumpHeld: false },
    inventory: { wood: 0 }, blocks: initialBlocks(), nextBlockId: 1,
  };
}

export function resolveBlock(s: Snapshot, cell: Cell): Block | undefined {
  return s.blocks.find(block => block.space === cell.space && block.x === cell.x && block.y === cell.y);
}

export function worldPosition(s: Snapshot, cell: Cell): { x: number; y: number } {
  return cell.space === 'house' ? { x: cell.x + s.house.x, y: cell.y + s.house.y } : { x: cell.x, y: cell.y };
}

export function targetAt(s: Snapshot, space: Space, x: number, y: number): Target {
  // JSON transports zero without an IEEE sign; grid coordinates have one zero identity.
  x = x === 0 ? 0 : x; y = y === 0 ? 0 : y;
  const cell = { space, x, y };
  return { ...cell, blockId: resolveBlock(s, cell)?.id ?? null };
}

function fail(reason: string): ActionResult { return { ok: false, reason }; }
function validCell(cell: Cell): boolean {
  if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) return false;
  if (cell.space === 'house') return cell.x >= 0 && cell.x < RULES.houseWidth && cell.y >= 0 && cell.y < RULES.houseHeight;
  return cell.space === 'world' && cell.x >= -10 && cell.x <= 40 && cell.y >= 0 && cell.y <= 12;
}

// Slab intersection rejects blockers strictly between player and selected cell.
function rayBox(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  let lo = 0, hi = 1;
  for (const [a, delta, min, max] of [[ax, bx - ax, cx - .5, cx + .5], [ay, by - ay, cy - .5, cy + .5]]) {
    if (Math.abs(delta) < EPS) { if (a < min + EPS || a > max - EPS) return false; continue; }
    const u = (min - a) / delta, v = (max - a) / delta;
    lo = Math.max(lo, Math.min(u, v)); hi = Math.min(hi, Math.max(u, v));
    if (lo >= hi - EPS) return false;
  }
  return hi > EPS && lo < 1 - EPS;
}

function reachable(s: Snapshot, cell: Cell, targetId: string | null): ActionResult {
  if (!validCell(cell)) return fail('Клетка вне маршрута');
  const position = worldPosition(s, cell), ay = s.player.y + RULES.playerHeight / 2;
  if (Math.hypot(position.x - s.player.x, position.y - ay) > RULES.reach + EPS) return fail('Слишком далеко');
  for (const block of s.blocks) {
    if (block.id === targetId) continue;
    const p = worldPosition(s, block);
    if (rayBox(s.player.x, ay, position.x, position.y, p.x, p.y)) return fail('Между вами другой блок');
  }
  return { ok: true };
}

export function canTake(s: Snapshot, target: Target): ActionResult {
  if (s.outcome !== 'playing') return fail('Забег завершён');
  const block = resolveBlock(s, target);
  if (!target.blockId || block?.id !== target.blockId) return fail('Выбранный блок изменился');
  if (!block.portable) return fail('Этот блок нельзя разобрать');
  if (s.inventory.wood >= RULES.inventoryCap) return fail('Инвентарь заполнен');
  const reach = reachable(s, target, block.id);
  return reach.ok ? { ok: true, block } : reach;
}

export function take(s: Snapshot, target: Target): ActionResult {
  const result = canTake(s, target);
  if (!result.ok || !result.block) return result;
  s.blocks.splice(s.blocks.findIndex(block => block.id === result.block!.id), 1);
  s.inventory.wood++;
  if (s.player.support?.blockId === result.block.id) {
    if (s.player.support.space === 'house' && s.house.motion === 'moving') s.player.vx += RULES.houseSpeed;
    s.player.support = null;
  }
  return result;
}

function overlapsPlayer(s: Snapshot, x: number, y: number): boolean {
  return x + .5 > s.player.x - RULES.playerWidth / 2 + EPS && x - .5 < s.player.x + RULES.playerWidth / 2 - EPS &&
    y + .5 > s.player.y + EPS && y - .5 < s.player.y + RULES.playerHeight - EPS;
}

/** Reserved hull between the road and floor. Feet animation never changes this envelope. */
export function overlapsChassis(s: Snapshot, x: number, y: number): boolean {
  return x + .5 > s.house.x + .5 + EPS && x - .5 < s.house.x + 6.5 - EPS &&
    y + .5 > s.house.y - 1 + EPS && y - .5 < s.house.y - .5 - EPS;
}

export function canPlace(s: Snapshot, target: Target): ActionResult {
  if (s.outcome !== 'playing') return fail('Забег завершён');
  if (target.blockId !== null || resolveBlock(s, target)) return fail('Клетка занята или выбор изменился');
  if (s.inventory.wood <= 0) return fail('Нужно разобрать блок дома');
  const reach = reachable(s, target, null);
  if (!reach.ok) return reach;
  const p = worldPosition(s, target);
  if (overlapsPlayer(s, p.x, p.y)) return fail('Здесь стоит персонаж');
  if (overlapsChassis(s, p.x, p.y)) return fail('Здесь находится шасси дома');
  // The two logical grids cannot create overlapping solids while the house is here.
  if (s.blocks.some(block => {
    const other = worldPosition(s, block);
    return Math.abs(other.x - p.x) < 1 - EPS && Math.abs(other.y - p.y) < 1 - EPS;
  })) return fail('Здесь находится другой блок');
  const neighbors: Cell[] = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => ({ space: target.space, x: target.x + dx, y: target.y + dy }));
  const chassisNeighbor = target.space === 'house' && target.y === 0 && target.x >= 1 && target.x <= 6;
  if (!chassisNeighbor && !neighbors.some(cell => resolveBlock(s, cell))) return fail('Нужен соседний блок');
  return { ok: true };
}

export function place(s: Snapshot, target: Target): ActionResult {
  const result = canPlace(s, target);
  if (!result.ok) return result;
  const block: Block = { space: target.space, x: target.x, y: target.y, id: `placed:${randomId()}`, material: 'wood', originalId: null, portable: true };
  s.nextBlockId++;
  s.blocks.push(block); s.inventory.wood--;
  return { ok: true, block };
}

/** Continuous coverage, rather than only two feet: a hole in the middle matters. */
export function houseSupported(s: Snapshot, atX = s.house.x): boolean {
  const from = atX + 1, to = atX + 6;
  const intervals = s.blocks.filter(block => block.space === 'world' && block.y === 0).map(block => [block.x - .5, block.x + .5]).sort((a, b) => a[0] - b[0]);
  let covered = from;
  for (const [start, end] of intervals) {
    if (end < covered - EPS) continue;
    if (start > covered + EPS) return false;
    covered = Math.max(covered, end);
    if (covered >= to - EPS) return true;
  }
  return false;
}

function chassisClear(s: Snapshot, atX: number): boolean {
  const houseBlocks = s.blocks.filter(block => block.space === 'house');
  for (const block of s.blocks) {
    if (block.space !== 'world' || block.y === 0) continue;
    // Check both the reserved hull and the actual remaining house, including floating obstacles.
    if (block.x + .5 > atX + .5 + EPS && block.x - .5 < atX + 6.5 - EPS &&
      block.y + .5 > s.house.y - 1 + EPS && block.y - .5 < s.house.y - .5 - EPS) return false;
    if (houseBlocks.some(houseBlock => Math.abs(atX + houseBlock.x - block.x) < 1 - EPS && Math.abs(s.house.y + houseBlock.y - block.y) < 1 - EPS)) return false;
  }
  return true;
}

function supportExists(s: Snapshot): boolean {
  const support = s.player.support;
  if (!support) return false;
  const block = resolveBlock(s, support);
  if (block?.id !== support.blockId) return false;
  const p = worldPosition(s, support);
  return Math.abs(s.player.y - (p.y + .5)) < .025 && Math.abs(s.player.x - p.x) < .5 + RULES.playerWidth / 2 - EPS;
}

function movePlayerX(s: Snapshot, amount: number): void {
  if (Math.abs(amount) < EPS) return;
  const p = s.player, half = RULES.playerWidth / 2, next = p.x + amount;
  let allowed = next;
  for (const block of s.blocks) {
    const b = worldPosition(s, block);
    if (p.y >= b.y + .5 - EPS || p.y + RULES.playerHeight <= b.y - .5 + EPS) continue;
    if (amount > 0 && p.x + half <= b.x - .5 + EPS && next + half > b.x - .5) allowed = Math.min(allowed, b.x - .5 - half);
    if (amount < 0 && p.x - half >= b.x + .5 - EPS && next - half < b.x + .5) allowed = Math.max(allowed, b.x + .5 + half);
  }
  if (Math.abs(allowed - next) > EPS) p.vx = 0;
  p.x = allowed;
}

function movePlayerY(s: Snapshot, amount: number): void {
  const p = s.player, next = p.y + amount, half = RULES.playerWidth / 2;
  let allowed = next;
  let landed: Block | undefined;
  for (const block of s.blocks) {
    const b = worldPosition(s, block);
    if (p.x + half <= b.x - .5 + EPS || p.x - half >= b.x + .5 - EPS) continue;
    if (amount <= 0 && p.y >= b.y + .5 - EPS && next <= b.y + .5 && b.y + .5 > allowed - EPS) {
      allowed = b.y + .5; landed = block;
    }
    if (amount > 0 && p.y + RULES.playerHeight <= b.y - .5 + EPS && next + RULES.playerHeight > b.y - .5) {
      allowed = Math.min(allowed, b.y - .5 - RULES.playerHeight);
    }
  }
  p.y = allowed;
  if (landed) {
    p.vy = 0;
    p.support = { space: landed.space, x: landed.x, y: landed.y, blockId: landed.id };
  } else if (Math.abs(allowed - next) > EPS) p.vy = 0;
}

/** Exactly one simulation tick. Render loops may call it repeatedly, never with wall-clock gaps. */
export function step(s: Snapshot, input: Input = stationary, dt = 1 / RULES.tickRate): void {
  if (s.outcome !== 'playing') return;
  if (!Number.isFinite(dt) || Math.abs(dt - 1 / RULES.tickRate) > EPS) throw new Error('step expects exactly one fixed tick');
  const p = s.player, h = s.house;
  if (!supportExists(s)) p.support = null;
  const wasHouseSupported = p.support?.space === 'house';
  const previousX = h.x;
  const currentGround = houseSupported(s);
  if (!currentGround) {
    h.motion = 'unsupported'; h.supportTimer = Math.max(0, h.supportTimer - dt);
  } else {
    h.supportTimer = RULES.supportGrace;
    const destination = Math.min(RULES.portalX - 3, h.x + RULES.houseSpeed * dt);
    if (h.x >= RULES.portalX - 3 - EPS) h.motion = 'portal';
    else if (houseSupported(s, destination) && chassisClear(s, destination)) { h.x = destination; h.motion = 'moving'; }
    else h.motion = 'gap';
  }
  const houseDelta = h.x - previousX;
  const platformVelocity = houseDelta / dt;
  if (wasHouseSupported) p.x += houseDelta;
  const direction = Number(input.right) - Number(input.left);
  const jump = input.jump && !p.jumpHeld && p.support !== null;
  p.jumpHeld = Boolean(input.jump);
  if (jump) {
    p.vy = RULES.jumpSpeed;
    p.vx = direction * RULES.moveSpeed + (wasHouseSupported ? platformVelocity : 0);
    p.support = null;
  } else if (p.support) {
    p.vx = direction * RULES.moveSpeed;
  } else if (direction !== 0) {
    // Air control changes relative input while preserving the take-off platform speed.
    const inherited = [RULES.houseSpeed, RULES.moveSpeed + RULES.houseSpeed, -RULES.moveSpeed + RULES.houseSpeed].some(value => Math.abs(p.vx - value) < EPS) ? RULES.houseSpeed : 0;
    p.vx = direction * RULES.moveSpeed + inherited;
  }
  movePlayerX(s, p.vx * dt);
  if (!supportExists(s)) p.support = null;
  if (!p.support) { p.vy -= RULES.gravity * dt; movePlayerY(s, p.vy * dt); }
  else p.vy = 0;
  s.tick++;
  if (p.y < -4) p.hp = 0;
  if (h.supportTimer <= 0) h.heartHp = 0;
  if (p.hp <= 0 || h.heartHp <= 0) {
    s.outcome = 'lost'; s.reason = p.hp <= 0 ? 'Персонаж упал в пропасть' : 'Дом потерял опору';
  } else if (h.x + 3 >= RULES.portalX - EPS && p.support?.space === 'house') {
    s.outcome = 'won'; s.reason = 'Дом добрался до портала'; h.motion = 'portal';
  }
}

export function retainedFraction(s: Snapshot): number {
  return s.blocks.filter(block => block.originalId !== null && baselineById.get(block.originalId)?.id === block.id).length / originalCount;
}

export function snapshot(s: Snapshot): Snapshot { return structuredClone(s); }

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name}: expected object`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, names: string[], name: string): void {
  if (Object.keys(value).length !== names.length || names.some(field => !Object.hasOwn(value, field))) throw new Error(`${name}: unexpected or missing fields`);
}
function number(value: unknown, name: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${name}: invalid number`);
  return value;
}
function string(value: unknown, name: string, max = 160): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new Error(`${name}: invalid string`);
  return value;
}
function enumValue<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (!values.includes(value as T)) throw new Error(`${name}: invalid value`);
  return value as T;
}

/** Fail before exposing a partial state. The server uses this same versioned domain contract. */
export function restore(raw: unknown): Snapshot {
  const r = object(raw, 'snapshot');
  exactKeys(r, ['schemaVersion', 'contentVersion', 'rulesVersion', 'runId', 'tick', 'outcome', 'reason', 'house', 'player', 'inventory', 'blocks', 'nextBlockId'], 'snapshot');
  if (r.schemaVersion !== 1 || r.contentVersion !== 'r1-map-1' || r.rulesVersion !== 'r1-rules-1') throw new Error('Unsupported snapshot/content/rules version');
  string(r.runId, 'runId', 96); number(r.tick, 'tick', 0, 10_000_000, true);
  enumValue(r.outcome, ['playing', 'won', 'lost'], 'outcome');
  if (r.reason !== null) string(r.reason, 'reason', 300);
  if (r.outcome === 'playing' && r.reason !== null) throw new Error('Playing run cannot have an outcome reason');
  if (r.outcome !== 'playing' && r.reason === null) throw new Error('Terminal run requires a reason');
  const h = object(r.house, 'house'); exactKeys(h, ['x', 'y', 'heartHp', 'motion', 'supportTimer'], 'house');
  number(h.x, 'house.x', 2, RULES.portalX - 3 + EPS); if (h.y !== RULES.houseY) throw new Error('house.y: map is horizontal');
  number(h.heartHp, 'heartHp', 0, 100, true); enumValue(h.motion, ['moving', 'gap', 'unsupported', 'portal'], 'motion'); number(h.supportTimer, 'supportTimer', 0, RULES.supportGrace);
  const p = object(r.player, 'player'); exactKeys(p, ['x', 'y', 'vx', 'vy', 'hp', 'support', 'jumpHeld'], 'player');
  number(p.x, 'player.x', -30, 60); number(p.y, 'player.y', -5, 15); number(p.vx, 'player.vx', -RULES.moveSpeed - RULES.houseSpeed - EPS, RULES.moveSpeed + RULES.houseSpeed + EPS); number(p.vy, 'player.vy', -40, RULES.jumpSpeed + EPS); number(p.hp, 'player.hp', 0, 3, true);
  if (typeof p.jumpHeld !== 'boolean') throw new Error('jumpHeld: expected boolean');
  const inv = object(r.inventory, 'inventory'); exactKeys(inv, ['wood'], 'inventory'); number(inv.wood, 'wood', 0, RULES.inventoryCap, true);
  number(r.nextBlockId, 'nextBlockId', 1, 10_000_000, true);
  if (!Array.isArray(r.blocks) || r.blocks.length > 650) throw new Error('blocks: invalid list');
  const ids = new Set<string>(), cells = new Set<string>();
  for (const [i, value] of r.blocks.entries()) {
    const b = object(value, `blocks[${i}]`); exactKeys(b, ['space', 'x', 'y', 'id', 'material', 'originalId', 'portable'], `blocks[${i}]`);
    enumValue(b.space, ['house', 'world'], 'space'); number(b.x, 'block.x', -10, 40, true); number(b.y, 'block.y', 0, 12, true);
    if (!validCell(b as unknown as Cell)) throw new Error('Block outside map bounds');
    const id = string(b.id, 'block.id', 96); if (b.material !== 'wood' || typeof b.portable !== 'boolean') throw new Error('Invalid block material/portability');
    if (ids.has(id) || cells.has(key(b as unknown as Cell))) throw new Error('Duplicate block ID or cell');
    ids.add(id); cells.add(key(b as unknown as Cell));
    const original = baselineById.get(id);
    if (original) {
      if (JSON.stringify(b) !== JSON.stringify(original)) {
        // Field order is not a contract, field equality is.
        if (Object.keys(original).some(field => b[field] !== original[field as keyof Block])) throw new Error('Original/terrain block was modified');
      }
    } else {
      if (!/^placed:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || b.originalId !== null || b.portable !== true) throw new Error('Invalid newly placed block identity');
    }
    if (b.originalId !== null && (!original || b.originalId !== original.originalId)) throw new Error('Original identity cannot be reconstructed');
  }
  for (const block of baseline) if (!block.portable && !ids.has(block.id)) throw new Error('Immutable terrain is missing');
  // All portable material comes from this original house; no hidden resource minting.
  if (r.blocks.filter(value => (value as Block).portable).length + (inv.wood as number) !== originalCount) throw new Error('Material conservation failed');
  const s = structuredClone(raw) as Snapshot;
  for (const block of s.blocks) {
    const position = worldPosition(s, block);
    if (overlapsChassis(s, position.x, position.y)) throw new Error('Block intersects reserved chassis');
  }
  if (!chassisClear(s, s.house.x)) throw new Error('Fixed world block intersects house');
  if (p.support !== null) {
    const support = object(p.support, 'support'); exactKeys(support, ['space', 'x', 'y', 'blockId'], 'support');
    enumValue(support.space, ['house', 'world'], 'support.space'); number(support.x, 'support.x', -10, 40, true); number(support.y, 'support.y', 0, 12, true); string(support.blockId, 'support.blockId', 96);
    if (!supportExists(s) || p.vy !== 0) throw new Error('Support reference or supported position is invalid');
  }
  if (s.outcome === 'won' && !(s.house.x + 3 >= RULES.portalX - EPS && s.player.hp > 0 && s.house.heartHp > 0 && s.player.support?.space === 'house')) throw new Error('Victory predicate does not match snapshot');
  if (s.outcome === 'lost' && s.player.hp > 0 && s.house.heartHp > 0) throw new Error('Loss predicate does not match snapshot');
  if (s.outcome === 'playing' && (s.player.hp <= 0 || s.house.heartHp <= 0)) throw new Error('Dead run cannot remain playing');
  return s;
}
