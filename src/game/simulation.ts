import { DEFAULT_CONFIG, DEFAULT_SHOP_ZONE, FIXED_STEP, type SimulationConfig, type ShopZoneConfig } from './config';

export type Point = { x: number; z: number };
export type Command = { type: 'move'; axis: number } | { type: 'cast'; aim: Point } | { type: 'enterShop'; shopId: string; offset?: number };
export type DeathReason = 'contact' | 'breach' | 'projectile' | 'abandoned';
export type EnemyKind = 'normal' | 'strong' | 'boss';
export interface Shooting {
  phase: 'cooldown' | 'telegraph';
  remaining: number;
  /** Normalized world directions. Boss locks them before its warning starts. */
  directions: Point[];
}
export interface Enemy extends Point {
  id: string;
  kind: EnemyKind;
  radius: number;
  status: 'alive' | 'captured';
  requiredHits: number;
  hitsRemaining: number;
  hitCastIds: string[];
  shooting: Shooting | null;
}
export interface Projectile extends Point {
  id: string;
  sourceEnemyId: string;
  velocity: Point;
  radius: number;
  lifetimeRemaining: number;
}
export interface ShopCandidate extends Point {
  id: string;
  at: number;
}
export interface HookConfig {
  readonly range: number;
  readonly outboundSpeed: number;
  readonly returnSpeed: number;
  readonly cooldown: number;
  readonly radius: number;
  readonly pierceTargets: number;
  readonly returnHitTargets: number;
  readonly goldMultiplierMilli: number;
}
export interface Hook extends Point {
  castId: string;
  phase: 'outbound' | 'returning';
  readonly direction: Readonly<Point>;
  traveled: number;
  capturedEnemyId: string | null;
  capturedEnemyIds: string[];
  hitEnemyIds: string[];
  outboundHits: number;
  returnHits: number;
  readonly config: Readonly<HookConfig>;
}
export interface GameEvent {
  type: 'cast' | 'castRejected' | 'hit' | 'returned' | 'spawn' | 'gameOver' | 'telegraph' | 'shoot' | 'shopCandidate' | 'shopEntered' | 'shopLeft' | 'consumed';
  at: number;
  castId?: string;
  enemyId?: string;
  reason?: DeathReason;
  lethal?: boolean;
  kind?: EnemyKind;
  projectileId?: string;
  shopId?: string;
  definitionId?: string;
  /** Exact total gold multiplier at this lethal event, before collector decrement. */
  goldMultiplierMilli?: number;
}
export interface RunState {
  runId: string;
  seed: number;
  phase: 'running' | 'paused' | 'shop' | 'gameOver';
  tick: number;
  time: number;
  distance: number;
  hero: Point;
  enemies: Enemy[];
  projectiles: Projectile[];
  shopCandidates: ShopCandidate[];
  usedShopIds: string[];
  activeShopId: string | null;
  effects: CombatEffects;
  hook: Hook | null;
  cooldownRemaining: number;
  kills: { normal: number; strong: number; boss: number };
  deathReason: DeathReason | null;
  events: GameEvent[];
}
export interface SimulationOptions {
  config?: Partial<SimulationConfig>;
  shopZone?: Partial<ShopZoneConfig>;
  initialEnemies?: Array<Point & { id?: string; kind?: EnemyKind; requiredHits?: number; hitsRemaining?: number; shooting?: Shooting | null }>;
  initialProjectiles?: Projectile[];
}


export interface EquipmentModifiers {
  rangeMultiplier: number; outboundSpeedMultiplier: number; returnSpeedMultiplier: number;
  cooldown: number; lateralSpeedMultiplier: number; pierceTargets: number; returnHitTargets: number; goldMultiplierMilli: number;
}
export interface CombatEffects {
  slowRemaining: number; slowedEnemyIds: string[]; slowedProjectileIds: string[]; collectorKillsRemaining: number;
}
export interface SimulationSnapshot {
  version: 'r34.1'; state: RunState; config: SimulationConfig; shopZone: ShopZoneConfig; equipment: EquipmentModifiers;
  randomState: number; counters: { enemy: number; cast: number; projectile: number; shop: number };
  generator: { spawnDistanceRemaining: number; bossAt: number; shopDistanceRemaining: number };
}
export class SimulationRuleError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = 'SimulationRuleError'; }
}
const emptyEffects = (): CombatEffects => ({ slowRemaining: 0, slowedEnemyIds: [], slowedProjectileIds: [], collectorKillsRemaining: 0 });
const validateEquipment = (value: EquipmentModifiers): Readonly<EquipmentModifiers> => {
  const keys = ['rangeMultiplier', 'outboundSpeedMultiplier', 'returnSpeedMultiplier', 'cooldown', 'lateralSpeedMultiplier', 'pierceTargets', 'returnHitTargets', 'goldMultiplierMilli'];
  if (!value || typeof value !== 'object' || Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) throw new SimulationRuleError('invalid_modifiers');
  for (const key of keys) {
    const n = value[key as keyof EquipmentModifiers];
    if (!Number.isFinite(n) || n < 0 || n > 10000) throw new SimulationRuleError('invalid_modifiers');
  }
  if (value.rangeMultiplier <= 0 || value.outboundSpeedMultiplier <= 0 || value.returnSpeedMultiplier <= 0 || value.lateralSpeedMultiplier <= 0 ||
    value.rangeMultiplier > 4 || value.outboundSpeedMultiplier > 4 || value.returnSpeedMultiplier > 4 || value.lateralSpeedMultiplier > 4 ||
    ![1, 2].includes(value.pierceTargets) || ![0, 1].includes(value.returnHitTargets) || value.pierceTargets > 1 && value.returnHitTargets > 0 ||
    !Number.isInteger(value.goldMultiplierMilli) || value.goldMultiplierMilli < 1000 || value.goldMultiplierMilli > 4000) throw new SimulationRuleError('invalid_modifiers');
  return Object.freeze({ ...value });
};

export interface SpawnAssessment { accepted: boolean; reason: 'ok' | 'capacity' | 'deadline' | 'corridor' | 'position'; }

type Motion = { hero: Point; hook: Point; intercept: number | null };
type EventKind = 'shopEnter' | 'effectExpired' | 'hit' | 'contact' | 'breach' | 'projectileHit' | 'projectileExpired' | 'range' | 'return' | 'boundary' | 'spawn' | 'shotStart' | 'shotRelease' | 'shop';
type CollisionEvent = { kind: EventKind; time: number; id: string; priority: number };
const EPSILON = 1e-9;
const ZERO: Point = Object.freeze({ x: 0, z: 0 });
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const normalize = (point: Point): Point => {
  const length = Math.hypot(point.x, point.z);
  return length > EPSILON ? { x: point.x / length, z: point.z / length } : { x: 0, z: -1 };
};

/** Isolated one-hit rule. A missed or already removed projectile cannot kill. */
export function resolveHeroProjectileHit(state: RunState, projectileId: string): boolean {
  const projectile = state.projectiles.find((candidate) => candidate.id === projectileId);
  if (state.phase !== 'running' || !projectile) return false;
  state.phase = 'gameOver';
  state.deathReason = 'projectile';
  state.hook = null;
  state.effects = emptyEffects();
  state.activeShopId = null;
  state.events.push({ type: 'gameOver', at: state.time, reason: 'projectile', enemyId: projectile.sourceEnemyId, projectileId });
  return true;
}

/** First contact between two linearly moving circles, including a contact at t=0. */
function sweptContact(relative: Point, velocity: Point, radius: number): number | null {
  const c = relative.x ** 2 + relative.z ** 2 - radius ** 2;
  if (c <= EPSILON) return 0;
  const a = velocity.x ** 2 + velocity.z ** 2;
  if (a < EPSILON) return null;
  const b = 2 * (relative.x * velocity.x + relative.z * velocity.z);
  if (b >= 0) return null;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -EPSILON) return null;
  const time = (-b - Math.sqrt(Math.max(0, discriminant))) / (2 * a);
  return time >= -EPSILON ? Math.max(0, time) : null;
}

/** Intercept the moving hero at the configured world-space return speed. */
function returnMotion(hook: Hook, hero: Point, velocity: Point): { velocity: Point; time: number } {
  const dx = hero.x - hook.x;
  const dz = hero.z - hook.z;
  const c = dx * dx + dz * dz;
  if (c <= EPSILON ** 2) return { velocity: ZERO, time: 0 };
  const speed = hook.config.returnSpeed;
  const a = velocity.x ** 2 + velocity.z ** 2 - speed ** 2;
  const b = 2 * (dx * velocity.x + dz * velocity.z);
  // Return speed exceeds hero speed in the accepted balance. Handle custom slower
  // configurations without NaNs: pursue the current position until next step.
  const discriminant = b * b - 4 * a * c;
  let time = Infinity;
  if (Math.abs(a) < EPSILON) {
    if (b < -EPSILON) time = -c / b;
  } else if (discriminant >= 0) {
    const roots = [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)];
    time = Math.min(...roots.filter((t) => t >= 0));
  }
  const tx = Number.isFinite(time) ? dx + velocity.x * time : dx;
  const tz = Number.isFinite(time) ? dz + velocity.z * time : dz;
  const length = Math.hypot(tx, tz);
  return { velocity: { x: tx / length * speed, z: tz / length * speed }, time };
}

/** Pure fixed-step combat. Call once per logic tick; rendering never advances it. */
export class RunSimulation {
  readonly state: RunState;
  readonly config: Readonly<SimulationConfig>;
  readonly shopZone: Readonly<ShopZoneConfig>;
  private equipment: Readonly<EquipmentModifiers>;
  private randomState: number;
  private enemySequence = 0;
  private castSequence = 0;
  private projectileSequence = 0;
  private shopSequence = 0;
  private spawnDistanceRemaining: number;
  private bossAt: number;
  private shopDistanceRemaining: number;

  constructor(runId: string, seed: number, options: SimulationOptions = {}) {
    if (!runId) throw new Error('runId is required');
    if (!Number.isFinite(seed)) throw new Error('seed must be finite');
    const config = { ...DEFAULT_CONFIG, ...options.config };
    for (const [name, value] of Object.entries(config)) {
      if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
        throw new Error(`Invalid simulation setting: ${name}`);
      }
    }
    if (config.spawnMinSeconds <= 0 || config.spawnMaxSeconds < config.spawnMinSeconds ||
        config.hookOutboundSpeed <= 0 || config.hookReturnSpeed <= 0 || config.hookRange <= 0 ||
        !Number.isInteger(config.maxEnemies) || config.maxEnemies < 1 ||
        !Number.isInteger(config.bossRequiredHits) || config.bossRequiredHits < 3 ||
        !Number.isInteger(config.maxShooters) || config.maxShooters < 0 ||
        !Number.isInteger(config.maxBosses) || config.maxBosses < 0 || config.maxBosses > 1 ||
        !Number.isInteger(config.maxProjectiles) || config.maxProjectiles < 3 ||
        config.shooterTelegraph <= 0 || config.bossTelegraph <= 0 ||
        config.shooterInterval < config.shooterTelegraph || config.bossInterval < config.bossTelegraph ||
        config.projectileSpeed <= 0 || config.projectileLifetime <= 0 || config.spawnRetrySeconds <= 0 ||
        config.shopMinInterval <= 0 || config.shopMaxInterval < config.shopMinInterval ||
        config.bossMaxInterval < config.bossMinInterval || !Number.isInteger(config.bossMinKills) || config.bossMinKills < 0 ||
        config.heroRadius <= 0 || config.enemyRadius <= 0 || config.strongRadius <= 0 || config.bossRadius <= 0 ||
        config.projectileRadius <= 0 || config.lateralLimit <= 0 || config.spawnDistance <= 0 || config.bossVolleyDegrees > 90) {
      throw new Error('Invalid simulation timing or capacity');
    }
    this.config = Object.freeze(config);
    this.shopZone = Object.freeze({ ...DEFAULT_SHOP_ZONE, ...options.shopZone });
    if (Object.keys(this.shopZone).length !== 2 || Object.values(this.shopZone).some(n => !Number.isFinite(n) || n <= 0 || n > 10)) throw new Error('Invalid shop zone');
    this.equipment = validateEquipment({ rangeMultiplier: 1, outboundSpeedMultiplier: 1, returnSpeedMultiplier: 1, cooldown: config.hookCooldown, lateralSpeedMultiplier: 1, pierceTargets: 1, returnHitTargets: 0, goldMultiplierMilli: 1000 });
    this.randomState = seed >>> 0;
    this.spawnDistanceRemaining = this.nextSpawnDelay() * this.streamSpeed;
    this.bossAt = config.bossFirstSeconds;
    this.shopDistanceRemaining = this.randomInterval(config.shopMinInterval, config.shopMaxInterval) * this.streamSpeed;
    this.state = {
      runId, seed, phase: 'running', tick: 0, time: 0, distance: 0,
      hero: { x: 0, z: 0 }, enemies: [], projectiles: [], shopCandidates: [], usedShopIds: [], activeShopId: null, effects: emptyEffects(), hook: null, cooldownRemaining: 0,
      kills: { normal: 0, strong: 0, boss: 0 }, deathReason: null, events: [],
    };
    for (const enemy of options.initialEnemies ?? []) {
      if (!Number.isFinite(enemy.x) || !Number.isFinite(enemy.z)) throw new Error('Invalid enemy position');
      const kind = enemy.kind ?? 'normal';
      if (!['normal', 'strong', 'boss'].includes(kind)) throw new Error('Invalid enemy kind');
      const created = this.makeEnemy(enemy.x, enemy.z, enemy.id, kind);
      if (enemy.requiredHits !== undefined) {
        if (!Number.isInteger(enemy.requiredHits) || enemy.requiredHits < (kind === 'boss' ? 3 : 1) ||
          (kind !== 'boss' && enemy.requiredHits !== 1)) throw new Error('Invalid requiredHits');
        created.requiredHits = enemy.requiredHits;
        created.hitsRemaining = enemy.requiredHits;
      }
      if (enemy.hitsRemaining !== undefined) {
        if (!Number.isInteger(enemy.hitsRemaining) || enemy.hitsRemaining < 1 || enemy.hitsRemaining > created.requiredHits) {
          throw new Error('Invalid hitsRemaining');
        }
        created.hitsRemaining = enemy.hitsRemaining;
      }
      if (enemy.shooting !== undefined) {
        if (kind === 'normal' && enemy.shooting !== null) throw new Error('Normal enemies cannot shoot');
        if (enemy.shooting && (!Number.isFinite(enemy.shooting.remaining) || enemy.shooting.remaining < 0 ||
          !['cooldown', 'telegraph'].includes(enemy.shooting.phase))) throw new Error('Invalid shooting state');
        if (enemy.shooting?.phase === 'telegraph' && (enemy.shooting.directions.length !== (kind === 'boss' ? 3 : 1) ||
          enemy.shooting.directions.some((direction) => !Number.isFinite(direction.x) || !Number.isFinite(direction.z) ||
            Math.abs(Math.hypot(direction.x, direction.z) - 1) > EPSILON))) throw new Error('Invalid telegraph directions');
        created.shooting = structuredClone(enemy.shooting);
      }
      this.state.enemies.push(created);
    }
    if (new Set(this.state.enemies.map((enemy) => enemy.id)).size !== this.state.enemies.length) {
      throw new Error('Enemy IDs must be unique');
    }
    for (const projectile of options.initialProjectiles ?? []) {
      if (![projectile.x, projectile.z, projectile.velocity.x, projectile.velocity.z, projectile.radius, projectile.lifetimeRemaining].every(Number.isFinite) ||
        projectile.radius < 0 || projectile.lifetimeRemaining <= 0) throw new Error('Invalid projectile');
      this.state.projectiles.push(structuredClone(projectile));
    }
    if (this.state.projectiles.length + this.reservedProjectiles() > config.maxProjectiles || new Set(this.state.projectiles.map((item) => item.id)).size !== this.state.projectiles.length) {
      throw new Error('Invalid projectile capacity or IDs');
    }
  }

  get canCast(): boolean {
    return this.state.phase === 'running' && this.state.hook === null && this.state.cooldownRemaining <= EPSILON;
  }

  get availableShop(): ShopCandidate | null { return this.state.shopCandidates.find(candidate => this.shop(candidate.id) !== null) ?? null; }
  get canEnterShop(): boolean { return this.availableShop !== null; }
  shop(id: string): ShopCandidate | null {
    if (this.state.phase !== 'running' || this.state.usedShopIds.includes(id)) return null;
    const candidate = this.state.shopCandidates.find(shop => shop.id === id);
    return candidate && Math.abs(candidate.x - this.state.hero.x) <= this.shopZone.lateralRadius + EPSILON &&
      Math.abs(candidate.z - this.state.hero.z) <= this.shopZone.longitudinalRadius + EPSILON ? candidate : null;
  }
  /** Resolve combat at the current instant before a direct UI/server transition. No tick is advanced. */
  enterShop(id: string): boolean {
    if (this.state.phase !== 'running') return false;
    while (this.state.phase === 'running') {
      const event = this.nextEvent(this.motion(0), 0);
      if (!event) break;
      this.resolve(event);
    }
    return this.enterShopNow(id);
  }
  private enterShopNow(id: string): boolean {
    if (!this.shop(id)) return false;
    this.state.phase = 'shop';
    this.state.activeShopId = id;
    this.state.usedShopIds.push(id);
    this.state.events.push({ type: 'shopEntered', at: this.state.time, shopId: id });
    return true;
  }
  leaveShop(): boolean {
    if (this.state.phase !== 'shop') return false;
    this.state.events.push({ type: 'shopLeft', at: this.state.time, shopId: this.state.activeShopId! });
    this.state.activeShopId = null;
    this.state.phase = 'paused';
    return true;
  }
  setEquipment(modifiers: EquipmentModifiers): void {
    const next = validateEquipment(modifiers);
    if (this.state.phase === 'running' && (this.state.tick > 0 || this.state.hook !== null)) throw new SimulationRuleError('equipment_unavailable');
    this.equipment = next;
  }
  applyConsumable(definitionId: string): true {
    if (!['slow_dust', 'collector_vial'].includes(definitionId)) throw new SimulationRuleError('invalid_consumable');
    if (this.state.phase !== 'running') throw new SimulationRuleError('consumable_unavailable');
    if (definitionId === 'collector_vial') {
      if (this.state.effects.collectorKillsRemaining > 0) throw new SimulationRuleError('effect_active');
      this.state.effects.collectorKillsRemaining = 10;
    } else {
      this.state.effects.slowRemaining = 3;
      this.state.effects.slowedEnemyIds = this.state.enemies.filter(enemy => enemy.status === 'alive').map(enemy => enemy.id);
      this.state.effects.slowedProjectileIds = this.state.projectiles.map(projectile => projectile.id);
    }
    this.state.events.push({ type: 'consumed', at: this.state.time, definitionId });
    return true;
  }
  abandon(): void {
    if (this.state.phase === 'gameOver') return;
    this.state.phase = 'gameOver'; this.state.deathReason = 'abandoned'; this.state.hook = null;
    this.state.effects = emptyEffects(); this.state.activeShopId = null;
    this.state.events.push({ type: 'gameOver', at: this.state.time, reason: 'abandoned' });
  }
  pause(): void { if (this.state.phase === 'running') this.state.phase = 'paused'; }
  resume(): void { if (this.state.phase === 'paused') this.state.phase = 'running'; }

  step(commands: readonly Command[] = []): void {
    if (this.state.phase !== 'running') return;
    // Reject invalid shop timing before any input/cast or tick mutation.
    for (const command of commands) if (command.type === 'enterShop' &&
      (typeof command.shopId !== 'string' || !command.shopId || !Number.isFinite(command.offset ?? 0) || (command.offset ?? 0) < 0 || (command.offset ?? 0) > FIXED_STEP)) {
      throw new SimulationRuleError('invalid_shop_command');
    }
    this.state.events = [];
    let axis = 0;
    const entries: Array<{ shopId: string; at: number }> = [];
    for (const command of commands) {
      if (command.type === 'move') axis = Number.isFinite(command.axis) ? clamp(command.axis, -1, 1) : 0;
      else if (command.type === 'cast') this.cast(command.aim);
      else entries.push({ shopId: command.shopId, at: this.state.time + (command.offset ?? 0) });
    }
    this.state.tick += 1;
    let remaining = FIXED_STEP;
    // Same-time hit/death events are resolved even at the tick boundary. Shop
    // is lower priority than death and stops the segment exactly at its time.
    while (this.state.phase === 'running') {
      const motion = this.motion(axis);
      const event = this.nextEvent(motion, remaining, entries);
      const elapsed = event ? clamp(event.time, 0, remaining) : remaining;
      this.advance(motion, elapsed);
      remaining = Math.max(0, remaining - elapsed);
      if (!event) break;
      if (event.kind === 'shopEnter') {
        const index = entries.findIndex(entry => entry.shopId === event.id && Math.abs(entry.at - this.state.time) <= EPSILON);
        if (index >= 0) entries.splice(index, 1);
        this.enterShopNow(event.id);
      } else this.resolve(event);
    }
  }

  exportSnapshot(): SimulationSnapshot {
    return structuredClone({
      version: 'r34.1', state: this.state, config: this.config, shopZone: this.shopZone, equipment: this.equipment,
      randomState: this.randomState,
      counters: { enemy: this.enemySequence, cast: this.castSequence, projectile: this.projectileSequence, shop: this.shopSequence },
      generator: { spawnDistanceRemaining: this.spawnDistanceRemaining, bossAt: this.bossAt, shopDistanceRemaining: this.shopDistanceRemaining },
    });
  }

  static restore(value: unknown): RunSimulation {
    const snapshot = validateSnapshot(value);
    const simulation = new RunSimulation(snapshot.state.runId, snapshot.state.seed, { config: snapshot.config, shopZone: snapshot.shopZone });
    Object.assign(simulation.state, structuredClone(snapshot.state));
    simulation.equipment = validateEquipment(snapshot.equipment);
    if (simulation.state.hook) {
      Object.freeze(simulation.state.hook.config); Object.freeze(simulation.state.hook.direction);
    }
    simulation.randomState = snapshot.randomState;
    simulation.enemySequence = snapshot.counters.enemy; simulation.castSequence = snapshot.counters.cast;
    simulation.projectileSequence = snapshot.counters.projectile; simulation.shopSequence = snapshot.counters.shop;
    simulation.spawnDistanceRemaining = snapshot.generator.spawnDistanceRemaining;
    simulation.bossAt = snapshot.generator.bossAt; simulation.shopDistanceRemaining = snapshot.generator.shopDistanceRemaining;
    return simulation;
  }

  private cast(aim: Point): void {
    if (!this.canCast) {
      this.state.events.push({ type: 'castRejected', at: this.state.time });
      return;
    }
    const dx = aim.x - this.state.hero.x;
    const dz = aim.z - this.state.hero.z;
    const length = Math.hypot(dx, dz);
    // The attack projects forward from the hero, never from the camera. Invalid,
    // zero-length and rearward aims do not consume the ability.
    if (!Number.isFinite(length) || length <= EPSILON || dz <= 0) return;
    const settings = Object.freeze({
      range: this.config.hookRange * this.equipment.rangeMultiplier, outboundSpeed: this.config.hookOutboundSpeed * this.equipment.outboundSpeedMultiplier,
      returnSpeed: this.config.hookReturnSpeed * this.equipment.returnSpeedMultiplier, cooldown: this.equipment.cooldown,
      radius: this.config.hookRadius, pierceTargets: this.equipment.pierceTargets, returnHitTargets: this.equipment.returnHitTargets, goldMultiplierMilli: this.equipment.goldMultiplierMilli,
    });
    const castId = `${this.state.runId}:cast:${++this.castSequence}`;
    this.state.hook = {
      ...this.state.hero, castId, phase: 'outbound',
      direction: Object.freeze({ x: dx / length, z: dz / length }),
      traveled: 0, capturedEnemyId: null, capturedEnemyIds: [], hitEnemyIds: [], outboundHits: 0, returnHits: 0, config: settings,
    };
    this.state.cooldownRemaining = settings.cooldown;
    this.state.events.push({ type: 'cast', at: this.state.time, castId });
  }

  private motion(axis: number): Motion {
    const { hero, hook } = this.state;
    let vx = axis * this.config.lateralSpeed * this.equipment.lateralSpeedMultiplier;
    if ((hero.x >= this.config.lateralLimit - EPSILON && vx > 0) ||
        (hero.x <= -this.config.lateralLimit + EPSILON && vx < 0)) vx = 0;
    const heroVelocity = { x: vx, z: this.config.heroSpeed };
    if (!hook) return { hero: heroVelocity, hook: ZERO, intercept: null };
    if (hook.phase === 'outbound') return {
      hero: heroVelocity,
      hook: { x: hook.direction.x * hook.config.outboundSpeed, z: hook.direction.z * hook.config.outboundSpeed },
      intercept: null,
    };
    const returning = returnMotion(hook, hero, heroVelocity);
    return { hero: heroVelocity, hook: returning.velocity, intercept: returning.time };
  }

  private nextEvent(motion: Motion, horizon: number, entries: Array<{ shopId: string; at: number }> = []): CollisionEvent | null {
    const candidates: CollisionEvent[] = [];
    const add = (kind: EventKind, time: number | null, id: string, priority: number) => {
      if (time !== null && Number.isFinite(time) && time >= -EPSILON && time <= horizon + EPSILON) {
        candidates.push({ kind, time: Math.max(0, time), id, priority });
      }
    };
    const { hero, hook } = this.state;
    for (const enemy of this.state.enemies) {
      if (enemy.status !== 'alive') continue;
      const enemySpeed = this.enemySpeed(enemy);
      add('contact', sweptContact(
        { x: enemy.x - hero.x, z: enemy.z - hero.z },
        { x: -motion.hero.x, z: -enemySpeed - motion.hero.z },
        enemy.radius + this.config.heroRadius,
      ), enemy.id, 1);
      const gap = enemy.z - hero.z + this.config.breachOffset;
      const closing = enemySpeed + motion.hero.z;
      add('breach', gap <= EPSILON ? 0 : closing > 0 ? gap / closing : null, enemy.id, 1);
      if (hook && !hook.hitEnemyIds.includes(enemy.id) && !enemy.hitCastIds.includes(hook.castId) &&
        (hook.phase === 'outbound' && hook.outboundHits < hook.config.pierceTargets || hook.phase === 'returning' && hook.returnHits < hook.config.returnHitTargets)) add('hit', sweptContact(
        { x: enemy.x - hook.x, z: enemy.z - hook.z },
        { x: -motion.hook.x, z: -enemySpeed - motion.hook.z },
        enemy.radius + hook.config.radius,
      ), enemy.id, 0);
      if (enemy.shooting) add(enemy.shooting.phase === 'telegraph' ? 'shotRelease' : 'shotStart', enemy.shooting.remaining, enemy.id, 4);
    }
    for (const projectile of this.state.projectiles) {
      add('projectileHit', sweptContact(
        { x: projectile.x - hero.x, z: projectile.z - hero.z },
        { x: this.projectileVelocity(projectile).x - motion.hero.x, z: this.projectileVelocity(projectile).z - motion.hero.z },
        projectile.radius + this.config.heroRadius,
      ), projectile.id, 1);
      add('projectileExpired', projectile.lifetimeRemaining, projectile.id, 3);
      const closing = motion.hero.z - this.projectileVelocity(projectile).z;
      const rearGap = projectile.z - hero.z + this.config.breachOffset + projectile.radius + this.config.heroRadius;
      add('projectileExpired', rearGap <= EPSILON ? 0 : closing > 0 ? rearGap / closing : null, projectile.id, 3);
    }
    if (hook?.phase === 'outbound') {
      add('range', (hook.config.range - hook.traveled) / hook.config.outboundSpeed, hook.castId, 2);
    } else if (hook && motion.intercept !== null) add('return', motion.intercept, hook.castId, 2);
    if (motion.hero.x !== 0) {
      const edge = Math.sign(motion.hero.x) * this.config.lateralLimit;
      add('boundary', (edge - hero.x) / motion.hero.x, '', 3);
    }
    if (this.config.spawning) {
      add('spawn', this.spawnDistanceRemaining / this.streamSpeed, '', 5);
      add('shop', this.shopDistanceRemaining / this.streamSpeed, '', 6);
    }
    if (this.state.effects.slowRemaining > 0) add('effectExpired', this.state.effects.slowRemaining, '', 3);
    for (const entry of entries) add('shopEnter', entry.at - this.state.time, entry.shopId, 7);
    const compare = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1;
    candidates.sort((a, b) => Math.abs(a.time - b.time) > EPSILON ? a.time - b.time :
      a.priority - b.priority || compare(a.id, b.id) || compare(a.kind, b.kind));
    return candidates[0] ?? null;
  }

  private advance(motion: Motion, elapsed: number): void {
    const { state } = this;
    state.time += elapsed;
    state.hero.x = clamp(state.hero.x + motion.hero.x * elapsed, -this.config.lateralLimit, this.config.lateralLimit);
    state.hero.z += motion.hero.z * elapsed;
    state.distance = state.hero.z;
    state.cooldownRemaining = Math.max(0, state.cooldownRemaining - elapsed);
    this.spawnDistanceRemaining -= elapsed * this.streamSpeed;
    this.shopDistanceRemaining -= elapsed * this.streamSpeed;
    for (const enemy of state.enemies) if (enemy.status === 'alive') {
      enemy.z -= this.enemySpeed(enemy) * elapsed;
      if (enemy.shooting) enemy.shooting.remaining = Math.max(0, enemy.shooting.remaining - elapsed);
    }
    for (const projectile of state.projectiles) {
      const velocity = this.projectileVelocity(projectile);
      projectile.x += velocity.x * elapsed;
      projectile.z += velocity.z * elapsed;
      projectile.lifetimeRemaining = Math.max(0, projectile.lifetimeRemaining - elapsed);
    }
    state.effects.slowRemaining = Math.max(0, state.effects.slowRemaining - elapsed);
    state.shopCandidates = state.shopCandidates.filter((shop) => shop.z >= state.hero.z - this.shopZone.longitudinalRadius - EPSILON);
    if (state.hook) {
      state.hook.x += motion.hook.x * elapsed;
      state.hook.z += motion.hook.z * elapsed;
      if (state.hook.phase === 'outbound') state.hook.traveled += state.hook.config.outboundSpeed * elapsed;
      for (const body of state.enemies.filter(enemy => state.hook!.capturedEnemyIds.includes(enemy.id))) { body.x = state.hook.x; body.z = state.hook.z; }
    }
  }

  private resolve(event: CollisionEvent): void {
    const { state } = this;
    const hook = state.hook;
    if (event.kind === 'hit' && hook) {
      const enemy = state.enemies.find((candidate) => candidate.id === event.id)!;
      // Both an outbound pass and its return carry the same castId. Never
      // decrement a boss twice for that ability activation.
      if (!enemy.hitCastIds.includes(hook.castId)) {
        enemy.hitCastIds.push(hook.castId);
        enemy.hitsRemaining -= 1;
      }
      hook.hitEnemyIds.push(enemy.id);
      if (hook.phase === 'outbound') hook.outboundHits += 1; else hook.returnHits += 1;
      const lethal = enemy.hitsRemaining === 0;
      let goldMultiplierMilli: number | undefined;
      if (lethal) {
        enemy.status = 'captured';
        enemy.shooting = null;
        enemy.x = hook.x;
        enemy.z = hook.z;
        hook.capturedEnemyId ??= enemy.id;
        hook.capturedEnemyIds.push(enemy.id);
        state.kills[enemy.kind] += 1;
        goldMultiplierMilli = hook.config.goldMultiplierMilli * (state.effects.collectorKillsRemaining > 0 ? 1.5 : 1);
        if (state.effects.collectorKillsRemaining > 0) state.effects.collectorKillsRemaining -= 1;
      }
      // Pierce continues after a surviving boss too. Every target stays in the
      // per-cast set, so a return can only credit a previously untouched enemy.
      if (hook.phase === 'outbound' && hook.outboundHits >= hook.config.pierceTargets) hook.phase = 'returning';
      state.events.push({ type: 'hit', at: state.time, enemyId: enemy.id, castId: hook.castId, lethal, kind: enemy.kind, ...(goldMultiplierMilli === undefined ? {} : { goldMultiplierMilli }) });
    } else if (event.kind === 'contact' || event.kind === 'breach') {
      state.phase = 'gameOver';
      state.deathReason = event.kind;
      state.hook = null; state.effects = emptyEffects(); state.activeShopId = null;
      state.events.push({ type: 'gameOver', at: state.time, reason: event.kind, enemyId: event.id });
    } else if (event.kind === 'projectileHit') resolveHeroProjectileHit(state, event.id);
    else if (event.kind === 'projectileExpired') state.projectiles = state.projectiles.filter((projectile) => projectile.id !== event.id);
    else if (event.kind === 'shotStart') this.startTelegraph(event.id);
    else if (event.kind === 'shotRelease') this.releaseShot(event.id);
    else if (event.kind === 'shop') {
      const candidate: ShopCandidate = {
        id: `${state.runId}:shop:${++this.shopSequence}`, x: this.random() < 0.5 ? -this.config.lateralLimit : this.config.lateralLimit,
        z: state.hero.z + this.config.spawnDistance, at: state.time,
      };
      state.shopCandidates.push(candidate);
      state.events.push({ type: 'shopCandidate', at: state.time });
      this.shopDistanceRemaining = this.randomInterval(this.config.shopMinInterval, this.config.shopMaxInterval) * this.streamSpeed;
    } else if (event.kind === 'effectExpired') {
      state.effects.slowRemaining = 0; state.effects.slowedEnemyIds = []; state.effects.slowedProjectileIds = [];
    } else if (event.kind === 'range' && hook) hook.phase = 'returning';
    else if (event.kind === 'return' && hook) {
      state.enemies = state.enemies.filter((enemy) => !hook.capturedEnemyIds.includes(enemy.id));
      state.events.push({ type: 'returned', at: state.time, castId: hook.castId });
      state.hook = null;
    } else if (event.kind === 'spawn') {
      this.spawnNext();
    }
    // A boundary event only changes the next segment's velocity. advance() has
    // already clamped the position, so no residual movement crosses the edge.
  }

  private makeEnemy(x: number, z: number, id?: string, kind: EnemyKind = 'normal'): Enemy {
    this.enemySequence += 1;
    return {
      id: id ?? `${this.state.runId}:enemy:${String(this.enemySequence).padStart(8, '0')}`,
      x, z, radius: kind === 'boss' ? this.config.bossRadius : kind === 'strong' ? this.config.strongRadius : this.config.enemyRadius,
      kind, status: 'alive', requiredHits: kind === 'boss' ? this.config.bossRequiredHits : 1,
      hitsRemaining: kind === 'boss' ? this.config.bossRequiredHits : 1, hitCastIds: [],
      shooting: kind === 'normal' ? null : { phase: 'cooldown', remaining: kind === 'boss' ? this.config.bossInterval - this.config.bossTelegraph : this.config.shooterInterval - this.config.shooterTelegraph, directions: [] },
    };
  }

  private enemySpeed(enemy: Enemy): number {
    const base = enemy.kind === 'boss' ? this.config.bossEnemySpeed : this.config.enemySpeed;
    return base * (this.state.effects.slowRemaining > 0 && this.state.effects.slowedEnemyIds.includes(enemy.id) ? 0.65 : 1);
  }
  private projectileVelocity(projectile: Projectile): Point {
    const factor = this.state.effects.slowRemaining > 0 && this.state.effects.slowedProjectileIds.includes(projectile.id) ? 0.65 : 1;
    return { x: projectile.velocity.x * factor, z: projectile.velocity.z * factor };
  }

  // Production stream milestones are metres of forward progress. A stationary
  // fixture uses active seconds only to retain R1's isolated capacity tests.
  private get streamSpeed(): number { return this.config.heroSpeed > EPSILON ? this.config.heroSpeed : 1; }

  private shotDirections(enemy: Enemy, telegraphSeconds = 0): Point[] {
    const center = normalize({ x: this.state.hero.x - enemy.x,
      z: this.state.hero.z + this.config.heroSpeed * telegraphSeconds - (enemy.z - this.enemySpeed(enemy) * telegraphSeconds) });
    const angles = enemy.kind === 'boss' ? [-this.config.bossVolleyDegrees, 0, this.config.bossVolleyDegrees] : [0];
    return angles.map((degrees) => {
      const angle = degrees * Math.PI / 180;
      return { x: center.x * Math.cos(angle) - center.z * Math.sin(angle), z: center.x * Math.sin(angle) + center.z * Math.cos(angle) };
    });
  }

  private reservedProjectiles(): number {
    return this.state.enemies.reduce((sum, enemy) => sum + (enemy.status === 'alive' && enemy.shooting?.phase === 'telegraph' ? enemy.kind === 'boss' ? 3 : 1 : 0), 0);
  }

  private startTelegraph(id: string): void {
    const enemy = this.state.enemies.find((candidate) => candidate.id === id && candidate.status === 'alive');
    if (!enemy?.shooting) return;
    const count = enemy.kind === 'boss' ? 3 : 1;
    const duration = enemy.kind === 'boss' ? this.config.bossTelegraph : this.config.shooterTelegraph;
    const directions = this.shotDirections(enemy, enemy.kind === 'boss' ? 0 : duration);
    const proposed = this.projectedShot(enemy, directions, duration);
    if (this.state.projectiles.length + this.reservedProjectiles() + count > this.config.maxProjectiles || !this.hasSafeCorridor(proposed)) {
      enemy.shooting.remaining = this.config.spawnRetrySeconds;
      return;
    }
    enemy.shooting = { phase: 'telegraph', remaining: duration, directions };
    this.state.events.push({ type: 'telegraph', at: this.state.time, enemyId: id, kind: enemy.kind });
  }

  private releaseShot(id: string): void {
    const enemy = this.state.enemies.find((candidate) => candidate.id === id && candidate.status === 'alive');
    if (!enemy?.shooting) return;
    const directions = enemy.kind === 'boss' ? enemy.shooting.directions : this.shotDirections(enemy);
    for (const direction of directions) {
      const projectile: Projectile = {
        id: `${this.state.runId}:projectile:${String(++this.projectileSequence).padStart(8, '0')}`, sourceEnemyId: enemy.id,
        x: enemy.x, z: enemy.z, velocity: { x: direction.x * this.config.projectileSpeed, z: direction.z * this.config.projectileSpeed },
        radius: this.config.projectileRadius, lifetimeRemaining: this.config.projectileLifetime,
      };
      this.state.projectiles.push(projectile);
      this.state.events.push({ type: 'shoot', at: this.state.time, enemyId: id, kind: enemy.kind, projectileId: projectile.id });
    }
    const interval = enemy.kind === 'boss' ? this.config.bossInterval : this.config.shooterInterval;
    const duration = enemy.kind === 'boss' ? this.config.bossTelegraph : this.config.shooterTelegraph;
    enemy.shooting = { phase: 'cooldown', remaining: interval - duration, directions: [] };
  }

  private spawnNext(): void {
    const { state, config } = this;
    const alive = state.enemies.filter((enemy) => enemy.status === 'alive');
    const totalKills = state.kills.normal + state.kills.strong + state.kills.boss;
    const bossDue = state.time + EPSILON >= this.bossAt && totalKills >= config.bossMinKills;
    const kind: EnemyKind = bossDue && !alive.some((enemy) => enemy.kind === 'boss') && config.maxBosses > 0 ? 'boss' :
      state.time >= config.shooterUnlockSeconds && alive.filter((enemy) => enemy.kind === 'strong').length < config.maxShooters &&
      this.random() < Math.min(0.45, 0.2 + Math.max(0, state.time - config.shooterUnlockSeconds) / 1080) ? 'strong' : 'normal';
    const enemy = this.makeEnemy((this.random() * 2 - 1) * config.lateralLimit, state.hero.z + config.spawnDistance, undefined, kind);
    if (this.assessSpawn(enemy).accepted) {
      state.enemies.push(enemy);
      state.events.push({ type: 'spawn', at: state.time, enemyId: enemy.id, kind });
      if (kind === 'boss') this.bossAt = state.time + this.randomInterval(config.bossMinInterval, config.bossMaxInterval);
      this.spawnDistanceRemaining = this.nextSpawnDelay() * this.streamSpeed;
    } else this.spawnDistanceRemaining = config.spawnRetrySeconds * this.streamSpeed;
  }

  /** EDF plan of mandatory hits, including existing targets and lateral travel.
   * Conservative: every hit is aimed from the target's x, safety before contact,
   * and no speculative reward/loot RNG participates in route generation. */
  assessSpawn(candidate: Enemy): SpawnAssessment {
    const { state, config } = this;
    const alive = state.enemies.filter((enemy) => enemy.status === 'alive');
    if (alive.length >= config.maxEnemies ||
      candidate.kind === 'strong' && alive.filter((enemy) => enemy.kind === 'strong').length >= config.maxShooters ||
      candidate.kind === 'boss' && alive.filter((enemy) => enemy.kind === 'boss').length >= config.maxBosses) return { accepted: false, reason: 'capacity' };
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.z) || Math.abs(candidate.x) > config.lateralLimit ||
      candidate.z <= state.hero.z + candidate.radius + config.heroRadius || candidate.z - state.hero.z > config.spawnDistance + EPSILON) return { accepted: false, reason: 'position' };
    const targets = [...alive, candidate].map((enemy) => {
      const closing = this.enemySpeed(enemy) + config.heroSpeed;
      const deadline = closing > EPSILON ? (enemy.z - state.hero.z - enemy.radius - config.heroRadius) / closing : Infinity;
      return { enemy, closing, deadline };
    }).sort((a, b) => a.deadline - b.deadline || (a.enemy.id === b.enemy.id ? 0 : a.enemy.id < b.enemy.id ? -1 : 1));
    let freeAt = state.cooldownRemaining;
    if (state.hook) {
      const hook = state.hook;
      const remainingOut = hook.phase === 'outbound' ? Math.max(0, hook.config.range - hook.traveled) / hook.config.outboundSpeed : 0;
      const returnDistance = Math.hypot(hook.x - state.hero.x, hook.z - state.hero.z) + remainingOut * (hook.config.outboundSpeed + config.heroSpeed);
      const minimumReturnSpeed = hook.config.returnSpeed - Math.hypot(config.heroSpeed, config.lateralSpeed);
      if (minimumReturnSpeed <= EPSILON) return { accepted: false, reason: 'deadline' };
      freeAt = Math.max(freeAt, remainingOut + returnDistance / minimumReturnSpeed);
    }
    let x = state.hero.x;
    for (const target of targets) {
      const { enemy, closing, deadline } = target;
      // Stationary debug/test scenes have no approach deadline. They consume
      // entity capacity but cannot force an unavoidable breach.
      if (closing <= EPSILON && enemy.z - state.hero.z > config.hookRange + config.hookRadius + enemy.radius) continue;
      const lateral = Math.abs(enemy.x - x);
      if (lateral > EPSILON && config.lateralSpeed <= EPSILON) return { accepted: false, reason: 'deadline' };
      freeAt += lateral > EPSILON ? lateral / config.lateralSpeed : 0;
      x = enemy.x;
      for (let hit = 0; hit < enemy.hitsRemaining; hit++) {
        const gap = enemy.z - state.hero.z - closing * freeAt;
        if (gap > config.hookRange + config.hookRadius + enemy.radius) {
          if (closing <= EPSILON) return { accepted: false, reason: 'deadline' };
          freeAt += (gap - config.hookRange - config.hookRadius - enemy.radius) / closing;
        }
        const distanceAtCast = enemy.z - state.hero.z - closing * freeAt;
        const outbound = Math.max(0, distanceAtCast - config.hookRadius - enemy.radius) / (config.hookOutboundSpeed + this.enemySpeed(enemy));
        if (freeAt + outbound + config.spawnSafetySeconds > deadline + EPSILON) return { accepted: false, reason: 'deadline' };
        const returnDistance = Math.max(0, distanceAtCast - closing * outbound);
        const cycle = Math.max(config.hookCooldown, outbound + returnDistance / (config.hookReturnSpeed + config.heroSpeed));
        freeAt += cycle;
      }
    }
    if (!this.hasSafeCorridor([])) return { accepted: false, reason: 'corridor' };
    return { accepted: true, reason: 'ok' };
  }

  private projectedShot(enemy: Enemy, directions: Point[], start: number): Array<Projectile & { start: number }> {
    return directions.map((direction, index) => ({
      id: `forecast:${enemy.id}:${index}`, sourceEnemyId: enemy.id, x: enemy.x, z: enemy.z - this.enemySpeed(enemy) * start,
      velocity: { x: direction.x * this.config.projectileSpeed, z: direction.z * this.config.projectileSpeed },
      radius: this.config.projectileRadius, lifetimeRemaining: this.config.projectileLifetime, start,
    }));
  }

  /** Reachable lateral grid over the projectile horizon. Edges use swept
   * circles, so a fast bullet between samples cannot open a false corridor. */
  private hasSafeCorridor(additional: Array<Projectile & { start: number }>): boolean {
    const { config, state } = this;
    const threats: Array<Projectile & { start: number }> = [...state.projectiles.map((item) => ({ ...item, start: 0 })), ...additional];
    for (const enemy of state.enemies) if (enemy.status === 'alive' && enemy.shooting?.phase === 'telegraph') {
      threats.push(...this.projectedShot(enemy, enemy.shooting.directions, enemy.shooting.remaining));
    }
    if (threats.length === 0) return true;
    const spacing = Math.min(0.25, Math.max(0.05, config.heroRadius));
    const cells = Math.ceil(config.lateralLimit * 2 / spacing);
    const positions = [...new Set([state.hero.x, ...Array.from({ length: cells + 1 }, (_, index) => -config.lateralLimit + config.lateralLimit * 2 * index / cells)])];
    const dt = 0.1;
    let reachable = [state.hero.x];
    const horizon = config.projectileLifetime + Math.max(0, ...threats.map((item) => item.start));
    for (let at = 0; at < horizon - EPSILON; at += dt) {
      const elapsed = Math.min(dt, horizon - at);
      const next: number[] = [];
      for (const x of positions) {
        for (const previousX of reachable) {
          if (Math.abs(x - previousX) > config.lateralSpeed * elapsed + EPSILON) continue;
          const velocity = { x: (x - previousX) / elapsed, z: config.heroSpeed };
          let safe = true;
          for (const threat of threats) {
            const begin = Math.max(at, threat.start);
            const end = Math.min(at + elapsed, threat.start + threat.lifetimeRemaining);
            if (end < begin - EPSILON) continue;
            const offset = begin - at;
            const projectileAge = begin - threat.start;
            const relative = {
              x: threat.x + threat.velocity.x * projectileAge - (previousX + velocity.x * offset),
              z: threat.z + threat.velocity.z * projectileAge - (state.hero.z + config.heroSpeed * begin),
            };
            const collision = sweptContact(relative, { x: threat.velocity.x - velocity.x, z: threat.velocity.z - velocity.z }, threat.radius + config.heroRadius);
            if (collision !== null && collision <= end - begin + EPSILON) { safe = false; break; }
          }
          if (safe) { next.push(x); break; }
        }
      }
      if (next.length === 0) return false;
      reachable = next;
    }
    return true;
  }

  private random(): number {
    // Mulberry32: private, deterministic, independent of browser/render clocks.
    this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
    let value = this.randomState;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }

  private nextSpawnDelay(): number {
    return this.randomInterval(this.config.spawnMinSeconds, this.config.spawnMaxSeconds);
  }

  private randomInterval(min: number, max: number): number { return min + this.random() * (max - min); }
}

/** Strict finite/range validation is shared by the browser and server replay. */
function validateSnapshot(value: unknown): SimulationSnapshot {
  const fail = (): never => { throw new SimulationRuleError('invalid_snapshot'); };
  const object = (v: unknown): Record<string, unknown> => !v || typeof v !== 'object' || Array.isArray(v) ? fail() : v as Record<string, unknown>;
  const number = (v: unknown, min = 0, max = 1e12, integer = false): number => typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || integer && !Number.isSafeInteger(v) ? fail() : v;
  const string = (v: unknown): string => typeof v !== 'string' || v.length < 1 || v.length > 512 ? fail() : v;
  const list = (v: unknown, limit = 10000): unknown[] => !Array.isArray(v) || v.length > limit ? fail() : v;
  const ids = (v: unknown, limit = 10000): string[] => {
    const a = list(v, limit).map(string); if (new Set(a).size !== a.length) fail(); return a;
  };
  const point = (v: unknown) => { const p = object(v); number(p.x, -1e12); number(p.z, -1e12); };
  const oneOf = (v: unknown, values: readonly unknown[]) => { if (!values.includes(v)) fail(); };
  const root = object(value);
  if (root.version !== 'r34.1') throw new SimulationRuleError('snapshot_version_mismatch');
  const cfg = object(root.config);
  if (Object.keys(cfg).length !== Object.keys(DEFAULT_CONFIG).length) fail();
  for (const [key, base] of Object.entries(DEFAULT_CONFIG)) {
    if (typeof base === 'boolean') { if (typeof cfg[key] !== 'boolean') fail(); }
    else number(cfg[key], 0, 10000);
  }
  const config = cfg as unknown as SimulationConfig;
  const zone = object(root.shopZone); if (Object.keys(zone).length !== 2) fail();
  number(zone.lateralRadius, EPSILON, 10); number(zone.longitudinalRadius, EPSILON, 10);
  validateEquipment(root.equipment as EquipmentModifiers);
  number(root.randomState, 0, 0xffffffff, true);
  const counters = object(root.counters); for (const key of ['enemy', 'cast', 'projectile', 'shop']) number(counters[key], 0, Number.MAX_SAFE_INTEGER, true);
  const generator = object(root.generator);
  number(generator.spawnDistanceRemaining, -1e12, 1e12);
  number(generator.shopDistanceRemaining, -1e12, 1e12); number(generator.bossAt);
  const state = object(root.state); string(state.runId); number(state.seed, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  oneOf(state.phase, ['running', 'paused', 'shop', 'gameOver']); number(state.tick, 0, Number.MAX_SAFE_INTEGER, true);
  const time = number(state.time); number(state.distance); point(state.hero);
  const hero = object(state.hero); number(hero.x, -config.lateralLimit - EPSILON, config.lateralLimit + EPSILON);
  if (Math.abs(number(hero.z) - number(state.distance)) > EPSILON) fail();
  number(state.cooldownRemaining, 0, 10000);
  const kills = object(state.kills); for (const kind of ['normal', 'strong', 'boss']) number(kills[kind], 0, Number.MAX_SAFE_INTEGER, true);
  const used = ids(state.usedShopIds); if (state.activeShopId !== null) string(state.activeShopId);
  if (state.phase === 'shop' && (state.activeShopId === null || !used.includes(state.activeShopId as string))) fail();
  if (state.phase !== 'shop' && state.activeShopId !== null) fail();
  oneOf(state.deathReason, [null, 'contact', 'breach', 'projectile', 'abandoned']);
  if ((state.phase === 'gameOver') !== (state.deathReason !== null)) fail();
  const effects = object(state.effects); number(effects.slowRemaining, 0, 3); ids(effects.slowedEnemyIds); ids(effects.slowedProjectileIds);
  number(effects.collectorKillsRemaining, 0, 10, true);
  const enemies = list(state.enemies, config.maxEnemies + 3); ids(enemies.map(v => object(v).id));
  for (const v of enemies) {
    const enemy = object(v); point(enemy); string(enemy.id); oneOf(enemy.kind, ['normal', 'strong', 'boss']);
    oneOf(enemy.status, ['alive', 'captured']); number(enemy.radius, EPSILON, 10000);
    const hits = number(enemy.requiredHits, enemy.kind === 'boss' ? 3 : 1, 10000, true);
    if (enemy.kind !== 'boss' && hits !== 1) fail();
    number(enemy.hitsRemaining, enemy.status === 'alive' ? 1 : 0, hits, true);
    if (enemy.status === 'captured' && enemy.hitsRemaining !== 0) fail();
    ids(enemy.hitCastIds, hits);
    if (enemy.shooting !== null) {
      if (enemy.kind === 'normal' || enemy.status !== 'alive') fail();
      const shooting = object(enemy.shooting); oneOf(shooting.phase, ['cooldown', 'telegraph']); number(shooting.remaining, 0, 10000);
      const directions = list(shooting.directions, 3);
      if (directions.length !== (shooting.phase === 'cooldown' ? 0 : enemy.kind === 'boss' ? 3 : 1)) fail();
      for (const dir of directions) { point(dir); const p = dir as Point; if (Math.abs(Math.hypot(p.x, p.z) - 1) > EPSILON) fail(); }
    }
  }
  const projectiles = list(state.projectiles, config.maxProjectiles); ids(projectiles.map(v => object(v).id));
  for (const v of projectiles) { const p = object(v); point(p); point(p.velocity); string(p.id); string(p.sourceEnemyId); number(p.radius, 0, 10000); number(p.lifetimeRemaining, 0, 10000); }
  const shops = list(state.shopCandidates); ids(shops.map(v => object(v).id));
  for (const v of shops) { const shop = object(v); string(shop.id); point(shop); number(shop.at, 0, time + EPSILON); }
  if (state.hook !== null) {
    if (state.phase === 'gameOver') fail();
    const hook = object(state.hook); point(hook); string(hook.castId); oneOf(hook.phase, ['outbound', 'returning']);
    point(hook.direction); const dir = hook.direction as Point; if (Math.abs(Math.hypot(dir.x, dir.z) - 1) > EPSILON || dir.z <= 0) fail();
    const settings = object(hook.config);
    for (const key of ['range', 'outboundSpeed', 'returnSpeed']) number(settings[key], EPSILON, 100000);
    number(settings.cooldown, 0, 10000); number(settings.radius, 0, 10000); number(settings.goldMultiplierMilli, 1000, 4000, true);
    oneOf(settings.pierceTargets, [1, 2]); oneOf(settings.returnHitTargets, [0, 1]);
    if (settings.pierceTargets === 2 && settings.returnHitTargets === 1) fail();
    number(hook.traveled, 0, number(settings.range) + EPSILON);
    const captured = ids(hook.capturedEnemyIds, 3), hit = ids(hook.hitEnemyIds, 3);
    const outboundHits = number(hook.outboundHits, 0, settings.pierceTargets as number, true), returnHits = number(hook.returnHits, 0, settings.returnHitTargets as number, true);
    if (outboundHits + returnHits !== hit.length || captured.some(id => !hit.includes(id))) fail();
    if (hook.capturedEnemyId !== null && (!captured.includes(hook.capturedEnemyId as string) || typeof hook.capturedEnemyId !== 'string')) fail();
    if ((captured.length === 0) !== (hook.capturedEnemyId === null)) fail();
    for (const id of captured) if (!enemies.some(v => object(v).id === id && object(v).status === 'captured')) fail();
  }
  for (const v of list(state.events, 10000)) {
    const event = object(v); oneOf(event.type, ['cast', 'castRejected', 'hit', 'returned', 'spawn', 'gameOver', 'telegraph', 'shoot', 'shopCandidate', 'shopEntered', 'shopLeft', 'consumed']);
    number(event.at, 0, time + EPSILON);
    for (const key of ['castId', 'enemyId', 'projectileId', 'shopId', 'definitionId']) if (event[key] !== undefined) string(event[key]);
    if (event.lethal !== undefined && typeof event.lethal !== 'boolean') fail();
    if (event.goldMultiplierMilli !== undefined) number(event.goldMultiplierMilli, 1000, 6000);
  }
  if (state.phase === 'gameOver' && (effects.slowRemaining !== 0 || effects.collectorKillsRemaining !== 0)) fail();
  return structuredClone(root) as unknown as SimulationSnapshot;
}
