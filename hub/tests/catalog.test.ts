import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateCatalog,safeLaunchPath,validateManifest } from '../src/catalog';
import { visibleRange,residentSet,stepPosition,gameCount } from '../src/geometry';
const catalog=JSON.parse(readFileSync(new URL('../games.json',import.meta.url),'utf8'));
describe('public catalog and URLs',()=> {
  it('keeps the three real entries and only the supplied root route playable',()=> {
    const games=validateCatalog(catalog);expect(games.map(g=>g.id)).toEqual(['runner-forge','last-throne','syezzhaem']);
    expect(games.filter(g=>g.status==='playable').map(g=>g.launchPath)).toEqual(['/']);
  });
  it.each(['//evil.test','/../x','/%2e%2e/x','/%252e%252e/x','/%2f/evil','/x\\y','javascript:1','/x?redirect=1','/x%20y'])('rejects unsafe path %s',path=>expect(safeLaunchPath(path)).toBe(false));
  it('rejects duplicate ids, wrong status and missing launch route',()=> {
    expect(()=>validateCatalog([catalog[0],catalog[0]])).toThrow();
    expect(()=>validateCatalog([{...catalog[0],status:'active'}])).toThrow();
    expect(()=>validateCatalog([{...catalog[0],launchPath:null}])).toThrow();
    expect(()=>validateCatalog([{...catalog[0],launchPath:'/hub/'}])).toThrow();
    expect(()=>validateManifest({version:2})).toThrow();
  });
});
describe('native carousel geometry',()=> {
  it('counts only complete horizontal bounds',()=>expect(visibleRange([{left:0,right:100},{left:124,right:224},{left:248,right:348}],300)).toEqual([0,1]));
  it('pins preparing selection without activating it and keeps one adjacent neighbor',()=>expect([...residentSet([4,5,6,7],12,0)]).toEqual([4,5,6,7,3,8,0]));
  it('steps a single item and clamps the final position',()=> {
    expect(stepPosition(0,[0,124,248,372],300,1)).toBe(124);
    expect(stepPosition(248,[0,124,248,372],300,1)).toBe(300);
    expect(stepPosition(300,[0,124,248,372],300,-1)).toBe(248);
  });
  it('declines numbers including 11 and 21',()=>expect([1,2,5,11,21].map(gameCount)).toEqual(['1 игра','2 игры','5 игр','11 игр','21 игра']));
});
