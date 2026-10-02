export type ConnectionState = 'checking' | 'online' | 'offline';
export const HEARTBEAT_INTERVAL_MS = 2_000;
export const HEARTBEAT_TIMEOUT_MS = 3_000;

/** A successful HTTP response, rather than navigator.onLine, grants play access. */
export class ConnectionMonitor {
  state: ConnectionState = 'checking';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<boolean> | undefined;
  private epoch = 0;
  private stopped = false;
  private controller: AbortController | undefined;

  constructor(private readonly changed: (state: ConnectionState) => void,
    private readonly request: typeof fetch = (...args) => globalThis.fetch(...args)) {}

  start(): void { void this.check(); }

  markOffline(): void {
    this.epoch++;
    this.controller?.abort();
    this.setState('offline');
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.changed(state);
  }

  check(): Promise<boolean> {
    if (this.pending) return this.pending;
    clearTimeout(this.timer);
    const epoch = this.epoch;
    this.controller = new AbortController();
    const timeout = setTimeout(() => this.controller?.abort(), HEARTBEAT_TIMEOUT_MS);
    this.pending = (async () => {
      let valid = false;
      try {
        const response = await this.request('/api/v1/health', {
          cache: 'no-store', credentials: 'same-origin', signal: this.controller!.signal,
          headers: { Accept: 'application/json' },
        });
        const body: unknown = await response.json();
        valid = response.ok && isHealth(body);
      } catch { valid = false; }
      if (epoch !== this.epoch || this.stopped) valid = false;
      if (!this.stopped) this.setState(valid ? 'online' : 'offline');
      return valid;
    })().finally(() => {
      clearTimeout(timeout);
      this.pending = undefined;
      if (!this.stopped) this.timer = setTimeout(() => { void this.check(); }, HEARTBEAT_INTERVAL_MS);
    });
    return this.pending;
  }

  stop(): void {
    this.stopped = true;
    this.epoch++;
    clearTimeout(this.timer);
    this.controller?.abort();
  }
}

export function isHealth(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return body.status === 'ok' && body.apiVersion === '1'
    && typeof body.serverTime === 'string' && Number.isFinite(Date.parse(body.serverTime));
}
