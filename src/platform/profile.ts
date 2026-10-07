import type { Command } from '../game/simulation';
import { validateCatalog as validateDomainCatalog, validateProfile as validateDomainProfile, validateRecipe,validateConfirmedRewards } from '../game/equipment';
import type { EquipmentCatalog, Operation, OperationResult, Profile, RunView } from '../game/equipment';
import { ApiError, GameApi, TransportError } from './api';
import { validateBalanceDocument, validatePinnedBalance } from './balance';
import type { BalanceDocument, PinnedBalance } from './balance';
import { validateWorkshopView } from './workshop';
import type { WorkshopView } from './workshop';

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
  try { return validateDomainCatalog(value); }
  catch { throw new ApiError('CATALOG_ERROR', 'Каталог экипировки повреждён или несовместим. Повтори загрузку.', 503); }
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
  try { validateRecipe(view.loot); validatePinnedBalance(view.balance); } catch { throw new ApiError('CORRUPT_RUN', 'Подтверждённые настройки или добыча забега повреждены. Повтори загрузку профиля.', 503); }
  return structuredClone(value) as RunView;
}
export function goldText(milli: string): string {
  const n = BigInt(milli), fraction = String(n % 1000n).padStart(3, '0').replace(/0+$/, '');
  return `${n / 1000n}${fraction ? `,${fraction}` : ''}`;
}
export class ProfileSession {
  onCommitted:((result:OperationResult,type:Operation['type'])=>void)|null=null;
  profile: Profile | null = null;
  run: RunView | null = null;
  balance: BalanceDocument | null = null;
  workshop: WorkshopView | null = null;
  private workshopEpoch = 0;
  private workshopRequest: Promise<void> | null = null;
  previewState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  previewError = '';
  private previewRequest: Promise<void> | null = null;
  private balanceEpoch = 0;
  get pinnedBalance(): PinnedBalance | null { return this.run?.balance ?? this.balance; }
  get catalog(): EquipmentCatalog | null { return this.pinnedBalance?.compiled.equipment ?? null; }
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
    this.invalidatePreview();
    this.invalidateWorkshop();
    const [profile, balance, run] = await Promise.all([this.api.call<Profile>('/profile'), this.api.call<BalanceDocument>('/balance'), this.api.call<RunView | null>(`/run?clientId=${this.clientId}`)]);
    this.acceptProfile(profile); this.balance = validateBalanceDocument(balance); this.previewState = 'ready'; this.run = validateRunView(run);
    if (this.pending && this.pendingAccountId !== this.profile!.accountId) this.clearPending();
    if (this.pending) await this.recover();
  }
  private invalidatePreview(): void {
    this.balanceEpoch++; this.previewRequest = null; this.balance = null; this.previewState = 'idle'; this.previewError = '';
  }
  private invalidateWorkshop(): void { this.workshopEpoch++; this.workshopRequest = null; this.workshop = null; }
  /** This read cannot settle money or replace an uncertain operation. */
  refreshWorkshop(): Promise<void> {
    if (!this.profile) return Promise.resolve();
    if (this.workshopRequest) return this.workshopRequest;
    const epoch = ++this.workshopEpoch, accountId = this.profile.accountId, revision = this.profile.revision;
    const request = this.api.call('/workshop').then(value => {
      if (epoch !== this.workshopEpoch || this.profile?.accountId !== accountId || this.profile.revision !== revision) return;
      this.workshop = validateWorkshopView(value);
    }).finally(() => { if (epoch === this.workshopEpoch) this.workshopRequest = null; });
    this.workshopRequest = request; return request;
  }
  /** A preview read cannot undo or retry a committed game operation. */
  refreshBalancePreview(): Promise<void> {
    if (this.run || !this.profile) return Promise.resolve();
    if (this.previewRequest) return this.previewRequest;
    const epoch = ++this.balanceEpoch, accountId = this.profile.accountId;
    this.balance = null; this.previewState = 'loading'; this.previewError = '';
    const current = () => epoch === this.balanceEpoch && !this.run && this.profile?.accountId === accountId;
    const request = this.api.call('/balance').then(value => {
      if (!current()) return;
      this.balance = validateBalanceDocument(value); this.previewState = 'ready';
    }).catch(() => {
      if (!current()) return;
      this.balance = null; this.previewState = 'error'; this.previewError = 'Предпросмотр баланса недоступен. Цены и модификаторы не показаны. Подтверждённые действия сохранены; повтори загрузку предпросмотра.';
    }).finally(() => { if (epoch === this.balanceEpoch) this.previewRequest = null; });
    this.previewRequest = request; return request;
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
    const workshop = result.workshop === undefined ? null : validateWorkshopView(result.workshop);
    if(result.visualRewards!==undefined)try{validateConfirmedRewards(result.visualRewards);}catch{throw new ApiError('CORRUPT_OPERATION','Квитанция награды повреждена. Повторно проверим результат.',503);}
    const type=this.pending.type;
    let current=false;
    if (this.acceptProfile(result.profile)) {
      current=true;
      const run = validateRunView(result.run);
      if (this.run?.runId !== run?.runId) this.invalidatePreview();
      this.run = run;
      this.invalidateWorkshop(); this.workshop = workshop;
    }
    this.clearPending();
    if(current)this.onCommitted?.(result,type);
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
  clearIdentity(): void { this.profile = null; this.run = null; this.invalidatePreview(); this.invalidateWorkshop(); }
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
