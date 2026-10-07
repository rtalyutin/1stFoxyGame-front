export type WorkshopOrigin = 'GALLERY' | 'GAME_OVER' | 'SHOP';
export type WorkshopPhase = WorkshopOrigin | 'BOOT' | 'LOGIN' | 'COUNTDOWN' | 'RUNNING' | 'PAUSED' | 'WORKSHOP';
export interface WorkshopRunState { runId: string; phase: string; }
export function canSettleProduction(phase: WorkshopPhase, readOnly = false): boolean {
  return !readOnly && ['GALLERY','GAME_OVER','SHOP','WORKSHOP','PAUSED'].includes(phase);
}

/** Workshop never owns a battle transition: it remembers only a safe address. */
export class WorkshopNavigation {
  origin: WorkshopOrigin | null = null;
  private shopRunId: string | null = null;
  enter(phase: WorkshopPhase, run: WorkshopRunState | null): boolean {
    if (phase !== 'GALLERY' && phase !== 'GAME_OVER' && phase !== 'SHOP') return false;
    if (run && run.phase !== 'gameOver' && !(phase === 'SHOP' && run.phase === 'shop')) return false;
    if (phase === 'SHOP' && !run || phase === 'GAME_OVER' && run?.phase !== 'gameOver') return false;
    this.origin = phase; this.shopRunId = phase === 'SHOP' ? run!.runId : null; return true;
  }
  valid(run: WorkshopRunState | null): boolean {
    if (!this.origin) return false;
    if (this.origin === 'SHOP') return Boolean(run && run.runId === this.shopRunId && run.phase === 'shop');
    if (this.origin === 'GAME_OVER') return run?.phase === 'gameOver';
    return !run || run.phase === 'gameOver';
  }
  leave(run: WorkshopRunState | null): WorkshopOrigin | 'PAUSED' {
    const result = this.valid(run) ? this.origin! : run && run.phase !== 'gameOver' ? 'PAUSED' : 'GALLERY';
    this.clear(); return result;
  }
  clear(): void { this.origin = null; this.shopRunId = null; }
}
