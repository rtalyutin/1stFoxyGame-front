import { DEFAULT_CONFIG, FIXED_STEP, type SimulationConfig } from './config';

export type Point = { x: number; z: number };
export type Command = { type: 'move'; axis: number } | { type: 'cast'; aim: Point };
export type DeathReason = 'contact' | 'breach';
export interface Enemy extends Point {
  id: string;
  kind: 'normal';
  radius: number;
  status: 'alive' | 'captured';
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
  type: 'cast' | 'castRejected' | 'hit' | 'returned' | 'spawn' | 'gameOver';
  at: number;
  castId?: string;
  enemyId?: string;
  reason?: DeathReason;
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
  hook: Hook | null;
  cooldownRemaining: number;
  kills: { normal: number; strong: number; boss: number };
  deathReason: DeathReason | null;
  events: GameEvent[];
}
export interface SimulationOptions {
  config?: Partial<SimulationConfig>;
  initialEnemies?: Array<Point & { id?: string }>;
}

type Motion = { hero: Point; hook: Point; intercept: number | null };
type EventKind = 'hit' | 'contact' | 'breach' | 'range' | 'return' | 'boundary' | 'spawn';
type CollisionEvent = { kind: EventKind; time: number; id: string; priority: number };
const EPSILON = 1e-9;
const ZERO: Point = Object.freeze({ x: 0, z: 0 });
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

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
  private spawnRemaining: number;

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
        !Number.isInteger(config.maxEnemies)) throw new Error('Invalid simulation timing or capacity');
    this.config = Object.freeze(config);
    this.randomState = seed >>> 0;
    this.spawnRemaining = this.nextSpawnDelay();
    this.state = {
      runId, seed, phase: 'running', tick: 0, time: 0, distance: 0,
      hero: { x: 0, z: 0 }, enemies: [], hook: null, cooldownRemaining: 0,
      kills: { normal: 0, strong: 0, boss: 0 }, deathReason: null, events: [],
    };
    for (const enemy of options.initialEnemies ?? []) {
      if (!Number.isFinite(enemy.x) || !Number.isFinite(enemy.z)) throw new Error('Invalid enemy position');
      this.state.enemies.push(this.makeEnemy(enemy.x, enemy.z, enemy.id));
    }
    if (new Set(this.state.enemies.map((enemy) => enemy.id)).size !== this.state.enemies.length) {
      throw new Error('Enemy IDs must be unique');
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
      add('contact', sweptContact(
        { x: enemy.x - hero.x, z: enemy.z - hero.z },
        { x: -motion.hero.x, z: -this.config.enemySpeed - motion.hero.z },
        enemy.radius + this.config.heroRadius,
      ), enemy.id, 1);
      const gap = enemy.z - hero.z + this.config.breachOffset;
      const closing = this.config.enemySpeed + motion.hero.z;
      add('breach', gap <= EPSILON ? 0 : closing > 0 ? gap / closing : null, enemy.id, 1);
      if (hook?.phase === 'outbound') add('hit', sweptContact(
        { x: enemy.x - hook.x, z: enemy.z - hook.z },
        { x: -motion.hook.x, z: -this.config.enemySpeed - motion.hook.z },
        enemy.radius + hook.config.radius,
      ), enemy.id, 0);
    }
    if (hook?.phase === 'outbound') {
      add('range', (hook.config.range - hook.traveled) / hook.config.outboundSpeed, hook.castId, 2);
    } else if (hook && motion.intercept !== null) add('return', motion.intercept, hook.castId, 2);
    if (motion.hero.x !== 0) {
      const edge = Math.sign(motion.hero.x) * this.config.lateralLimit;
      add('boundary', (edge - hero.x) / motion.hero.x, '', 3);
    }
    if (this.config.spawning) add('spawn', this.spawnRemaining, '', 4);
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
    this.spawnRemaining -= elapsed;
    for (const enemy of state.enemies) if (enemy.status === 'alive') enemy.z -= this.config.enemySpeed * elapsed;
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
      enemy.status = 'captured';
      enemy.x = hook.x;
      enemy.z = hook.z;
      hook.capturedEnemyId = enemy.id;
      hook.phase = 'returning';
      state.kills.normal += 1;
      state.events.push({ type: 'hit', at: state.time, enemyId: enemy.id, castId: hook.castId });
    } else if (event.kind === 'contact' || event.kind === 'breach') {
      state.phase = 'gameOver';
      state.deathReason = event.kind;
      state.hook = null;
      state.events.push({ type: 'gameOver', at: state.time, reason: event.kind, enemyId: event.id });
    } else if (event.kind === 'range' && hook) hook.phase = 'returning';
    else if (event.kind === 'return' && hook) {
      state.enemies = state.enemies.filter((enemy) => enemy.id !== hook.capturedEnemyId);
      state.events.push({ type: 'returned', at: state.time, castId: hook.castId });
      state.hook = null;
    } else if (event.kind === 'spawn') {
      if (state.enemies.filter((enemy) => enemy.status === 'alive').length < this.config.maxEnemies) {
        const enemy = this.makeEnemy((this.random() * 2 - 1) * this.config.lateralLimit, state.hero.z + this.config.spawnDistance);
        state.enemies.push(enemy);
        state.events.push({ type: 'spawn', at: state.time, enemyId: enemy.id });
      }
      this.spawnRemaining = this.nextSpawnDelay();
    }
    // A boundary event only changes the next segment's velocity. advance() has
    // already clamped the position, so no residual movement crosses the edge.
  }

  private makeEnemy(x: number, z: number, id?: string): Enemy {
    this.enemySequence += 1;
    return {
      id: id ?? `${this.state.runId}:enemy:${String(this.enemySequence).padStart(8, '0')}`,
      x, z, radius: this.config.enemyRadius, kind: 'normal', status: 'alive',
    };
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
    return this.config.spawnMinSeconds + this.random() * (this.config.spawnMaxSeconds - this.config.spawnMinSeconds);
  }
}
