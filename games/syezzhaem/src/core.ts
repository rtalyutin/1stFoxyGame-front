import { RULES, R2_RULES, MATERIALS, isR2, rulesFor, compatibleContent, type ContentVersion, type ActionResult, type Block, type Cell, type Input, type Snapshot, type Space, type Target, type Material, type Actor, type Inventory, type Support } from './contracts.js';
import worldDefinition from '../public/content/r1-map-1.json' with { type: 'json' };
import houseDefinition from '../public/content/r1-house-1.json' with { type: 'json' };
import tutorialWorld from '../public/content/r1-map-2.json' with { type: 'json' };
import tutorialHouse from '../public/content/r1-house-2.json' with { type: 'json' };

import routeWorld from '../public/content/r2-map-1.json' with { type: 'json' };
import routeHouse from '../public/content/r2-house-1.json' with { type: 'json' };
import routeActors from '../public/content/r2-actors-1.json' with { type: 'json' };

const EPS = 1e-7;
const stationary: Input = { left: false, right: false, jump: false };
const key = (cell: Cell) => `${cell.space}:${cell.x}:${cell.y}`;
const originalKey = (x: number, y: number) => `original:${x}:${y}`;

/** Logical map. Z, piston animation and all drawing are deliberately outside the simulation. */
export function initialBlocks(version: ContentVersion = 'r1-map-1'): Block[] {
  const world = version === 'r2-map-1' ? routeWorld : version === 'r1-map-2' ? tutorialWorld : worldDefinition;
  const house = version === 'r2-map-1' ? routeHouse : version === 'r1-map-2' ? tutorialHouse : houseDefinition;
  return structuredClone([...world.blocks, ...house.blocks]) as Block[];
}

const baselines = new Map((['r1-map-1', 'r1-map-2', 'r2-map-1'] as const).map(version => {
  const blocks = initialBlocks(version);
  return [version, {blocks, byId: new Map(blocks.map(block => [block.id, block])), originalCount: blocks.filter(block => block.originalId !== null).length}];
}));

export function randomId(): string {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  // getRandomValues also works on a phone visiting a plain HTTP development host.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createInitial(id = randomId(), contentVersion: ContentVersion = 'r1-map-1'): Snapshot {
  const rulesVersion = contentVersion === 'r2-map-1' ? 'r2-rules-1' : contentVersion === 'r1-map-2' ? 'r1-rules-2' : 'r1-rules-1';
  const RULES = rulesFor({rulesVersion});
  const state: Snapshot = {
    schemaVersion: 1, contentVersion, rulesVersion, runId: id,
    tick: 0, outcome: 'playing', reason: null,
    house: { x: 2, y: RULES.houseY, heartHp: 100, motion: 'moving', supportTimer: RULES.supportGrace },
    player: { x: 6, y: RULES.houseY + .5, vx: 0, vy: 0, hp: 3, support: { space: 'house', x: 4, y: 0, blockId: originalKey(4, 0) }, jumpHeld: false },
    inventory: { wood: 0 }, blocks: initialBlocks(contentVersion), nextBlockId: 1,
  };
  if (contentVersion === 'r2-map-1') {
    state.player.x = 6.6; state.player.heldActorKey = null; state.player.actionCooldownTicks = 0;
    state.inventory = {wood: 0, stone: 0, slime: 0}; state.actors = initialActors();
    state.lava = {x: state.house.x + 1 - R2_RULES.lavaLead, playerDamageTicks: 0, coreDamageTicks: 0};
    state.tutorialPlacements = 0; state.destroyedMaterials = {wood: 0, stone: 0, slime: 0};
  }
  return state;
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
function validCell(cell: Cell, s?: Snapshot): boolean {
  if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) return false;
  if (cell.space === 'house') return cell.x >= 0 && cell.x < RULES.houseWidth && cell.y >= 0 && cell.y < RULES.houseHeight;
  return cell.space === 'world' && cell.x >= -10 && cell.x <= (s && isR2(s) ? 140 : 40) && cell.y >= 0 && cell.y <= 12;
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
  const RULES = rulesFor(s);
  if (!validCell(cell, s)) return fail('Клетка вне маршрута');
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
  const RULES = rulesFor(s);
  if (s.outcome !== 'playing') return fail('Забег завершён');
  const block = resolveBlock(s, target);
  if (!target.blockId || block?.id !== target.blockId) return fail('Выбранный блок изменился');
  if (!block.portable) return fail('Этот блок нельзя разобрать');
  if (isR2(s) && actionBlocked(s)) return fail('Подождите следующий шаг');
  if (inventoryTotal(s.inventory) >= RULES.inventoryCap) return fail('Инвентарь заполнен');
  const reach = reachable(s, target, block.id);
  return reach.ok ? { ok: true, block } : reach;
}

export function take(s: Snapshot, target: Target): ActionResult {
  const RULES = rulesFor(s);
  const result = canTake(s, target);
  if (!result.ok || !result.block) return result;
  s.blocks.splice(s.blocks.findIndex(block => block.id === result.block!.id), 1);
  s.inventory[result.block.material] = (s.inventory[result.block.material] ?? 0) + 1;
  if (isR2(s)) { clearActorSupport(s, result.block.id); setActionDelay(s); }
  if (s.player.support?.blockId === result.block.id) {
    if (s.player.support.space === 'house' && s.house.motion === 'moving') s.player.vx += RULES.houseSpeed;
    s.player.support = null;
  }
  return result;
}

function overlapsPlayer(s: Snapshot, x: number, y: number): boolean {
  const RULES = rulesFor(s);
  return x + .5 > s.player.x - RULES.playerWidth / 2 + EPS && x - .5 < s.player.x + RULES.playerWidth / 2 - EPS &&
    y + .5 > s.player.y + EPS && y - .5 < s.player.y + RULES.playerHeight - EPS;
}

/** Reserved hull between the road and floor. Feet animation never changes this envelope. */
export function overlapsChassis(s: Snapshot, x: number, y: number): boolean {
  return x + .5 > s.house.x + .5 + EPS && x - .5 < s.house.x + 6.5 - EPS &&
    y + .5 > s.house.y - 1 + EPS && y - .5 < s.house.y - .5 - EPS;
}

export function canPlace(s: Snapshot, target: Target, material: Material = 'wood'): ActionResult {
  if (s.outcome !== 'playing') return fail('Забег завершён');
  if (target.blockId !== null || resolveBlock(s, target)) return fail('Клетка занята или выбор изменился');
  if (!isR2(s) && material !== 'wood') return fail('Материал недоступен в этой версии');
  if (isR2(s) && s.player.heldActorKey) return fail('Сначала поставьте переносимый предмет');
  if (isR2(s) && actionBlocked(s)) return fail('Подождите следующий шаг');
  if ((s.inventory[material] ?? 0) <= 0) return fail('Нужно разобрать блок этого материала');
  const reach = reachable(s, target, null);
  if (!reach.ok) return reach;
  const p = worldPosition(s, target);
  if (isR2(s) && s.actors!.some(actor => actor.hp > 0 && actor.state !== 'held' && overlapsActorCell(actor, p.x, p.y))) return fail('Здесь находится предмет или моб');
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

export function place(s: Snapshot, target: Target, material: Material = 'wood'): ActionResult {
  const result = canPlace(s, target, material);
  if (!result.ok) return result;
  const block: Block = { space: target.space, x: target.x, y: target.y, id: `placed:${randomId()}`, material, originalId: null, portable: true };
  if (isR2(s)) { block.durability = MATERIALS[material].durability; block.burnTicks = 0; }
  s.nextBlockId++;
  s.blocks.push(block); s.inventory[material] = (s.inventory[material] ?? 0) - 1;
  if (isR2(s)) {
    if ((s.tutorialPlacements ?? 0) < 2) s.tutorialPlacements = Math.max(s.tutorialPlacements!, routeWorld.tutorial_cells.filter(cell => resolveBlock(s, {space: 'world', ...cell})?.portable).length);
    setActionDelay(s);
  }
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
  const RULES = rulesFor(s);
  const support = s.player.support;
  if (!support) return false;
  const block = resolveBlock(s, support);
  if (block?.id !== support.blockId) return false;
  const p = worldPosition(s, support);
  return Math.abs(s.player.y - (p.y + .5)) < .025 && Math.abs(s.player.x - p.x) < .5 + RULES.playerWidth / 2 - EPS;
}

function movePlayerX(s: Snapshot, amount: number): void {
  const RULES = rulesFor(s);
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

/** Landing is spatial: transport may reorder overrides, so array position cannot decide support. */
function preferLanding(s: Snapshot, x: number, width: number, candidate: Block, current: Block): boolean {
  const a = worldPosition(s, candidate), b = worldPosition(s, current);
  if (Math.abs(a.y - b.y) > EPS) return a.y > b.y;
  const overlap = (center: number) => Math.min(x + width / 2, center + .5) - Math.max(x - width / 2, center - .5);
  const difference = overlap(a.x) - overlap(b.x);
  if (Math.abs(difference) > EPS) return difference > 0;
  const distanceDifference = Math.abs(a.x - x) - Math.abs(b.x - x);
  if (Math.abs(distanceDifference) > EPS) return distanceDifference < 0;
  if (candidate.space !== current.space) return candidate.space < current.space;
  if (candidate.x !== current.x) return candidate.x < current.x;
  if (candidate.y !== current.y) return candidate.y < current.y;
  return candidate.id < current.id;
}

function movePlayerY(s: Snapshot, amount: number): void {
  const RULES = rulesFor(s);
  const p = s.player, next = p.y + amount, half = RULES.playerWidth / 2;
  let allowed = next;
  let landed: Block | undefined;
  for (const block of s.blocks) {
    const b = worldPosition(s, block);
    if (p.x + half <= b.x - .5 + EPS || p.x - half >= b.x + .5 - EPS) continue;
    if (amount <= 0 && p.y >= b.y + .5 - EPS && next <= b.y + .5 && b.y + .5 > allowed - EPS) {
      if (!isR2(s) || !landed || preferLanding(s, p.x, RULES.playerWidth, block, landed)) { allowed = b.y + .5; landed = block; }
    }
    if (amount > 0 && p.y + RULES.playerHeight <= b.y - .5 + EPS && next + RULES.playerHeight > b.y - .5) {
      allowed = Math.min(allowed, b.y - .5 - RULES.playerHeight);
    }
  }
  p.y = allowed;
  if (landed) {
    if (isR2(s) && landed.material === 'slime') { p.vy = R2_RULES.slimeBounceSpeed; p.support = null; return; }
    if (isR2(s) && p.vy < -12) p.hp = Math.max(0, p.hp - 1);
    p.vy = 0;
    p.support = { space: landed.space, x: landed.x, y: landed.y, blockId: landed.id };
  } else if (Math.abs(allowed - next) > EPS) p.vy = 0;
}

/** Exactly one simulation tick. Render loops may call it repeatedly, never with wall-clock gaps. */
export function step(s: Snapshot, input: Input = stationary, dt = 1 / RULES.tickRate): void {
  const RULES = rulesFor(s);
  if (s.outcome !== 'playing') return;
  if (!Number.isFinite(dt) || Math.abs(dt - 1 / RULES.tickRate) > EPS) throw new Error('step expects exactly one fixed tick');
  if (isR2(s) && s.tutorialPlacements! < 2) return;
  if (isR2(s)) s.player.actionCooldownTicks = Math.max(0, s.player.actionCooldownTicks! - 1);
  // First transfer is untimed; the durable placed counter prevents re-locking on resume.
  if (s.contentVersion === 'r1-map-2' && s.nextBlockId === 1) return;
  const p = s.player, h = s.house;
  if (!supportExists(s)) p.support = null;
  const wasHouseSupported = p.support?.space === 'house';
  const previousX = h.x;
  const currentGround = houseSupported(s);
  if (!currentGround) {
    h.motion = 'unsupported'; h.supportTimer = isR2(s) ? Math.max(0, Math.round(h.supportTimer * RULES.tickRate) - 1) / RULES.tickRate : Math.max(0, h.supportTimer - dt);
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
  const damageReason = isR2(s) ? tickR2(s, houseDelta) : undefined;
  if (p.y < -4) p.hp = 0;
  if (h.supportTimer <= 0) h.heartHp = 0;
  if (p.hp <= 0 || h.heartHp <= 0) {
    s.outcome = 'lost'; s.reason = !isR2(s) ? (p.hp <= 0 ? 'Персонаж упал в пропасть' : 'Дом потерял опору') : p.hp <= 0 ? (p.y < -4 ? 'Персонаж упал в пропасть' : damageReason?.player ?? 'Игрок погиб от удара при падении') : h.supportTimer <= 0 ? 'Дом потерял опору' : damageReason?.core ?? 'Сердце дома разрушено';
  } else if (h.x + 3 >= RULES.portalX - EPS && p.support?.space === 'house') {
    s.outcome = 'won'; s.reason = 'Дом добрался до портала'; h.motion = 'portal';
  }
}

export function retainedFraction(s: Snapshot): number {
  const {byId, originalCount} = baselines.get(s.contentVersion)!;
  return s.blocks.filter(block => block.originalId !== null && byId.get(block.originalId)?.id === block.id).length / originalCount;
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
  if (r.contentVersion === 'r2-map-1') return restoreR2(raw);
  exactKeys(r, ['schemaVersion', 'contentVersion', 'rulesVersion', 'runId', 'tick', 'outcome', 'reason', 'house', 'player', 'inventory', 'blocks', 'nextBlockId'], 'snapshot');
  if (r.schemaVersion !== 1 || !compatibleContent(r.contentVersion, r.rulesVersion)) throw new Error('Unsupported snapshot/content/rules version');
  const RULES = rulesFor(r as unknown as Snapshot);
  const {blocks: baseline, byId: baselineById, originalCount} = baselines.get(r.contentVersion as ContentVersion)!;
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

export function initialActors(): Actor[] { return structuredClone(routeActors.actors) as Actor[]; }
export function inventoryTotal(inventory: Inventory): number { return inventory.wood + (inventory.stone ?? 0) + (inventory.slime ?? 0); }
function actionBlocked(s: Snapshot): boolean { return s.tutorialPlacements === 2 && (s.player.actionCooldownTicks ?? 0) > 0; }
function setActionDelay(s: Snapshot): void { s.player.actionCooldownTicks = s.tutorialPlacements === 2 ? R2_RULES.actionDelayTicks : 0; }
export function actorPosition(_s: Snapshot, actor: Actor): {x: number; y: number} { return {x: actor.x, y: actor.y}; }
export function actorDimensions(actor: Actor): {width: number; height: number} { return actor.kind === 'mob' ? {width: .7, height: 1.2} : actor.kind === 'cat' ? {width: .65, height: .75} : {width: .8, height: .7}; }
function overlapsActorCell(actor: Actor, x: number, y: number): boolean {
  const {width, height} = actorDimensions(actor);
  return x + .5 > actor.x - width / 2 + EPS && x - .5 < actor.x + width / 2 - EPS && y + .5 > actor.y + EPS && y - .5 < actor.y + height - EPS;
}
function actorReach(s: Snapshot, x: number, y: number): ActionResult {
  const sourceY = s.player.y + rulesFor(s).playerHeight / 2;
  if (Math.hypot(x - s.player.x, y - sourceY) > rulesFor(s).reach + EPS) return fail('Слишком далеко');
  if (s.blocks.some(block => { const p = worldPosition(s, block); return rayBox(s.player.x, sourceY, x, y, p.x, p.y); })) return fail('Между вами другой блок');
  return {ok: true};
}
export function canPickActor(s: Snapshot, actorKey: string): ActionResult {
  if (!isR2(s) || s.outcome !== 'playing') return fail('Предмет недоступен');
  if (s.player.heldActorKey) return fail('Можно нести только один предмет');
  if (actionBlocked(s)) return fail('Подождите следующий шаг');
  const actor = s.actors!.find(item => item.actorKey === actorKey);
  if (!actor || actor.kind === 'mob' || actor.hp <= 0 || !['idle', 'falling'].includes(actor.state)) return fail('Этот предмет нельзя поднять');
  const reach = actorReach(s, actor.x, actor.y + actorDimensions(actor).height / 2);
  return reach.ok ? {ok: true, actor} : reach;
}
export function pickActor(s: Snapshot, actorKey: string): ActionResult {
  const result = canPickActor(s, actorKey);
  if (!result.ok || !result.actor) return result;
  result.actor.state = 'held'; result.actor.support = null; result.actor.vx = 0; result.actor.vy = 0;
  s.player.heldActorKey = result.actor.actorKey; syncHeldActor(s); setActionDelay(s);
  return result;
}
export function canPutActor(s: Snapshot, target: Cell): ActionResult {
  if (!isR2(s) || s.outcome !== 'playing' || !s.player.heldActorKey) return fail('В руках нет предмета');
  if (actionBlocked(s)) return fail('Подождите следующий шаг');
  const actor = s.actors!.find(item => item.actorKey === s.player.heldActorKey)!;
  const block = resolveBlock(s, target);
  if (!block || !validCell(target, s) || ('blockId' in target && (target as Target).blockId !== block.id)) return fail('Нужен свободный верх существующего блока');
  const p = worldPosition(s, block), y = p.y + .5, dimensions = actorDimensions(actor);
  const reach = actorReach(s, p.x, y + dimensions.height / 2);
  if (!reach.ok) return reach;
  const overlaps = (x: number, bottom: number, width: number, height: number) => p.x + dimensions.width / 2 > x - width / 2 + EPS && p.x - dimensions.width / 2 < x + width / 2 - EPS && y + dimensions.height > bottom + EPS && y < bottom + height - EPS;
  if (overlaps(s.player.x, s.player.y, rulesFor(s).playerWidth, rulesFor(s).playerHeight)) return fail('Здесь стоит персонаж');
  for (const other of s.actors!) {
    if (other.actorKey === actor.actorKey || other.hp <= 0 || other.state === 'held') continue;
    const d = actorDimensions(other);
    if (overlaps(other.x, other.y, d.width, d.height)) return fail('Здесь находится другой предмет');
  }
  for (const solid of s.blocks) { const position = worldPosition(s, solid); if (overlaps(position.x, position.y - .5, 1, 1)) return fail('Место для предмета занято'); }
  if (y < s.house.y - .5 - EPS && p.x + dimensions.width / 2 > s.house.x + .5 && p.x - dimensions.width / 2 < s.house.x + 6.5 && y + dimensions.height > s.house.y - 1) return fail('Здесь находится шасси дома');
  return {ok: true, actor};
}
export function putActor(s: Snapshot, target: Cell): ActionResult {
  const result = canPutActor(s, target);
  if (!result.ok || !result.actor) return result;
  const block = resolveBlock(s, target)!, p = worldPosition(s, block), actor = result.actor;
  actor.x = p.x; actor.y = p.y + .5; actor.vx = 0; actor.vy = 0; actor.state = 'idle';
  actor.support = {space: block.space, x: block.x, y: block.y, blockId: block.id};
  s.player.heldActorKey = null; setActionDelay(s); return result;
}
function syncHeldActor(s: Snapshot): void {
  const actor = s.actors?.find(item => item.actorKey === s.player.heldActorKey);
  if (!actor) return;
  actor.x = s.player.x; actor.y = s.player.y + .65; actor.vx = s.player.vx; actor.vy = s.player.vy;
}
function clearActorSupport(s: Snapshot, blockId: string): void {
  for (const actor of s.actors ?? []) if (actor.support?.blockId === blockId) {
    if (actor.support.space === 'house' && s.house.motion === 'moving') actor.vx += rulesFor(s).houseSpeed;
    actor.support = null; if (actor.kind !== 'mob' && actor.hp > 0) actor.state = 'falling';
  }
}
function destroyBlock(s: Snapshot, block: Block): void {
  const index = s.blocks.findIndex(item => item.id === block.id);
  if (index < 0) return;
  s.blocks.splice(index, 1);
  if (block.portable) s.destroyedMaterials![block.material]++;
  if (s.player.support?.blockId === block.id) {
    if (s.player.support.space === 'house' && s.house.motion === 'moving') s.player.vx += rulesFor(s).houseSpeed;
    s.player.support = null;
  }
  clearActorSupport(s, block.id);
}
export function damageBlock(s: Snapshot, blockId: string, damage = 1): void {
  if (!isR2(s) || !Number.isInteger(damage) || damage <= 0) return;
  const block = s.blocks.find(item => item.id === blockId);
  if (!block) return;
  block.durability = Math.max(0, block.durability! - damage);
  if (block.durability === 0) destroyBlock(s, block);
}
function destroyActor(s: Snapshot, actor: Actor): void {
  actor.hp = 0; actor.state = actor.kind === 'mob' ? 'removed' : 'destroyed'; actor.support = null; actor.vx = 0; actor.vy = 0; actor.fuseTicks = 0;
  if (s.player.heldActorKey === actor.actorKey) s.player.heldActorKey = null;
}
function validActorSupport(s: Snapshot, actor: Actor): boolean {
  if (!actor.support) return false;
  const block = resolveBlock(s, actor.support);
  if (block?.id !== actor.support.blockId) return false;
  const p = worldPosition(s, block);
  return Math.abs(actor.y - p.y - .5) < .025 && Math.abs(actor.x - p.x) < .5 + actorDimensions(actor).width / 2 - EPS;
}
function moveActorX(s: Snapshot, actor: Actor, amount: number): boolean {
  const d = actorDimensions(actor), next = actor.x + amount;
  let allowed = next;
  for (const block of s.blocks) {
    const b = worldPosition(s, block);
    if (actor.y >= b.y + .5 - EPS || actor.y + d.height <= b.y - .5 + EPS) continue;
    if (amount > 0 && actor.x + d.width / 2 <= b.x - .5 + EPS && next + d.width / 2 > b.x - .5) allowed = Math.min(allowed, b.x - .5 - d.width / 2);
    if (amount < 0 && actor.x - d.width / 2 >= b.x + .5 - EPS && next - d.width / 2 < b.x + .5) allowed = Math.max(allowed, b.x + .5 + d.width / 2);
  }
  actor.x = allowed;
  if (Math.abs(allowed - next) > EPS) { actor.vx = 0; return false; }
  return true;
}
function moveActorY(s: Snapshot, actor: Actor, amount: number): void {
  const d = actorDimensions(actor), next = actor.y + amount;
  let allowed = next, landed: Block | undefined;
  for (const block of s.blocks) {
    const b = worldPosition(s, block);
    if (actor.x + d.width / 2 <= b.x - .5 + EPS || actor.x - d.width / 2 >= b.x + .5 - EPS) continue;
    if (amount <= 0 && actor.y >= b.y + .5 - EPS && next <= b.y + .5 && b.y + .5 > allowed - EPS && (!landed || preferLanding(s, actor.x, d.width, block, landed))) { allowed = b.y + .5; landed = block; }
    if (amount > 0 && actor.y + d.height <= b.y - .5 + EPS && next + d.height > b.y - .5) allowed = Math.min(allowed, b.y - .5 - d.height);
  }
  actor.y = allowed;
  if (landed) { actor.vy = 0; actor.support = {space: landed.space, x: landed.x, y: landed.y, blockId: landed.id}; if (actor.kind !== 'mob') actor.state = 'idle'; }
  else if (Math.abs(allowed - next) > EPS) actor.vy = 0;
}
function explode(s: Snapshot, mob: Actor): void {
  if (mob.explosionApplied) return;
  mob.explosionApplied = true; mob.state = 'exploded'; mob.hp = 0; mob.fuseTicks = 0; mob.vx = 0; mob.vy = 0; mob.support = null;
  const centerY = mob.y + actorDimensions(mob).height / 2, radius = R2_RULES.mobBlastRadius;
  const near = (x: number, y: number) => Math.hypot(x - mob.x, y - centerY) <= radius + EPS;
  if (near(s.player.x, s.player.y + rulesFor(s).playerHeight / 2)) s.player.hp = Math.max(0, s.player.hp - 1);
  if (near(s.house.x + 3, s.house.y - .75)) s.house.heartHp = Math.max(0, s.house.heartHp - 30);
  for (const block of [...s.blocks]) { const p = worldPosition(s, block); if (near(p.x, p.y)) damageBlock(s, block.id); }
  for (const actor of s.actors!) if (actor.actorKey !== mob.actorKey && actor.hp > 0 && near(actor.x, actor.y + actorDimensions(actor).height / 2)) destroyActor(s, actor);
}
function tickActors(s: Snapshot, houseDelta: number): void {
  for (const actor of s.actors!) {
    if (actor.state === 'exploded') { actor.state = 'removed'; continue; }
    if (actor.hp <= 0 || actor.state === 'held') continue;
    if (actor.support?.space === 'house' && resolveBlock(s, actor.support)?.id === actor.support.blockId) actor.x += houseDelta;
    if (!validActorSupport(s, actor)) actor.support = null;
    if (actor.kind === 'mob') {
      if (actor.state === 'armed') {
        actor.vx = 0;
      } else {
        const targetY = s.player.y + rulesFor(s).playerHeight / 2, ay = actor.y + actorDimensions(actor).height / 2;
        const visible = Math.hypot(s.player.x - actor.x, targetY - ay) <= R2_RULES.mobDetection && !s.blocks.some(block => { const p = worldPosition(s, block); return rayBox(actor.x, ay, s.player.x, targetY, p.x, p.y); });
        if (visible) actor.state = 'chase';
        if (actor.state === 'chase') actor.direction = s.player.x < actor.x ? -1 : 1;
        else if (actor.x <= 52 || actor.x >= 58) actor.direction = actor.x <= 52 ? 1 : -1;
        actor.vx = actor.direction * R2_RULES.mobSpeed;
        if (actor.state === 'chase' && actor.support && s.player.y - actor.y > 1.2 && Math.abs(s.player.x - actor.x) < 4.5) { actor.vy = R2_RULES.mobJumpSpeed; actor.support = null; }
      }
    } else if (actor.support) actor.vx = 0;
    if (!moveActorX(s, actor, actor.vx / R2_RULES.tickRate) && actor.kind === 'mob' && actor.state !== 'armed') actor.direction = actor.direction === 1 ? -1 : 1;
    if (!validActorSupport(s, actor)) actor.support = null;
    if (!actor.support) { actor.vy -= R2_RULES.gravity / R2_RULES.tickRate; moveActorY(s, actor, actor.vy / R2_RULES.tickRate); if (actor.kind !== 'mob' && !actor.support) actor.state = 'falling'; }
    if (actor.y < -4) { destroyActor(s, actor); continue; }
    if (actor.kind === 'mob' && actor.state !== 'armed' && Math.hypot(s.player.x - actor.x, s.player.y + R2_RULES.playerHeight / 2 - actor.y - .6) <= R2_RULES.mobArmDistance) { actor.state = 'armed'; actor.fuseTicks = R2_RULES.mobFuseTicks; actor.vx = 0; }
    else if (actor.kind === 'mob' && actor.state === 'armed') { actor.fuseTicks--; if (actor.fuseTicks === 0) explode(s, actor); }
  }
  syncHeldActor(s);
}
function tickR2(s: Snapshot, houseDelta: number): {player?: string; core?: string} {
  const beforePlayerHp = s.player.hp, beforeCoreHp = s.house.heartHp;
  tickActors(s, houseDelta);
  const reason: {player?: string; core?: string} = {};
  if (beforePlayerHp > 0 && s.player.hp === 0) reason.player = 'Игрок погиб от взрыва';
  if (beforeCoreHp > 0 && s.house.heartHp === 0) reason.core = 'Сердце дома разрушено взрывом';
  const lava = s.lava!; lava.x += R2_RULES.lavaSpeed / R2_RULES.tickRate;
  const playerContact = s.player.x - R2_RULES.playerWidth / 2 <= lava.x;
  lava.playerDamageTicks = playerContact ? lava.playerDamageTicks + 1 : 0;
  if (lava.playerDamageTicks >= R2_RULES.lavaIntervalTicks) { s.player.hp = Math.max(0, s.player.hp - 1); lava.playerDamageTicks = 0; if (s.player.hp === 0) reason.player = 'Игрок погиб в лаве'; }
  const coreContact = s.house.x + 3 - .4 <= lava.x;
  lava.coreDamageTicks = coreContact ? lava.coreDamageTicks + 1 : 0;
  if (lava.coreDamageTicks >= R2_RULES.lavaIntervalTicks) { s.house.heartHp = Math.max(0, s.house.heartHp - 25); lava.coreDamageTicks = 0; if (s.house.heartHp === 0) reason.core = 'Лава разрушила сердце дома'; }
  for (const actor of s.actors!) if (actor.hp > 0 && actor.x - actorDimensions(actor).width / 2 <= lava.x) destroyActor(s, actor);
  for (const block of [...s.blocks]) {
    if (block.material !== 'wood') continue;
    if (block.burnTicks! > 0) { block.burnTicks!--; if (block.burnTicks === 0) destroyBlock(s, block); }
    else if (worldPosition(s, block).x - .5 <= lava.x) block.burnTicks = R2_RULES.burnTicks;
  }
  return reason;
}
export function actorSaved(s: Snapshot, kind: 'cat' | 'chest'): boolean {
  if (!isR2(s) || s.outcome !== 'won') return false;
  const actor = s.actors!.find(item => item.kind === kind)!;
  return actor.hp > 0 && (actor.support?.space === 'house' || actor.state === 'held' && s.player.heldActorKey === actor.actorKey && s.player.hp > 0 && s.player.support?.space === 'house');
}

function restoreR2(raw: unknown): Snapshot {
  const r = object(raw, 'snapshot');
  exactKeys(r, ['schemaVersion','contentVersion','rulesVersion','runId','tick','outcome','reason','house','player','inventory','blocks','nextBlockId','actors','lava','tutorialPlacements','destroyedMaterials'], 'snapshot');
  if (r.schemaVersion !== 1 || r.contentVersion !== 'r2-map-1' || r.rulesVersion !== 'r2-rules-1') throw new Error('Unsupported R2 snapshot/content/rules version');
  const rules = R2_RULES, baseline = baselines.get('r2-map-1')!;
  string(r.runId, 'runId', 96); number(r.tick, 'tick', 0, 10_000_000, true);
  enumValue(r.outcome, ['playing','won','lost'], 'outcome');
  if (r.reason !== null) string(r.reason, 'reason', 300);
  if ((r.outcome === 'playing') !== (r.reason === null)) throw new Error('Outcome reason does not match state');
  const h = object(r.house, 'house'); exactKeys(h, ['x','y','heartHp','motion','supportTimer'], 'house');
  number(h.x, 'house.x', 2, rules.portalX - 3 + EPS); if (h.y !== rules.houseY) throw new Error('house.y: incompatible map');
  number(h.heartHp, 'heartHp', 0, 100, true); enumValue(h.motion, ['moving','gap','unsupported','portal'], 'motion'); number(h.supportTimer, 'supportTimer', 0, rules.supportGrace);
  const p = object(r.player, 'player'); exactKeys(p, ['x','y','vx','vy','hp','support','jumpHeld','heldActorKey','actionCooldownTicks'], 'player');
  number(p.x, 'player.x', -40, 180); number(p.y, 'player.y', -10, 30); number(p.vx, 'player.vx', -rules.moveSpeed - rules.houseSpeed - EPS, rules.moveSpeed + rules.houseSpeed + EPS); number(p.vy, 'player.vy', -80, rules.slimeBounceSpeed + EPS); number(p.hp, 'player.hp', 0, 3, true);
  if (typeof p.jumpHeld !== 'boolean') throw new Error('jumpHeld: expected boolean');
  if (p.heldActorKey !== null) string(p.heldActorKey, 'heldActorKey', 96);
  number(p.actionCooldownTicks, 'actionCooldownTicks', 0, rules.actionDelayTicks, true);
  const inv = object(r.inventory, 'inventory'), destroyed = object(r.destroyedMaterials, 'destroyedMaterials');
  exactKeys(inv, ['wood','stone','slime'], 'inventory'); exactKeys(destroyed, ['wood','stone','slime'], 'destroyedMaterials');
  for (const material of ['wood','stone','slime'] as const) { number(inv[material], `inventory.${material}`, 0, rules.inventoryCap, true); number(destroyed[material], `destroyedMaterials.${material}`, 0, baseline.originalCount, true); }
  if (inventoryTotal(inv as unknown as Inventory) > rules.inventoryCap) throw new Error('Combined inventory capacity exceeded');
  number(r.nextBlockId, 'nextBlockId', 1, 10_000_000, true); number(r.tutorialPlacements, 'tutorialPlacements', 0, 2, true);
  if (!Array.isArray(r.blocks) || r.blocks.length > 650) throw new Error('blocks: invalid list');
  const ids = new Set<string>(), cells = new Set<string>();
  for (const [i, value] of r.blocks.entries()) {
    const b = object(value, `blocks[${i}]`); exactKeys(b, ['space','x','y','id','material','originalId','portable','durability','burnTicks'], `blocks[${i}]`);
    enumValue(b.space, ['house','world'], 'space'); number(b.x, 'block.x', -10, 140, true); number(b.y, 'block.y', 0, 12, true);
    if (!validCell(b as unknown as Cell, r as unknown as Snapshot)) throw new Error('Block outside R2 map bounds');
    const id = string(b.id, 'block.id', 96), material = enumValue(b.material, ['wood','stone','slime'], 'material');
    if (typeof b.portable !== 'boolean') throw new Error('portable: expected boolean');
    number(b.durability, 'durability', 1, MATERIALS[material].durability, true); number(b.burnTicks, 'burnTicks', 0, MATERIALS[material].burnTicks, true);
    if (ids.has(id) || cells.has(key(b as unknown as Cell))) throw new Error('Duplicate block ID or cell');
    ids.add(id); cells.add(key(b as unknown as Cell));
    const original = baseline.byId.get(id);
    if (original) {
      for (const field of ['space','x','y','id','material','originalId','portable'] as const) if (b[field] !== original[field]) throw new Error('Base identity was modified');
    } else if (!/^placed:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || b.originalId !== null || b.portable !== true) throw new Error('Invalid placed block identity');
    if (b.originalId !== null && (!original || b.originalId !== original.originalId)) throw new Error('Original identity cannot be reconstructed');
  }
  for (const material of ['wood','stone','slime'] as const) {
    const budget = baseline.blocks.filter(block => block.portable && block.material === material).length;
    const current = r.blocks.filter(value => (value as Block).portable && (value as Block).material === material).length;
    if (current + (inv[material] as number) + (destroyed[material] as number) !== budget) throw new Error(`Material conservation failed: ${material}`);
  }
  const lava = object(r.lava, 'lava'); exactKeys(lava, ['x','playerDamageTicks','coreDamageTicks'], 'lava');
  number(lava.x, 'lava.x', -17, 130000); number(lava.playerDamageTicks, 'playerDamageTicks', 0, 59, true); number(lava.coreDamageTicks, 'coreDamageTicks', 0, 59, true);
  const expectedLava = -17 + (r.tick as number) * rules.lavaSpeed / rules.tickRate;
  if (Math.abs((lava.x as number) - expectedLava) > 1e-5) throw new Error('Lava position does not match simulation tick');
  if (!Array.isArray(r.actors) || r.actors.length !== 3) throw new Error('actors: the versioned actor set is required');
  const actorKeys = new Set<string>(), actorBaseline = initialActors();
  for (const [i, value] of r.actors.entries()) {
    const actor = object(value, `actors[${i}]`); exactKeys(actor, ['actorKey','kind','x','y','vx','vy','hp','support','state','direction','fuseTicks','explosionApplied'], `actors[${i}]`);
    const identity = actorBaseline.find(item => item.actorKey === actor.actorKey);
    if (!identity || actor.kind !== identity.kind || actorKeys.has(identity.actorKey)) throw new Error('Actor identity is invalid or duplicated');
    actorKeys.add(identity.actorKey);
    number(actor.x, 'actor.x', -40, 180); number(actor.y, 'actor.y', -10, 30); number(actor.vx, 'actor.vx', -6, 6); number(actor.vy, 'actor.vy', -80, rules.mobJumpSpeed + EPS); number(actor.hp, 'actor.hp', 0, 1, true);
    if (actor.direction !== -1 && actor.direction !== 1 || typeof actor.explosionApplied !== 'boolean') throw new Error('Actor direction/explosion flag invalid');
    number(actor.fuseTicks, 'fuseTicks', 0, rules.mobFuseTicks, true);
    if (actor.kind === 'mob') {
      enumValue(actor.state, ['patrol','chase','armed','exploded','removed'], 'mob.state');
      if (actor.state === 'armed' && ((actor.fuseTicks as number) < 1 || actor.explosionApplied || actor.hp !== 1)) throw new Error('Armed mob must have a live one-shot fuse');
      if (['patrol','chase'].includes(actor.state as string) && (actor.fuseTicks !== 0 || actor.explosionApplied || actor.hp !== 1)) throw new Error('Unarmed mob has invalid fuse/state');
      if (['exploded','removed'].includes(actor.state as string) && (actor.fuseTicks !== 0 || actor.hp !== 0 || actor.support !== null)) throw new Error('Removed mob has invalid state');
      if (actor.state === 'exploded' && actor.explosionApplied !== true) throw new Error('Explosion application flag is required');
    } else {
      enumValue(actor.state, ['idle','falling','held','destroyed'], 'item.state');
      if (actor.fuseTicks !== 0 || actor.explosionApplied !== false || (actor.state === 'destroyed') !== (actor.hp === 0)) throw new Error('Item state is invalid');
      if ((actor.state === 'idle') !== (actor.support !== null)) throw new Error('Item support does not match state');
    }
  }
  const s = structuredClone(raw) as Snapshot;
  for (const block of s.blocks) { const p = worldPosition(s, block); if (overlapsChassis(s, p.x, p.y)) throw new Error('Block intersects reserved chassis'); }
  if (!chassisClear(s, s.house.x)) throw new Error('Fixed world block intersects house');
  const checkSupport = (value: unknown, path: string): void => {
    if (value === null) return;
    const support = object(value, path); exactKeys(support, ['space','x','y','blockId'], path);
    enumValue(support.space, ['house','world'], `${path}.space`); number(support.x, `${path}.x`, -10, 140, true); number(support.y, `${path}.y`, 0, 12, true); string(support.blockId, `${path}.blockId`, 96);
    if (resolveBlock(s, support as unknown as Cell)?.id !== support.blockId) throw new Error('Support refers to a missing/replaced block');
  };
  checkSupport(p.support, 'player.support');
  if (p.support !== null && (!supportExists(s) || p.vy !== 0)) throw new Error('Player support/position invalid');
  for (const actor of s.actors!) { checkSupport(actor.support, 'actor.support'); if (actor.support && (!validActorSupport(s, actor) || actor.vy !== 0)) throw new Error('Actor support/position invalid'); }
  const held = s.actors!.filter(actor => actor.state === 'held');
  if (held.length > 1 || (p.heldActorKey === null) !== (held.length === 0) || held.length === 1 && held[0].actorKey !== p.heldActorKey) throw new Error('Held actor reference does not match actor state');
  if (held[0] && (held[0].kind === 'mob' || Math.abs(held[0].x - s.player.x) > EPS || Math.abs(held[0].y - s.player.y - .65) > EPS || held[0].vx !== s.player.vx || held[0].vy !== s.player.vy)) throw new Error('Held actor position is invalid');
  if ((r.tutorialPlacements as number) < 2 && (r.tick !== 0 || h.x !== 2 || p.actionCooldownTicks !== 0)) throw new Error('Tutorial time must remain frozen');
  if (s.outcome === 'won' && !(s.house.x + 3 >= rules.portalX - EPS && s.player.hp > 0 && s.house.heartHp > 0 && s.player.support?.space === 'house')) throw new Error('Victory predicate does not match snapshot');
  if (s.outcome === 'lost' && s.player.hp > 0 && s.house.heartHp > 0) throw new Error('Loss predicate does not match snapshot');
  if (s.outcome === 'playing' && (s.player.hp <= 0 || s.house.heartHp <= 0)) throw new Error('Dead run cannot remain playing');
  return s;
}
