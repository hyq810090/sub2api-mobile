import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { ScreenShell } from '@/src/components/screen-shell';
import { formatTokenValue } from '@/src/lib/formatters';
import { confirmAction, createOperationKey, formatDateTime, formatMoney, getManagementError } from '@/src/lib/management';
import {
  clearAccountError,
  getAccount,
  getAccountTodayStats,
  getAccountUsage,
  getClaudeResetCredits,
  getOpenAIQuota,
  redeemClaudeResetCredit,
  refreshOpenAIQuota,
  resetAccountQuota,
  resetOpenAIQuota,
  setAccountSchedulable,
  testAccount,
} from '@/src/services/admin';
import { adminConfigState } from '@/src/store/admin-config';
import type { AdminAccount, AccountUsageInfo, ClaudeResetCredits, OpenAIQuotaUsage, OpenAIRateLimitWindow, UsageProgress } from '@/src/types/admin';

const { useSnapshot } = require('valtio/react');

// Keep an uncertain operation available when the operator leaves and reopens the account.
// The server's idempotency fence remains authoritative across app restarts.
const pendingClaudeOperations = new Map<string, string>();

const windows: Array<[keyof AccountUsageInfo, string]> = [
  ['five_hour', '5 小时'], ['seven_day', '7 天'], ['seven_day_sonnet', 'Sonnet 7 天'],
  ['seven_day_fable', 'Fable 7 天'], ['thirty_day', '30 天'], ['gemini_shared_daily', 'Gemini 共享每日'],
  ['gemini_pro_daily', 'Gemini Pro 每日'], ['gemini_flash_daily', 'Gemini Flash 每日'],
  ['gemini_shared_minute', 'Gemini 共享每分钟'], ['gemini_pro_minute', 'Gemini Pro 每分钟'], ['gemini_flash_minute', 'Gemini Flash 每分钟'],
];
const windowNames: Record<string, string> = { five_hour: '5 小时', seven_day: '7 天', seven_day_overage_included: '7 天额外额度' };
const blockerNames: Record<string, string> = {
  not_limited: '尚未触及限额', cooldown: '冷却中', expired: '已到期', not_started: '尚未生效',
  ineligible: '当前账号不可使用', paused: '重置卡已暂停', no_resets_left: '剩余次数不足',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View className="rounded-[18px] border border-[#e7dfcf] bg-[#fbf8f2] p-4"><Text className="mb-3 text-base font-bold text-[#16181a]">{title}</Text>{children}</View>;
}
function Button({ label, onPress, disabled = false, danger = false }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={{ opacity: disabled ? 0.45 : 1, backgroundColor: danger ? '#a4512b' : '#1d5f55' }} className="rounded-xl px-4 py-3"><Text className="text-center text-sm font-semibold text-white">{label}</Text></Pressable>;
}
function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return <View className="mt-3 rounded-xl bg-[#f7e1d6] p-3"><Text selectable className="text-sm leading-5 text-[#a4512b]">{getManagementError(error)}</Text></View>;
}
function Field({ label, value }: { label: string; value: string }) {
  return <View className="mb-2 flex-row justify-between gap-3"><Text className="flex-1 text-sm text-[#7d7468]">{label}</Text><Text selectable className="max-w-[70%] text-right text-sm text-[#16181a]">{value}</Text></View>;
}
function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function quotaNumber(account: AdminAccount, key: keyof AdminAccount) {
  return finite(account[key]) ?? finite(account.extra?.[key]);
}
function percentText(value: unknown) {
  const number = finite(value);
  return number === undefined ? '—' : `${number.toFixed(1)}%`;
}
function names(keys: string[]) {
  return keys.map((key) => windowNames[key] ?? key).join('、') || '—';
}
function UsageBar({ label, usedPercent, resetAt, children }: { label: string; usedPercent?: number; resetAt?: string | number | null; children?: ReactNode }) {
  const used = finite(usedPercent);
  return (
    <View className="mb-3 rounded-xl bg-[#f1ece2] p-3">
      <Field label={label} value={`已用 ${percentText(used)}`} />
      <View className="mb-2 h-2 overflow-hidden rounded-full bg-[#e1d9ca]"><View style={{ height: 8, width: `${Math.min(100, Math.max(0, used ?? 0))}%`, backgroundColor: (used ?? 0) >= 95 ? '#a4512b' : '#1d5f55' }} /></View>
      <Text className="text-xs text-[#7d7468]">{used === undefined ? '用量未知' : `剩余 ${Math.max(0, 100 - used).toFixed(1)}%`} · 重置 {formatDateTime(resetAt)}</Text>
      {children}
    </View>
  );
}
function ProviderWindow({ label, data }: { label: string; data: UsageProgress }) {
  return <UsageBar label={label} usedPercent={data.utilization} resetAt={data.resets_at}>
    {finite(data.limit_requests) !== undefined ? <Text className="mt-2 text-xs text-[#7d7468]">请求 {finite(data.used_requests) ?? '—'} / {data.limit_requests}</Text> : null}
    {data.window_stats ? <Text className="mt-2 text-xs text-[#7d7468]">本地窗口统计：请求 {finite(data.window_stats.requests) ?? '—'} · Token {finite(data.window_stats.tokens) === undefined ? '—' : formatTokenValue(data.window_stats.tokens!)} · 消费 {formatMoney(data.window_stats.cost)}</Text> : null}
  </UsageBar>;
}
function OpenAIWindow({ label, data }: { label: string; data?: OpenAIRateLimitWindow | null }) {
  if (!data) return null;
  const hours = data.limit_window_seconds / 3600;
  const window = hours >= 24 ? `${(hours / 24).toFixed(1).replace(/\.0$/, '')} 天` : `${hours.toFixed(1).replace(/\.0$/, '')} 小时`;
  return <UsageBar label={`${label}（${window}）`} usedPercent={data.used_percent} resetAt={data.reset_at} />;
}

type AccountAction = 'test' | 'pause' | 'resume' | 'clear-error' | 'local-reset';

export default function AccountDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const accountId = Number(params.id);
  const validId = Number.isSafeInteger(accountId) && accountId > 0;
  const config = useSnapshot(adminConfigState);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [claudeCredits, setClaudeCredits] = useState<ClaudeResetCredits | null>(null);
  const [claudeQueriedAt, setClaudeQueriedAt] = useState(0);
  const [claudeFeedback, setClaudeFeedback] = useState('');
  const [openAIQuota, setOpenAIQuota] = useState<OpenAIQuotaUsage | null>(null);
  const [openAIQueriedAt, setOpenAIQueriedAt] = useState(0);
  const [openAIFeedback, setOpenAIFeedback] = useState('');
  const [openAIRequiresQuery, setOpenAIRequiresQuery] = useState(true);
  const pendingClaudeKey = useRef<string | null>(null);
  const [claudeRetryPending, setClaudeRetryPending] = useState(false);
  const confirmationPending = useRef(false);
  const mounted = useRef(true);
  const identity = useRef(accountId);
  identity.current = accountId;
  const operationScope = `${config.activeAccountId}|${config.baseUrl}|${accountId}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    setClaudeCredits(null); setClaudeQueriedAt(0); setClaudeFeedback('');
    setOpenAIQuota(null); setOpenAIQueriedAt(0); setOpenAIRequiresQuery(true); setOpenAIFeedback('');
    pendingClaudeKey.current = pendingClaudeOperations.get(operationScope) ?? null;
    setClaudeRetryPending(Boolean(pendingClaudeKey.current)); setFeedback('');
  }, [accountId, config.baseUrl, config.adminApiKey, config.sessionRevision, operationScope]);

  const accountQuery = useQuery({ queryKey: ['account', accountId], queryFn: () => getAccount(accountId), enabled: validId });
  const account = accountQuery.data;
  const statsQuery = useQuery({ queryKey: ['account-today-stats', accountId], queryFn: () => getAccountTodayStats(accountId), enabled: validId, staleTime: 60_000 });
  const usageQuery = useQuery({ queryKey: ['account-usage', accountId], queryFn: () => getAccountUsage(accountId, { source: 'passive' }), enabled: Boolean(account), staleTime: 60_000, retry: false });
  const isShadow = Boolean(account?.parent_account_id);
  const supportsClaude = account?.platform === 'anthropic' && account.type === 'oauth';
  const supportsOpenAI = account?.platform === 'openai' && account.type === 'oauth' && !isShadow;

  function refreshAccountData() {
    void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    void queryClient.invalidateQueries({ queryKey: ['account', accountId] });
    void queryClient.invalidateQueries({ queryKey: ['account-usage', accountId] });
  }

  const activeUsage = useMutation({
    mutationFn: () => getAccountUsage(accountId, { source: 'active', force: true }),
    retry: false,
    onSuccess: (data) => queryClient.setQueryData(['account-usage', accountId], data),
  });
  const accountAction = useMutation({
    mutationFn: async (action: AccountAction) => {
      if (action === 'test') { await testAccount(accountId); return '账号连通性测试成功。'; }
      if (action === 'pause' || action === 'resume') { await setAccountSchedulable(accountId, action === 'resume'); return action === 'resume' ? '已恢复账号调度。' : '已暂停账号调度。'; }
      if (action === 'clear-error') { await clearAccountError(accountId); return '已清除账号错误状态，请测试账号是否恢复。'; }
      await resetAccountQuota(accountId); return '已重置本地额度计数。上游服务商额度未变化。';
    },
    retry: false,
    onSuccess: (message) => { setFeedback(message); refreshAccountData(); },
  });
  const claudeQuery = useMutation({
    mutationFn: () => getClaudeResetCredits(accountId),
    retry: false,
    onSuccess: (data) => { setClaudeCredits(data); setClaudeQueriedAt(Date.now()); },
    onError: () => setClaudeQueriedAt(0),
  });
  const claudeReset = useMutation({
    mutationFn: (key: string) => redeemClaudeResetCredit(accountId, key),
    retry: false,
    onSuccess: (result) => {
      const messages: Record<string, string> = {
        reset: `重置成功，已清除 ${names(result.cleared ?? [])} 限额。`,
        already_used: '此次重置已使用，未重复扣除重置卡。',
        not_limited: '账号尚未达到可重置的限额，本次未使用重置卡。',
        cooldown: `当前处于冷却期，请在 ${formatDateTime(result.cooldown_until)} 后查询。`,
        ineligible: '当前账号不符合重置条件。',
        unknown: '使用结果尚未确定。请查询当前额度；如需重试，使用“重试同一次使用”按钮。',
      };
      setClaudeFeedback(`${messages[result.outcome] ?? '后台返回未知结果，请先查询。'}${result.reason ? ` ${result.reason}` : ''}${result.replayed ? '（返回同一次操作的记录）' : ''}`);
      setClaudeCredits(result.credits ?? null); setClaudeQueriedAt(0);
      if (['reset', 'already_used', 'not_limited', 'cooldown', 'ineligible'].includes(result.outcome)) { pendingClaudeOperations.delete(operationScope); pendingClaudeKey.current = null; setClaudeRetryPending(false); }
      else setClaudeRetryPending(true);
      refreshAccountData();
    },
    onError: () => {
      setClaudeRetryPending(true); setClaudeQueriedAt(0);
      setClaudeFeedback('使用请求未确认。请先查询额度；重试将沿用同一次操作编号，避免再次使用重置卡。');
    },
  });
  const openAIQuery = useMutation({
    mutationFn: (persist: boolean) => persist ? refreshOpenAIQuota(accountId) : getOpenAIQuota(accountId),
    retry: false,
    onSuccess: (data) => {
      setOpenAIQuota(data); setOpenAIQueriedAt(Date.now()); setOpenAIRequiresQuery(false);
      if ('cache_persisted' in data && (!data.cache_persisted || ('credits_cache_persisted' in data && data.credits_cache_persisted === false))) setOpenAIFeedback('最新额度已查询，后台缓存更新未完成；此处显示此次查询结果。');
    },
    onError: () => { setOpenAIQueriedAt(0); setOpenAIRequiresQuery(true); },
  });
  const openAIReset = useMutation({
    mutationFn: () => resetOpenAIQuota(accountId),
    retry: false,
    onSuccess: (result) => {
      setOpenAIQuota(result.quota ?? null); setOpenAIQueriedAt(0); setOpenAIRequiresQuery(true);
      setOpenAIFeedback(result.warning_code || !result.cache_refreshed || !result.account_state_recovered
        ? `上游重置已完成（${result.windows_reset} 个窗口），后台缓存或账号状态恢复未完成，请查询最新额度。不要重复使用重置卡。${result.warning_code ? ` [${result.warning_code}]` : ''}`
        : `已使用一张重置卡，重置 ${result.windows_reset} 个窗口。请查询最新额度后再进行其他重置。`);
      refreshAccountData();
    },
    onError: () => {
      setOpenAIQueriedAt(0); setOpenAIRequiresQuery(true);
      setOpenAIFeedback('使用结果尚未确认，重置卡可能已经扣除。请查询最新额度和剩余次数，不要直接重复使用。');
    },
  });
  const busy = accountAction.isPending || claudeReset.isPending || openAIReset.isPending;
  const totalClaudeResets = claudeCredits?.credits.reduce((sum, credit) => sum + credit.resets_left, 0);
  const nextClaude = claudeCredits?.credits.find((credit) => credit.redeemable);
  const canUseClaude = Boolean(claudeCredits?.eligible && nextClaude && (claudeCredits.available_count > 0) && claudeQueriedAt > 0);
  const openAICount = openAIQuota?.rate_limit_reset_credits?.available_count;
  const canUseOpenAI = Boolean(!openAIRequiresQuery && openAIQueriedAt > 0 && finite(openAICount) !== undefined && openAICount! > 0);

  async function runAccountAction(action: AccountAction) {
    if (busy || confirmationPending.current) return;
    const prompts: Record<AccountAction, { title: string; message: string }> = {
      test: { title: '测试账号', message: '将向上游发送一次测试请求，可能产生少量用量或费用。' },
      pause: { title: '暂停账号', message: `暂停“${account?.name}”的新请求调度，正在处理的请求不受影响。` },
      resume: { title: '恢复账号', message: `恢复“${account?.name}”的请求调度。请确认账号额度和状态正常。` },
      'clear-error': { title: '清除错误状态', message: '清除后台记录的账号错误；此操作不能修复失效凭据或解除上游封禁。' },
      'local-reset': { title: '重置本地额度计数', message: '将清零此账号的本地累计、每日和每周额度计数，并清理本地限流状态。这会重新允许请求使用本地额度，不会恢复服务商额度，也不会使用重置卡。' },
    };
    confirmationPending.current = true;
    const sessionAtConfirmation = adminConfigState.sessionRevision;
    const confirmed = await confirmAction({ ...prompts[action], destructive: action === 'local-reset' || action === 'pause' });
    confirmationPending.current = false;
    if (confirmed && mounted.current && identity.current === accountId && adminConfigState.sessionRevision === sessionAtConfirmation) { setFeedback(''); accountAction.mutate(action); }
  }
  async function useClaudeCard(retry = false) {
    if (busy || claudeQuery.isPending || confirmationPending.current) return;
    if (!retry && (!canUseClaude || Date.now() - claudeQueriedAt > 60_000)) {
      setClaudeFeedback('请先重新查询重置卡，再确认使用。'); return;
    }
    if (retry && !pendingClaudeKey.current) return;
    confirmationPending.current = true;
    const sessionAtConfirmation = adminConfigState.sessionRevision;
    const confirmed = await confirmAction({
      title: retry ? '重试同一次使用' : '使用 Claude 重置卡',
      message: retry ? '将查询或继续之前已确认的同一次操作，不会主动创建新的使用记录。' : `将消耗一次重置机会，清除 ${names(nextClaude?.clears ?? [])} 限额。剩余次数 ${totalClaudeResets ?? '未知'}，消耗后不可撤销。`,
      destructive: true,
    });
    confirmationPending.current = false;
    if (!confirmed || !mounted.current || identity.current !== accountId || adminConfigState.sessionRevision !== sessionAtConfirmation) return;
    if (!retry && Date.now() - claudeQueriedAt > 60_000) { setClaudeFeedback('查询结果已过期，请重新查询后使用。'); return; }
    pendingClaudeKey.current ??= createOperationKey(`claude-reset-${accountId}`);
    pendingClaudeOperations.set(operationScope, pendingClaudeKey.current);
    setClaudeFeedback(''); claudeReset.mutate(pendingClaudeKey.current);
  }
  async function useOpenAICard() {
    if (busy || openAIQuery.isPending || confirmationPending.current) return;
    if (!canUseOpenAI || Date.now() - openAIQueriedAt > 60_000) { setOpenAIFeedback('请先查询最新额度和重置卡，再确认使用。'); return; }
    confirmationPending.current = true;
    const sessionAtConfirmation = adminConfigState.sessionRevision;
    const confirmed = await confirmAction({ title: '使用 OpenAI / Codex 重置卡', message: `当前有 ${openAICount} 次重置机会。本次将使用一张，恢复上游限额；使用后不可撤销。请等待操作结果，期间不要重复提交。`, destructive: true });
    confirmationPending.current = false;
    if (!confirmed || !mounted.current || identity.current !== accountId || adminConfigState.sessionRevision !== sessionAtConfirmation) return;
    if (Date.now() - openAIQueriedAt > 60_000) { setOpenAIFeedback('查询结果已过期，请重新查询后使用。'); return; }
    setOpenAIFeedback(''); setOpenAIRequiresQuery(true); openAIReset.mutate();
  }
  async function refresh() {
    if (!validId) return;
    setRefreshing(true);
    try { await Promise.all([accountQuery.refetch(), statsQuery.refetch(), ...(account ? [usageQuery.refetch()] : [])]); }
    finally { setRefreshing(false); }
  }

  const usage = usageQuery.data;
  const localWindows = account ? [
    { label: '累计额度', limit: quotaNumber(account, 'quota_limit'), used: quotaNumber(account, 'quota_used') },
    { label: '每日额度', limit: quotaNumber(account, 'quota_daily_limit'), used: quotaNumber(account, 'quota_daily_used'), reset: account.quota_daily_reset_at },
    { label: '每周额度', limit: quotaNumber(account, 'quota_weekly_limit'), used: quotaNumber(account, 'quota_weekly_used'), reset: account.quota_weekly_reset_at },
  ] : [];
  const hasUsageWindows = windows.some(([key]) => usage?.[key] && typeof usage[key] === 'object');
  const hasLocalQuota = localWindows.some((item) => (item.limit ?? 0) > 0);

  return (
    <>
      <Stack.Screen options={{ title: '账号额度与管理', headerShown: true, headerTintColor: '#16181a', headerStyle: { backgroundColor: '#f4efe4' }, headerShadowVisible: false }} />
      <ScreenShell title={account?.name ?? '账号详情'} subtitle="查询限额、消费、重置卡和调度状态。" variant="minimal" safeAreaEdges={['bottom']} onRefresh={() => void refresh()} refreshing={refreshing} bottomInsetClassName="pb-8">
        {!validId ? <Text className="text-[#a4512b]">账号编号无效。</Text> : null}
        {accountQuery.isLoading ? <ActivityIndicator color="#1d5f55" /> : null}
        <ErrorNotice error={accountQuery.error} />
        {accountQuery.isError ? <Button label="重新加载账号" onPress={() => void accountQuery.refetch()} /> : null}
        {account ? <>
          <Section title="账号状态">
            <Field label="平台 / 类型" value={`${account.platform} / ${account.type}`} />
            <Field label="状态 / 调度" value={`${account.status ?? '未知'} / ${account.schedulable === false ? '已暂停' : account.schedulable === true ? '可调度' : '未知'}`} />
            <Field label="并发" value={`${finite(account.current_concurrency) ?? '—'} / ${finite(account.concurrency) ?? '—'}`} />
            <Field label="最近使用" value={formatDateTime(account.last_used_at)} />
            <Field label="账号到期" value={account.expires_at ? formatDateTime(account.expires_at) : '未设置'} />
            {account.groups?.length ? <Field label="分组" value={account.groups.map((group) => group.name).join('、')} /> : null}
            {account.rate_limit_reset_at ? <Field label="限流恢复" value={formatDateTime(account.rate_limit_reset_at)} /> : null}
            {account.overload_until ? <Field label="过载恢复" value={formatDateTime(account.overload_until)} /> : null}
            {account.temp_unschedulable_until ? <Field label="临时暂停至" value={formatDateTime(account.temp_unschedulable_until)} /> : null}
            {account.temp_unschedulable_reason ? <Text selectable className="mb-3 text-sm text-[#a4512b]">临时暂停原因：{account.temp_unschedulable_reason}</Text> : null}
            {account.error_message ? <Text selectable className="mb-3 text-sm text-[#a4512b]">{account.error_message}</Text> : null}
            <View className="flex-row flex-wrap gap-2">
              <Button label={accountAction.isPending ? '处理中…' : '测试账号'} disabled={busy} onPress={() => void runAccountAction('test')} />
              <Button label={account.schedulable === false ? '恢复调度' : '暂停调度'} disabled={busy || account.schedulable === undefined} onPress={() => void runAccountAction(account.schedulable === false ? 'resume' : 'pause')} danger={account.schedulable !== false} />
              {account.status === 'error' || account.error_message ? <Button label="清除错误状态" disabled={busy} onPress={() => void runAccountAction('clear-error')} /> : null}
            </View>
            {feedback ? <Text className="mt-3 text-sm leading-5 text-[#1d5f55]">{feedback}</Text> : null}
            <ErrorNotice error={accountAction.error} />
          </Section>
          <Section title="今日消费">
            <Field label="请求次数" value={finite(statsQuery.data?.requests)?.toLocaleString() ?? '—'} />
            <Field label="Token" value={finite(statsQuery.data?.tokens) === undefined ? '—' : formatTokenValue(statsQuery.data!.tokens)} />
            <Field label="账号消费" value={formatMoney(statsQuery.data?.cost)} />
            {statsQuery.isLoading ? <Text className="text-xs text-[#7d7468]">正在查询今日统计…</Text> : null}
            <ErrorNotice error={statsQuery.error} />
          </Section>
          <Section title="上游限额与使用情况">
            <Text className="mb-3 text-xs leading-5 text-[#7d7468]">{usage?.subscription_tier ? `套餐 ${usage.subscription_tier} · ` : ''}{usage?.source === 'active' ? '主动查询' : '后台快照'} · 更新 {formatDateTime(usage?.updated_at)}</Text>
            {windows.map(([key, label]) => {
              const value = usage?.[key];
              return value && typeof value === 'object' && 'utilization' in value ? <ProviderWindow key={key} label={label} data={value as UsageProgress} /> : null;
            })}
            {Object.entries(usage?.antigravity_quota ?? {}).map(([model, value]) => <UsageBar key={model} label={model} usedPercent={value.utilization} resetAt={value.reset_time} />)}
            {!hasUsageWindows && !Object.keys(usage?.antigravity_quota ?? {}).length && !usageQuery.isLoading ? <Text className="mb-3 text-sm text-[#7d7468]">暂无限额快照。可查询最新用量；支持范围取决于账号平台和后台版本。</Text> : null}
            {usageQuery.isLoading ? <Text className="mb-3 text-sm text-[#7d7468]">正在读取用量快照…</Text> : null}
            {usage?.error || usage?.forbidden_reason ? <Text selectable className="mb-3 text-sm text-[#a4512b]">{usage.error || usage.forbidden_reason}</Text> : null}
            {usage?.needs_reauth ? <Text className="mb-3 text-sm text-[#a4512b]">授权已失效，请在网页后台重新授权。</Text> : null}
            <Button label={activeUsage.isPending ? '查询中…' : '查询最新用量'} disabled={activeUsage.isPending || busy} onPress={() => activeUsage.mutate()} />
            <ErrorNotice error={activeUsage.error || usageQuery.error} />
          </Section>
          {account.type === 'apikey' ? <Section title="本地账号额度">
            <Text className="mb-3 text-xs leading-5 text-[#7d7468]">后台按消费金额控制的本地额度，与服务商的请求 / Token 限额分别统计。</Text>
            {localWindows.map((item) => <View key={item.label} className="mb-3 rounded-xl bg-[#f1ece2] p-3">
              <Field label={item.label} value={item.limit === undefined ? '额度未知' : item.limit <= 0 ? '未设置限额' : formatMoney(item.limit)} />
              <Field label="已用 / 剩余" value={`${formatMoney(item.used)} / ${item.limit === undefined ? '—' : item.limit <= 0 ? '不限额' : item.used === undefined ? '—' : formatMoney(Math.max(0, item.limit - item.used))}`} />
              {item.reset ? <Text className="text-xs text-[#7d7468]">重置时间 {formatDateTime(item.reset)}</Text> : null}
            </View>)}
            {hasLocalQuota && !isShadow ? <Button label="重置本地额度计数" disabled={busy} danger onPress={() => void runAccountAction('local-reset')} /> : null}
          </Section> : null}
          {isShadow ? <Section title="重置卡管理"><Text className="mb-3 text-sm leading-5 text-[#7d7468]">这是影子账号，重置和额度由主账号 #{account.parent_account_id} 管理。</Text><Button label="查看主账号" onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: String(account.parent_account_id) } })} /></Section> : null}
          {supportsClaude ? <Section title="Claude 重置卡">
            <Text className="mb-3 text-xs leading-5 text-[#7d7468]">查询不会使用重置卡。只有后台确认可使用的卡，才允许在确认后重置上游限额。</Text>
            <Field label="持有剩余次数" value={totalClaudeResets === undefined ? '请先查询' : String(totalClaudeResets)} />
            <Field label="当前可使用次数" value={claudeCredits ? String(claudeCredits.available_count) : '—'} />
            {claudeCredits ? <>
              <Field label="查询时间" value={formatDateTime(claudeCredits.fetched_at)} />
              {!claudeCredits.eligible ? <Text className="mb-3 text-sm text-[#a4512b]">账号不符合使用条件，可能需要在网页后台重新授权。</Text> : null}
              {claudeCredits.cooldown_until && new Date(claudeCredits.cooldown_until).getTime() > Date.now() ? <Field label="冷却至" value={formatDateTime(claudeCredits.cooldown_until)} /> : null}
              {claudeCredits.weekly_resets_at ? <Field label="每周恢复" value={formatDateTime(claudeCredits.weekly_resets_at)} /> : null}
              {claudeCredits.credits.map((credit, index) => <View key={`${credit.label}-${index}`} className="mb-3 rounded-xl bg-[#f1ece2] p-3">
                <Field label={credit.label || '重置卡'} value={`${credit.resets_left} 次 · ${credit.redeemable ? '可使用' : '暂不可使用'}`} />
                <Field label="清除窗口" value={names(credit.clears)} />
                {credit.starts_at ? <Field label="生效时间" value={formatDateTime(credit.starts_at)} /> : null}
                {credit.expires_at ? <Field label="到期时间" value={formatDateTime(credit.expires_at)} /> : null}
                {Object.entries(credit.percent_used).map(([key, value]) => <Field key={key} label={`${windowNames[key] ?? key} 已用`} value={percentText(value)} />)}
                {credit.use_requires_limit ? <Text className="mt-1 text-xs text-[#7d7468]">须先触及对应限额才可使用。</Text> : null}
                {credit.blocking.length ? <Text className="mt-1 text-xs text-[#a4512b]">限制：{credit.blocking.map((key) => blockerNames[key] ?? key).join('、')}</Text> : null}
              </View>)}
              {totalClaudeResets === 0 ? <Text className="mb-3 text-sm text-[#7d7468]">没有可用的重置卡。</Text> : null}
              {(totalClaudeResets ?? 0) > 0 && !canUseClaude ? <Text className="mb-3 text-xs text-[#7d7468]">持有重置卡，但当前不可使用。请查询并查看使用条件。</Text> : null}
            </> : null}
            <View className="flex-row flex-wrap gap-2">
              <Button label={claudeQuery.isPending ? '查询中…' : '查询重置卡'} disabled={busy || claudeQuery.isPending} onPress={() => claudeQuery.mutate()} />
              <Button label={claudeReset.isPending ? '使用中…' : '使用重置卡'} disabled={busy || claudeQuery.isPending || !canUseClaude || claudeRetryPending} danger onPress={() => void useClaudeCard()} />
              {claudeRetryPending ? <Button label="重试同一次使用" disabled={busy || claudeQuery.isPending} onPress={() => void useClaudeCard(true)} /> : null}
            </View>
            {claudeFeedback ? <Text className="mt-3 text-sm leading-5 text-[#7d7468]">{claudeFeedback}</Text> : null}
            <ErrorNotice error={claudeQuery.error || claudeReset.error} />
          </Section> : null}
          {supportsOpenAI ? <Section title="OpenAI / Codex 额度与重置卡">
            <Text className="mb-3 text-xs leading-5 text-[#7d7468]">查询实时上游额度和重置机会。使用重置卡不可撤销，网络异常后请先核对剩余次数。</Text>
            <Field label="重置卡次数" value={finite(openAICount) === undefined ? '请先查询' : String(openAICount)} />
            {openAIQuota ? <>
              <Field label="套餐" value={openAIQuota.plan_type || '—'} />
              <Field label="查询时间" value={formatDateTime(openAIQuota.fetched_at)} />
              <Field label="请求状态" value={openAIQuota.rate_limit ? openAIQuota.rate_limit.limit_reached ? '已触及限额' : openAIQuota.rate_limit.allowed ? '允许请求' : '暂不允许' : '—'} />
              <OpenAIWindow label="主要窗口" data={openAIQuota.rate_limit?.primary_window} />
              <OpenAIWindow label="次要窗口" data={openAIQuota.rate_limit?.secondary_window} />
              {openAIQuota.additional_rate_limits?.map((limit, index) => <View key={`${limit.limit_name}-${index}`}><OpenAIWindow label={`${limit.limit_name || limit.metered_feature} 主要`} data={limit.rate_limit?.primary_window} /><OpenAIWindow label={`${limit.limit_name || limit.metered_feature} 次要`} data={limit.rate_limit?.secondary_window} /></View>)}
              <Field label="积分余额" value={openAIQuota.credits ? openAIQuota.credits.unlimited ? '不限量' : openAIQuota.credits.balance ?? (openAIQuota.credits.has_credits ? '有积分，余额未知' : '无积分') : '未返回'} />
              {openAIQuota.rate_limit_reset_credits?.credits?.map((credit, index) => <Field key={index} label={`重置卡 ${index + 1} 到期`} value={formatDateTime(credit.expires_at)} />)}
            </> : null}
            <View className="flex-row flex-wrap gap-2">
              <Button label={openAIQuery.isPending ? '查询中…' : '查询额度与重置卡'} disabled={busy || openAIQuery.isPending} onPress={() => openAIQuery.mutate(false)} />
              <Button label="刷新后台快照" disabled={busy || openAIQuery.isPending} onPress={() => openAIQuery.mutate(true)} />
              <Button label={openAIReset.isPending ? '使用中，请等待…' : '使用重置卡'} disabled={busy || openAIQuery.isPending || !canUseOpenAI} danger onPress={() => void useOpenAICard()} />
            </View>
            {openAIFeedback ? <Text className="mt-3 text-sm leading-5 text-[#7d7468]">{openAIFeedback}</Text> : null}
            <ErrorNotice error={openAIQuery.error || openAIReset.error} />
          </Section> : null}
        </> : null}
      </ScreenShell>
    </>
  );
}
