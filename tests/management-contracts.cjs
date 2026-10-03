const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const project = path.resolve(__dirname, '..');
const ts = require(path.join(project, 'node_modules/typescript'));
const config = { baseUrl: 'https://test.invalid/api/v1/', adminApiKey: ' synthetic-admin-key ', sessionRevision: 0 };
const calls = [];
let handler = async () => json({});
const fakeFetch = async (url, init = {}) => {
  calls.push({ url: String(url), ...init, headers: new Headers(init.headers) });
  return handler(url, init);
};
const modules = new Map();
function load(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const source = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ exports: module.exports, module, console, Headers, Response, Request, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, fetch: fakeFetch, Date, Math,
    require(spec) {
      if (spec === '@/src/store/admin-config') return { adminConfigState: config };
      if (spec === 'react-native') return { Platform: { OS: 'web' }, Alert: { alert: () => {} } };
      if (spec.startsWith('@/')) return load(path.join(project, spec.slice(2)) + '.ts');
      if (spec.startsWith('.')) return load(path.resolve(path.dirname(file), spec) + '.ts');
      return require(require.resolve(spec, { paths: [project] }));
    }
  });
  vm.runInContext(js, context, { filename: file });
  return module.exports;
}
const api = load(path.join(project, 'src/services/admin.ts'));
const fetchApi = load(path.join(project, 'src/lib/admin-fetch.ts'));
const clean = value => JSON.parse(JSON.stringify(value));
function json(data, status = 200, extra = {}) { return new Response(JSON.stringify({ code: status === 200 ? 0 : status, message: status === 200 ? 'success' : 'failure', data, ...extra }), { status, headers: { 'Content-Type': 'application/json' } }); }
function sse(lines, status = 200) { return new Response(lines.map(x => `data: ${typeof x === 'string' ? x : JSON.stringify(x)}\n\n`).join(''), { status, headers: { 'Content-Type': 'text/event-stream' } }); }
function reset(next) { calls.length = 0; handler = next; }
function last(expectedPath, method = 'GET', body) {
  assert.equal(calls.length, 1, 'one fetch per operation; no automatic mutation retry');
  const call = calls[0];
  assert.equal(new URL(call.url).pathname, expectedPath);
  assert.equal(call.method || 'GET', method);
  assert.equal(call.headers.get('x-api-key'), 'synthetic-admin-key');
  if (body !== undefined) assert.deepEqual(JSON.parse(call.body), body);
  return call;
}
const subscription = { id: 77, user_id: 11, group_id: 8, status: 'active', starts_at: '2026-10-01T00:00:00Z', expires_at: '2026-11-01T00:00:00Z', daily_usage_usd: 3, weekly_usage_usd: 11, monthly_usage_usd: 35, daily_window_start: '2026-10-03T00:00:00Z', weekly_window_start: '2026-10-01T00:00:00Z', monthly_window_start: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-03T00:00:00Z', group: { id: 8, name: '测试订阅', platform: 'anthropic', daily_limit_usd: 20, weekly_limit_usd: 100, monthly_limit_usd: 300 } };
const quota = { plan_type: 'plus', rate_limit: { allowed: true, limit_reached: false, primary_window: { used_percent: 60, limit_window_seconds: 18000, reset_after_seconds: 1000, reset_at: 1790989000 } }, rate_limit_reset_credits: { available_count: 2, credits: [{ expires_at: '2026-10-22T00:00:00Z' }] }, fetched_at: 1790988000 };
const credits = { eligible: true, available_count: 1, credits: [{ label: '测试重置卡', resets_left: 2, clears: ['five_hour'], percent_used: { five_hour: 100 }, blocking: [], use_requires_limit: true, redeemable: true }], fetched_at: '2026-10-03T00:00:00Z' };
const cases = [];
function check(name, fn) { cases.push([name, fn]); }

check('Base URL prefix normalization and trimmed admin key', async () => {
  reset(async () => json({ id: 11 })); await api.getUser(11); last('/api/v1/admin/users/11');
  for (const suffix of ['', '/api', '/api/v1', '/api/v1/']) {
    config.baseUrl = 'https://test.invalid' + suffix;
    reset(async () => json({ id: 11 })); await api.getUser(11); last('/api/v1/admin/users/11');
  }
  config.baseUrl = 'https://test.invalid/api/v1/';
});
check('Missing configuration fails before network access', async () => {
  const base = config.baseUrl; const key = config.adminApiKey;
  config.baseUrl = ''; reset(async () => json({})); await assert.rejects(() => api.getUser(11), /BASE_URL_REQUIRED/); assert.equal(calls.length, 0);
  config.baseUrl = base; config.adminApiKey = ''; await assert.rejects(() => api.getUser(11), /ADMIN_API_KEY_REQUIRED/); assert.equal(calls.length, 0); config.adminApiKey = key;
});
check('Provider quota/card query and no-body refresh contract', async () => {
  reset(async () => json({ ...quota, cache_persisted: true })); const result = await api.refreshOpenAIQuota(22); last('/api/v1/admin/openai/accounts/22/quota/refresh', 'POST'); assert.equal(result.rate_limit_reset_credits.available_count, 2);
  reset(async () => json(credits)); const actual = await api.getClaudeResetCredits(22); last('/api/v1/admin/accounts/22/claude/reset-credits'); assert.deepEqual(clean(actual), credits);
});
check('Claude reset uses caller idempotency key unchanged', async () => {
  reset(async () => json({ outcome: 'reset', cleared: ['five_hour'], replayed: false })); const result = await api.redeemClaudeResetCredit(22, 'same-confirmation-123'); const call = last('/api/v1/admin/accounts/22/claude/reset-credits/redeem', 'POST'); assert.equal(call.headers.get('Idempotency-Key'), 'same-confirmation-123'); assert.equal(result.outcome, 'reset');
});
check('OpenAI consumption succeeds with partial postprocessing warning', async () => {
  const fixture = { code: 'ok', windows_reset: 2, cache_refreshed: false, account_state_recovered: true, warning_code: 'reset_credit_cache_refresh_failed' };
  reset(async () => json(fixture)); const result = await api.resetOpenAIQuota(22); last('/api/v1/admin/openai/accounts/22/reset-quota', 'POST'); assert.deepEqual(clean(result), fixture);
});
check('OpenAI transport failure does not retry non-idempotent consumption', async () => {
  reset(async () => { throw new Error('Network request failed'); }); await assert.rejects(() => api.resetOpenAIQuota(22), /Network request failed/); assert.equal(calls.length, 1);
});
check('Canonical paginated subscriptions list filters correct user and page', async () => {
  const fixture = { items: [subscription], total: 25, page: 2, page_size: 20, pages: 2 };
  reset(async () => json(fixture)); const result = await api.listUserSubscriptions(11, 2, 20);
  const call = last('/api/v1/admin/subscriptions'); const params = new URL(call.url).searchParams;
  assert.equal(params.get('user_id'), '11'); assert.equal(params.get('page'), '2'); assert.equal(params.get('page_size'), '20'); assert.deepEqual(clean(result), fixture);
});
check('Backend service subscription progress normalizes exact USD window fields', async () => {
  const fixture = { id: 77, group_name: '测试订阅', expires_at: '2026-11-01T00:00:00Z', expires_in_days: 29,
    daily: { used_usd: 3, limit_usd: 20, remaining_usd: 17, percentage: 15, window_start: '2026-10-03T00:00:00Z', resets_at: '2026-10-04T00:00:00Z', resets_in_seconds: 3600 },
    weekly: { used_usd: 0, limit_usd: 100, remaining_usd: 100, percentage: 0, window_start: '2026-10-01T00:00:00Z', resets_at: '2026-10-08T00:00:00Z', resets_in_seconds: 0 } };
  reset(async () => json(fixture)); const result = await api.getSubscriptionProgress(77); last('/api/v1/admin/subscriptions/77/progress');
  assert.deepEqual(clean(result), { subscription_id: 77, expires_at: fixture.expires_at, days_remaining: 29, daily: { used: 3, limit: 20, percentage: 15, reset_in_seconds: 3600 }, weekly: { used: 0, limit: 100, percentage: 0, reset_in_seconds: 0 }, monthly: null });
});
check('Legacy progress shape preserves zero/unlimited and absent periods', async () => {
  const fixture = { subscription_id: 77, expires_at: null, days_remaining: null, daily: { used: 0, limit: null, percentage: 0, reset_in_seconds: 0 }, weekly: null };
  reset(async () => json(fixture)); const result = await api.getSubscriptionProgress(77);
  assert.deepEqual(clean(result), { ...fixture, monthly: null });
  reset(async () => json({ id: 77 })); const absent = await api.getSubscriptionProgress(77); assert.equal(absent.daily, null); assert.equal(absent.weekly, null); assert.equal(absent.monthly, null);
});
check('Malformed subscription usage is rejected instead of shown as zero', async () => {
  reset(async () => json({ id: 77, daily: { used_usd: 'oops', limit_usd: 20 } })); await assert.rejects(() => api.getSubscriptionProgress(77));
});
check('Mutation argument validation fails before network request', async () => {
  reset(async () => json({})); await assert.rejects(() => api.resetSubscriptionQuota(77, { daily: false, weekly: false, monthly: false })); assert.equal(calls.length, 0);
  for (const days of [0, -1, 1.5, 36501, NaN]) { await assert.rejects(() => api.extendSubscription(77, days)); assert.equal(calls.length, 0); }
  await assert.rejects(() => api.redeemClaudeResetCredit(22, '  ')); assert.equal(calls.length, 0);
});
check('Subscription reset and extension preserve payload and operation key', async () => {
  reset(async () => json(subscription)); await api.resetSubscriptionQuota(77, { daily: true, weekly: false, monthly: true }, 'reset-77-same-confirmation'); const resetCall = last('/api/v1/admin/subscriptions/77/reset-quota', 'POST', { daily: true, weekly: false, monthly: true }); assert.equal(resetCall.headers.get('Idempotency-Key'), 'reset-77-same-confirmation');
  reset(async () => json(subscription)); await api.extendSubscription(77, 30, 'extend-77-same-confirmation'); const extendCall = last('/api/v1/admin/subscriptions/77/extend', 'POST', { days: 30 }); assert.equal(extendCall.headers.get('Idempotency-Key'), 'extend-77-same-confirmation');
});
check('SSE test completion success accepted', async () => {
  reset(async () => sse([{ type: 'test_start', model: 'test-model' }, { type: 'content', text: '测试响应' }, { type: 'test_complete', success: true }])); const result = await api.testAccount(22); last('/api/v1/admin/accounts/22/test', 'POST'); assert.ok(result);
});
check('SSE HTTP 200 error event rejected', async () => {
  reset(async () => sse([{ type: 'test_start', model: 'test-model' }, { type: 'error', error: 'provider failed' }])); await assert.rejects(() => api.testAccount(22), /provider failed/); assert.equal(calls.length, 1);
});
check('SSE incomplete stream and unsuccessful completion rejected', async () => {
  reset(async () => sse([{ type: 'test_start' }, { type: 'content', text: 'partial' }])); await assert.rejects(() => api.testAccount(22));
  reset(async () => sse([{ type: 'test_complete', success: false, error: 'failed completion' }])); await assert.rejects(() => api.testAccount(22));
});
check('SSE CRLF framing and no-space data marker accepted', async () => {
  reset(async () => new Response(': keepalive\r\n\r\ndata:{"type":"test_start"}\r\n\r\ndata:{"type":"test_complete","success":true}\r\n\r\n', { headers: { 'Content-Type': 'text/event-stream' } })); const result = await api.testAccount(22); assert.equal(result.success, true);
});
check('Unsupported endpoint error carries HTTP status', async () => {
  reset(async () => json(undefined, 404, { reason: 'NOT_FOUND' })); try { await api.getClaudeResetCredits(22); assert.fail('must reject'); } catch (error) { assert.equal(error.status, 404); }
});
check('Admin compliance string error code preserved', async () => {
  reset(async () => new Response(JSON.stringify({ code: 'ADMIN_COMPLIANCE_ACK_REQUIRED', message: 'administrator compliance acknowledgement is required' }), { status: 423, headers: { 'Content-Type': 'application/json' } })); try { await api.getUser(11); assert.fail('must reject'); } catch (error) { assert.ok(error.reason === 'ADMIN_COMPLIANCE_ACK_REQUIRED' || error.message === 'ADMIN_COMPLIANCE_ACK_REQUIRED' || error.code === 'ADMIN_COMPLIANCE_ACK_REQUIRED'); assert.equal(error.status, 423); }
});
check('Delayed fetch response rejected after server switch and return', async () => {
  let resolveResponse; reset(() => new Promise(resolve => { resolveResponse = resolve; }));
  const pending = api.getUser(11); config.sessionRevision += 2; resolveResponse(json({ id: 11 }));
  await assert.rejects(() => pending, /SESSION_CHANGED/); assert.equal(calls.length, 1);
});
check('Delayed body decode rejected after credentials change', async () => {
  let resolveBody; let decodingStarted;
  const started = new Promise(resolve => { decodingStarted = resolve; });
  const response = json({ id: 11 }); response.text = () => { decodingStarted(); return new Promise(resolve => { resolveBody = resolve; }); };
  reset(async () => response); const pending = api.getUser(11); await started;
  const originalKey = config.adminApiKey; config.adminApiKey = 'different-synthetic-key'; resolveBody(JSON.stringify({ code: 0, data: { id: 11 } }));
  await assert.rejects(() => pending, /SESSION_CHANGED/); config.adminApiKey = originalKey;
});
check('Timeout abort reports uncertain result and never retries mutation', async () => {
  reset((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }));
  await assert.rejects(() => fetchApi.adminFetch('/api/v1/admin/openai/accounts/22/reset-quota', { method: 'POST' }, { timeoutMs: 5 }), /REQUEST_TIMEOUT/);
  assert.equal(calls.length, 1); assert.equal(calls[0].signal.aborted, true);
});
check('Caller cancellation forwards abort without converting it to timeout', async () => {
  const caller = new AbortController();
  reset((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('caller cancelled', 'AbortError')), { once: true });
  }));
  const pending = fetchApi.adminFetch('/api/v1/admin/users/11', { signal: caller.signal }); caller.abort();
  await assert.rejects(() => pending, /caller cancelled/); assert.equal(calls.length, 1);
});

(async () => {
  let passed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`); passed++; }
    catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
  }
  console.log(`Contract checks: ${passed}/${cases.length} passed`);
})();
