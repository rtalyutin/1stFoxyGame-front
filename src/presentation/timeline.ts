import type { Enemy, RunState } from '../game/simulation';

/** Consume every logic tick, including events that disappear before the next render. */
export class PresentationTimeline {
  private runId = '';
  private previousX = 0;
  private previousTick = -1;
  private castAt = 0;
  private returningAt = 0;
  private previousHookPhase = '';
  private movement = 'run';
  private deathSeconds = 0;
  private hits = new Map<string, number>();
  private shots = new Map<string, number>();

  observe(state: RunState): void {
    if (state.runId !== this.runId) {
      this.reset(); this.runId = state.runId; this.previousX = state.hero.x;
    }
    if (state.tick === this.previousTick) return;
    this.previousTick = state.tick;
    const dx = state.hero.x - this.previousX;
    this.movement = dx < -0.0001 ? 'strafe_left' : dx > 0.0001 ? 'strafe_right' : 'run';
    this.previousX = state.hero.x;
    for (const event of state.events) {
      if (event.type === 'cast') this.castAt = event.at;
      if (event.type === 'hit' && event.enemyId) this.hits.set(event.enemyId, event.at);
      if (event.type === 'shoot' && event.enemyId) this.shots.set(event.enemyId, event.at);
    }
    if (state.hook?.phase === 'returning' && this.previousHookPhase !== 'returning') this.returningAt = state.time;
    this.previousHookPhase = state.hook?.phase ?? '';
    const ids = new Set(state.enemies.map(enemy => enemy.id));
    for (const id of this.hits.keys()) if (!ids.has(id)) this.hits.delete(id);
    for (const id of this.shots.keys()) if (!ids.has(id)) this.shots.delete(id);
  }

  hero(state: RunState, delta: number): { clip: string; seconds: number; loop: boolean } {
    if (state.phase === 'gameOver') {
      this.deathSeconds = Math.min(1, this.deathSeconds + Math.min(delta, 0.1));
      return { clip: 'death', seconds: this.deathSeconds, loop: false };
    }
    if (state.hook?.phase === 'returning') return {
      clip: state.hook.capturedEnemyId ? 'hook_return_capture' : 'hook_return_empty',
      seconds: state.time - this.returningAt, loop: false,
    };
    if (state.hook) {
      const elapsed = state.time - this.castAt;
      return elapsed < 0.8 ? { clip: 'hook_cast', seconds: elapsed, loop: false }
        : { clip: 'hook_hold', seconds: elapsed - 0.8, loop: true };
    }
    return { clip: this.movement, seconds: state.time, loop: true };
  }

  creep(id: string, time: number, captured: boolean): { clip: string; seconds: number; loop: boolean } {
    if (!captured) {
      const hitAt = this.hits.get(id);
      if (hitAt !== undefined && time - hitAt < 0.6) return { clip: 'hit', seconds: time - hitAt, loop: false };
      return { clip: 'run', seconds: time, loop: true };
    }
    const elapsed = time - (this.hits.get(id) ?? time);
    return elapsed < 0.6 ? { clip: 'hit', seconds: elapsed, loop: false }
      : { clip: 'death_capture', seconds: elapsed - 0.6, loop: true };
  }

  enemy(enemy: Enemy, time: number, telegraphSeconds: number, duration: (clip: string) => number): { clip: string; seconds: number; loop: boolean } {
    if (enemy.kind === 'normal') return this.creep(enemy.id, time, enemy.status === 'captured');
    const hit = this.hits.get(enemy.id), elapsed = hit === undefined ? Infinity : time - hit;
    if (enemy.status === 'captured') {
      if(hit===undefined)return{clip:'death_capture',seconds:0,loop:false};
      const death = enemy.kind === 'boss' ? 'death' : 'hit', seconds = duration(death);
      return elapsed < seconds ? {clip:death,seconds:elapsed,loop:false} : {clip:'death_capture',seconds:Math.max(0,elapsed-seconds),loop:true};
    }
    if (enemy.kind === 'boss' && hit !== undefined) {
      const recovery=duration('hit_recover'),escape=duration('break_free');
      if(elapsed<recovery)return{clip:'hit_recover',seconds:elapsed,loop:false};
      if(elapsed<recovery+escape)return{clip:'break_free',seconds:elapsed-recovery,loop:false};
    }
    if(enemy.shooting?.phase==='telegraph')return{clip:'shoot_prepare',seconds:Math.max(0,Math.min(1,1-enemy.shooting.remaining/telegraphSeconds))*duration('shoot_prepare'),loop:false};
    const shot=this.shots.get(enemy.id);
    if(shot!==undefined&&time-shot<duration('shoot'))return{clip:'shoot',seconds:time-shot,loop:false};
    return{clip:'run',seconds:time,loop:true};
  }

  reset(): void {
    this.runId = ''; this.previousX = 0; this.previousTick = -1;
    this.castAt = 0; this.returningAt = 0; this.previousHookPhase = '';
    this.movement = 'run'; this.deathSeconds = 0; this.hits.clear(); this.shots.clear();
  }
}
