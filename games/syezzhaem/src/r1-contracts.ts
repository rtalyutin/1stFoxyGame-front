import type { SnapshotV1 } from './snapshot-v1.js';
export type { SnapshotV1, BuildContext, CellOverride } from './snapshot-v1.js';
export type RunLifecycle = 'active' | 'won' | 'lost' | 'abandoned';
export interface ResultDto {
  outcome: 'playing' | 'won' | 'lost'; score: number; elapsed_seconds: number;
  retained_fraction: number; distance: number; cat_saved: false; chest_saved: false;
}
export interface RunDto {
  run_id: string; revision: number; lifecycle: RunLifecycle; checkpoint: SnapshotV1;
  started_at: string; updated_at: string; finished_at?: string | null; result?: ResultDto | null;
}
export interface ProfileDto {
  profile_id: string; revision: number; display_name: string;
  sound_enabled: boolean; sound_volume: number; quality: 'low' | 'medium'; controls_hint_seen: boolean;
}
export interface CatalogEntry {
  level_id: string; title: string; content_version: string; rules_version: string; client_build_id: string;
}
export interface BootstrapDto {
  user_id: string; profile: ProfileDto; active_run: RunDto | null;
  catalog: CatalogEntry[]; compatible_versions: string[];
}
export interface HistoryDto { items: RunDto[]; next_cursor: string | null }
export interface RpcError { code: string; message: string; path?: string; details?: unknown }
export type Envelope<T> = { ok: true; data: T; error: null; request_id: string | null }
  | { ok: false; data: null; error: RpcError; request_id: string | null };
