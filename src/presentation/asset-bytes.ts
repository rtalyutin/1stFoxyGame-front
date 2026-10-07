/** Share immutable model bytes between scenes within this document only. */
const pending=new Map<string,Promise<Uint8Array>>();
export function assetBytes(path:string):Promise<Uint8Array>{
 const existing=pending.get(path);if(existing)return existing;
 const request=(async()=>{
  const response=await fetch(import.meta.env.BASE_URL+path,{signal:AbortSignal.timeout(20000),cache:'no-cache'});
  if(!response.ok)throw new Error(`Model HTTP ${response.status}: ${path}`);
  return new Uint8Array(await response.arrayBuffer());
 })();pending.set(path,request);
 void request.catch(()=>{if(pending.get(path)===request)pending.delete(path);});return request;
}
