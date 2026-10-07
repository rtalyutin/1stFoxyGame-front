import { describe, expect, it } from 'vitest';
import { canSettleProduction, WorkshopNavigation } from './workshop-navigation';

describe('safe workshop return address', () => {
  it('opens only from gallery, final results or a confirmed shop', () => {
    const nav = new WorkshopNavigation();
    for (const phase of ['RUNNING','COUNTDOWN','PAUSED','LOGIN','BOOT'] as const) expect(nav.enter(phase,null)).toBe(false);
    expect(nav.enter('GALLERY',{runId:'run',phase:'running'})).toBe(false);
    expect(nav.enter('SHOP',{runId:'run',phase:'paused'})).toBe(false);
    expect(nav.enter('SHOP',null)).toBe(false);
    expect(nav.enter('GAME_OVER',null)).toBe(false);
    expect(nav.enter('GALLERY',null)).toBe(true); expect(nav.leave(null)).toBe('GALLERY');
  });
  it('returns to the same shop after background or server confirmations', () => {
    const nav = new WorkshopNavigation(), shop = {runId:'shop-run',phase:'shop'};
    expect(nav.enter('SHOP',shop)).toBe(true); expect(nav.valid(structuredClone(shop))).toBe(true);
    expect(nav.leave(shop)).toBe('SHOP'); expect(nav.origin).toBeNull();
  });
  it('never resumes a run after another device changes the safe origin', () => {
    const nav = new WorkshopNavigation(); nav.enter('SHOP',{runId:'old-run',phase:'shop'});
    expect(nav.valid({runId:'new-run',phase:'shop'})).toBe(false);
    expect(nav.leave({runId:'new-run',phase:'running'})).toBe('PAUSED');
    nav.enter('GAME_OVER',{runId:'old-run',phase:'gameOver'});
    expect(nav.leave(null)).toBe('GALLERY');
    nav.enter('GALLERY',null); expect(nav.leave({runId:'new-run',phase:'running'})).toBe('PAUSED');
  });
  it('keeps a visible pause earning while leaving battle and countdown to their existing queue', () => {
    for (const phase of ['GALLERY','GAME_OVER','SHOP','WORKSHOP','PAUSED'] as const) expect(canSettleProduction(phase)).toBe(true);
    for (const phase of ['RUNNING','COUNTDOWN','BOOT','LOGIN'] as const) expect(canSettleProduction(phase)).toBe(false);
  });
  it('spectator screens do not commit passive settlement revisions', () => {
    for (const phase of ['GALLERY','GAME_OVER','SHOP','WORKSHOP','PAUSED'] as const) expect(canSettleProduction(phase,true)).toBe(false);
    expect(canSettleProduction('PAUSED',false)).toBe(true);
  });
});
