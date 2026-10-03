import { describe, it, expect } from 'vitest';
import { RunSimulation } from '../game/simulation';
import { PresentationTimeline } from './timeline';

describe('presentation time and event adapter', () => {
  it('shows a nonlethal boss impact, freezes it on pause, and returns to running', () => {
    const sim = new RunSimulation('boss-pose', 7, {
      config: { spawning: false, heroSpeed: 0, bossEnemySpeed: 0, bossInterval: 1000 },
      initialEnemies: [{ id: 'boss', kind: 'boss', x: 0, z: 10 }],
    });
    const timeline = new PresentationTimeline(); timeline.observe(sim.state);
    sim.step([{ type: 'cast', aim: { x: 0, z: 10 } }]); timeline.observe(sim.state);
    while (sim.state.enemies[0].hitsRemaining === 3) { sim.step(); timeline.observe(sim.state); }
    expect(sim.state.enemies[0].status).toBe('alive');
    const pose = timeline.creep('boss', sim.state.time, false);
    expect(pose.clip).toBe('hit');
    sim.pause(); sim.step(); timeline.observe(sim.state);
    expect(timeline.creep('boss', sim.state.time, false)).toEqual(pose);
    sim.resume();
    for (let i = 0; i < 50; i++) { sim.step(); timeline.observe(sim.state); }
    expect(timeline.creep('boss', sim.state.time, false).clip).toBe('run');
  });
  it('retains a hit across several ticks in one frame and freezes during pause', () => {
    const sim = new RunSimulation('capture', 4, { initialEnemies: [{ id: 'target', x: 0, z: 25 }] });
    const timeline = new PresentationTimeline(); timeline.observe(sim.state);
    sim.step([{ type: 'cast', aim: { x: 0, z: 25 } }]); timeline.observe(sim.state);
    while (!sim.state.hook?.capturedEnemyId) { sim.step(); timeline.observe(sim.state); }
    for (let index = 0; index < 3; index++) { sim.step(); timeline.observe(sim.state); }
    expect(sim.state.events).toHaveLength(0);
    const pose = timeline.creep('target', sim.state.time, true);
    expect(pose.clip).toBe('hit'); expect(pose.seconds).toBeGreaterThan(0.03);
    sim.pause(); const before = timeline.hero(sim.state, 0.02);
    sim.step(); timeline.observe(sim.state);
    expect(timeline.hero(sim.state, 0.1)).toEqual(before);
    expect(timeline.creep('target', sim.state.time, true)).toEqual(pose);
  });

  it('detects an empty range return without an event and resets between runs', () => {
    const sim = new RunSimulation('empty', 3); const timeline = new PresentationTimeline();
    timeline.observe(sim.state);
    sim.step([{ type: 'cast', aim: { x: 20, z: 25 } }]); timeline.observe(sim.state);
    while (sim.state.hook?.phase === 'outbound') { sim.step(); timeline.observe(sim.state); }
    expect(timeline.hero(sim.state, 0.02).clip).toBe('hook_return_empty');
    const fresh = new RunSimulation('fresh', 3); timeline.observe(fresh.state);
    expect(timeline.hero(fresh.state, 0.02)).toEqual({ clip: 'run', seconds: 0, loop: true });
  });

  it('finishes visual death without advancing the terminal simulation', () => {
    const sim = new RunSimulation('death', 1, { initialEnemies: [{ x: 0, z: 0.2 }] });
    sim.step(); const timeline = new PresentationTimeline(); timeline.observe(sim.state);
    const time = sim.state.time;
    for (let index = 0; index < 20; index++) timeline.hero(sim.state, 0.1);
    expect(timeline.hero(sim.state, 0.1)).toEqual({ clip: 'death', seconds: 1, loop: false });
    expect(sim.state.time).toBe(time);
  });
});
