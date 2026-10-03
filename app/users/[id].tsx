import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LineTrendChart } from '@/src/components/line-trend-chart';
import { UserSubscriptions } from '@/src/components/user-subscriptions';
import { confirmAction, createOperationKey, formatDateTime as formatTime, formatMoney, getManagementError as getErrorMessage } from '@/src/lib/management';
import { getDashboardSnapshot, getUsageStats, getUser, listUserApiKeys, updateUserBalance, updateUserStatus } from '@/src/services/admin';
import { adminConfigState } from '@/src/store/admin-config';
import type { AdminApiKey, BalanceOperation } from '@/src/types/admin';

const colors = {
  page: '#f4efe4',
  card: '#fbf8f2',
  text: '#16181a',
  subtext: '#6f665c',
  border: '#e7dfcf',
  primary: '#1d5f55',
  dark: '#1b1d1f',
  errorBg: '#f7e1d6',
  errorText: '#a4512b',
  muted: '#f7f1e6',
};

type RangeKey = 'today' | '7d' | '30d';

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: 'today', label: '今日' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
];
type BalancePayload = { amount: number; notes?: string; operation: BalanceOperation };
const pendingBalanceOperations = new Map<string, { signature: string; key: string; payload: BalancePayload; needsVerification: boolean }>();

function getDateRange(rangeKey: RangeKey) {
  const end = new Date();
  const start = new Date();

  if (rangeKey === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (rangeKey === '30d') {
    start.setDate(end.getDate() - 29);
  } else {
    start.setDate(end.getDate() - 6);
  }

  const toDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

  return {
    start_date: toDate(start),
    end_date: toDate(end),
    granularity: rangeKey === 'today' ? ('hour' as const) : ('day' as const),
  };
}

function formatUsageCost(stats?: { total_account_cost?: number | null; total_actual_cost?: number | null; total_cost?: number | null }) {
  const value = stats?.total_account_cost ?? stats?.total_actual_cost ?? stats?.total_cost;
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(4)}` : '—';
}

function formatTokenValue(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const number = value;
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(2)}B`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(2)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(2)}K`;
  return new Intl.NumberFormat('en-US').format(number);
}


function formatQuotaMoney(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(4)}` : '—';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{title}</Text>
      <View style={{ marginTop: 12 }}>{children}</View>
    </View>
  );
}

function GridField({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        width: '48.5%',
        backgroundColor: colors.muted,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 12, color: colors.subtext }}>{label}</Text>
      <Text style={{ marginTop: 6, fontSize: 15, fontWeight: '600', color: colors.text }}>{value}</Text>
    </View>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.muted,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 12, color: colors.subtext }}>{label}</Text>
      <Text style={{ marginTop: 6, fontSize: 16, fontWeight: '700', color: colors.text }}>{value}</Text>
    </View>
  );
}

function StatusBadge({ text }: { text: string }) {
  const normalized = text.toLowerCase();
  const backgroundColor = normalized === 'active' ? '#dff4ea' : normalized === 'inactive' || normalized === 'disabled' ? '#ece5da' : '#f7e1d6';
  const color = normalized === 'active' ? '#17663f' : normalized === 'inactive' || normalized === 'disabled' ? '#6f665c' : '#a4512b';

  return (
    <View style={{ backgroundColor, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color }}>{text}</Text>
    </View>
  );
}

function CopyInlineButton({ copied, onPress }: { copied: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        marginLeft: 8,
        backgroundColor: copied ? '#dff4ea' : '#e7dfcf',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: '700', color: copied ? '#17663f' : '#4e463e' }}>{copied ? '已复制' : '复制'}</Text>
    </Pressable>
  );
}

function KeyItem({ item, copied, onCopy }: { item: AdminApiKey; copied: boolean; onCopy: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const limited = typeof item.quota === 'number' && item.quota > 0;
  const quotaKnown = typeof item.quota === 'number' && Number.isFinite(item.quota);
  const usedKnown = typeof item.quota_used === 'number' && Number.isFinite(item.quota_used);
  const windows = [
    { label: '5 小时', used: item.usage_5h, limit: item.rate_limit_5h },
    { label: '1 天', used: item.usage_1d, limit: item.rate_limit_1d },
    { label: '7 天', used: item.usage_7d, limit: item.rate_limit_7d },
  ].filter((window) => window.used !== undefined || window.limit !== undefined);
  return (
    <View
      style={{
        backgroundColor: colors.muted,
        borderRadius: 14,
        padding: 12,
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: 10,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{item.name || `Key #${item.id}`}</Text>
            {item.key ? <CopyInlineButton copied={copied} onPress={onCopy} /> : null}
          </View>
          <Text style={{ marginTop: 4, fontSize: 12, color: colors.subtext }}>{item.group?.name || '未分组'}</Text>
        </View>
        <StatusBadge text={item.status || '--'} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <Text selectable={revealed} style={{ flex: 1, fontSize: 12, lineHeight: 18, color: colors.text }}>{item.key ? (revealed ? item.key : '••••••••••••••••') : '服务器未返回密钥'}</Text>
        {item.key ? <Pressable accessibilityRole="button" onPress={() => setRevealed((current) => !current)} style={{ padding: 8 }}>
          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>{revealed ? '隐藏' : '显示'}</Text>
        </Pressable> : null}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: colors.subtext }}>已用额度</Text>
          <Text style={{ marginTop: 4, fontSize: 14, fontWeight: '700', color: colors.text }}>{formatQuotaMoney(item.quota_used)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: colors.subtext }}>总限额</Text>
          <Text style={{ marginTop: 4, fontSize: 14, fontWeight: '700', color: colors.text }}>{quotaKnown ? (limited ? formatQuotaMoney(item.quota) : '不限额') : '—'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: colors.subtext }}>剩余额度</Text>
          <Text style={{ marginTop: 4, fontSize: 14, fontWeight: '700', color: colors.primary }}>{!quotaKnown ? '—' : !limited ? '不限额' : usedKnown ? formatQuotaMoney(Math.max(0, item.quota - item.quota_used)) : '—'}</Text>
        </View>
      </View>
      {windows.length ? <View style={{ marginTop: 10, gap: 6 }}>
        {windows.map((window) => <Text key={window.label} style={{ fontSize: 12, lineHeight: 18, color: colors.subtext }}>
          {window.label}：已用 {formatQuotaMoney(window.used)} · 限额 {window.limit === undefined ? '—' : typeof window.limit === 'number' && window.limit > 0 ? formatQuotaMoney(window.limit) : '不限额'}
          {typeof window.limit === 'number' && window.limit > 0 && typeof window.used === 'number' ? ` · 剩余 ${formatQuotaMoney(Math.max(0, window.limit - window.used))}` : ''}
        </Text>)}
      </View> : null}
      <View style={{ marginTop: 12, gap: 5 }}>
        <Text style={{ fontSize: 12, color: colors.subtext }}>到期时间：{item.expires_at === undefined ? '未返回' : item.expires_at ? formatTime(item.expires_at) : '永不过期'}</Text>
        <Text style={{ fontSize: 12, color: colors.subtext }}>最后使用：{formatTime(item.last_used_at)}</Text>
      </View>
    </View>
  );
}

export default function UserDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = Number(id);
  const validUserId = Number.isSafeInteger(userId) && userId > 0;
  const queryClient = useQueryClient();
  const balanceScope = `${adminConfigState.activeAccountId}:${adminConfigState.baseUrl}:${userId}`;
  const savedBalanceOperation = pendingBalanceOperations.get(balanceScope);

  const [operation, setOperation] = useState<BalanceOperation>(savedBalanceOperation?.payload.operation ?? 'add');
  const [amount, setAmount] = useState(savedBalanceOperation ? String(savedBalanceOperation.payload.amount) : '10');
  const [notes, setNotes] = useState(savedBalanceOperation?.payload.notes ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [balanceSuccess, setBalanceSuccess] = useState<string | null>(null);
  const [statusSuccess, setStatusSuccess] = useState<string | null>(null);
  const [balanceConfirming, setBalanceConfirming] = useState(false);
  const [statusConfirming, setStatusConfirming] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [balanceUncertain, setBalanceUncertain] = useState(savedBalanceOperation?.needsVerification ?? false);
  const [verifyingBalance, setVerifyingBalance] = useState(false);
  const [apiKeysPage, setApiKeysPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d');
  const balanceOperation = useRef<{ signature: string; key: string } | null>(savedBalanceOperation ?? null);
  const balanceActionLock = useRef(false);
  const statusActionLock = useRef(false);
  const mounted = useRef(true);
  const currentIdentity = useRef(balanceScope);
  currentIdentity.current = balanceScope;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const range = getDateRange(rangeKey);

  const userQuery = useQuery({
    queryKey: ['user', userId],
    queryFn: () => getUser(userId),
    enabled: validUserId,
  });

  const apiKeysQuery = useQuery({
    queryKey: ['user-api-keys', userId, apiKeysPage],
    queryFn: () => listUserApiKeys(userId, apiKeysPage, 20),
    enabled: validUserId,
  });

  const usageStatsQuery = useQuery({
    queryKey: ['usage-stats', 'user', userId, rangeKey, range.start_date, range.end_date],
    queryFn: () => getUsageStats({ ...range, user_id: userId }),
    enabled: validUserId,
  });

  const usageSnapshotQuery = useQuery({
    queryKey: ['usage-snapshot', 'user', userId, rangeKey, range.start_date, range.end_date, range.granularity],
    queryFn: () =>
      getDashboardSnapshot({
        ...range,
        user_id: userId,
        include_stats: false,
        include_trend: true,
        include_model_stats: false,
        include_group_stats: false,
        include_users_trend: false,
      }),
    enabled: validUserId,
  });

  const balanceMutation = useMutation({
    retry: false,
    mutationFn: (payload: { amount: number; notes?: string; operation: BalanceOperation; operationKey: string }) =>
      updateUserBalance(userId, {
        balance: payload.amount,
        notes: payload.notes,
        operation: payload.operation,
      }, payload.operationKey),
    onMutate: () => { setFormError(null); setBalanceSuccess(null); },
    onSuccess: async () => {
      setFormError(null);
      setBalanceSuccess('余额操作已完成。');
      balanceOperation.current = null;
      pendingBalanceOperations.delete(balanceScope);
      setAmount('10');
      setNotes('');
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['user', userId] }), queryClient.invalidateQueries({ queryKey: ['users'] })]);
    },
    onError: (error) => { setFormError(getErrorMessage(error)); setBalanceUncertain(true); },
    onSettled: () => { balanceActionLock.current = false; },
  });

  const statusMutation = useMutation({
    retry: false,
    mutationFn: (status: 'active' | 'disabled') => updateUserStatus(userId, status),
    onSuccess: async () => {
      setStatusError(null);
      setStatusSuccess('用户状态已更新。');
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['user', userId] }), queryClient.invalidateQueries({ queryKey: ['users'] })]);
    },
    onError: (error) => setStatusError(getErrorMessage(error)),
    onSettled: () => { statusActionLock.current = false; },
  });

  const user = userQuery.data;
  const apiKeys = apiKeysQuery.data?.items ?? [];
  const apiKeyPages = apiKeysQuery.data?.pages || Math.ceil((apiKeysQuery.data?.total || 0) / 20);

  const filteredApiKeys = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();

    return apiKeys.filter((item) => {
      const haystack = [item.name, item.key, item.group?.name].filter(Boolean).join(' ').toLowerCase();
      return keyword ? haystack.includes(keyword) : true;
    });
  }, [apiKeys, searchText]);
  const trendPoints = (usageSnapshotQuery.data?.trend ?? []).map((item) => ({
    label: rangeKey === 'today' ? item.date.slice(11, 13) : item.date.slice(5, 10),
    value: item.total_tokens,
  }));

  async function submitBalance() {
    if (!validUserId || balanceActionLock.current || balanceUncertain || balanceMutation.isPending || balanceConfirming || !user) return;
    const numericAmount = Number(amount);

    if (!amount.trim()) {
      setFormError('请输入金额。');
      return;
    }

    if (!/^\d+(\.\d{1,6})?$/.test(amount.trim()) || !Number.isFinite(numericAmount) || numericAmount < 0 || (operation !== 'set' && numericAmount === 0)) {
      setFormError('请输入有效金额（最多 6 位小数）；充值或扣减须大于 0。');
      return;
    }
    const payload = {
      amount: numericAmount,
      notes: notes.trim() || undefined,
      operation,
    };
    const action = operation === 'set' ? '设置余额' : operation === 'subtract' ? '扣减余额' : '充值余额';
    const sessionRevision = adminConfigState.sessionRevision;
    balanceActionLock.current = true;
    setBalanceConfirming(true);
    const confirmed = await confirmAction({
      title: action,
      message: `${balanceOperation.current?.signature === JSON.stringify(payload) ? '重试原请求，沿用原请求编号，避免重复变更余额。' : '这是一次新的余额操作。'}${user.email}（#${userId}）当前余额 ${formatMoney(user.balance)}。${operation === 'set' ? '将余额设为' : operation === 'subtract' ? '将扣减' : '将增加'} ${formatQuotaMoney(numericAmount)}。确认执行？`,
      destructive: operation === 'subtract' || operation === 'set',
    });
    setBalanceConfirming(false);
    if (!confirmed || !mounted.current || currentIdentity.current !== balanceScope || adminConfigState.sessionRevision !== sessionRevision) { balanceActionLock.current = false; return; }
    const signature = JSON.stringify(payload);
    if (balanceOperation.current?.signature !== signature) balanceOperation.current = { signature, key: createOperationKey(`user-balance-${userId}`) };
    pendingBalanceOperations.set(balanceScope, { ...balanceOperation.current, payload, needsVerification: true });
    balanceMutation.mutate({ ...payload, operationKey: balanceOperation.current.key });
  }

  async function copyKey(item: AdminApiKey) {
    if (!item.key) return;
    try {
      await Clipboard.setStringAsync(item.key);
      setCopiedKeyId(item.id);
      setTimeout(() => {
        setCopiedKeyId((current) => (current === item.id ? null : current));
      }, 1500);
    } catch {
      setStatusError('复制失败，请显示密钥后手动复制。');
    }
  }

  async function handleToggleUserStatus() {
    if (!user || !validUserId || statusActionLock.current || statusMutation.isPending || statusConfirming || user.role?.toLowerCase() === 'admin') return;
    const nextStatus: 'active' | 'disabled' = user.status === 'disabled' ? 'active' : 'disabled';
    const actionLabel = nextStatus === 'disabled' ? '禁用' : '启用';
    const sessionRevision = adminConfigState.sessionRevision;
    statusActionLock.current = true;
    setStatusConfirming(true);
    const confirmed = await confirmAction({
      title: `${actionLabel}用户`,
      message: `确认${actionLabel} ${user.email}（#${userId}）？${nextStatus === 'disabled' ? '禁用后该用户无法继续使用服务。' : ''}`,
      destructive: nextStatus === 'disabled',
    });
    setStatusConfirming(false);
    if (confirmed && mounted.current && currentIdentity.current === balanceScope && adminConfigState.sessionRevision === sessionRevision) { setStatusError(null); setStatusSuccess(null); statusMutation.mutate(nextStatus); }
    else statusActionLock.current = false;
  }

  async function verifyBalanceResult() {
    if (balanceActionLock.current || verifyingBalance || !validUserId) return;
    balanceActionLock.current = true;
    setVerifyingBalance(true);
    const sessionRevision = adminConfigState.sessionRevision;
    try {
      const freshUser = await getUser(userId);
      if (adminConfigState.sessionRevision !== sessionRevision) return;
      queryClient.setQueryData(['user', userId], freshUser);
      setBalanceUncertain(false);
      const pending = pendingBalanceOperations.get(balanceScope);
      if (pending) pendingBalanceOperations.set(balanceScope, { ...pending, needsVerification: false });
      setFormError(null);
      setBalanceSuccess(`已查询当前余额：${formatMoney(freshUser.balance)}。相同金额、备注和操作的重试将沿用原请求，避免重复扣款或充值。`);
    } catch (error) { setFormError(`余额查询失败：${getErrorMessage(error)}`); }
    finally { balanceActionLock.current = false; setVerifyingBalance(false); }
  }

  async function refreshAll() {
    setRefreshing(true);
    try {
      await Promise.all([
        userQuery.refetch(), apiKeysQuery.refetch(), usageStatsQuery.refetch(), usageSnapshotQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['user-subscriptions', userId] }),
        queryClient.invalidateQueries({ queryKey: ['subscription-progress'] }),
      ]);
    } finally { setRefreshing(false); }
  }

  if (!validUserId) return <>
    <Stack.Screen options={{ title: '用户详情' }} />
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.page, padding: 16 }}>
      <Section title="无法查询"><Text style={{ color: colors.errorText }}>用户编号无效，请返回用户列表重新选择。</Text></Section>
    </SafeAreaView>
  </>;

  return (
    <>
      <Stack.Screen options={{ title: user?.email || '用户详情' }} />
      <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.page }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refreshAll(); }} tintColor={colors.primary} />}>
          {userQuery.isLoading ? (
            <Section title="状态">
              <Text style={{ color: colors.subtext }}>正在加载用户详情...</Text>
            </Section>
          ) : null}

          {userQuery.error ? (
            <Section title="状态">
              <View style={{ backgroundColor: colors.errorBg, borderRadius: 12, padding: 12 }}>
                <Text style={{ color: colors.errorText, fontWeight: '700' }}>用户信息加载失败</Text>
                <Text style={{ marginTop: 6, color: colors.errorText }}>{getErrorMessage(userQuery.error)}</Text>
                <Pressable onPress={() => { void userQuery.refetch(); }} disabled={userQuery.isFetching} style={{ paddingVertical: 10 }}><Text style={{ color: colors.primary, fontWeight: '700' }}>重新查询</Text></Pressable>
              </View>
            </Section>
          ) : null}

          {user ? (
            <Section title="基础信息">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 }}>
                <View
                  style={{
                    width: '48.5%',
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                    paddingVertical: 8,
                  }}
                >
                  <Text style={{ fontSize: 11, color: colors.subtext }}>邮箱</Text>
                  <Text style={{ marginTop: 4, fontSize: 13, color: colors.subtext }}>{user.email || '--'}</Text>
                </View>
                <GridField label="用户名" value={user.username || '--'} />
                <GridField label="余额" value={formatMoney(user.balance)} />
                <View
                  style={{
                    width: '48.5%',
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                    paddingVertical: 8,
                  }}
                >
                  <Text style={{ fontSize: 11, color: colors.subtext }}>最后使用时间</Text>
                  <Text style={{ marginTop: 4, fontSize: 13, color: colors.subtext }}>{formatTime(user.last_used_at)}</Text>
                </View>
              </View>

              <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 12, color: colors.subtext }}>用户状态</Text>
                  <StatusBadge text={user.status || 'active'} />
                </View>
                <Pressable
                  disabled={statusMutation.isPending || statusConfirming || user.role?.toLowerCase() === 'admin'}
                  onPress={handleToggleUserStatus}
                  style={{
                    backgroundColor: user.status === 'disabled' ? colors.primary : '#8b3f1f',
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    opacity: statusMutation.isPending || statusConfirming || user.role?.toLowerCase() === 'admin' ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                    {statusMutation.isPending ? '处理中...' : user.status === 'disabled' ? '启用用户' : '禁用用户'}
                  </Text>
                </Pressable>
              </View>

              {user.role?.toLowerCase() === 'admin' ? <Text style={{ marginTop: 8, fontSize: 12, color: colors.subtext }}>管理员用户不支持禁用。</Text> : null}

              {statusError ? (
                <View style={{ marginTop: 10, backgroundColor: colors.errorBg, borderRadius: 12, padding: 12 }}>
                  <Text style={{ color: colors.errorText }}>{statusError}</Text>
                </View>
              ) : null}
              {statusSuccess ? <Text style={{ marginTop: 10, color: colors.primary }}>{statusSuccess}</Text> : null}
            </Section>
          ) : null}

          <UserSubscriptions userId={userId} />

          <Section title="总用量">
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {RANGE_OPTIONS.map((item) => {
                const active = item.key === rangeKey;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setRangeKey(item.key)}
                    style={{
                      backgroundColor: active ? colors.primary : colors.muted,
                      borderRadius: 999,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderWidth: 1,
                      borderColor: active ? colors.primary : colors.border,
                    }}
                  >
                    <Text style={{ color: active ? '#fff' : colors.text, fontSize: 12, fontWeight: '700' }}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <MetricCard label="请求" value={formatTokenValue(usageStatsQuery.data?.total_requests)} />
              <MetricCard label="Token" value={formatTokenValue(usageStatsQuery.data?.total_tokens)} />
              <MetricCard label="成本" value={formatUsageCost(usageStatsQuery.data)} />
            </View>

            {usageStatsQuery.data ? (
              <Text style={{ marginTop: 10, fontSize: 12, color: colors.subtext }}>
                输入 {formatTokenValue(usageStatsQuery.data.total_input_tokens)} · 输出 {formatTokenValue(usageStatsQuery.data.total_output_tokens)}
              </Text>
            ) : null}

            {usageStatsQuery.isLoading ? <Text style={{ marginTop: 12, color: colors.subtext }}>正在加载用量统计...</Text> : null}

            {usageStatsQuery.error ? (
              <View style={{ marginTop: 12, backgroundColor: colors.errorBg, borderRadius: 12, padding: 12 }}>
                <Text style={{ color: colors.errorText, fontWeight: '700' }}>用量统计加载失败</Text>
                <Text style={{ marginTop: 6, color: colors.errorText }}>{getErrorMessage(usageStatsQuery.error)}</Text>
              </View>
            ) : null}

            {!usageSnapshotQuery.isLoading && trendPoints.length > 1 ? (
              <View style={{ marginTop: 14 }}>
                <LineTrendChart
                  title="用量趋势"
                  subtitle={`${range.start_date} 到 ${range.end_date}`}
                  points={trendPoints}
                  color="#1d5f55"
                  formatValue={(value) => formatTokenValue(value)}
                  compact
                />
              </View>
            ) : null}

            {usageSnapshotQuery.isLoading ? <Text style={{ marginTop: 12, color: colors.subtext }}>正在加载趋势图...</Text> : null}

            {usageSnapshotQuery.error ? (
              <View style={{ marginTop: 12, backgroundColor: colors.errorBg, borderRadius: 12, padding: 12 }}>
                <Text style={{ color: colors.errorText, fontWeight: '700' }}>趋势加载失败</Text>
                <Text style={{ marginTop: 6, color: colors.errorText }}>{getErrorMessage(usageSnapshotQuery.error)}</Text>
              </View>
            ) : null}
          </Section>

          <Section title="API Key 额度">
            <Text style={{ color: colors.subtext, fontSize: 12, marginBottom: 10 }}>已用金额始终显示；总限额为 0 表示不限额。密钥默认隐藏。</Text>
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="搜索本页名称 / Key / 分组"
              placeholderTextColor="#9a9082"
              style={{
                backgroundColor: colors.muted,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 12,
                color: colors.text,
                marginBottom: 10,
              }}
            />

            {apiKeysQuery.isLoading ? <Text style={{ color: colors.subtext }}>正在加载 API Keys...</Text> : null}
            {apiKeysQuery.data ? <Text style={{ color: colors.subtext, fontSize: 12, marginBottom: 10 }}>共 {apiKeysQuery.data.total} 个 Key · 第 {apiKeysPage} 页</Text> : null}

            {apiKeysQuery.error ? (
              <View style={{ backgroundColor: colors.errorBg, borderRadius: 12, padding: 12 }}>
                <Text style={{ color: colors.errorText, fontWeight: '700' }}>API Keys 加载失败</Text>
                <Text style={{ marginTop: 6, color: colors.errorText }}>{getErrorMessage(apiKeysQuery.error)}</Text>
                <Pressable onPress={() => { void apiKeysQuery.refetch(); }} disabled={apiKeysQuery.isFetching} style={{ paddingVertical: 10 }}><Text style={{ color: colors.primary, fontWeight: '700' }}>重新查询</Text></Pressable>
              </View>
            ) : null}

            {!apiKeysQuery.isLoading && !apiKeysQuery.error ? (
              filteredApiKeys.length > 0 ? (
                <View>
                  {filteredApiKeys.map((item) => (
                    <KeyItem key={item.id} item={item} copied={copiedKeyId === item.id} onCopy={() => copyKey(item)} />
                  ))}
                </View>
              ) : (
                <Text style={{ color: colors.subtext }}>当前筛选条件下没有 Key。</Text>
              )
            ) : null}
            {apiKeyPages > 1 ? <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12 }}>
              <Pressable disabled={apiKeysPage <= 1 || apiKeysQuery.isFetching} onPress={() => setApiKeysPage((current) => current - 1)} style={{ padding: 12, opacity: apiKeysPage <= 1 ? 0.5 : 1 }}><Text style={{ color: colors.primary, fontWeight: '700' }}>上一页</Text></Pressable>
              <Text style={{ color: colors.subtext }}>{apiKeysPage} / {apiKeyPages}</Text>
              <Pressable disabled={apiKeysPage >= apiKeyPages || apiKeysQuery.isFetching} onPress={() => setApiKeysPage((current) => current + 1)} style={{ padding: 12, opacity: apiKeysPage >= apiKeyPages ? 0.5 : 1 }}><Text style={{ color: colors.primary, fontWeight: '700' }}>下一页</Text></Pressable>
            </View> : null}
          </Section>

          <Section title="余额操作">
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {([
                { label: '充值', value: 'add' },
                { label: '扣减', value: 'subtract' },
                { label: '设为', value: 'set' },
              ] as const).map((item) => {
                const active = operation === item.value;
                return (
                  <Pressable
                    key={item.value}
                    disabled={balanceMutation.isPending || balanceConfirming || balanceUncertain || verifyingBalance}
                    onPress={() => setOperation(item.value)}
                    style={{
                      flex: 1,
                      backgroundColor: active ? colors.primary : colors.muted,
                      borderRadius: 12,
                      paddingVertical: 12,
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: active ? colors.primary : colors.border,
                    }}
                  >
                    <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '700' }}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              value={amount}
              editable={!balanceMutation.isPending && !balanceConfirming && !balanceUncertain && !verifyingBalance}
              onChangeText={setAmount}
              placeholder="输入金额，例如 10"
              placeholderTextColor="#9a9082"
              keyboardType="decimal-pad"
              style={{
                backgroundColor: colors.muted,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 12,
                color: colors.text,
                marginBottom: 10,
              }}
            />

            <TextInput
              value={notes}
              editable={!balanceMutation.isPending && !balanceConfirming && !balanceUncertain && !verifyingBalance}
              onChangeText={setNotes}
              placeholder="备注（可选）"
              placeholderTextColor="#9a9082"
              style={{
                backgroundColor: colors.muted,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 12,
                color: colors.text,
                marginBottom: 10,
              }}
            />

            {formError ? (
              <View style={{ backgroundColor: colors.errorBg, borderRadius: 12, padding: 12, marginBottom: 10 }}>
                <Text style={{ color: colors.errorText }}>{formError}</Text>
              </View>
            ) : null}
            {balanceSuccess ? <Text style={{ color: colors.primary, marginBottom: 10 }}>{balanceSuccess}</Text> : null}
            {balanceUncertain ? <View style={{ marginBottom: 12 }}>
              <Text style={{ color: colors.subtext, fontSize: 12, lineHeight: 18, marginBottom: 8 }}>请先重新查询余额，核对上次操作结果后再继续。</Text>
              <Pressable disabled={verifyingBalance} onPress={verifyBalanceResult} style={{ padding: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10 }}><Text style={{ color: colors.primary, fontWeight: '700' }}>{verifyingBalance ? '查询余额中...' : '查询操作结果'}</Text></Pressable>
            </View> : null}

            <Pressable onPress={submitBalance} disabled={!user || balanceMutation.isPending || balanceConfirming || balanceUncertain || verifyingBalance} style={{ backgroundColor: colors.dark, borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: !user || balanceMutation.isPending || balanceConfirming || balanceUncertain || verifyingBalance ? 0.6 : 1 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>{balanceMutation.isPending ? '提交中...' : '确认提交'}</Text>
            </Pressable>
          </Section>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
