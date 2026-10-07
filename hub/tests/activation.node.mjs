import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activate, activatedCatalog, probeDeployment, httpsOrigin } from '../scripts/activate-last-throne.mjs';
import { catalogSource } from '../scripts/catalog-source.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const original = JSON.parse(await readFile(new URL('../games.json', import.meta.url), 'utf8'));
function fixture(change = {}, {recomputeETag = false, camera = false} = {}) {
  const clientId = camera ? 'r3-content-002' : 'r3-001';
  const versions = { frontend:'r3-web-test', backend:'r3-api-test', core:'r3-core-1', content:'r3-content-1', metadataSchema:'r3-meta-1', saveFormat:4, api:1 };
  if (camera) versions.backend = 'r3-api-7b084f31d98e7e6f';
  const page = '<script src="./assets/game.js"></script>', script = 'console.log("play")';
  const manifest = { releaseId:clientId, sourceHash:'source', clientEntry:'web/index.html', versions,
    files:{ 'web/index.html':hash(page), 'web/assets/game.js':hash(script) } };
  const bytes = JSON.stringify(manifest);
  const content = {contentVersion:'r3-content-1',metadataSchemaVersion:'r3-meta-1'};
  const body = {
    '/td/':'fetch("/td/current.json")',
    '/td/current.json':{ releaseId:clientId,clientEntry:'web/index.html',manifestUrl:`/td/releases/${clientId}/manifest.json`,versions },
    [`/td/releases/${clientId}/manifest.json`]:bytes,
    '/td/api/v1/ready':{ ready:true,releaseId:'r3-001' },
    [`/td/api/v1/bootstrap?clientReleaseId=${clientId}`]:{clientReleaseId:clientId,apiReleaseId:'r3-001',versions,
      capabilities:{battle:true,profiles:true,cloudSaves:true},contentUrl:`/td/api/v1/content?clientReleaseId=${clientId}`},
    [`/td/api/v1/content?clientReleaseId=${clientId}`]:content,
    [`/td/releases/${clientId}/web/index.html`]:page, [`/td/releases/${clientId}/web/assets/game.js`]:script,
  };
  const apiBytes = JSON.stringify({ ...manifest, releaseId:'r3-001', versions:{...versions,frontend:'r3-web-old'}, compatibleClientReleases:['r3-001','r3-content-002'] });
  if (camera) {
    body['/td/releases/r3-001/manifest.json'] = apiBytes;
    body['/td/api/v1/version'] = { releaseId:'r3-001', versions:{...versions,frontend:'r3-web-old'} };
  }
  Object.assign(body, change);
  const requests=[];
  return { expected:{releaseId:clientId,sourceHash:'source',manifestSha256:hash(bytes),projectionHash:hash(JSON.stringify(content)),
    ...(camera ? {apiReleaseId:'r3-001',apiManifestSha256:hash(apiBytes),backend:versions.backend} : {})}, requests,
    fetchImpl:async (url, options) => {
      assert.equal(options.redirect,'error'); assert.equal(options.cache,'no-store'); assert.ok(options.signal);
      const u = new URL(url); assert.equal(u.origin,'https://games.test'); const path = u.pathname + u.search; requests.push(path);
      if (!Object.hasOwn(body,path)) return new Response('missing',{status:404});
      const value=body[path]; const text=typeof value==='string'?value:JSON.stringify(value);
      const headers=path.startsWith('/td/api/v1/content?')?{etag:`"sha256-${hash(recomputeETag?text:JSON.stringify(content))}"`}:{};
      return new Response(text,{status:200,headers});
    } };
}
test('ready deployment checks launcher, API, content and every client byte',async()=>{
  const f=fixture(), result=await probeDeployment('https://games.test',f.expected,f.fetchImpl);
  assert.equal(result.filesChecked,2); assert.ok(f.requests.includes('/td/releases/r3-001/web/assets/game.js'));
});
test('camera client002 is ready on the exact retained API001 and both immutable identities are checked',async()=>{
  const f=fixture({}, {camera:true}), result=await probeDeployment('https://games.test',f.expected,f.fetchImpl);
  assert.equal(result.releaseId,'r3-content-002'); assert.equal(result.filesChecked,2);
  assert.ok(f.requests.includes('/td/releases/r3-001/manifest.json'));
  assert.ok(f.requests.includes('/td/api/v1/version'));
});
test('camera activation refuses a different live API or backend and altered API001 manifest',async()=>{
  for(const change of [
    {'/td/api/v1/ready':{ready:true,releaseId:'r3-content-002'}},
    {'/td/api/v1/version':{releaseId:'r3-001',versions:{backend:'r3-api-other'}}},
    {'/td/releases/r3-001/manifest.json':'{}'},
    {'/td/api/v1/bootstrap?clientReleaseId=r3-content-002':{clientReleaseId:'r3-content-002',apiReleaseId:'r3-content-002'}},
  ]) {
    const f=fixture(change,{camera:true}); await assert.rejects(probeDeployment('https://games.test',f.expected,f.fetchImpl));
  }
  const f=fixture({}, {camera:true});
  await assert.rejects(probeDeployment('https://games.test',{...f.expected,apiReleaseId:'r3-other'},f.fetchImpl),/Unsupported/);
});
test('requires an explicit HTTPS origin and rejects credentials and unrelated paths',()=>{
  for(const origin of ['http://games.test','https://user:secret@games.test','https://games.test/hub/','https://games.test/?x=1']) assert.throws(()=>httpsOrigin(origin));
});
test('rejects a launcher selecting the old client',async()=>{
  const f=fixture({'/td/current.json':{releaseId:'r1-002',clientEntry:'web/index.html'}});
  await assert.rejects(probeDeployment('https://games.test',f.expected,f.fetchImpl),/select/);
});
test('rejects a modified release manifest',async()=>{
  const f=fixture({'/td/releases/r3-001/manifest.json':'{}'});
  await assert.rejects(probeDeployment('https://games.test',f.expected,f.fetchImpl),/manifest hash/);
});
test('rejects unready API',async()=>{
  const f=fixture({'/td/api/v1/ready':{ready:false,releaseId:'r3-001'}});
  await assert.rejects(probeDeployment('https://games.test',f.expected,f.fetchImpl),/not ready/);
});
test('rejects incompatible API and absent gameplay capabilities',async()=>{
  for (const value of [
    {clientReleaseId:'r3-001',apiReleaseId:'r1-002'},
    {clientReleaseId:'r3-001',apiReleaseId:'r3-001',versions:{},capabilities:{battle:false}},
  ]) {
    const f=fixture({'/td/api/v1/bootstrap?clientReleaseId=r3-001':value});
    await assert.rejects(probeDeployment('https://games.test',f.expected,f.fetchImpl));
  }
});
test('rejects content that disagrees with its ETag',async()=>{
  const f=fixture({'/td/api/v1/content?clientReleaseId=r3-001':{contentVersion:'r3-content-1',metadataSchemaVersion:'r3-meta-1',tampered:true}});
  await assert.rejects(probeDeployment('https://games.test',f.expected,f.fetchImpl),/Content identity/);
});
test('rejects modified R3 content even if the API recomputes a matching ETag',async()=>{
  const f=fixture({'/td/api/v1/content?clientReleaseId=r3-001':{contentVersion:'r3-content-1',metadataSchemaVersion:'r3-meta-1',tampered:true}},{recomputeETag:true});
  await assert.rejects(probeDeployment('https://games.test',f.expected,f.fetchImpl),/projection hash/);
});
test('rejects a missing or altered immutable client chunk',async()=>{
  const f=fixture({'/td/releases/r3-001/web/assets/game.js':'tampered'});
  await assert.rejects(probeDeployment('https://games.test',f.expected,f.fetchImpl),/Client hash/);
});
test('rejects redirects and oversized responses',async()=>{
  await assert.rejects(probeDeployment('https://games.test',fixture().expected,async()=>({ok:true,redirected:true})),/Unavailable/);
  await assert.rejects(probeDeployment('https://games.test',fixture().expected,async()=>new Response('x'.repeat(8*1024*1024+1))),/exceeds limit/);
});
test('only Last Throne changes; source default and other games remain intact',()=>{
  const before=JSON.stringify(original), activated=activatedCatalog(original);
  assert.equal(JSON.stringify(original),before);
  for(const g of original) {
    const next=activated.find(x=>x.id===g.id);
    assert.deepEqual(next,g.id==='last-throne'?{...g,status:'playable',launchPath:'/td/'}:g);
  }
});
test('failed readiness cannot create a catalog; successful activation is exclusive',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'td-activate-'));
  try {
    const catalogPath=join(dir,'games.json'), out=join(dir,'activated.json'); await writeFile(catalogPath,JSON.stringify(original));
    const bad=fixture({'/td/api/v1/ready':{ready:false}});
    await assert.rejects(activate({origin:'https://games.test',out,catalogPath,...bad}));
    await assert.rejects(readFile(out),{code:'ENOENT'});
    const good=fixture(); await activate({origin:'https://games.test',out,catalogPath,...good});
    const result=await readFile(out,'utf8'); assert.deepEqual(JSON.parse(result),activatedCatalog(original));
    await assert.rejects(activate({origin:'https://games.test',out,catalogPath,...good}),{code:'EEXIST'});
    assert.equal(await readFile(out,'utf8'),result);
    await assert.rejects(activate({origin:'https://games.test',out:catalogPath,catalogPath,...good}),/default catalog/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('effective catalog affects build identity and a missing override fails',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'td-build-catalog-'));
  try {
    await writeFile(join(dir,'games.json'),JSON.stringify(original));
    const override=join(dir,'ready.json'); await writeFile(override,JSON.stringify(activatedCatalog(original)));
    assert.notEqual(catalogSource(dir,override).hash,catalogSource(dir).hash);
    assert.throws(()=>catalogSource(dir,join(dir,'absent.json')));
  } finally { await rm(dir,{recursive:true,force:true}); }
});
