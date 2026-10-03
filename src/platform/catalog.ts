import { DEFAULT_CONFIG, RULES_VERSION } from '../game/config';
import type { SimulationConfig } from '../game/config';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректный каталог правил');
  return value as ObjectValue;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error('Некорректный каталог правил');
  return value;
};

/** Reject a mismatched backend/frontend pair before creating a combat snapshot. */
export function validateCatalog(value: unknown): Readonly<SimulationConfig> {
  const catalog = object(value);
  if (catalog.rulesVersion !== RULES_VERSION || catalog.catalogVersion !== RULES_VERSION) {
    throw new Error('Версии правил клиента и сервера различаются. Обнови страницу.');
  }
  if (array(catalog.modifiers).length !== 0) throw new Error('Неизвестные модификаторы правил');
  const rules = object(catalog.rules);
  const same = (actual: unknown, expected: unknown) => {
    if (actual !== expected) throw new Error('Правила сервера не соответствуют этой сборке. Обнови страницу.');
  };
  const exclusions = new Set(['spawning', 'strongRadius', 'bossRadius', 'bossEnemySpeed', 'bossRequiredHits',
    'projectileRadius', 'projectileSpeed', 'projectileLifetime', 'shooterTelegraph', 'shooterInterval',
    'bossTelegraph', 'bossInterval', 'bossVolleyDegrees']);
  for (const [key, expected] of Object.entries(DEFAULT_CONFIG)) if (!exclusions.has(key)) same(rules[key], expected);
  const enemies = array(catalog.enemies).map(object);
  if (enemies.length !== 3 || new Set(enemies.map(enemy => enemy.code)).size !== 3) throw new Error('Некорректный каталог врагов');
  for (const [code, radius, speed, hits, weapon] of [
    ['normal', DEFAULT_CONFIG.enemyRadius, DEFAULT_CONFIG.enemySpeed, 1, null],
    ['strong', DEFAULT_CONFIG.strongRadius, DEFAULT_CONFIG.enemySpeed, 1, 'strong-shot'],
    ['boss', DEFAULT_CONFIG.bossRadius, DEFAULT_CONFIG.bossEnemySpeed, DEFAULT_CONFIG.bossRequiredHits, 'boss-volley'],
  ]) {
    const enemy = enemies.find(enemy => enemy.code === code);
    if (!enemy) throw new Error('В каталоге отсутствует обязательный враг');
    same(enemy.radius, radius); same(enemy.worldSpeed, speed); same(enemy.requiredHits, hits); same(enemy.weaponCode, weapon);
    if (array(enemy.modifiers).length !== 0) throw new Error('Неизвестный модификатор врага');
  }
  const weapons = array(catalog.weapons).map(object);
  if (weapons.length !== 2 || new Set(weapons.map(weapon => weapon.code)).size !== 2) throw new Error('Некорректный каталог оружия');
  for (const [code, telegraph, interval, angles] of [
    ['strong-shot', DEFAULT_CONFIG.shooterTelegraph, DEFAULT_CONFIG.shooterInterval, [0]],
    ['boss-volley', DEFAULT_CONFIG.bossTelegraph, DEFAULT_CONFIG.bossInterval, [-DEFAULT_CONFIG.bossVolleyDegrees, 0, DEFAULT_CONFIG.bossVolleyDegrees]],
  ] as const) {
    const weapon = weapons.find(weapon => weapon.code === code);
    if (!weapon) throw new Error('Отсутствует оружие врага');
    same(weapon.telegraphSeconds, telegraph); same(weapon.shotIntervalSeconds, interval);
    same(weapon.projectileSpeed, DEFAULT_CONFIG.projectileSpeed);
    same(weapon.projectileRadius, DEFAULT_CONFIG.projectileRadius);
    same(weapon.projectileLifetimeSeconds, DEFAULT_CONFIG.projectileLifetime);
    const actualAngles = array(weapon.anglesDegrees);
    same(actualAngles.length, angles.length); angles.forEach((angle, i) => same(actualAngles[i], angle));
  }
  return DEFAULT_CONFIG;
}

export async function loadCatalog(fetcher: typeof fetch = fetch): Promise<Readonly<SimulationConfig>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetcher('/api/v1/catalog', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Каталог правил недоступен. Попробуй снова.');
    return validateCatalog(await response.json());
  } finally { clearTimeout(timer); }
}
