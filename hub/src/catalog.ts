export type Game = {
  id: string; title: string; description: string; status: 'playable' | 'soon';
  launchPath: string | null; scene: string;
  poster: { desktop: string; mobile: string; width: number; height: number };
};
export type Manifest = {
  version: 1; model: string; behavior: 'forge' | 'throne' | 'moving';
  hero: string; anchors: ['anchor_approach', 'anchor_entry', 'anchor_inside'];
};
export function safeLaunchPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\s?#]/.test(value)) return false;
  try {
    // Reject encoded separators and dot segments before URL normalization.
    let decoded = value;
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    return decoded.startsWith('/') && !decoded.startsWith('//') && !/[\\\s?#%]/.test(decoded)
      && !decoded.split('/').some(s => s === '.' || s === '..');
  } catch { return false; }
}
export function safeAssetPath(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9/_ .-]*\.(glb|json|webp|png)$/.test(value)
    && !value.includes(' ') && !value.split('/').some(s => s === '.' || s === '..');
}
export function validateCatalog(value: unknown): Game[] {
  if (!Array.isArray(value)) throw new Error('Catalog must be an array');
  const ids = new Set<string>();
  for (const game of value) {
    if (!game || typeof game !== 'object' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(game.id) || ids.has(game.id)) throw new Error('Invalid or duplicate game id');
    ids.add(game.id);
    for (const key of ['title', 'description']) if (typeof game[key] !== 'string' || !game[key].trim()) throw new Error(`Missing ${key}`);
    if (!['playable', 'soon'].includes(game.status)) throw new Error('Unknown status');
    if (game.status === 'playable' ? !safeLaunchPath(game.launchPath) || /^\/hub(?:\/|$)|^\/api(?:\/|$)/.test(game.launchPath) : game.launchPath !== null) throw new Error('Invalid launch path');
    if (!safeAssetPath(game.scene) || !game.poster || !safeAssetPath(game.poster.desktop) || !safeAssetPath(game.poster.mobile)
      || !Number.isInteger(game.poster.width) || game.poster.width <= 0 || !Number.isInteger(game.poster.height) || game.poster.height <= 0) throw new Error('Invalid scene or poster');
  }
  return value as Game[];
}
export function validateManifest(value: unknown): Manifest {
  const m = value as Manifest;
  if (!m || m.version !== 1 || !['forge', 'throne', 'moving'].includes(m.behavior)
    || !safeAssetPath(m.model) || !safeAssetPath(m.hero)
    || JSON.stringify(m.anchors) !== JSON.stringify(['anchor_approach', 'anchor_entry', 'anchor_inside'])) throw new Error('Incompatible scene manifest');
  return m;
}
