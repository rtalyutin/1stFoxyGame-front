import { createHash, randomUUID } from 'node:crypto';
import { readFile, open, mkdir, link, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from '../src/catalog.ts';

export const R2 = Object.freeze({
  releaseId: 'r2-001',
  sourceHash: 'b4cb38f2477b406608f648cb72e5c1c68a4aed8fd4f3fa84a88637e70d4b9bf8',
  manifestSha256: 'dafc60169b772214823799f89fc623d3b4f1f02ab0e69710f57e6ee57aa54dbf',
  projectionHash: 'f4cb8ef36a5e12d1c6e83902bff2227425cff313dbcf529f6a195360ccbbe9ed',
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])]));
  return value;
}
function requireCondition(value, message) { if (!value) throw new Error(message); }
export function httpsOrigin(input) {
  const u = new URL(input);
  requireCondition(u.protocol === 'https:' && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash,
    'Supply the HTTPS origin of the existing first game, without path or credentials');
  return u.origin;
}
async function resource(origin, path, fetchImpl, limit = 8 * 1024 * 1024) {
  const url = new URL(path, origin);
  requireCondition(url.origin === origin && url.pathname.startsWith('/td/'), 'Resource leaves the TD prefix');
  const response = await fetchImpl(url.href, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  requireCondition(response.ok && !response.redirected && (!response.url || response.url === url.href), `Unavailable resource: ${path}`);
  const chunks = []; let size = 0;
  requireCondition(response.body, `Empty resource: ${path}`);
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    requireCondition(size <= limit, `Resource exceeds limit: ${path}`);
    chunks.push(Buffer.from(chunk));
  }
  return { bytes: Buffer.concat(chunks), headers: response.headers };
}
async function json(origin, path, fetchImpl) {
  const r = await resource(origin, path, fetchImpl, 1024 * 1024);
  return { ...r, value: JSON.parse(r.bytes.toString('utf8')) };
}

// Probe is read-only. Every launcher dependency and all immutable client bytes
// must work before the catalog can advertise the game.
export async function probeDeployment(input, expected = R2, fetchImpl = fetch) {
  const origin = httpsOrigin(input), prefix = `/td/releases/${expected.releaseId}/`;
  const launcher = await resource(origin, '/td/', fetchImpl);
  requireCondition(launcher.bytes.includes(Buffer.from('/td/current.json')), 'TD launcher is missing');
  const current = (await json(origin, '/td/current.json', fetchImpl)).value;
  requireCondition(current.releaseId === expected.releaseId && current.clientEntry === 'web/index.html'
    && current.manifestUrl === `${prefix}manifest.json`, 'Launcher does not select the expected R2 client');
  const manifestResponse = await json(origin, `${prefix}manifest.json`, fetchImpl);
  requireCondition(sha256(manifestResponse.bytes) === expected.manifestSha256, 'Immutable R2 manifest hash differs');
  const manifest = manifestResponse.value;
  requireCondition(manifest.releaseId === expected.releaseId && manifest.sourceHash === expected.sourceHash
    && manifest.clientEntry === current.clientEntry, 'Release identity differs');
  requireCondition(canonical(current.versions) === canonical(manifest.versions), 'Launcher versions differ');
  const ready = (await json(origin, '/td/api/v1/ready', fetchImpl)).value;
  requireCondition(ready.ready === true && ready.releaseId === expected.releaseId, 'R2 API is not ready');
  const bootstrap = (await json(origin, `/td/api/v1/bootstrap?clientReleaseId=${expected.releaseId}`, fetchImpl)).value;
  requireCondition(bootstrap.clientReleaseId === expected.releaseId && bootstrap.apiReleaseId === expected.releaseId
    && canonical(bootstrap.versions) === canonical(manifest.versions), 'Bootstrap versions differ');
  requireCondition(['battle', 'profiles', 'cloudSaves'].every(k => bootstrap.capabilities?.[k] === true), 'Gameplay capabilities are unavailable');
  requireCondition(bootstrap.contentUrl === `/td/api/v1/content?clientReleaseId=${expected.releaseId}`, 'Content route differs');
  const content = await json(origin, bootstrap.contentUrl, fetchImpl);
  requireCondition(content.value.contentVersion === manifest.versions.content
    && content.value.metadataSchemaVersion === manifest.versions.metadataSchema
    && content.headers.get('etag') === `"sha256-${sha256(canonical(content.value))}"`, 'Content identity/hash differs');
  requireCondition(sha256(canonical(content.value)) === expected.projectionHash, 'Pinned R2 content projection hash differs');
  const entries = Object.entries(manifest.files).filter(([p]) => p.startsWith('web/'));
  requireCondition(entries.length > 0 && entries.length <= 1000 && entries.some(([p]) => p === 'web/index.html'), 'Client file inventory is missing');
  let bytes = 0;
  for (const [path, hash] of entries) {
    requireCondition(/^web\/[a-zA-Z0-9_./-]+$/.test(path) && !path.split('/').some(p => p === '.' || p === '..')
      && /^[a-f0-9]{64}$/.test(hash), 'Unsafe client inventory');
    const file = await resource(origin, prefix + path, fetchImpl);
    requireCondition(sha256(file.bytes) === hash, `Client hash differs: ${path}`);
    bytes += file.bytes.length;
    requireCondition(bytes <= 64 * 1024 * 1024, 'Client exceeds total size limit');
  }
  return { origin, releaseId: expected.releaseId, manifestSha256: expected.manifestSha256, filesChecked: entries.length,
    bytesChecked: bytes, checkedAt: new Date().toISOString() };
}

export function activatedCatalog(input) {
  const catalog = validateCatalog(structuredClone(input));
  const entry = catalog.find(g => g.id === 'last-throne');
  requireCondition(entry, 'Last Throne entry is absent');
  entry.status = 'playable'; entry.launchPath = '/td/';
  return validateCatalog(catalog);
}

export async function activate({ origin, out, catalogPath = fileURLToPath(new URL('../games.json', import.meta.url)), expected = R2, fetchImpl = fetch }) {
  const source = resolve(catalogPath), destination = resolve(out);
  requireCondition(destination !== source, 'Do not overwrite the default catalog');
  const catalog = activatedCatalog(JSON.parse(await readFile(source, 'utf8')));
  const proof = await probeDeployment(origin, expected, fetchImpl);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  // Expose the complete file atomically without replacing an existing catalog.
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try { const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(catalog, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
    await link(temporary, destination);
  } finally { await unlink(temporary).catch(() => {}); }
  return { ...proof, catalog: destination };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireCondition(args.length === 4 && args[0] === '--origin' && args[2] === '--out',
      'Usage: node hub/scripts/activate-last-throne.mjs --origin https://actual-origin --out /private/path/td-catalog.json');
    console.log(JSON.stringify(await activate({ origin: args[1], out: args[3] }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
