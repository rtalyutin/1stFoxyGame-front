import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function catalogSource(root, override = process.env.HUB_CATALOG_FILE) {
  const path = override ? resolve(override) : resolve(root, 'games.json');
  const bytes = readFileSync(path);
  return { path, bytes, hash: createHash('sha256').update(bytes).digest('hex') };
}
