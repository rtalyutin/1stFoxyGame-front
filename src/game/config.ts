/** Reproducible R2 starting balance. World distances: metres; speeds: m/s. */
export const RULES_VERSION = 'r2.1';
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
  strongRadius: number;
  bossRadius: number;
  bossEnemySpeed: number;
  bossRequiredHits: number;
  projectileRadius: number;
  projectileSpeed: number;
  projectileLifetime: number;
  shooterTelegraph: number;
  shooterInterval: number;
  bossTelegraph: number;
  bossInterval: number;
  bossVolleyDegrees: number;
  maxShooters: number;
  maxBosses: number;
  maxProjectiles: number;
  shooterUnlockSeconds: number;
  bossFirstSeconds: number;
  bossMinKills: number;
  bossMinInterval: number;
  bossMaxInterval: number;
  shopMinInterval: number;
  shopMaxInterval: number;
  spawnSafetySeconds: number;
  spawnRetrySeconds: number;
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
  strongRadius: 0.55,
  bossRadius: 1,
  bossEnemySpeed: 0.5,
  bossRequiredHits: 3,
  projectileRadius: 0.12,
  projectileSpeed: 8,
  projectileLifetime: 8,
  shooterTelegraph: 0.8,
  shooterInterval: 3,
  bossTelegraph: 1,
  bossInterval: 3.5,
  bossVolleyDegrees: 15,
  maxShooters: 2,
  maxBosses: 1,
  maxProjectiles: 24,
  shooterUnlockSeconds: 30,
  bossFirstSeconds: 90,
  bossMinKills: 25,
  bossMinInterval: 90,
  bossMaxInterval: 150,
  shopMinInterval: 55,
  shopMaxInterval: 75,
  spawnSafetySeconds: 2,
  spawnRetrySeconds: 0.25,
});

/** R3 entry window, kept separate so the accepted R2 catalog stays compatible. */
export interface ShopZoneConfig { lateralRadius: number; longitudinalRadius: number; }
export const DEFAULT_SHOP_ZONE: Readonly<ShopZoneConfig> = Object.freeze({ lateralRadius: 1, longitudinalRadius: 2 });
