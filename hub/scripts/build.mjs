import { build } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync,readFileSync,writeFileSync,rmSync,copyFileSync } from 'node:fs';
import { resolve,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogSource } from './catalog-source.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
function files(dir) { return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(resolve(dir,e.name)):[resolve(dir,e.name)]).sort(); }
const sources=files(root).filter(p=>!/[\\/](dist|test-results)[\\/]/.test(p));
const hash=createHash('sha256');for(const p of sources){hash.update(relative(root,p));hash.update(readFileSync(p));}
// An operator-verified catalog must produce a different immutable hub version.
const catalog=catalogSource(root);hash.update('effective-catalog');hash.update(catalog.bytes);
process.env.HUB_BUILD_ID??=`hub-${hash.digest('hex').slice(0,16)}`;
rmSync(resolve(root,'dist'),{recursive:true,force:true});
await build({configFile:resolve(root,'vite.config.ts'),logLevel:'warn'});
const release=resolve(root,'dist/releases',process.env.HUB_BUILD_ID);
writeFileSync(resolve(release,'version.json'),JSON.stringify({buildId:process.env.HUB_BUILD_ID,sourceSha:process.env.SOURCE_SHA??null,catalogSha256:catalog.hash})+'\n');
const sums=files(release).map(p=>`${createHash('sha256').update(readFileSync(p)).digest('hex')}  ${relative(release,p)}`).join('\n')+'\n';
writeFileSync(resolve(release,'SHA256SUMS'),sums);
copyFileSync(resolve(release,'index.html'),resolve(root,'dist/index.html'));
console.log(`Hub built: ${process.env.HUB_BUILD_ID} — hub/dist/index.html + immutable release`);
