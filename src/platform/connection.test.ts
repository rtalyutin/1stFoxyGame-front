import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionMonitor, HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, isHealth } from './connection';

const ok = () => new Response(JSON.stringify({ status: 'ok', apiVersion: '1', serverTime: '2026-10-02T12:00:00.000Z' }), { status: 200 });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('server connection is required for play', () => {
  it('preserves the global receiver required by native browser fetch (QA-01)', async () => {
    vi.stubGlobal('fetch', async function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return ok();
    });
    const monitor = new ConnectionMonitor(() => {});
    expect(await monitor.check()).toBe(true);
    monitor.stop();
  });

  it('rejects stale protocol, malformed data and non-success status', async () => {
    expect(isHealth({ status: 'ok', apiVersion: '2', serverTime: '2026-10-02' })).toBe(false);
    expect(isHealth({ status: 'ok', apiVersion: '1', serverTime: 'not-a-date' })).toBe(false);
    const monitor = new ConnectionMonitor(() => {}, vi.fn(async () => new Response('{}', { status: 503 })));
    expect(await monitor.check()).toBe(false);
    expect(monitor.state).toBe('offline');
    monitor.stop();
  });

  it('uses a real health response and disables browser cache', async () => {
    const request = vi.fn(async () => ok());
    const monitor = new ConnectionMonitor(() => {}, request);
    expect(await monitor.check()).toBe(true);
    expect(request).toHaveBeenCalledWith('/api/v1/health', expect.objectContaining({ cache: 'no-store' }));
    monitor.stop();
  });

  it('an offline event cannot be undone by an older successful response', async () => {
    let respond!: (response: Response) => void;
    const request = vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; }));
    const monitor = new ConnectionMonitor(() => {}, request);
    const pending = monitor.check();
    monitor.markOffline();
    respond(ok());
    expect(await pending).toBe(false);
    expect(monitor.state).toBe('offline');
    monitor.stop();
  });

  it('detects a silent network loss within the 2 second interval plus 3 second timeout', async () => {
    vi.useFakeTimers();
    let count = 0;
    const request: typeof fetch = vi.fn(async (_url, options) => {
      if (++count === 1) return ok();
      return new Promise<Response>((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const monitor = new ConnectionMonitor(() => {}, request);
    await monitor.check();
    expect(monitor.state).toBe('online');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS);
    expect(monitor.state).toBe('offline');
    monitor.stop();
  });
});
