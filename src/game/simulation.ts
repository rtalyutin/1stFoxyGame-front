import { DEFAULT_CONFIG, FIXED_STEP, type SimulationConfig } from './config';

export type Point = { x: number; z: number };
export type Command = { type: 'move'; axis: number } | { type: 'cast'; aim: Point };
export type DeathReason = 'contact' | 'breach' | 'projectile';
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
}
export interface Hook extends Point {
  castId: string;
  phase: 'outbound' | 'returning';
  readonly direction: Readonly<Point>;
  traveled: number;
  capturedEnemyId: string | null;
  readonly config: Readonly<HookConfig>;
}
export interface GameEvent {
  type: 'cast' | 'castRejected' | 'hit' | 'returned' | 'spawn' | 'gameOver' | 'telegraph' | 'shoot' | 'shopCandidate';
  at: number;
  castId?: string;
  enemyId?: string;
  reason?: DeathReason;
  lethal?: boolean;
  kind?: EnemyKind;
  projectileId?: string;
}
export interface RunState {
  runId: string;
  seed: number;
  phase: 'running' | 'paused' | 'gameOver';
  tick: number;
  time: number;
  distance: number;
  hero: Point;
  enemies: Enemy[];
  projectiles: Projectile[];
  shopCandidates: ShopCandidate[];
  hook: Hook | null;
  cooldownRemaining: number;
  kills: { normal: number; strong: number; boss: number };
  deathReason: DeathReason | null;
  events: GameEvent[];
}
export interface SimulationOptions {
  config?: Partial<SimulationConfig>;
  initialEnemies?: Array<Point & { id?: string; kind?: EnemyKind; requiredHits?: number; hitsRemaining?: number; shooting?: Shooting | null }>;
  initialProjectiles?: Projectile[];
}

export interface SpawnAssessment { accepted: boolean; reason: 'ok' | 'capacity' | 'deadline' | 'corridor' | 'position'; }

type Motion = { hero: Point; hook: Point; intercept: number | null };
type EventKind = 'hit' | 'contact' | 'breach' | 'projectileHit' | 'projectileExpired' | 'range' | 'return' | 'boundary' | 'spawn' | 'shotStart' | 'shotRelease' | 'shop';
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
    this.randomState = seed >>> 0;
    this.spawnDistanceRemaining = this.nextSpawnDelay() * this.streamSpeed;
    this.bossAt = config.bossFirstSeconds;
    this.shopDistanceRemaining = this.randomInterval(config.shopMinInterval, config.shopMaxInterval) * this.streamSpeed;
    this.state = {
      runId, seed, phase: 'running', tick: 0, time: 0, distance: 0,
      hero: { x: 0, z: 0 }, enemies: [], projectiles: [], shopCandidates: [], hook: null, cooldownRemaining: 0,
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

  pause(): void { if (this.state.phase === 'running') this.state.phase = 'paused'; }
  resume(): void { if (this.state.phase === 'paused') this.state.phase = 'running'; }

  step(commands: readonly Command[] = []): void {
    if (this.state.phase !== 'running') return;
    this.state.events = [];
    let axis = 0;
    for (const command of commands) {
      if (command.type === 'move') axis = Number.isFinite(command.axis) ? clamp(command.axis, -1, 1) : 0;
      else this.cast(command.aim);
    }
    this.state.tick += 1;
    let remaining = FIXED_STEP;
    // Continue through zero-time events at the tick boundary: a same-time hit
    // must not defer another enemy's contact to the following input frame.
    while (this.state.phase === 'running') {
      const motion = this.motion(axis);
      const event = this.nextEvent(motion, remaining);
      const elapsed = event ? clamp(event.time, 0, remaining) : remaining;
      this.advance(motion, elapsed);
      remaining -= elapsed;
      if (!event) break;
      this.resolve(event);
    }
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
      range: this.config.hookRange, outboundSpeed: this.config.hookOutboundSpeed,
      returnSpeed: this.config.hookReturnSpeed, cooldown: this.config.hookCooldown,
      radius: this.config.hookRadius,
    });
    const castId = `${this.state.runId}:cast:${++this.castSequence}`;
    this.state.hook = {
      ...this.state.hero, castId, phase: 'outbound',
      direction: Object.freeze({ x: dx / length, z: dz / length }),
      traveled: 0, capturedEnemyId: null, config: settings,
    };
    this.state.cooldownRemaining = settings.cooldown;
    this.state.events.push({ type: 'cast', at: this.state.time, castId });
  }

  private motion(axis: number): Motion {
    const { hero, hook } = this.state;
    let vx = axis * this.config.lateralSpeed;
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

  private nextEvent(motion: Motion, horizon: number): CollisionEvent | null {
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
      if (hook?.phase === 'outbound') add('hit', sweptContact(
        { x: enemy.x - hook.x, z: enemy.z - hook.z },
        { x: -motion.hook.x, z: -enemySpeed - motion.hook.z },
        enemy.radius + hook.config.radius,
      ), enemy.id, 0);
      if (enemy.shooting) add(enemy.shooting.phase === 'telegraph' ? 'shotRelease' : 'shotStart', enemy.shooting.remaining, enemy.id, 4);
    }
    for (const projectile of this.state.projectiles) {
      add('projectileHit', sweptContact(
        { x: projectile.x - hero.x, z: projectile.z - hero.z },
        { x: projectile.velocity.x - motion.hero.x, z: projectile.velocity.z - motion.hero.z },
        projectile.radius + this.config.heroRadius,
      ), projectile.id, 1);
      add('projectileExpired', projectile.lifetimeRemaining, projectile.id, 3);
      const closing = motion.hero.z - projectile.velocity.z;
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
      projectile.x += projectile.velocity.x * elapsed;
      projectile.z += projectile.velocity.z * elapsed;
      projectile.lifetimeRemaining = Math.max(0, projectile.lifetimeRemaining - elapsed);
    }
    state.shopCandidates = state.shopCandidates.filter((shop) => shop.z >= state.hero.z - this.config.breachOffset);
    if (state.hook) {
      state.hook.x += motion.hook.x * elapsed;
      state.hook.z += motion.hook.z * elapsed;
      if (state.hook.phase === 'outbound') state.hook.traveled += state.hook.config.outboundSpeed * elapsed;
      const body = state.enemies.find((enemy) => enemy.id === state.hook?.capturedEnemyId);
      if (body) { body.x = state.hook.x; body.z = state.hook.z; }
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
      const lethal = enemy.hitsRemaining === 0;
      if (lethal) {
        enemy.status = 'captured';
        enemy.shooting = null;
        enemy.x = hook.x;
        enemy.z = hook.z;
        hook.capturedEnemyId = enemy.id;
        state.kills[enemy.kind] += 1;
      }
      // A surviving boss stays on its route; the empty hook comes back.
      hook.phase = 'returning';
      state.events.push({ type: 'hit', at: state.time, enemyId: enemy.id, castId: hook.castId, lethal, kind: enemy.kind });
    } else if (event.kind === 'contact' || event.kind === 'breach') {
      state.phase = 'gameOver';
      state.deathReason = event.kind;
      state.hook = null;
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
    } else if (event.kind === 'range' && hook) hook.phase = 'returning';
    else if (event.kind === 'return' && hook) {
      state.enemies = state.enemies.filter((enemy) => enemy.id !== hook.capturedEnemyId);
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

  private enemySpeed(enemy: Enemy): number { return enemy.kind === 'boss' ? this.config.bossEnemySpeed : this.config.enemySpeed; }

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
