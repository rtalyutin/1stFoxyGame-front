import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, GameApi, TransportError } from './api';
const session = { account: { id:'69e7e09c-c672-47e0-8a6b-b26b3e9966cb',login:'runner' },csrfToken:'csrf-only-in-memory',expiresAt:'2030-01-01T00:00:00Z' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('account transport', () => {
  it('uses same-origin HttpOnly cookies and keeps passwords solely in the login request', async () => {
    const request = vi.fn(async (url: unknown) => String(url).endsWith('/auth/logout') ? json({ok:true}) : json(session));
    const api = new GameApi(request); await api.login('runner','secret'); await api.logout();
    expect(request.mock.calls[0]).toEqual(['/api/v1/auth/login',expect.objectContaining({method:'POST',credentials:'same-origin',body:JSON.stringify({login:'runner',password:'secret'})})]);
    expect(request.mock.calls[1]).toEqual(['/api/v1/auth/logout',expect.objectContaining({headers:expect.objectContaining({'X-CSRF-Token':session.csrfToken}),body:'{}'})]);
    expect(api.csrfToken).toBe('');
  });
  it('preserves the fetch receiver and disables HTTP cache', async () => {
    vi.stubGlobal('fetch',async function(this: unknown,_url: unknown,options: RequestInit) { if (this !== globalThis) throw new Error('receiver'); expect(options.cache).toBe('no-store'); return json(session); });
    expect((await new GameApi().session()).account.login).toBe('runner');
  });
  it('exposes expired access separately from an uncertain network outcome', async () => {
    const api = new GameApi(vi.fn(async () => json({error:{code:'AUTH_REQUIRED',message:'expired'}},401)));
    await expect(api.call('/profile')).rejects.toMatchObject({code:'AUTH_REQUIRED',status:401});
    await expect(new GameApi(vi.fn(async () => { throw new Error('network'); })).call('/operations',{})).rejects.toBeInstanceOf(TransportError);
  });
  it('rejects malformed successful session responses', async () => {
    await expect(new GameApi(vi.fn(async () => json({account:session.account,csrfToken:7}))).session()).rejects.toBeInstanceOf(ApiError);
  });
  it('bounds a request, leaving uncertain mutation recovery to the same operation id', async () => {
    vi.useFakeTimers();
    const request: typeof fetch = vi.fn(async (_url,options) => new Promise<Response>((_resolve,reject) => options!.signal!.addEventListener('abort',() => reject(new Error('timeout')))));
    const promise = new GameApi(request,3000).call('/operations',{}); const assertion = expect(promise).rejects.toBeInstanceOf(TransportError);
    await vi.advanceTimersByTimeAsync(3000); await assertion;
  });
});
