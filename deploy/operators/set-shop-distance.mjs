import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
const base = pathToFileURL(`${process.cwd()}/`);
const { default: pg } = await import(new URL('node_modules/pg/lib/index.js', base));
const { Client } = pg;
const { readBalance } = await import(new URL('dist/balance/store.js', base));
const { EntityStore } = await import(new URL('dist/db/entity-store.js', base));
const { BALANCE_PARAMETERS, BALANCE_TYPE_ID, BALANCE_POINTER_TYPE_ID, BALANCE_POINTER_ID, parameterCode, balanceDocument } = await import(new URL('dist/balance/model.js', base));
const expected = 'ca5b0000-0000-5000-a000-000000000001';
const keys = ['runtime.shopMaxDistance', 'runtime.shopMinDistance'];
let stage = 'configuration', client;
try {
  if (!['foxy', 'foxy_wood_verify_e785e29', 'foxy_ci'].includes(process.env.SHOP_PUBLISH_DATABASE)) throw new Error('DATABASE_NOT_ALLOWLISTED');
  if (Boolean(process.env.DATABASE_URL) === Boolean(process.env.DATABASE_URL_FILE)) throw new Error('ONE_DATABASE_SOURCE_REQUIRED');
  const connectionString = process.env.DATABASE_URL_FILE ? readFileSync(process.env.DATABASE_URL_FILE, 'utf8').trim() : process.env.DATABASE_URL;
  client = new Client({ connectionString }); await client.connect();
  const database = (await client.query('SELECT current_database() AS name')).rows[0].name;
  if (database !== process.env.SHOP_PUBLISH_DATABASE) throw new Error('DATABASE_MISMATCH');
  await client.query('BEGIN'); stage = 'transaction';
  await client.query("SET LOCAL search_path=public; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='30s'");
  const locks = await client.query('SELECT id FROM entity_types WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[BALANCE_TYPE_ID, BALANCE_POINTER_TYPE_ID, 'ca5d0000-0000-5000-a000-000000000001']]);
  if (locks.rowCount !== 3) throw new Error('TYPE_LOCK_MISMATCH');
  const old = await readBalance(client);
  if (old.revision !== expected || keys.some(k => old.values[k] !== 250)) throw new Error('BALANCE_REVISION_CONFLICT');
  const values = { ...old.values };
  for (const key of keys) values[key] = 100;
  deepStrictEqual(Object.keys(values).filter(k => values[k] !== old.values[k]).sort(), keys);
  const revision = randomUUID(), candidate = balanceDocument(revision, values);
  const store = new EntityStore(client); await store.create('runner-balance', revision);
  await store.set(revision, 'schema-version', { type:'text', value:'runner-balance.1' });
  await store.set(revision, 'published-at', { type:'timestamp', value:new Date() });
  for (const p of BALANCE_PARAMETERS) {
    const value = values[p.key];
    await store.set(revision, parameterCode(p.key), p.type === 'boolean' ? {type:'boolean',value} : p.type === 'integer' ? {type:'integer',value:BigInt(value)} : {type:'decimal',value:String(value)});
  }
  await store.publish(revision);
  const pointer = await client.query(`UPDATE entity_parameter_values v SET value_reference=$1
    FROM entity_parameters p, entities e WHERE p.id=v.parameter_id AND p.entity_type_id=$2
    AND p.code='active-revision' AND v.position=0 AND e.id=v.entity_id AND e.state='active'
    AND e.id=$3 AND v.value_reference=$4 RETURNING v.value_reference`, [revision, BALANCE_POINTER_TYPE_ID, BALANCE_POINTER_ID, expected]);
  if (pointer.rowCount !== 1) throw new Error('POINTER_CONFLICT');
  deepStrictEqual(await readBalance(client), candidate);
  deepStrictEqual(await readBalance(client, expected), old);
  await client.query('COMMIT'); stage = 'committed';
  deepStrictEqual(await readBalance(client), candidate);
  console.log(JSON.stringify({pass:true,database,previousRevision:expected,revision,changedKeys:keys,shopMinDistance:100,shopMaxDistance:100,previousRevisionUnchanged:true}));
} catch (error) {
  if (client && stage !== 'committed') await client.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify({pass:false,stage,code:/^[A-Z0-9_]+$/.test(error.message) ? error.message : error.code ?? 'OPERATOR_FAILED'}));
  process.exitCode = 1;
} finally { await client?.end(); }
