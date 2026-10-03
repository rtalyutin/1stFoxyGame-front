import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// CI checks out the precisely pinned backend revision at .ci-backend. Local
// callers may set BACKEND_ROOT_PATH to another checkout; missing files fail.
const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const backendRoot = resolve(frontendRoot, process.env.BACKEND_ROOT_PATH || '.ci-backend');
const read = (root, path) => readFile(resolve(root, path), 'utf8');

const source = await read(frontendRoot, 'src/game/equipment.ts');
// TypeScript 7 exposes a native compiler rather than transpileModule. The
// project's Node 24 engine erases this module's types without a dependency.
const emittedCode = stripTypeScriptTypes(source, { mode: 'strip', sourceUrl: 'equipment.ts' });
// The module has only erased type imports. Loading the emitted module tests its
// real export and validator; no regex extraction substitutes for execution.
const clientModule = await import(`data:text/javascript;base64,${Buffer.from(emittedCode).toString('base64')}`);
const backendCatalog = JSON.parse(await read(backendRoot, 'content/equipment.json'));
assert.deepStrictEqual(clientModule.EQUIPMENT_CATALOG, backendCatalog, 'Client and backend equipment catalogs differ');
console.log(`Equipment catalog agrees: ${createHash('sha256').update(JSON.stringify(backendCatalog)).digest('hex')}`);

// Browser bundling resolves extensionless TS imports; NodeNext uses .js. This
// normalization affects only import/export specifiers, not gameplay code.
const normalizeImports = (input) => input.replace(/\r\n/g, '\n').replace(
  /(\bfrom\s+['"]\.\.?\/[^'"\n]+)\.js(['"])/g,
  '$1$2',
);
// Snapshot export/restore/validation lives inside simulation.ts.
for (const name of ['simulation', 'config']) {
  const frontendSource = normalizeImports(await read(frontendRoot, `src/game/${name}.ts`));
  const backendSource = normalizeImports(await read(backendRoot, `src/combat/${name}.ts`));
  assert.equal(frontendSource, backendSource, `Frontend/backend combat source differs: ${name}.ts`);
  console.log(`Combat source agrees: ${name}.ts ${createHash('sha256').update(frontendSource).digest('hex')}`);
}
