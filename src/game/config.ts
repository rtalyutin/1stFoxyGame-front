/** Accepted R1 starting balance. Distances are metres; speeds are metres/second. */
export interface SimulationConfig {
  heroSpeed: number;
  lateralSpeed: number;
  heroRadius: number;
  lateralLimit: number;
  enemySpeed: number;
  enemyRadius: number;
  breachOffset: number;
  spawnDistance: number;
  spawnMinSeconds: number;
  spawnMaxSeconds: number;
  maxEnemies: number;
  spawning: boolean;
  hookRange: number;
  hookOutboundSpeed: number;
  hookReturnSpeed: number;
  hookCooldown: number;
  hookRadius: number;
}

export const FIXED_STEP = 1 / 60;

export const DEFAULT_CONFIG: Readonly<SimulationConfig> = Object.freeze({
  heroSpeed: 2,
  lateralSpeed: 6,
  heroRadius: 0.35,
  lateralLimit: 4.5,
  enemySpeed: 1,
  enemyRadius: 0.45,
  breachOffset: 1,
  spawnDistance: 36,
  spawnMinSeconds: 2.8,
  spawnMaxSeconds: 3.4,
  maxEnemies: 8,
  spawning: true,
  hookRange: 30,
  hookOutboundSpeed: 35,
  hookReturnSpeed: 45,
  hookCooldown: 2,
  hookRadius: 0.35,
});
