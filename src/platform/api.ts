/** Same-origin transport: the server owns session and wallet. */
export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); this.name = 'ApiError'; }
}
export class TransportError extends Error {
  constructor(message = 'Ответ сервера не получен. Проверяем результат той же операции.') { super(message); this.name = 'TransportError'; }
}
export interface Session { account: { id: string; login: string }; csrfToken: string; expiresAt: string; }
export class GameApi {
  csrfToken = '';
  accountId: string | null = null;
  constructor(private readonly request: typeof fetch = (...args) => globalThis.fetch(...args), readonly timeoutMs = 8000) {}
  async call<T>(path: string, body?: unknown, method: 'GET' | 'POST' | 'PUT' = body === undefined ? 'GET' : 'POST'): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.request(`/api/v1${path}`, {
        method, credentials: 'same-origin', cache: 'no-store',
        signal: controller.signal, headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json', ...(this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {}) }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const error = result as { error?: { code?: unknown; message?: unknown } };
        throw new ApiError(typeof error?.error?.code === 'string' ? error.error.code : 'SERVER_ERROR', typeof error?.error?.message === 'string' ? error.error.message : 'Сервис временно недоступен.', response.status);
      }
      return result as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new TransportError();
    } finally { clearTimeout(timeout); }
  }
  async session(): Promise<Session> { return this.acceptSession(await this.call('/session')); }
  async login(login: string, password: string): Promise<Session> { return this.acceptSession(await this.call('/auth/login', { login, password })); }
  async logout(): Promise<void> { await this.call('/auth/logout', {}); this.csrfToken = ''; this.accountId = null; }
  private acceptSession(value: unknown): Session {
    const session = value as Partial<Session>;
    if (!session?.account || typeof session.account.id !== 'string' || typeof session.account.login !== 'string' || typeof session.csrfToken !== 'string' || !session.csrfToken || typeof session.expiresAt !== 'string' || !Number.isFinite(Date.parse(session.expiresAt))) {
      throw new ApiError('CORRUPT_SESSION', 'Ответ сессии повреждён. Войди снова.', 503);
    }
    this.csrfToken = session.csrfToken; this.accountId = session.account.id;
    return session as Session;
  }
}
