import {it,expect,vi} from 'vitest';
import {assetBytes} from './asset-bytes';
it('shares concurrent hero requests across scenes and lets a refused asset load retry',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response(new Uint8Array([1,2,3]))).mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(new Response(new Uint8Array([4])));
 vi.stubGlobal('fetch',fetch);
 try{const first=assetBytes('shared-test.glb'),second=assetBytes('shared-test.glb');expect(first).toBe(second);expect([...await first]).toEqual([1,2,3]);expect(fetch).toHaveBeenCalledTimes(1);
 await expect(assetBytes('retry-test.glb')).rejects.toThrow('503');expect([...await assetBytes('retry-test.glb')]).toEqual([4]);expect(fetch).toHaveBeenCalledTimes(3);}finally{vi.unstubAllGlobals();}
});
