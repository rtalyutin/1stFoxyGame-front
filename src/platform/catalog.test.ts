import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateCatalog, loadCatalog } from './catalog';
import { DEFAULT_CONFIG } from '../game/config';

// Accepted R2 API fixture. This is test data, not a second runtime catalog.
function fixture() {
  return {
    catalogVersion: 'r2.1', rulesVersion: 'r2.1', modifiers: [],
    enemies: [
      { code: 'normal', requiredHits: 1, radius: .45, worldSpeed: 1, weaponCode: null, modifiers: [] },
      { code: 'strong', requiredHits: 1, radius: .55, worldSpeed: 1, weaponCode: 'strong-shot', modifiers: [] },
      { code: 'boss', requiredHits: 3, radius: 1, worldSpeed: .5, weaponCode: 'boss-volley', modifiers: [] },
    ],
    weapons: [
      { code: 'strong-shot', telegraphSeconds: .8, projectileSpeed: 8, projectileRadius: .12, projectileLifetimeSeconds: 8, shotIntervalSeconds: 3, anglesDegrees: [0] },
      { code: 'boss-volley', telegraphSeconds: 1, projectileSpeed: 8, projectileRadius: .12, projectileLifetimeSeconds: 8, shotIntervalSeconds: 3.5, anglesDegrees: [-15, 0, 15] },
    ],
    rules: {
      heroSpeed: 2, lateralSpeed: 6, heroRadius: .35, lateralLimit: 4.5, enemySpeed: 1, enemyRadius: .45,
      breachOffset: 1, spawnDistance: 36, spawnMinSeconds: 2.8, spawnMaxSeconds: 3.4, maxEnemies: 8,
      hookRange: 30, hookOutboundSpeed: 35, hookReturnSpeed: 45, hookCooldown: 2, hookRadius: .35,
      maxShooters: 2, maxBosses: 1, maxProjectiles: 24, shooterUnlockSeconds: 30, bossFirstSeconds: 90,
      bossMinKills: 25, bossMinInterval: 90, bossMaxInterval: 150, shopMinInterval: 55, shopMaxInterval: 75,
      spawnSafetySeconds: 2, spawnRetrySeconds: .25,
    },
  };
}

describe('paired R2 combat catalog', () => {
  it('accepts the agreed rules and rejects version, timing and hit threshold changes', () => {
    expect(validateCatalog(fixture())).toBe(DEFAULT_CONFIG);
    const version = fixture(); version.rulesVersion = 'r1'; expect(() => validateCatalog(version)).toThrow();
    const hits = fixture(); hits.enemies[2].requiredHits = 2; expect(() => validateCatalog(hits)).toThrow();
    const speed = fixture(); speed.weapons[0].projectileSpeed = 9; expect(() => validateCatalog(speed)).toThrow();
    const hook = fixture(); hook.rules.hookCooldown = 1; expect(() => validateCatalog(hook)).toThrow();
  });
  it('rejects malformed content, references, duplicates and unimplemented modifiers', () => {
    for (const value of [null, {}, [], { ...fixture(), enemies: null }]) expect(() => validateCatalog(value)).toThrow();
    const ref = fixture(); ref.enemies[1].weaponCode = 'missing'; expect(() => validateCatalog(ref)).toThrow();
    const duplicate = fixture(); duplicate.enemies[2].code = 'strong'; expect(() => validateCatalog(duplicate)).toThrow();
    const modifier = { ...fixture(), modifiers: ['auto-aim'] }; expect(() => validateCatalog(modifier)).toThrow();
  });
  it('loads fresh rules and refuses an unavailable endpoint before a run', async () => {
    let init: RequestInit | undefined;
    const fetcher = async (_url: unknown, options?: RequestInit) => { init = options; return Response.json(fixture()); };
    expect(await loadCatalog(fetcher as typeof fetch)).toBe(DEFAULT_CONFIG);
    expect(init?.cache).toBe('no-store'); expect(init?.signal).toBeInstanceOf(AbortSignal);
    await expect(loadCatalog((async () => new Response('', { status: 503 })) as typeof fetch)).rejects.toThrow('недоступен');
  });
  it.skipIf(!process.env.BACKEND_CATALOG_PATH)('agrees with the actual paired backend artifact', () => {
    const catalog = JSON.parse(readFileSync(process.env.BACKEND_CATALOG_PATH!, 'utf8'));
    expect(validateCatalog(catalog)).toBe(DEFAULT_CONFIG);
  });
});
