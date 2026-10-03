import { adminFetch, adminTestAccount } from '@/src/lib/admin-fetch';
import type { AccountUsageInfo, ClaudeResetCredits, ClaudeResetOutcome, OpenAIQuotaUsage, OpenAIQuotaRefreshResult, OpenAIQuotaResetResult, UserSubscription, SubscriptionProgress, SubscriptionWindow } from '@/src/types/admin';
import type {
  AccountTodayStats,
  AdminAccount,
  AdminApiKey,
  AdminGroup,
  AdminSettings,
  AdminUser,
  BalanceOperation,
  DashboardModelStats,
  DashboardSnapshot,
  DashboardStats,
  DashboardTrend,
  CreateAccountRequest,
  CreateUserRequest,
  PaginatedData,
  UsageStats,
  UserUsageSummary,
} from '@/src/types/admin';

function buildQuery(params: Record<string, string | number | boolean | null | undefined>) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });

  const value = query.toString();

  return value ? `?${value}` : '';
}

export function getDashboardStats() {
  return adminFetch<DashboardStats>('/api/v1/admin/dashboard/stats');
}

export function getAdminSettings() {
  return adminFetch<AdminSettings>('/api/v1/admin/settings');
}

export function getDashboardTrend(params: {
  start_date: string;
  end_date: string;
  granularity?: 'day' | 'hour';
  account_id?: number;
  group_id?: number;
  user_id?: number;
}) {
  return adminFetch<DashboardTrend>(`/api/v1/admin/dashboard/trend${buildQuery(params)}`);
}

export function getDashboardModels(params: { start_date: string; end_date: string }) {
  return adminFetch<DashboardModelStats>(`/api/v1/admin/dashboard/models${buildQuery(params)}`);
}

export function getDashboardSnapshot(params: {
  start_date: string;
  end_date: string;
  granularity?: 'day' | 'hour';
  account_id?: number;
  user_id?: number;
  group_id?: number;
  model?: string;
  request_type?: string;
  billing_type?: string | null;
  include_stats?: boolean;
  include_trend?: boolean;
  include_model_stats?: boolean;
  include_group_stats?: boolean;
  include_users_trend?: boolean;
}) {
  return adminFetch<DashboardSnapshot>(`/api/v1/admin/dashboard/snapshot-v2${buildQuery(params)}`);
}

export function getUsageStats(params: {
  start_date: string;
  end_date: string;
  user_id?: number;
  account_id?: number;
  group_id?: number;
  model?: string;
  request_type?: string;
  billing_type?: string | null;
}) {
  return adminFetch<UsageStats>(`/api/v1/admin/usage/stats${buildQuery(params)}`);
}

export function listUsers(search = '', page = 1) {
  return adminFetch<PaginatedData<AdminUser>>(
    `/api/v1/admin/users${buildQuery({ page, page_size: 20, search: search.trim() })}`
  );
}

export function getUser(userId: number) {
  return adminFetch<AdminUser>(`/api/v1/admin/users/${userId}`);
}

export function createUser(body: CreateUserRequest) {
  return adminFetch<AdminUser>('/api/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getUserUsage(userId: number, period: 'day' | 'week' | 'month' = 'month') {
  return adminFetch<UserUsageSummary>(`/api/v1/admin/users/${userId}/usage${buildQuery({ period })}`);
}

export function listUserApiKeys(userId: number, page = 1, pageSize = 20) {
  return adminFetch<PaginatedData<AdminApiKey>>(`/api/v1/admin/users/${userId}/api-keys${buildQuery({ page, page_size: pageSize })}`);
}

export function updateUserBalance(
  userId: number,
  body: { balance: number; operation: BalanceOperation; notes?: string },
  idempotencyKey?: string
) {
  return adminFetch<AdminUser>(
    `/api/v1/admin/users/${userId}/balance`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    {
      idempotencyKey: idempotencyKey ?? `user-balance-${userId}-${Date.now()}`,
    }
  );
}

export function updateUserStatus(userId: number, status: 'active' | 'disabled') {
  return adminFetch<AdminUser>(`/api/v1/admin/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export function listGroups(search = '') {
  return adminFetch<PaginatedData<AdminGroup>>(
    `/api/v1/admin/groups${buildQuery({ page: 1, page_size: 20, search: search.trim() })}`
  );
}

export function getGroup(groupId: number) {
  return adminFetch<AdminGroup>(`/api/v1/admin/groups/${groupId}`);
}

export function listAccounts(search = '', page = 1) {
  return adminFetch<PaginatedData<AdminAccount>>(
    `/api/v1/admin/accounts${buildQuery({ page, page_size: 20, search: search.trim() })}`
  );
}

export function getAccount(accountId: number) {
  return adminFetch<AdminAccount>(`/api/v1/admin/accounts/${accountId}`);
}

export function createAccount(body: CreateAccountRequest) {
  return adminFetch<AdminAccount>('/api/v1/admin/accounts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getAccountTodayStats(accountId: number) {
  return adminFetch<AccountTodayStats>(`/api/v1/admin/accounts/${accountId}/today-stats`);
}

export function testAccount(accountId: number) {
  return adminTestAccount(`/api/v1/admin/accounts/${accountId}/test`);
}

export function refreshAccount(accountId: number) {
  return adminFetch(`/api/v1/admin/accounts/${accountId}/refresh`, {
    method: 'POST',
  });
}

export function setAccountSchedulable(accountId: number, schedulable: boolean) {
  return adminFetch<AdminAccount>(`/api/v1/admin/accounts/${accountId}/schedulable`, {
    method: 'POST',
    body: JSON.stringify({ schedulable }),
  });
}

export function getAccountUsage(accountId: number, options: { source?: 'passive' | 'active'; force?: boolean } = {}) {
  return adminFetch<AccountUsageInfo>(`/api/v1/admin/accounts/${accountId}/usage${buildQuery(options)}`, {}, { timeoutMs: 90_000 });
}

export function clearAccountError(accountId: number) {
  return adminFetch<AdminAccount>(`/api/v1/admin/accounts/${accountId}/clear-error`, { method: 'POST' });
}

export function resetAccountQuota(accountId: number) {
  return adminFetch<AdminAccount>(`/api/v1/admin/accounts/${accountId}/reset-quota`, { method: 'POST' });
}

export function getClaudeResetCredits(accountId: number) {
  return adminFetch<ClaudeResetCredits>(`/api/v1/admin/accounts/${accountId}/claude/reset-credits`, {}, { timeoutMs: 90_000 });
}

export function redeemClaudeResetCredit(accountId: number, idempotencyKey: string) {
  if (!idempotencyKey.trim()) return Promise.reject(new Error('请先创建操作标识再使用重置卡。'));
  return adminFetch<ClaudeResetOutcome>(`/api/v1/admin/accounts/${accountId}/claude/reset-credits/redeem`,
    { method: 'POST' }, { idempotencyKey, timeoutMs: 120_000 });
}

export function getOpenAIQuota(accountId: number) {
  return adminFetch<OpenAIQuotaUsage>(`/api/v1/admin/openai/accounts/${accountId}/quota`, {}, { timeoutMs: 90_000 });
}

export function refreshOpenAIQuota(accountId: number) {
  return adminFetch<OpenAIQuotaRefreshResult>(`/api/v1/admin/openai/accounts/${accountId}/quota/refresh`, { method: 'POST' }, { timeoutMs: 90_000 });
}

// This upstream action is not idempotent. Never retry automatically.
export function resetOpenAIQuota(accountId: number) {
  return adminFetch<OpenAIQuotaResetResult>(`/api/v1/admin/openai/accounts/${accountId}/reset-quota`, { method: 'POST' }, { timeoutMs: 120_000 });
}

export function listUserSubscriptions(userId: number, page = 1, pageSize = 20) {
  return adminFetch<PaginatedData<UserSubscription>>(`/api/v1/admin/subscriptions${buildQuery({ user_id: userId, page, page_size: pageSize })}`);
}

export function getSubscription(subscriptionId: number) {
  return adminFetch<UserSubscription>(`/api/v1/admin/subscriptions/${subscriptionId}`);
}

export async function getSubscriptionProgress(subscriptionId: number): Promise<SubscriptionProgress> {
  type RawWindow = Partial<SubscriptionWindow> & { used_usd?: number; limit_usd?: number | null; resets_in_seconds?: number | null };
  type RawProgress = { id?: number; subscription_id?: number; expires_at?: string | null; expires_in_days?: number | null; days_remaining?: number | null; daily?: RawWindow | null; weekly?: RawWindow | null; monthly?: RawWindow | null };
  const raw = await adminFetch<RawProgress>(`/api/v1/admin/subscriptions/${subscriptionId}/progress`);
  const window = (value?: RawWindow | null): SubscriptionWindow | null => {
    if (!value) return null;
    const used = value.used_usd ?? value.used;
    if (typeof used !== 'number' || !Number.isFinite(used)) throw new Error('订阅额度返回格式异常，请核对后台版本。');
    return { used, limit: value.limit_usd ?? value.limit ?? null,
      percentage: value.percentage ?? 0, reset_in_seconds: value.resets_in_seconds ?? value.reset_in_seconds ?? null };
  };
  return { subscription_id: raw.id ?? raw.subscription_id ?? subscriptionId,
    daily: window(raw.daily), weekly: window(raw.weekly), monthly: window(raw.monthly),
    expires_at: raw.expires_at ?? null, days_remaining: raw.expires_in_days ?? raw.days_remaining ?? null };
}

export function resetSubscriptionQuota(subscriptionId: number, options: { daily: boolean; weekly: boolean; monthly: boolean }, idempotencyKey?: string) {
  if (!options.daily && !options.weekly && !options.monthly) return Promise.reject(new Error('请至少选择一个重置周期。'));
  return adminFetch<UserSubscription>(`/api/v1/admin/subscriptions/${subscriptionId}/reset-quota`,
    { method: 'POST', body: JSON.stringify(options) }, { idempotencyKey });
}

export function extendSubscription(subscriptionId: number, days: number, idempotencyKey?: string) {
  if (!Number.isInteger(days) || days <= 0 || days > 36500) return Promise.reject(new Error('续期天数须为 1 到 36500 的整数。'));
  return adminFetch<UserSubscription>(`/api/v1/admin/subscriptions/${subscriptionId}/extend`,
    { method: 'POST', body: JSON.stringify({ days }) }, { idempotencyKey });
}
