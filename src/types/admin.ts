export type ApiEnvelope<T> = {
  code: number | string;
  message: string;
  reason?: string;
  metadata?: Record<string, string>;
  data?: T;
};

export type PaginatedData<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
};

export type DashboardStats = {
  total_users: number;
  today_new_users: number;
  active_users: number;
  total_api_keys: number;
  active_api_keys: number;
  total_accounts: number;
  normal_accounts: number;
  error_accounts: number;
  total_requests: number;
  total_cost: number;
  total_tokens: number;
  today_requests: number;
  today_cost: number;
  today_tokens: number;
  today_input_tokens?: number;
  today_output_tokens?: number;
  today_cache_read_tokens?: number;
  rpm: number;
  tpm: number;
};

export type TrendPoint = {
  date: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost: number;
  actual_cost: number;
};

export type DashboardTrend = {
  start_date: string;
  end_date: string;
  granularity: 'day' | 'hour' | string;
  trend: TrendPoint[];
};

export type ModelStat = {
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost: number;
  actual_cost: number;
};

export type DashboardModelStats = {
  start_date: string;
  end_date: string;
  models: ModelStat[];
};

export type UsageStats = {
  total_requests?: number;
  total_tokens?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_cost?: number;
  total_actual_cost?: number;
  total_account_cost?: number;
  average_duration_ms?: number;
};

export type DashboardSnapshot = {
  trend?: TrendPoint[];
  models?: ModelStat[];
  groups?: Array<{
    group_id?: number;
    group_name?: string;
    requests?: number;
    total_tokens?: number;
    total_cost?: number;
    total_actual_cost?: number;
  }>;
};

export type AdminSettings = {
  site_name?: string;
  [key: string]: string | number | boolean | null | string[] | undefined;
};

export type AdminUser = {
  id: number;
  email: string;
  username?: string | null;
  balance?: number;
  concurrency?: number;
  status?: string;
  role?: string;
  current_concurrency?: number;
  notes?: string | null;
  last_used_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type UserUsageSummary = {
  total_requests?: number;
  total_tokens?: number;
  total_cost?: number;
  requests?: number;
  tokens?: number;
  cost?: number;
  [key: string]: string | number | boolean | null | undefined;
};

export type AdminApiKey = {
  id: number;
  user_id: number;
  key: string;
  name: string;
  group_id?: number | null;
  status: string;
  quota: number;
  quota_used: number;
  last_used_at?: string | null;
  expires_at?: string | null;
  created_at?: string;
  updated_at?: string;
  usage_5h?: number;
  usage_1d?: number;
  usage_7d?: number;
  rate_limit_5h?: number | null;
  rate_limit_1d?: number | null;
  rate_limit_7d?: number | null;
  group?: AdminGroup;
  user?: {
    id: number;
    email?: string;
    username?: string | null;
  };
};

export type BalanceOperation = 'set' | 'add' | 'subtract';

export type AdminGroup = {
  id: number;
  name: string;
  description?: string | null;
  platform: string;
  rate_multiplier?: number;
  is_exclusive?: boolean;
  status?: string;
  subscription_type?: string;
  daily_limit_usd?: number | null;
  weekly_limit_usd?: number | null;
  monthly_limit_usd?: number | null;
  account_count?: number;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
};

export type AccountTodayStats = {
  requests: number;
  tokens: number;
  cost: number;
  standard_cost?: number;
  user_cost?: number;
};

export type AdminAccount = {
  id: number;
  name: string;
  platform: string;
  type: string;
  status?: string;
  schedulable?: boolean;
  priority?: number;
  concurrency?: number;
  current_concurrency?: number;
  rate_multiplier?: number;
  error_message?: string;
  updated_at?: string;
  last_used_at?: string | null;
  group_ids?: number[];
  groups?: AdminGroup[];
  extra?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  expires_at?: string | null;
  rate_limit_reset_at?: string | null;
  overload_until?: string | null;
  temp_unschedulable_until?: string | null;
  temp_unschedulable_reason?: string | null;
  session_window_start?: string | null;
  session_window_end?: string | null;
  session_window_status?: string | null;
  parent_account_id?: number | null;
  quota_dimension?: string;
  quota_limit?: number | null;
  quota_used?: number;
  quota_daily_limit?: number | null;
  quota_daily_used?: number;
  quota_weekly_limit?: number | null;
  quota_weekly_used?: number;
  quota_daily_reset_at?: string | null;
  quota_weekly_reset_at?: string | null;
};

export type UsageProgress = {
  utilization: number;
  resets_at: string | null;
  remaining_seconds: number;
  used_requests?: number;
  limit_requests?: number;
  window_stats?: { requests?: number; tokens?: number; cost?: number; actual_cost?: number } | null;
};

export type AccountUsageInfo = {
  source?: 'passive' | 'active';
  updated_at?: string | null;
  five_hour?: UsageProgress | null;
  seven_day?: UsageProgress | null;
  seven_day_sonnet?: UsageProgress | null;
  seven_day_fable?: UsageProgress | null;
  thirty_day?: UsageProgress | null;
  gemini_shared_daily?: UsageProgress | null;
  gemini_pro_daily?: UsageProgress | null;
  gemini_flash_daily?: UsageProgress | null;
  gemini_shared_minute?: UsageProgress | null;
  gemini_pro_minute?: UsageProgress | null;
  gemini_flash_minute?: UsageProgress | null;
  antigravity_quota?: Record<string, { utilization: number; reset_time: string }> | null;
  subscription_tier?: string;
  error?: string;
  error_code?: string;
  needs_reauth?: boolean;
  is_forbidden?: boolean;
  forbidden_reason?: string;
};

export type ClaudeResetCredit = {
  label: string;
  resets_left: number;
  starts_at?: string | null;
  expires_at?: string | null;
  clears: string[];
  percent_used: Record<string, number>;
  blocking: string[];
  use_requires_limit: boolean;
  redeemable: boolean;
};

export type ClaudeResetCredits = {
  eligible: boolean;
  available_count: number;
  credits: ClaudeResetCredit[];
  cooldown_until?: string | null;
  weekly_resets_at?: string | null;
  fetched_at: string;
};

export type ClaudeResetOutcome = {
  outcome: string;
  reason?: string;
  cleared?: string[];
  cooldown_until?: string | null;
  credits?: ClaudeResetCredits | null;
  replayed: boolean;
};

export type OpenAIRateLimitWindow = {
  used_percent: number;
  limit_window_seconds: number;
  reset_after_seconds: number;
  reset_at: number;
};
export type OpenAIRateLimit = {
  allowed: boolean;
  limit_reached: boolean;
  primary_window?: OpenAIRateLimitWindow | null;
  secondary_window?: OpenAIRateLimitWindow | null;
};
export type OpenAIQuotaUsage = {
  plan_type?: string;
  rate_limit?: OpenAIRateLimit | null;
  additional_rate_limits?: Array<{ limit_name: string; metered_feature: string; rate_limit?: OpenAIRateLimit | null }>;
  rate_limit_reset_credits?: { available_count: number; credits?: Array<{ expires_at?: string }> } | null;
  credits?: { has_credits: boolean; unlimited: boolean; balance: string | null } | null;
  fetched_at: number;
};
export type OpenAIQuotaRefreshResult = OpenAIQuotaUsage & { cache_persisted: boolean; credits_cache_persisted?: boolean };
export type OpenAIQuotaResetResult = {
  code: string;
  windows_reset: number;
  credit?: { id?: string; status?: string; expires_at?: string; redeemed_at?: string } | null;
  quota?: OpenAIQuotaUsage | null;
  account?: AdminAccount | null;
  cache_refreshed: boolean;
  account_state_recovered: boolean;
  warning_code?: string;
};

export type UserSubscription = {
  id: number;
  user_id: number;
  group_id: number;
  status: 'active' | 'expired' | 'revoked' | 'suspended';
  starts_at: string;
  expires_at: string | null;
  daily_usage_usd: number;
  weekly_usage_usd: number;
  monthly_usage_usd: number;
  group?: AdminGroup;
};
export type SubscriptionWindow = { used: number; limit: number | null; percentage: number; reset_in_seconds: number | null };
export type SubscriptionProgress = {
  subscription_id: number;
  daily: SubscriptionWindow | null;
  weekly: SubscriptionWindow | null;
  monthly: SubscriptionWindow | null;
  expires_at: string | null;
  days_remaining: number | null;
};

export type AccountType = 'apikey' | 'oauth' | 'setup-token' | 'upstream';

export type CreateAccountRequest = {
  name: string;
  platform: string;
  type: AccountType;
  credentials: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, string | number | boolean | null | undefined>;
  notes?: string;
  proxy_id?: number;
  concurrency?: number;
  priority?: number;
  rate_multiplier?: number;
  group_ids?: number[];
};

export type CreateUserRequest = {
  email: string;
  password: string;
  username?: string;
  notes?: string;
  role?: 'user' | 'admin';
  status?: 'active' | 'disabled';
  balance?: number;
  concurrency?: number;
  [key: string]: string | number | boolean | null | undefined;
};
