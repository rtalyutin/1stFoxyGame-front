import { RULES_VERSION } from '../game/config';
import type { SimulationConfig } from '../game/config';
import { RunSimulation } from '../game/simulation';

type ObjectValue = Record<string, unknown>;
function invalid(): never { throw new Error('Некорректный каталог правил'); }
const object = (value: unknown): ObjectValue => { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as ObjectValue; };
const array = (value: unknown): unknown[] => { if (!Array.isArray(value)) invalid(); return value as unknown[]; };
const number = (value: unknown): number => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid(); return value as number; };
/** Tuning values may differ from this build. Only the supported protocol and structure are fixed. */
export function validateCatalog(value: unknown): Readonly<SimulationConfig> {
  const catalog = object(value);
  if (catalog.rulesVersion !== RULES_VERSION || catalog.catalogVersion !== RULES_VERSION) throw new Error('Версии правил клиента и сервера различаются. Обнови страницу.');
  if (array(catalog.modifiers).length !== 0) throw new Error('Неизвестные модификаторы правил');
  const rules = object(catalog.rules);
  const config: Record<string, number | boolean> = { spawning: true };
  for (const key of ['heroSpeed','lateralSpeed','heroRadius','lateralLimit','enemySpeed','enemyRadius','breachOffset','spawnDistance','spawnMinSeconds','spawnMaxSeconds','maxEnemies','hookRange','hookOutboundSpeed','hookReturnSpeed','hookCooldown','hookRadius','maxShooters','maxBosses','maxProjectiles','shooterUnlockSeconds','bossFirstSeconds','bossMinKills','bossMinInterval','bossMaxInterval','shopMinInterval','shopMaxInterval','spawnSafetySeconds','spawnRetrySeconds']) config[key] = number(rules[key]);
  const enemies = array(catalog.enemies).map(object);
  if (enemies.length !== 3 || new Set(enemies.map(enemy => enemy.code)).size !== 3) invalid();
  for (const [code, weapon] of [['normal',null],['strong','strong-shot'],['boss','boss-volley']]) {
    const enemy = enemies.find(e => e.code === code); if (!enemy || enemy.weaponCode !== weapon || array(enemy.modifiers).length !== 0) invalid();
    number(enemy.requiredHits); number(enemy.radius); number(enemy.worldSpeed);
    if (code !== 'boss' && (enemy.requiredHits !== 1 || enemy.worldSpeed !== config.enemySpeed) || code === 'normal' && enemy.radius !== config.enemyRadius) invalid();
    if (code === 'strong') config.strongRadius = number(enemy.radius);
    if (code === 'boss') { config.bossRadius = number(enemy.radius); config.bossEnemySpeed = number(enemy.worldSpeed); config.bossRequiredHits = number(enemy.requiredHits); }
  }
  const weapons = array(catalog.weapons).map(object);
  if (weapons.length !== 2 || new Set(weapons.map(w => w.code)).size !== 2) invalid();
  for (const code of ['strong-shot','boss-volley']) {
    const weapon = weapons.find(w => w.code === code); if (!weapon) invalid();
    const angles = array(weapon.anglesDegrees).map(value => { if (typeof value !== 'number' || !Number.isFinite(value)) invalid(); return value as number; });
    if (code === 'strong-shot' && (angles.length !== 1 || angles[0] !== 0) || code === 'boss-volley' && (angles.length !== 3 || angles[1] !== 0 || angles[0] !== -angles[2]! || angles[2]! < 0 || angles[2]! > 90)) invalid();
    config[code === 'strong-shot' ? 'shooterTelegraph' : 'bossTelegraph'] = number(weapon.telegraphSeconds);
    config[code === 'strong-shot' ? 'shooterInterval' : 'bossInterval'] = number(weapon.shotIntervalSeconds);
    for (const [key,wire] of [['projectileSpeed','projectileSpeed'],['projectileRadius','projectileRadius'],['projectileLifetime','projectileLifetimeSeconds']]) {
      const value = number(weapon[wire]); if (config[key] !== undefined && config[key] !== value) invalid(); config[key] = value;
    }
    if (code === 'boss-volley') config.bossVolleyDegrees = angles[2]!;
  }
  try { return new RunSimulation('catalog-protocol-check',1,{config:config as unknown as SimulationConfig}).config; }
  catch { return invalid(); }
}
export async function loadCatalog(fetcher: typeof fetch = fetch): Promise<Readonly<SimulationConfig>> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(),3000);
  try { const response = await fetcher('/api/v1/catalog', { cache:'no-store', signal:controller.signal }); if (!response.ok) throw new Error('Каталог правил недоступен. Попробуй снова.'); return validateCatalog(await response.json()); }
  finally { clearTimeout(timer); }
}
