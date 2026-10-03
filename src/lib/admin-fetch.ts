import { adminConfigState } from '@/src/store/admin-config';
import type { ApiEnvelope } from '@/src/types/admin';

export class AdminApiError extends Error {
  constructor(message: string, public status?: number, public code?: number | string) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export function buildRequestUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.trim().replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  for (const prefix of ['/api/v1', '/api']) {
    if (normalizedBase.endsWith(prefix) && normalizedPath.startsWith(`${prefix}/`)) {
      return `${normalizedBase.slice(0, -prefix.length)}${normalizedPath}`;
    }
  }
  return `${normalizedBase}${normalizedPath}`;
}

type RequestOptions = { idempotencyKey?: string; timeoutMs?: number };

async function requestAdmin<T>(path: string, init: RequestInit, options: RequestOptions,
  decode: (response: Response) => Promise<T>): Promise<T> {
  const { baseUrl, adminApiKey, sessionRevision } = adminConfigState;
  if (!baseUrl.trim()) throw new AdminApiError('BASE_URL_REQUIRED');
  if (!adminApiKey.trim()) throw new AdminApiError('ADMIN_API_KEY_REQUIRED');
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('x-api-key', adminApiKey.trim());
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 30_000);
  const assertSession = () => {
    if (adminConfigState.sessionRevision !== sessionRevision || adminConfigState.baseUrl !== baseUrl || adminConfigState.adminApiKey !== adminApiKey) {
      throw new AdminApiError('SESSION_CHANGED');
    }
  };
  try {
    const response = await fetch(buildRequestUrl(baseUrl, path), { ...init, headers, signal: controller.signal });
    assertSession();
    const result = await decode(response);
    assertSession();
    return result;
  } catch (error) {
    assertSession();
    if (timedOut) throw new AdminApiError('REQUEST_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abort);
  }
}

async function decodeEnvelope<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let json: ApiEnvelope<T>;
  try { json = JSON.parse(raw); }
  catch {
    throw new AdminApiError(response.status === 404 || response.status === 405 ? 'API_NOT_SUPPORTED' : 'INVALID_SERVER_RESPONSE', response.status);
  }
  if (!response.ok || json.code !== 0) {
    throw new AdminApiError(json.reason || (typeof json.code === 'string' ? json.code : json.message) || 'REQUEST_FAILED', response.status, json.code);
  }
  return json.data as T;
}

export function adminFetch<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
  return requestAdmin(path, init, options, decodeEnvelope<T>);
}

// Verify a candidate connection before saving or switching the active session.
export async function verifyAdminConnection(input: { baseUrl: string; adminApiKey: string }): Promise<void> {
  const url = new URL(input.baseUrl.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new AdminApiError('请输入有效的 HTTP 或 HTTPS 服务器地址。');
  if (!input.adminApiKey.trim()) throw new AdminApiError('ADMIN_API_KEY_REQUIRED');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(buildRequestUrl(input.baseUrl, '/api/v1/admin/settings'), {
      headers: { 'x-api-key': input.adminApiKey.trim(), 'Content-Type': 'application/json' }, signal: controller.signal,
    });
    await decodeEnvelope(response);
  } catch (error) {
    if (controller.signal.aborted) throw new AdminApiError('REQUEST_TIMEOUT');
    throw error;
  } finally { clearTimeout(timeout); }
}

// Account tests emit SSE; HTTP 200 alone does not mean the test passed.
export function adminTestAccount(path: string): Promise<{ success: true; message: string }> {
  return requestAdmin(path, { method: 'POST' }, { timeoutMs: 120_000 }, async (response) => {
    if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
      await decodeEnvelope(response);
      throw new AdminApiError('测试返回格式异常，请核对后台版本。', response.status);
    }
    const raw = await response.text();
    let completed = false;
    for (const block of raw.replace(/\r\n/g, '\n').split('\n\n')) {
      const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') continue;
      let event: { type?: string; success?: boolean; error?: string };
      try { event = JSON.parse(data); } catch { throw new AdminApiError('测试数据异常，请重新查询账号状态。'); }
      if (event.type === 'error') throw new AdminApiError(event.error || '账号测试失败。');
      if (event.type === 'test_complete') {
        if (event.success !== true) throw new AdminApiError('账号测试失败。');
        completed = true;
      }
    }
    if (!completed) throw new AdminApiError('测试连接中断，结果尚未确认，请稍后重试。');
    return { success: true, message: '测试成功' };
  });
}
