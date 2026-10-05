// Each tab keeps its own branch. A conflict never overwrites another local branch.
export interface RunPins { clientReleaseId: string; coreVersion: string; contentVersion: string; metadataSchemaVersion: string; snapshotSchemaVersion: number }
export interface PendingOperation { kind: 'checkpoint' | 'finish'; generation: number; body: Record<string, unknown> }
export interface LocalRun<S = unknown, R = unknown> {
  key: string; runId: string; clientRunId: string; pins: RunPins; seed: number;
  serverRevision: number; localGeneration: number; confirmedGeneration: number;
  latestLocalCheckpoint: S | null; terminalRecord: R | null; pendingOperation: PendingOperation | null;
  conflict: string | null; updatedAt: number;
}
export type SaveStatus = 'device' | 'server' | 'error' | 'conflict' | 'saving';
export interface RunStore {
  list(): Promise<LocalRun[]>;
  get(key: string): Promise<LocalRun | undefined>;
  put(record: LocalRun): Promise<void>;
  update(key: string, change: (record: LocalRun) => void): Promise<LocalRun>;
}

export class IndexedRunStore implements RunStore {
  private db: Promise<IDBDatabase>;
  constructor() {
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open('last-throne-saves-v2', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('runs', { keyPath: 'key' });
      req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Закройте другую вкладку игры для открытия сохранений.'));
    });
  }
  async list() {
    const db = await this.db;
    return new Promise<LocalRun[]>((resolve, reject) => {
      const tx = db.transaction('runs'); const req = tx.objectStore('runs').getAll();
      tx.oncomplete = () => resolve(req.result.sort((a: LocalRun, b: LocalRun) => b.updatedAt - a.updatedAt));
      tx.onerror = () => reject(tx.error);
    });
  }
  async get(key: string) {
    const db = await this.db;
    return new Promise<LocalRun | undefined>((resolve, reject) => {
      const tx = db.transaction('runs'); const req = tx.objectStore('runs').get(key);
      tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(tx.error);
    });
  }
  async put(record: LocalRun) {
    const db = await this.db;
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('runs', 'readwrite'); tx.objectStore('runs').put(record);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  }
  async update(key: string, change: (record: LocalRun) => void) {
    const db = await this.db;
    return new Promise<LocalRun>((resolve, reject) => {
      const tx = db.transaction('runs', 'readwrite'); const os = tx.objectStore('runs'); const req = os.get(key);
      let result: LocalRun;
      req.onsuccess = () => {
        try { if (!req.result) throw new Error('Локальная партия не найдена.'); result = req.result; change(result); result.updatedAt = Date.now(); os.put(result); }
        catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  }
}

export class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`/td/api/v1${path}`, { credentials: 'same-origin', ...options, signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...options.headers } });
    const body = await response.json();
    if (!response.ok) { const error = body.error ?? body; throw new ApiError(response.status, error.code ?? 'API_ERROR', error.message ?? 'Сервер временно недоступен.'); }
    return body as T;
  } finally { clearTimeout(timeout); }
}
export type SaveTransport = (runId: string, operation: PendingOperation) => Promise<{revision: number; status?: string}>;
const transport: SaveTransport = (id, op) => api(`/runs/${encodeURIComponent(id)}/${op.kind}`, {
  method: op.kind === 'checkpoint' ? 'PUT' : 'POST', body: JSON.stringify(op.body),
});
function queueNext(record: LocalRun) {
  if (record.pendingOperation || record.conflict) return;
  if (record.terminalRecord && record.confirmedGeneration < record.localGeneration) {
    record.pendingOperation = { kind: 'finish', generation: record.localGeneration,
      body: { requestId: crypto.randomUUID(), expectedRevision: record.serverRevision, result: structuredClone(record.terminalRecord) } };
  } else if (!record.terminalRecord && record.latestLocalCheckpoint && record.confirmedGeneration < record.localGeneration) {
    record.pendingOperation = { kind: 'checkpoint', generation: record.localGeneration,
      body: { requestId: crypto.randomUUID(), expectedRevision: record.serverRevision,
        snapshotSchemaVersion: record.pins.snapshotSchemaVersion, snapshot: structuredClone(record.latestLocalCheckpoint) } };
  }
}

export class SaveManager<S = unknown, R = unknown> {
  key: string;
  private store: RunStore;
  private onStatus: (status: SaveStatus, record: LocalRun<S,R>, message?: string) => void;
  private send: SaveTransport;
  private running = false;
  private stopped = false;
  private onlineListener = () => { void this.sync(); };
  constructor(key: string, store: RunStore, onStatus: (status: SaveStatus, record: LocalRun<S,R>, message?: string) => void,
    send: SaveTransport = transport) { this.key = key; this.store = store; this.onStatus = onStatus; this.send = send; window.addEventListener('online', this.onlineListener); }
  async record(): Promise<LocalRun<S,R>> { const r = await this.store.get(this.key); if (!r) throw new Error('Сохранение не найдено.'); return r as LocalRun<S,R>; }
  private report(record: LocalRun, error?: string) {
    if (this.stopped) return;
    const status = record.conflict ? 'conflict' : error ? 'error' : record.pendingOperation ? 'saving'
      : record.confirmedGeneration === record.localGeneration ? 'server' : 'device';
    this.onStatus(status, record as LocalRun<S,R>, error ?? record.conflict ?? undefined);
  }
  async checkpoint(snapshot: S) {
    const record = await this.store.update(this.key, r => {
      if (r.terminalRecord) throw new Error('Партия уже завершена.');
      r.latestLocalCheckpoint = structuredClone(snapshot); r.localGeneration++; queueNext(r);
    });
    this.report(record); void this.sync(); // Local transaction completes before the caller may start a wave.
  }
  async finish(result: R) {
    const record = await this.store.update(this.key, r => {
      if (r.terminalRecord) return;
      r.terminalRecord = structuredClone(result); r.localGeneration++; queueNext(r);
    });
    this.report(record); void this.sync();
  }
  async sync() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (!this.stopped) {
        let record = await this.store.update(this.key, queueNext);
        this.report(record);
        if (record.conflict || !record.pendingOperation) break;
        const operation = structuredClone(record.pendingOperation);
        let response;
        try { response = await this.send(record.runId, operation); }
        catch (error) {
          if (error instanceof ApiError && (error.status === 409 || error.status === 401 || error.status === 404 || error.status === 422)) {
            record = await this.store.update(this.key, r => { r.conflict = `${error.code}: ${error.message}`; });
            this.report(record);
          } else this.report(record, 'Облако недоступно. Точный запрос сохранён на устройстве; повторите синхронизацию.');
          break;
        }
        if (!Number.isSafeInteger(response.revision) || typeof operation.body.expectedRevision !== 'number' || response.revision <= operation.body.expectedRevision) {
          this.report(record, 'Сервер вернул неверную ревизию. Запрос сохранён для повтора.'); break;
        }
        record = await this.store.update(this.key, r => {
          // A late response from another tab/session cannot acknowledge a different operation.
          if (r.pendingOperation?.body.requestId !== operation.body.requestId) return;
          r.serverRevision = response.revision; r.confirmedGeneration = operation.generation; r.pendingOperation = null;
          queueNext(r);
        });
        this.report(record);
      }
    } finally { this.running = false; }
  }
  dispose() { this.stopped = true; window.removeEventListener('online', this.onlineListener); }
}

// Fresh per document, including a duplicated tab. The selected record key survives reload separately.
let documentBranchId: string | undefined;
export function tabBranchId() { return documentBranchId ??= crypto.randomUUID(); }
export async function branchRecord(store: RunStore, source: LocalRun) {
  const key = `${source.clientRunId}:${tabBranchId()}`;
  if (key === source.key) return source;
  const record = { ...structuredClone(source), key, updatedAt: Date.now() };
  await store.put(record); return record;
}
