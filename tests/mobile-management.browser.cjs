/*
 * End-to-end smoke checks at a 390px phone width. Only a synthetic backend is
 * used: the reserved .invalid host is intercepted, and every unexpected API
 * request fails the test. No live account, credit, balance or subscription is
 * changed. Fixture shapes follow sub2api's actual admin API, including the Go
 * subscription-progress names used_usd/limit_usd/resets_in_seconds.
 *
 * Run against an existing Expo Web server:
 *   NODE_PATH=/path/to/node_modules node tests/mobile-management.browser.cjs
 * Optional: MOBILE_TEST_URL, MOBILE_TEST_CHROMIUM, MOBILE_TEST_ARTIFACTS.
 * Chromium must be installed; this script does not download browsers or start
 * services. Playwright is a test runner prerequisite, not an app dependency.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const appUrl = process.env.MOBILE_TEST_URL || 'http://127.0.0.1:8082';
const executablePath = process.env.MOBILE_TEST_CHROMIUM || '/usr/bin/chromium';
const artifactDir = process.env.MOBILE_TEST_ARTIFACTS || path.resolve(__dirname, '../../artifacts');
const backend = 'https://mobile-backend.invalid';
const secondBackend = 'https://second-mobile-backend.invalid';
const syntheticKey = 'synthetic-browser-test-key';
const future = new Date(Date.now() + 86_400_000 * 90).toISOString();
const now = new Date().toISOString();
const group = { id: 4, name: '手机测试套餐', daily_limit_usd: 10, weekly_limit_usd: 50, monthly_limit_usd: 100 };
const users = Array.from({ length: 21 }, (_, index) => ({ id: index + 1, username: `用户 ${index + 1}`, email: `user${index + 1}@example.invalid`, role: 'user', status: 'active', balance: 12.5, concurrency: 3 }));
const accounts = [
  { id: 101, name: 'Claude 测试账号', platform: 'anthropic', type: 'oauth', status: 'active', schedulable: true, concurrency: 5, current_concurrency: 1 },
  { id: 102, name: 'Codex 测试账号', platform: 'openai', type: 'oauth', status: 'active', schedulable: true, concurrency: 5, current_concurrency: 0 },
  { id: 103, name: '旧后台测试账号', platform: 'anthropic', type: 'oauth', status: 'active', schedulable: true, concurrency: 5 },
  { id: 104, name: '未知额度测试账号', platform: 'openai', type: 'apikey', status: 'active', schedulable: true, concurrency: 2 },
];
const subscription = { id: 201, user_id: 21, group_id: 4, status: 'active', starts_at: now, expires_at: future, daily_usage_usd: 3.25, weekly_usage_usd: 12, monthly_usage_usd: 20, group };
const state = { claudeRemaining: 2, openAIRemaining: 2, failOpenAIReset: false, failProgress: false, failSubscriptionReset: false, dailyUsed: 3.25, weeklyUsed: 12, monthlyUsed: 20 };
const requests = [];
const unexpected = [];
const errors = [];
const dashboard = { total_users: 21, today_new_users: 1, active_users: 20, total_api_keys: 1, active_api_keys: 1, total_accounts: 4, normal_accounts: 4, error_accounts: 0, total_requests: 400, total_cost: 18.5, total_tokens: 50000, today_requests: 42, today_cost: 12.3, today_tokens: 12345, rpm: 2, tpm: 1234 };
const paginated = (items, total = items.length, page = 1) => ({ items, total, page, page_size: 20, pages: Math.ceil(total / 20) });
const claudeCredits = () => ({ eligible: true, available_count: state.claudeRemaining, credits: [{ label: '测试重置卡', resets_left: state.claudeRemaining, clears: ['five_hour'], percent_used: { five_hour: 100 }, blocking: [], use_requires_limit: true, redeemable: state.claudeRemaining > 0, starts_at: now, expires_at: future }], fetched_at: now });
const openAIQuota = () => ({ plan_type: 'plus', rate_limit: { allowed: false, limit_reached: true, primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_after_seconds: 3600, reset_at: Math.floor(Date.now() / 1000) + 3600 } }, rate_limit_reset_credits: { available_count: state.openAIRemaining, credits: [{ expires_at: future }] }, credits: { has_credits: false, unlimited: false, balance: null }, fetched_at: Math.floor(Date.now() / 1000) });

async function installRoutes(context) {
  await context.route(/^https:\/\/(?:second-)?mobile-backend\.invalid\/api\/v1\/.*/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const endpoint = url.pathname.replace('/api/v1', '');
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS', 'content-type': 'application/json' };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const entry = { host: url.hostname, endpoint, method, query: Object.fromEntries(url.searchParams), headers: request.headers(), body: request.postDataJSON() };
    requests.push(entry);
    assert.equal(entry.headers['x-api-key'], syntheticKey, 'requests carry only the synthetic key');
    const ok = (data) => route.fulfill({ status: 200, headers, body: JSON.stringify({ code: 0, message: 'success', data }) });
    const failure = (message, status = 500) => route.fulfill({ status, headers, body: JSON.stringify({ code: status, message }) });
    if (endpoint === '/admin/settings') return ok({ site_name: url.origin === secondBackend ? '第二服务器' : '测试服务器' });
    if (endpoint === '/admin/dashboard/stats') return ok(dashboard);
    if (endpoint === '/admin/dashboard/trend') return ok({ start_date: entry.query.start_date, end_date: entry.query.end_date, granularity: 'day', trend: [] });
    if (endpoint === '/admin/dashboard/models') return ok({ start_date: entry.query.start_date, end_date: entry.query.end_date, models: [] });
    if (endpoint === '/admin/dashboard/snapshot-v2') return ok({ trend: [], models: [], groups: [] });
    if (endpoint === '/admin/usage/stats') return ok({ total_requests: 4, total_tokens: 2000, total_cost: 3.25 });
    if (endpoint === '/admin/users') {
      if (url.origin === secondBackend) return ok(paginated([{ ...users[20], username: '第二服务器独有用户' }]));
      const search = entry.query.search || '';
      const page = Number(entry.query.page || 1);
      const filtered = search ? users.filter((user) => `${user.email} ${user.username}`.includes(search)) : users;
      return ok(paginated(filtered.slice((page - 1) * 20, page * 20), filtered.length, page));
    }
    if (/^\/admin\/users\/\d+$/.test(endpoint)) return ok(users.find((user) => user.id === Number(endpoint.split('/').at(-1))));
    if (/^\/admin\/users\/\d+\/api-keys$/.test(endpoint)) return ok(paginated([{ id: 301, user_id: 21, name: '测试 API Key', key: 'synthetic-api-key', status: 'active', quota: 10, quota_used: 3.25, rate_limit_5h: 5, usage_5h: 2, expires_at: future, group }]));
    if (endpoint === '/admin/accounts') return ok(paginated(accounts));
    const accountId = Number(endpoint.match(/\/accounts\/(\d+)/)?.[1]);
    if (/^\/admin\/accounts\/\d+$/.test(endpoint)) return ok(accounts.find((account) => account.id === accountId));
    if (endpoint.endsWith('/today-stats')) return accountId === 103 ? failure('统计暂不可用') : ok({ requests: 42, tokens: 12345, cost: 12.3 });
    if (/^\/admin\/accounts\/\d+\/usage$/.test(endpoint)) {
      if (accountId === 103) return route.fulfill({ status: 404, headers: { ...headers, 'content-type': 'text/html' }, body: '<html>Not found</html>' });
      return ok({ source: entry.query.source || 'passive', updated_at: now, subscription_tier: '测试套餐', five_hour: { utilization: 100, resets_at: future, remaining_seconds: 3600 }, seven_day: { utilization: 20, resets_at: future, remaining_seconds: 7200 } });
    }
    if (endpoint.endsWith('/claude/reset-credits')) return accountId === 103 ? failure('旧后台没有该接口', 404) : ok(claudeCredits());
    if (endpoint.endsWith('/claude/reset-credits/redeem') && method === 'POST') {
      state.claudeRemaining -= 1;
      return ok({ outcome: 'reset', cleared: ['five_hour'], credits: claudeCredits(), replayed: false });
    }
    if (endpoint === '/admin/openai/accounts/102/quota') return ok(openAIQuota());
    if (endpoint === '/admin/openai/accounts/102/reset-quota' && method === 'POST') {
      if (state.failOpenAIReset) return failure('上游结果未确认');
      state.openAIRemaining -= 1;
      return ok({ code: 'rate_limit_reset_success', windows_reset: 1, quota: openAIQuota(), cache_refreshed: true, account_state_recovered: true });
    }
    if (endpoint === '/admin/subscriptions' || endpoint === '/admin/users/21/subscriptions') return ok(paginated([subscription]));
    if (endpoint === '/admin/subscriptions/201/progress') {
      if (state.failProgress) return failure('额度查询暂不可用');
      return ok({ id: 201, daily: { used_usd: state.dailyUsed, limit_usd: 10, percentage: state.dailyUsed * 10, resets_in_seconds: 3600 }, weekly: { used_usd: state.weeklyUsed, limit_usd: 50, percentage: state.weeklyUsed * 2, resets_in_seconds: 86400 }, monthly: { used_usd: state.monthlyUsed, limit_usd: 100, percentage: state.monthlyUsed, resets_in_seconds: 604800 }, expires_at: future, expires_in_days: 90 });
    }
    if (endpoint === '/admin/subscriptions/201/reset-quota' && method === 'POST') {
      if (state.failSubscriptionReset) return failure('订阅重置被拒绝');
      for (const period of ['daily', 'weekly', 'monthly']) if (entry.body[period]) state[`${period}Used`] = 0;
      return ok({ ...subscription, daily_usage_usd: state.dailyUsed, weekly_usage_usd: state.weeklyUsed, monthly_usage_usd: state.monthlyUsed });
    }
    if (endpoint === '/admin/subscriptions/201/extend' && method === 'POST') return ok({ ...subscription, expires_at: new Date(new Date(subscription.expires_at).getTime() + entry.body.days * 86400000).toISOString() });
    unexpected.push(`${method} ${endpoint}`);
    return failure(`Unexpected test API request: ${method} ${endpoint}`, 404);
  });
}

const countPost = (endpoint) => requests.filter((request) => request.endpoint === endpoint && request.method === 'POST');
async function textVisible(page, text) { await page.getByText(text, { exact: true }).first().waitFor({ state: 'visible', timeout: 20000 }); }
async function assertBodyContains(page, text) { await page.waitForFunction((expected) => document.body.innerText.includes(expected), text, { timeout: 20000 }); }
async function clickText(page, text) { await page.getByText(text, { exact: true }).last().click(); }
async function goBackInApp(page) { await page.getByLabel(/^(Go back|.*, back)$/).first().click(); }
async function assertDisabled(locator) { assert.equal(await locator.getAttribute('aria-disabled'), 'true'); }
async function confirmClick(page, locator, accept, message) {
  const dialogPromise = page.waitForEvent('dialog');
  const clicked = locator.click();
  const dialog = await dialogPromise;
  assert.equal(dialog.type(), 'confirm');
  assert.ok(dialog.message().includes(message), 'confirmation explains the affected action');
  if (accept) await dialog.accept(); else await dialog.dismiss();
  await clicked;
}

async function main() {
  fs.mkdirSync(artifactDir, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'zh-CN' });
  await installRoutes(context);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${appUrl}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('例如：https://api.example.com').fill(backend);
    await page.getByPlaceholder('admin-xxxxxxxx').fill(syntheticKey);
    await clickText(page, '进入应用');
    await page.waitForURL('**/monitor');
    await assertBodyContains(page, '测试服务器 的当前运行状态。');
    const tabLabels = await page.getByRole('tab').allTextContents();
    assert.deepEqual(tabLabels.map((label) => label.trim()), ['概览', '用户', '账号', '服务器'], 'phone navigation is limited to four useful management screens');
    console.log('PASS: fresh-session login and four management tabs.');

    await page.getByRole('tab', { name: '用户', exact: true }).click();
    await assertBodyContains(page, '已显示 20 / 21 位用户');
    await clickText(page, '加载更多用户');
    await assertBodyContains(page, '已显示 21 / 21 位用户');
    assert.ok(requests.some((request) => request.endpoint === '/admin/users' && request.query.page === '2'), 'pagination loads the second server page');
    await page.getByRole('textbox', { name: '搜索用户' }).fill('user21');
    await assertBodyContains(page, '已显示 1 / 1 位用户');
    await page.getByRole('button', { name: '查看用户 user21@example.invalid', exact: true }).click();
    await page.waitForURL('**/users/21');
    console.log('PASS: server pagination and debounced user search.');
    await textVisible(page, '订阅与额度');
    await assertBodyContains(page, '剩余 $6.7500');
    await assertBodyContains(page, '已用 $3.2500 · 限额 $10.0000');
    await assertBodyContains(page, '剩余有效期：90 天');
    await assertBodyContains(page, '约 1 小时 0 分钟后自动重置');
    await page.getByRole('checkbox', { name: '周额度' }).click();
    const subscriptionReset = page.getByRole('button', { name: '重置所选额度', exact: true });
    await confirmClick(page, subscriptionReset, false, '日额度、周额度');
    assert.equal(countPost('/admin/subscriptions/201/reset-quota').length, 0, 'cancel preserves quota');
    await confirmClick(page, subscriptionReset, true, '日额度、周额度');
    await assertBodyContains(page, '日额度、周额度已重置。');
    const resetRequests = countPost('/admin/subscriptions/201/reset-quota');
    assert.equal(resetRequests.length, 1, 'one confirmation makes exactly one subscription reset');
    assert.deepEqual(resetRequests[0].body, { daily: true, weekly: true, monthly: false });
    assert.ok(resetRequests[0].headers['idempotency-key'], 'subscription reset identifies the confirmed operation');
    await assertBodyContains(page, '已用 $20.0000 · 限额 $100.0000');
    await page.getByRole('textbox', { name: '订阅延长天数' }).fill('0');
    await page.getByRole('button', { name: '确认延长', exact: true }).click();
    await assertBodyContains(page, '延长天数必须是 1 至 36500 的整数。');
    assert.equal(countPost('/admin/subscriptions/201/extend').length, 0);
    await page.getByRole('textbox', { name: '订阅延长天数' }).fill('7');
    await confirmClick(page, page.getByRole('button', { name: '确认延长', exact: true }), true, '延长 7 天');
    await assertBodyContains(page, '订阅已延长 7 天。');
    assert.deepEqual(countPost('/admin/subscriptions/201/extend')[0].body, { days: 7 });
    await page.getByRole('textbox', { name: '订阅延长天数' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifactDir, 'mobile-user-subscriptions.png') });

    state.failSubscriptionReset = true;
    await confirmClick(page, subscriptionReset, true, '日额度、周额度');
    await assertBodyContains(page, '订阅重置被拒绝');
    assert.equal(await page.getByText('日额度、周额度已重置。', { exact: true }).count(), 0, 'failed mutation does not retain a success message');
    state.failProgress = true;
    await clickText(page, '刷新额度');
    await assertBodyContains(page, '额度查询失败：额度查询暂不可用');

    console.log('PASS: subscription progress, selected-period reset, extension, and errors.');
    // Navigate within the app: Web deliberately keeps admin credentials in
    // memory only, so a full page reload must require login again.
    await goBackInApp(page);
    await page.getByRole('tab', { name: '账号', exact: true }).click();
    await page.getByRole('button', { name: '查看账号 Claude 测试账号', exact: true }).click();
    await textVisible(page, 'Claude 重置卡');
    await assertBodyContains(page, '剩余 0.0%');
    const claudeUse = page.getByRole('button', { name: '使用重置卡', exact: true });
    await assertDisabled(claudeUse);
    await clickText(page, '查询重置卡');
    await assertBodyContains(page, '测试重置卡');
    await confirmClick(page, claudeUse, false, '消耗一次重置机会');
    assert.equal(countPost('/admin/accounts/101/claude/reset-credits/redeem').length, 0);
    await confirmClick(page, claudeUse, true, '消耗一次重置机会');
    await assertBodyContains(page, '重置成功，已清除 5 小时 限额。');
    const claudePosts = countPost('/admin/accounts/101/claude/reset-credits/redeem');
    assert.equal(claudePosts.length, 1, 'one confirmation consumes one Claude credit');
    assert.ok(claudePosts[0].headers['idempotency-key']);
    await assertDisabled(claudeUse);
    await claudeUse.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifactDir, 'mobile-claude-reset.png') });

    console.log('PASS: Claude card cancellation and one confirmed consumption.');
    await goBackInApp(page);
    await page.getByRole('button', { name: '查看账号 Codex 测试账号', exact: true }).click();
    await textVisible(page, 'OpenAI / Codex 额度与重置卡');
    const openAIUse = page.getByRole('button', { name: '使用重置卡', exact: true });
    await assertDisabled(openAIUse);
    await clickText(page, '查询额度与重置卡');
    await textVisible(page, '已触及限额');
    await confirmClick(page, openAIUse, false, '使用一张');
    assert.equal(countPost('/admin/openai/accounts/102/reset-quota').length, 0);
    await confirmClick(page, openAIUse, true, '使用一张');
    await assertBodyContains(page, '已使用一张重置卡，重置 1 个窗口。');
    assert.equal(countPost('/admin/openai/accounts/102/reset-quota').length, 1, 'one confirmation consumes one OpenAI credit');
    await assertDisabled(openAIUse);
    await clickText(page, '查询额度与重置卡');
    state.failOpenAIReset = true;
    await confirmClick(page, openAIUse, true, '使用一张');
    await assertBodyContains(page, '使用结果尚未确认，重置卡可能已经扣除。');
    await assertDisabled(openAIUse);
    assert.equal(countPost('/admin/openai/accounts/102/reset-quota').length, 2, 'failed irreversible OpenAI action is not automatically retried');
    await openAIUse.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifactDir, 'mobile-openai-reset.png') });

    console.log('PASS: OpenAI card cancellation, consumption, and uncertain result protection.');
    await goBackInApp(page);
    await page.getByRole('button', { name: '查看账号 旧后台测试账号', exact: true }).click();
    await assertBodyContains(page, '当前后台版本不支持此功能');
    await assertBodyContains(page, '统计暂不可用');
    await clickText(page, '查询重置卡');
    await assertBodyContains(page, '当前后台版本不支持此功能');
    await assertDisabled(page.getByRole('button', { name: '使用重置卡', exact: true }));
    const todayText = await page.getByText('今日消费', { exact: true }).last().locator('..').innerText();
    assert.ok(todayText.includes('—'), 'failed statistics are shown as unknown');
    assert.ok(!todayText.includes('$0.00'), 'failed statistics do not imply a zero balance');
    assert.equal(countPost('/admin/accounts/103/claude/reset-credits/redeem').length, 0);

    await goBackInApp(page);
    await page.getByRole('button', { name: '查看账号 未知额度测试账号', exact: true }).click();
    await textVisible(page, '本地账号额度');
    await assertBodyContains(page, '额度未知');
    assert.equal(await page.getByRole('button', { name: '重置本地额度计数', exact: true }).count(), 0, 'unknown quota does not expose a reset of unknown limits');

    console.log('PASS: unsupported backend and unknown quota are not false zero/success.');
    await goBackInApp(page);
    await page.getByRole('tab', { name: '服务器', exact: true }).click();
    await clickText(page, '+');
    await page.getByPlaceholder('例如：https://api.example.com').fill(secondBackend);
    await page.getByPlaceholder('admin-xxxxxxxx').fill(syntheticKey);
    await clickText(page, '保存并使用');
    await page.waitForURL('**/monitor');
    await assertBodyContains(page, '第二服务器 的当前运行状态。');
    await page.getByRole('tab', { name: '用户', exact: true }).click();
    await textVisible(page, '第二服务器独有用户');
    assert.equal(await page.getByText('用户 21', { exact: true }).count(), 0, 'server switching discards the previous server user cache');
    assert.deepEqual(unexpected, [], 'all backend calls match the supported API fixtures');
    assert.deepEqual(errors, [], 'new mobile flows emit no uncaught browser errors');
    console.log('PASS: four management tabs, user pagination/search, subscription normalization/reset/extension, confirmed Claude/OpenAI resets, error handling, server isolation.');
    console.log(`Screenshots: ${artifactDir}`);
  } catch (error) {
    await page.screenshot({ path: path.join(artifactDir, 'mobile-management-failure.png') });
    console.error('Browser smoke failure:', error.stack || error.message);
    console.error('Unexpected API calls:', unexpected);
    console.error('Uncaught browser errors:', errors);
    throw error;
  } finally { await browser.close(); }
}

main().catch(() => { process.exitCode = 1; });
