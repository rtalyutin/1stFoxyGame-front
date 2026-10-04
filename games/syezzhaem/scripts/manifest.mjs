import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
const digest=b=>createHash('sha256').update(b).digest('hex');
const buildId=process.env.BUILD_ID ?? 'r1-local-001';
if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(buildId))throw new Error('Unsafe BUILD_ID');
const files={};
async function walk(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=resolve(dir,entry.name);
    if(entry.isSymbolicLink())throw new Error('Release symlink rejected');
    if(entry.isDirectory())await walk(path);
    else if(entry.isFile() && entry.name !== 'release-manifest.json'){
      const bytes=await readFile(path);files[relative(resolve('dist'),path).replaceAll('\\','/')]={bytes:bytes.length,sha256:digest(bytes)};
    }
  }
}
await walk('dist');
if(!files['index.html'])throw new Error('Missing entry');
const manifest={manifest_version:1,build_id:buildId,entry_url:`/games/syezzhaem/releases/${buildId}/`,api_version:'v1',content_version:'r1-map-1',rules_version:'r1-rules-1',snapshot_schema_version:1,level_id:'house-bridge-portal',files:Object.fromEntries(Object.entries(files).sort())};
await writeFile('dist/release-manifest.json',JSON.stringify(manifest,null,2)+'\n');
const sources={};
async function sourceWalk(dir){
  let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const entry of entries){if(entry.name==='__pycache__'||entry.name.endsWith('.pyc'))continue;const path=`${dir}/${entry.name}`;if(entry.isSymbolicLink())throw new Error('Source symlink rejected');if(entry.isDirectory())await sourceWalk(path);else if(entry.isFile())sources[path]=digest(await readFile(path));}
}
for(const dir of ['src','server','db','scripts','tests','spec','licenses','public','deploy'])await sourceWalk(dir);
for(const file of ['index.html','package.json','package-lock.json','tsconfig.json','vite.config.ts','README.md','TASK_STATE.md']){try{sources[file]=digest(await readFile(file));}catch(error){if(error.code!=='ENOENT')throw error;}}
const ordered=Object.fromEntries(Object.entries(sources).sort(([a],[b])=>a.localeCompare(b)));
const pkg=JSON.parse(await readFile('package.json','utf8'));
await writeFile('build-manifest.json',JSON.stringify({build_id:buildId,sourceRevision:null,sourceDigest:digest(JSON.stringify(ordered)),sources:ordered,releaseManifestSha256:digest(await readFile('dist/release-manifest.json')),contracts:{api:'v1',snapshot:1,content:'r1-map-1',rules:'r1-rules-1',level:'house-bridge-portal'},dependencies:pkg.dependencies,devDependencies:pkg.devDependencies},null,2)+'\n');
console.log(`Release ${buildId}: ${Object.keys(files).length} verified files`);
