import type { Command } from '../game/simulation';
import { EQUIPMENT_CATALOG, validateProfile as validateDomainProfile, validateRecipe } from '../game/equipment';
import type { EquipmentCatalog, Operation, OperationResult, Profile, RunView } from '../game/equipment';
import { ApiError, GameApi, TransportError } from './api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = 'foxy-r34-client';
const PENDING_KEY = 'foxy-r34-pending';
const safeStore = (storage: Storage | undefined, key: string, value?: string) => {
  try { if (value === undefined) return storage?.getItem(key) ?? null; storage?.setItem(key, value); } catch { /* Storage may be disabled: session stays in memory. */ }
  return null;
};
export function clientId(storage?: Storage): string {
  const existing = safeStore(storage, KEY);
  if (existing && UUID.test(existing)) return existing;
  const id = crypto.randomUUID(); safeStore(storage, KEY, id); return id;
}
export interface TabChannel {
  postMessage(value: unknown): void;
  addEventListener(type: 'message', callback: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', callback: (event: MessageEvent) => void): void;
  close(): void;
}
/** A duplicated tab must not inherit a live tab's server control or pending command. */
export class TabIdentity {
  id: string;
  readonly ready: Promise<void>;
  private channel: TabChannel | null = null;
  private active = false;
  private heldByPeer = false;
  private readonly nonce = crypto.randomUUID();
  private readonly rivals = new Set<string>();
  private readonly listen = (event: MessageEvent): void => {
    const message = event.data as { kind?: unknown; id?: unknown; nonce?: unknown; active?: unknown };
    if (!message || message.id !== this.id || typeof message.nonce !== 'string' || !UUID.test(message.nonce) || message.nonce === this.nonce) return;
    if (message.kind === 'probe') {
      if (!this.active) this.rivals.add(message.nonce);
      this.channel?.postMessage({ kind:'claim',id:this.id,nonce:this.nonce,active:this.active });
    } else if (message.kind === 'claim' && !this.active) {
      if (message.active === true) this.heldByPeer = true;
      else if (message.active === false) this.rivals.add(message.nonce);
    }
  };
  constructor(private readonly storage?: Storage, factory?: () => TabChannel) {
    this.id = clientId(storage);
    if (!factory && typeof window === 'undefined') { this.active = true; this.ready = Promise.resolve(); return; }
    try {
      this.channel = factory ? factory() : new BroadcastChannel('foxy-r34-tab-control');
      this.channel.addEventListener('message',this.listen);
      this.ready = new Promise(resolve => setTimeout(() => {
        // Live owners always retain their id. Simultaneous claims use nonce order.
        if (this.heldByPeer || [...this.rivals].some(nonce => nonce < this.nonce)) { this.id = crypto.randomUUID(); safeStore(storage,KEY,this.id); }
        this.active = true; this.channel?.postMessage({ kind:'claim',id:this.id,nonce:this.nonce,active:true }); resolve();
      },100));
      this.channel.postMessage({ kind:'probe',id:this.id,nonce:this.nonce,active:false });
    } catch {
      // Without cross-tab arbitration, each document has a fresh id. A restored
      // live run then requires explicit takeover; a copied command is discarded.
      this.channel?.close(); this.channel = null; this.id = crypto.randomUUID(); safeStore(storage,KEY,this.id); this.active = true; this.ready = Promise.resolve();
    }
  }
  close(): void { this.channel?.removeEventListener('message',this.listen); this.channel?.close(); this.channel = null; }
}
/** Reject corruption without repairing inventory or granting any local wallet. */
export function validateProfile(value: unknown): Profile {
  try { return validateDomainProfile(value); }
  catch { throw new ApiError('CORRUPT_PROFILE', 'Профиль повреждён. Имущество не изменено; повтори загрузку.', 503); }
}
export function validateEquipmentCatalog(value: unknown): EquipmentCatalog {
  if (JSON.stringify(value) !== JSON.stringify(EQUIPMENT_CATALOG)) {
    // Compare canonical keys, not JSON property insertion order.
    const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b)).map(([k,x]) => [k,canonical(x)])) : v;
    if (JSON.stringify(canonical(value)) !== JSON.stringify(canonical(EQUIPMENT_CATALOG))) throw new ApiError('CATALOG_ERROR', 'Каталог экипировки не соответствует сборке. Обнови страницу.', 503);
  }
  return structuredClone(value) as EquipmentCatalog;
}
/** Independent metadata lets the UI close an incompatible snapshot safely. */
export function validateRunView(value: unknown): RunView | null {
  if (value === null) return null;
  const view = value as Partial<RunView>;
  if (!view || typeof view !== 'object' || typeof view.runId !== 'string' || !UUID.test(view.runId)
    || !['owner','readOnly'].includes(String(view.control)) || !Number.isSafeInteger(view.ownerEpoch) || Number(view.ownerEpoch) < 1
    || typeof view.updatedAt !== 'string' || !Number.isFinite(Date.parse(view.updatedAt))) {
    throw new ApiError('CORRUPT_RUN', 'Метаданные забега повреждены. Повтори загрузку профиля.', 503);
  }
  try { validateRecipe(view.loot); } catch { throw new ApiError('CORRUPT_RUN', 'Подтверждённая добыча забега повреждена. Повтори загрузку профиля.', 503); }
  return structuredClone(value) as RunView;
}
export function goldText(milli: string): string {
  const n = BigInt(milli), fraction = String(n % 1000n).padStart(3, '0').replace(/0+$/, '');
  return `${n / 1000n}${fraction ? `,${fraction}` : ''}`;
}
export class ProfileSession {
  profile: Profile | null = null;
  run: RunView | null = null;
  catalog: EquipmentCatalog | null = null;
  pending: Operation | null = null;
  private requestPending = false;
  private pendingAccountId: string | null = null;
  private readonly identity: TabIdentity;
  get clientId(): string { return this.identity.id; }
  constructor(readonly api: GameApi, private readonly storage?: Storage, tabFactory?: () => TabChannel) {
    this.identity = new TabIdentity(storage,tabFactory);
    const initialId = this.clientId;
    const saved = safeStore(storage, PENDING_KEY);
    if (saved) { try { const cache = JSON.parse(saved) as { accountId: string; operation: Operation }; const op = cache.operation; if (typeof cache.accountId === 'string' && UUID.test(op.operationId) && op.clientId === this.clientId && Number.isSafeInteger(op.expectedRevision)) { this.pending = op; this.pendingAccountId = cache.accountId; } } catch { /* Invalid command cache is not a profile. */ } }
    void this.identity.ready.then(() => { if (this.clientId !== initialId || saved && !this.pending) this.clearPending(); });
  }
  async load(): Promise<void> {
    await this.identity.ready;
    const [profile, catalog, run] = await Promise.all([this.api.call<Profile>('/profile'), this.api.call<EquipmentCatalog>('/economy/catalog'), this.api.call<RunView | null>(`/run?clientId=${this.clientId}`)]);
    this.acceptProfile(profile); this.catalog = validateEquipmentCatalog(catalog); this.run = validateRunView(run);
    if (this.pending && this.pendingAccountId !== this.profile!.accountId) this.clearPending();
    if (this.pending) await this.recover();
  }
  acceptProfile(value: unknown): boolean {
    const incoming = validateProfile(value);
    if (this.api.accountId && incoming.accountId !== this.api.accountId) throw new ApiError('CORRUPT_PROFILE', 'Ответ профиля принадлежит другому аккаунту. Войди снова.', 503);
    if (this.profile && incoming.accountId === this.profile.accountId && incoming.revision < this.profile.revision) return false;
    this.profile = incoming; return true;
  }
  private accept(result: OperationResult): OperationResult {
    if (!result || result.status !== 'committed' || !this.pending || result.operationId !== this.pending.operationId) throw new ApiError('CORRUPT_OPERATION', 'Ответ операции повреждён. Повторно проверим её результат.', 503);
    // Replayed historic results cannot roll a newly loaded profile/run back.
    if (result.profile.accountId !== this.pendingAccountId) throw new ApiError('CORRUPT_OPERATION', 'Ответ операции принадлежит другому аккаунту.', 503);
    if (this.acceptProfile(result.profile)) this.run = validateRunView(result.run);
    this.clearPending();
    return result;
  }
  async operate(type: Operation['type'], payload: Operation['payload']): Promise<OperationResult> {
    await this.identity.ready;
    if (this.pending || this.requestPending) throw new ApiError('OPERATION_PENDING', 'Предыдущая операция ещё не подтверждена. Сначала проверим её результат.', 409);
    if (!this.profile) throw new ApiError('AUTH_REQUIRED', 'Войди в аккаунт.', 401);
    this.pending = { operationId: crypto.randomUUID(), expectedRevision: this.profile.revision, clientId: this.clientId, type, payload } as Operation;
    this.pendingAccountId = this.profile.accountId;
    safeStore(this.storage, PENDING_KEY, JSON.stringify({ accountId: this.pendingAccountId, operation: this.pending }));
    return this.sendPending();
  }
  private async sendPending(): Promise<OperationResult> {
    if (!this.pending) throw new ApiError('OPERATION_NOT_FOUND', 'Нет ожидающей операции.', 404);
    this.requestPending = true;
    try { return this.accept(await this.api.call<OperationResult>('/operations', this.pending)); }
    catch (error) {
      if (error instanceof TransportError || error instanceof ApiError && error.status >= 500) {
        // An uncertain POST is never replaced by a new id, even after reload.
        return await this.lookupOrRetry();
      }
      if (error instanceof ApiError && error.status !== 401 && error.status !== 403) {
        this.clearPending();
      }
      throw error;
    } finally { this.requestPending = false; }
  }
  private async lookupOrRetry(): Promise<OperationResult> {
    try { return this.accept(await this.api.call<OperationResult>(`/operations/${this.pending!.operationId}`)); }
    catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'OPERATION_NOT_FOUND') throw error;
      try { return this.accept(await this.api.call<OperationResult>('/operations', this.pending)); }
      catch (retryError) {
        if (retryError instanceof ApiError && retryError.status < 500 && retryError.status !== 401 && retryError.status !== 403) this.clearPending();
        throw retryError;
      }
    }
  }
  async recover(): Promise<OperationResult> {
    await this.identity.ready;
    if (!this.pending) throw new ApiError('OPERATION_NOT_FOUND', 'Нет ожидающей операции.', 404);
    if (this.requestPending) throw new ApiError('OPERATION_PENDING', 'Проверяем предыдущую операцию.', 409);
    this.requestPending = true;
    try { return await this.lookupOrRetry(); } finally { this.requestPending = false; }
  }
  private clearPending(): void { this.pending = null; this.pendingAccountId = null; try { this.storage?.removeItem(PENDING_KEY); } catch { /* optional command cache */ } }
  clearIdentity(): void { this.profile = null; this.run = null; this.catalog = null; }
}
/** Every fixed frame is journaled. In-flight frames remain recoverable on errors. */
export class FrameJournal {
  queued: Command[][] = [];
  inflight: Command[][] = [];
  append(frame: Command[]): void { this.queued.push(structuredClone(frame)); }
  begin(max = 30): Command[][] {
    if (this.inflight.length) throw new Error('A combat batch is already in flight');
    this.inflight = this.queued.splice(0, Math.min(120, Math.max(1, max)));
    return structuredClone(this.inflight);
  }
  acknowledge(): void { this.inflight = []; }
  clear(): void { this.queued = []; this.inflight = []; }
  get length(): number { return this.queued.length + this.inflight.length; }
}
