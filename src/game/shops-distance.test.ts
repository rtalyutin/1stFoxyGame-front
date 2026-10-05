import { describe, it, expect } from 'vitest';
import { FIXED_STEP } from './config';
import { RunSimulation, type SimulationRuntimeBalance } from './simulation';
const runtime: SimulationRuntimeBalance = {shopMinDistance:100,shopMaxDistance:100,shopRightProbability:.5,shooterChanceStart:.12,shooterChanceMax:.4,shooterChanceRampSeconds:300,slowDurationSeconds:3,slowSpeedMultiplier:.65,collectorKills:10,collectorGoldMultiplierMilli:1200};
describe('shops every100m under a pinned runtime balance', () => {
  it.each([2,4])('uses travelled metres at hero speed%s and restores the exact stream', speed => {
    const sim = new RunSimulation('shops-100', 42, {config:{spawning:true,heroSpeed:speed,spawnMinSeconds:10000,spawnMaxSeconds:10000,bossFirstSeconds:10000},runtimeBalance:runtime});
    const markers: number[] = []; let restored: RunSimulation | null = null;
    for (let tick=0;tick<Math.ceil(320/speed/FIXED_STEP);tick++) {
      sim.step(); restored?.step();
      if (restored) expect(restored.exportSnapshot()).toEqual(sim.exportSnapshot());
      for (const event of sim.state.events.filter(e => e.type==='shopCandidate')) markers.push(sim.state.shopCandidates.find(s=>Math.abs(s.at-event.at)<1e-8)!.z);
      if (Math.abs(sim.state.hero.z-100)<speed*FIXED_STEP/2 && !restored) restored=RunSimulation.restore(sim.exportSnapshot());
    }
    expect(markers).toHaveLength(3);
    markers.forEach((z,i)=>expect(z).toBeCloseTo(136+i*100,7));
    expect(restored).not.toBeNull();
  });
  it('enters at134m, freezes timers, leaves paused and cannot reuse the same store', () => {
    const sim=new RunSimulation('shop-entry',42,{config:{spawning:true,spawnMinSeconds:10000,spawnMaxSeconds:10000,bossFirstSeconds:10000},runtimeBalance:runtime});
    while(sim.state.hero.z<134-1e-8)sim.step();
    const candidate=sim.state.shopCandidates[0];sim.state.hero.x=candidate.x;
    expect(sim.canEnterShop).toBe(true);expect(sim.enterShop(candidate.id)).toBe(true);
    const frozen=sim.exportSnapshot();for(let i=0;i<100;i++)sim.step();expect(sim.exportSnapshot()).toEqual(frozen);
    expect(RunSimulation.restore(frozen).state.phase).toBe('shop');
    expect(sim.leaveShop()).toBe(true);expect(sim.state.phase).toBe('paused');sim.resume();expect(sim.enterShop(candidate.id)).toBe(false);
  });
});
