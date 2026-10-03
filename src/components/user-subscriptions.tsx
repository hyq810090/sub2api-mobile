import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { confirmAction, createOperationKey, formatDateTime, getManagementError } from '@/src/lib/management';
import { extendSubscription, getSubscription, getSubscriptionProgress, listUserSubscriptions, resetSubscriptionQuota } from '@/src/services/admin';
import { adminConfigState } from '@/src/store/admin-config';
import type { PaginatedData, SubscriptionProgress, UserSubscription } from '@/src/types/admin';

const colors = {
  card: '#fbf8f2', muted: '#f7f1e6', text: '#16181a', subtext: '#6f665c',
  border: '#e7dfcf', primary: '#1d5f55', error: '#a4512b', errorBg: '#f7e1d6',
};

const periods = [
  { key: 'daily', label: '日额度' },
  { key: 'weekly', label: '周额度' },
  { key: 'monthly', label: '月额度' },
] as const;
type ResetOptions = { daily: boolean; weekly: boolean; monthly: boolean };
type PendingExtension = { days: number; key: string };
// Keep unresolved requests through card collapse, navigation, and switching back to the same server profile.
const pendingOperations = new Map<string, { extension: PendingExtension | null; uncertain: 'reset' | 'extend' | null }>();

function money(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(4)}` : '—';
}

function statusLabel(status: string) {
  return ({ active: '有效', expired: '已过期', revoked: '已撤销', suspended: '已暂停' } as Record<string, string>)[status] || status;
}

function resetCountdown(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  if (seconds <= 0) return '等待自动重置';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return hours >= 24 ? `约 ${Math.ceil(seconds / 86400)} 天后自动重置` : `约 ${hours ? `${hours} 小时 ` : ''}${minutes} 分钟后自动重置`;
}

function QuotaWindow({ label, window, fallbackUsed, fallbackLimit }: { label: string; window: NonNullable<SubscriptionProgress['daily']> | null; fallbackUsed: number; fallbackLimit: number | null | undefined }) {
  if (!window) {
    if (fallbackLimit === undefined) return <Text style={{ color: colors.subtext, marginTop: 10 }}>{label}：服务器未返回限额信息</Text>;
    if (fallbackLimit === null || fallbackLimit <= 0) return <Text style={{ color: colors.subtext, marginTop: 10 }}>{label}：不限额 · 已用 {money(fallbackUsed)}</Text>;
    return <View style={{ marginTop: 12 }}>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{label} · 限额 {money(fallbackLimit)}</Text>
      <Text style={{ color: colors.subtext, fontSize: 12, lineHeight: 18, marginTop: 5 }}>订阅记录已用 {money(fallbackUsed)} · 剩余 {money(Number.isFinite(fallbackUsed) ? Math.max(0, fallbackLimit - fallbackUsed) : null)}</Text>
      <Text style={{ color: colors.subtext, fontSize: 11, marginTop: 5 }}>当前周期尚未返回进度，以上为订阅记录。</Text>
    </View>;
  }
  const limited = window.limit !== null && window.limit > 0;
  const remaining = limited ? Math.max(0, (window.limit as number) - window.used) : null;
  const percentage = limited ? Math.min(100, Math.max(0, window.used / (window.limit as number) * 100)) : 0;
  const countdown = resetCountdown(window.reset_in_seconds);
  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{label}</Text>
        <Text style={{ color: remaining === 0 ? colors.error : colors.primary, fontSize: 13, fontWeight: '700' }}>
          {remaining === null ? '不限额' : `剩余 ${money(remaining)}`}
        </Text>
      </View>
      <Text style={{ color: colors.subtext, fontSize: 12, marginTop: 5 }}>
        已用 {money(window.used)} · 限额 {limited ? money(window.limit as number) : '不限额'}
      </Text>
      {limited ? (
        <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
          <View style={{ height: 6, width: `${percentage}%`, backgroundColor: percentage >= 90 ? colors.error : colors.primary }} />
        </View>
      ) : null}
      {countdown ? <Text style={{ color: colors.subtext, fontSize: 11, marginTop: 5 }}>{countdown}</Text> : null}
    </View>
  );
}

function Feedback({ text, error = false }: { text: string; error?: boolean }) {
  return <View style={{ marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: error ? colors.errorBg : '#dff4ea' }}>
    <Text style={{ color: error ? colors.error : colors.primary, fontSize: 13 }}>{text}</Text>
  </View>;
}

function ActionButton({ label, onPress, disabled, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={{
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center',
    backgroundColor: secondary ? colors.muted : colors.primary, borderWidth: 1,
    borderColor: secondary ? colors.border : colors.primary, opacity: disabled ? 0.55 : 1,
  }}>
    <Text style={{ color: secondary ? colors.text : '#fff', fontSize: 13, fontWeight: '700' }}>{label}</Text>
  </Pressable>;
}

function SubscriptionDetails({ item, userId, onBusyChange }: { item: UserSubscription; userId: number; onBusyChange: (busy: boolean) => void }) {
  const queryClient = useQueryClient();
  const operationScope = `${adminConfigState.activeAccountId}:${adminConfigState.baseUrl}:${item.id}`;
  const savedOperation = pendingOperations.get(operationScope);
  const [resetOptions, setResetOptions] = useState<ResetOptions>({ daily: true, weekly: false, monthly: false });
  const [days, setDays] = useState(savedOperation?.extension ? String(savedOperation.extension.days) : '30');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [uncertainOperation, setUncertainOperation] = useState<'reset' | 'extend' | null>(savedOperation?.uncertain ?? null);
  const [verifying, setVerifying] = useState(false);
  const actionLock = useRef(false);
  const mounted = useRef(true);
  const currentIdentity = useRef(operationScope);
  currentIdentity.current = operationScope;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const extensionOperation = useRef<PendingExtension | null>(savedOperation?.extension ?? null);
  const progressQuery = useQuery({
    queryKey: ['subscription-progress', item.id],
    queryFn: () => getSubscriptionProgress(item.id),
    enabled: Number.isInteger(item.id) && item.id > 0,
  });

  async function refreshRelated() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['user-subscriptions', userId] }),
      queryClient.invalidateQueries({ queryKey: ['subscription-progress', item.id] }),
      queryClient.invalidateQueries({ queryKey: ['user-api-keys', userId] }),
      queryClient.invalidateQueries({ queryKey: ['usage-stats', 'user', userId] }),
      queryClient.invalidateQueries({ queryKey: ['user', userId] }),
    ]);
  }

  function persistPending(uncertain: 'reset' | 'extend' | null) {
    if (extensionOperation.current || uncertain) pendingOperations.set(operationScope, { extension: extensionOperation.current, uncertain });
    else pendingOperations.delete(operationScope);
  }

  const resetMutation = useMutation({
    retry: false,
    mutationFn: (payload: { options: ResetOptions; operationKey: string }) => resetSubscriptionQuota(item.id, payload.options, payload.operationKey),
    onMutate: () => { setError(null); setMessage(null); onBusyChange(true); },
    onSuccess: async (_, payload) => {
      persistPending(null);
      await refreshRelated();
      setMessage(`${periods.filter((period) => payload.options[period.key]).map((period) => period.label).join('、')}已重置。`);
    },
    onError: (reason) => { persistPending('reset'); setError(getManagementError(reason)); setUncertainOperation('reset'); },
    onSettled: () => { actionLock.current = false; onBusyChange(false); },
  });
  const extendMutation = useMutation({
    retry: false,
    mutationFn: (payload: { days: number; operationKey: string }) => extendSubscription(item.id, payload.days, payload.operationKey),
    onMutate: () => { setError(null); setMessage(null); onBusyChange(true); },
    onSuccess: async (_, payload) => {
      extensionOperation.current = null;
      persistPending(null);
      await refreshRelated();
      setMessage(`订阅已延长 ${payload.days} 天。`);
    },
    onError: (reason) => { persistPending('extend'); setError(getManagementError(reason)); setUncertainOperation('extend'); },
    onSettled: () => { actionLock.current = false; onBusyChange(false); },
  });
  const busy = confirming || verifying || resetMutation.isPending || extendMutation.isPending;
  const resettable = item.status === 'active' && (!item.expires_at || new Date(item.expires_at).getTime() > Date.now());
  const extendable = item.status === 'active' || item.status === 'expired';
  const groupName = item.group?.name || `分组 #${item.group_id}`;

  async function confirmReset() {
    if (actionLock.current || busy || uncertainOperation || !resettable) return;
    const selected = periods.filter((period) => resetOptions[period.key]);
    if (!selected.length) { setError('请至少选择一个额度周期。'); return; }
    const options = { ...resetOptions };
    const sessionRevision = adminConfigState.sessionRevision;
    actionLock.current = true;
    setConfirming(true);
    onBusyChange(true);
    const confirmed = await confirmAction({
      title: '重置订阅额度',
      message: `将用户 #${userId} 的「${groupName}」${selected.map((period) => period.label).join('、')}已用额度清零。有效期不变，用户将能再次使用这些额度。确认重置？`,
      destructive: true,
    });
    setConfirming(false);
    if (confirmed && mounted.current && currentIdentity.current === operationScope && adminConfigState.sessionRevision === sessionRevision) {
      persistPending('reset');
      resetMutation.mutate({ options, operationKey: createOperationKey(`subscription-reset-${item.id}`) });
    }
    else { actionLock.current = false; onBusyChange(false); }
  }

  async function confirmExtend() {
    if (actionLock.current || busy || uncertainOperation || !extendable) return;
    const numericDays = Number(days);
    if (!/^\d+$/.test(days.trim()) || !Number.isInteger(numericDays) || numericDays < 1 || numericDays > 36500) {
      setError('延长天数必须是 1 至 36500 的整数。');
      return;
    }
    const sessionRevision = adminConfigState.sessionRevision;
    actionLock.current = true;
    setConfirming(true);
    onBusyChange(true);
    const confirmed = await confirmAction({
      title: '延长订阅有效期',
      message: `${extensionOperation.current?.days === numericDays ? '重试上次延长请求，沿用原请求编号，避免重复延长。' : '这是一次新的延长操作。'}为用户 #${userId} 的「${groupName}」延长 ${numericDays} 天。当前到期时间：${formatDateTime(item.expires_at)}。额度不会重置。确认执行？`,
    });
    setConfirming(false);
    if (!confirmed || !mounted.current || currentIdentity.current !== operationScope || adminConfigState.sessionRevision !== sessionRevision) { actionLock.current = false; onBusyChange(false); return; }
    if (extensionOperation.current?.days !== numericDays) extensionOperation.current = { days: numericDays, key: createOperationKey(`subscription-extend-${item.id}`) };
    persistPending('extend');
    extendMutation.mutate({ days: numericDays, operationKey: extensionOperation.current.key });
  }

  async function verifyOperationResult() {
    if (actionLock.current || busy || !uncertainOperation) return;
    actionLock.current = true;
    const sessionRevision = adminConfigState.sessionRevision;
    setVerifying(true);
    onBusyChange(true);
    try {
      const [fresh, progress] = await Promise.all([
        getSubscription(item.id),
        uncertainOperation === 'reset' ? getSubscriptionProgress(item.id) : Promise.resolve(null),
      ]);
      if (adminConfigState.sessionRevision !== sessionRevision) return;
      queryClient.setQueriesData<PaginatedData<UserSubscription>>({ queryKey: ['user-subscriptions', userId] }, (previous) => previous ? ({ ...previous, items: previous.items.map((subscription) => subscription.id === fresh.id ? fresh : subscription) }) : previous);
      if (progress) queryClient.setQueryData(['subscription-progress', item.id], progress);
      setUncertainOperation(null);
      persistPending(null);
      setError(null);
      setMessage(`已重新查询服务器状态。当前到期：${formatDateTime(fresh.expires_at)}。${extensionOperation.current ? '相同天数的重试将沿用原请求；更改天数会创建新操作。' : '请查看最新额度后再决定是否继续重置。'}`);
    } catch (reason) { setError(`结果查询失败：${getManagementError(reason)}`); }
    finally { setVerifying(false); actionLock.current = false; onBusyChange(false); }
  }

  return <View style={{ paddingTop: 4 }}>
    {progressQuery.isLoading ? <Text style={{ color: colors.subtext, marginTop: 12 }}>正在查询订阅额度...</Text> : null}
    {progressQuery.error ? <>
      <Feedback text={`额度查询失败：${getManagementError(progressQuery.error)}`} error />
      <View style={{ marginTop: 8 }}><ActionButton label="重试额度查询" secondary onPress={() => { void progressQuery.refetch(); }} disabled={progressQuery.isFetching} /></View>
    </> : null}
    {progressQuery.data ? <>
      {periods.map((period) => <QuotaWindow key={period.key} label={period.label} window={progressQuery.data[period.key]}
        fallbackUsed={item[`${period.key}_usage_usd`]} fallbackLimit={item.group?.[`${period.key}_limit_usd`]} />)}
      {progressQuery.data.days_remaining !== null ? <Text style={{ color: colors.subtext, fontSize: 12, marginTop: 10 }}>剩余有效期：{Math.max(0, progressQuery.data.days_remaining)} 天</Text> : null}
      <Pressable disabled={progressQuery.isFetching || busy} onPress={() => { void progressQuery.refetch(); }} style={{ alignSelf: 'flex-start', marginTop: 10, paddingVertical: 6 }}>
        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>{progressQuery.isFetching ? '刷新中...' : '刷新额度'}</Text>
      </Pressable>
    </> : null}

    <View style={{ borderTopWidth: 1, borderColor: colors.border, marginTop: 14, paddingTop: 14 }}>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>重置订阅额度</Text>
      <Text style={{ color: colors.subtext, fontSize: 12, lineHeight: 18, marginTop: 5 }}>选择要清零的周期；只修改已用额度，不修改有效期。</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
        {periods.map((period) => <Pressable key={period.key} accessibilityRole="checkbox" accessibilityState={{ checked: resetOptions[period.key], disabled: busy || !resettable }}
          disabled={busy || !!uncertainOperation || !resettable} onPress={() => setResetOptions((current) => ({ ...current, [period.key]: !current[period.key] }))}
          style={{ flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center', backgroundColor: resetOptions[period.key] ? colors.primary : colors.card, borderWidth: 1, borderColor: resetOptions[period.key] ? colors.primary : colors.border, opacity: !resettable ? 0.5 : 1 }}>
          <Text style={{ color: resetOptions[period.key] ? '#fff' : colors.text, fontWeight: '700', fontSize: 12 }}>{resetOptions[period.key] ? '✓ ' : ''}{period.label}</Text>
        </Pressable>)}
      </View>
      <ActionButton label={resetMutation.isPending ? '正在重置...' : '重置所选额度'} onPress={confirmReset} disabled={busy || !!uncertainOperation || !resettable || !Object.values(resetOptions).some(Boolean)} />
      {!resettable ? <Text style={{ color: colors.subtext, fontSize: 12, marginTop: 8 }}>额度重置仅用于有效的订阅。</Text> : null}
    </View>

    <View style={{ borderTopWidth: 1, borderColor: colors.border, marginTop: 14, paddingTop: 14 }}>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>延长订阅</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <TextInput accessibilityLabel="订阅延长天数" value={days} onChangeText={setDays} editable={!busy && !uncertainOperation && extendable} keyboardType="number-pad" maxLength={5}
          placeholder="天数" style={{ flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 10, padding: 12, color: colors.text }} />
        <Text style={{ color: colors.subtext }}>天</Text>
      </View>
      <View style={{ marginTop: 10 }}><ActionButton label={extendMutation.isPending ? '正在延长...' : extensionOperation.current?.days === Number(days) ? '重试上次延长' : '确认延长'} onPress={confirmExtend} disabled={busy || !!uncertainOperation || !extendable} secondary /></View>
      {!extendable ? <Text style={{ color: colors.subtext, fontSize: 12, marginTop: 8 }}>已撤销或暂停的订阅需先在后台处理状态。</Text> : null}
    </View>
    {message ? <Feedback text={message} /> : null}
    {error ? <Feedback text={error} error /> : null}
    {uncertainOperation ? <View style={{ marginTop: 10 }}>
      <Text style={{ color: colors.subtext, fontSize: 12, lineHeight: 18, marginBottom: 8 }}>请先查询当前额度与到期时间，确认上次操作结果后再继续。</Text>
      <ActionButton label={verifying ? '正在查询结果...' : '查询操作结果'} onPress={verifyOperationResult} disabled={busy} secondary />
    </View> : null}
  </View>;
}

export function UserSubscriptions({ userId }: { userId: number }) {
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const subscriptionsQuery = useQuery({
    queryKey: ['user-subscriptions', userId, page],
    queryFn: () => listUserSubscriptions(userId, page, 20),
    enabled: Number.isInteger(userId) && userId > 0,
  });
  const items = subscriptionsQuery.data?.items ?? [];
  const selected = selectedId === null ? (items.find((item) => item.status === 'active') || items[0])?.id : selectedId;
  const total = subscriptionsQuery.data?.total ?? 0;
  const totalPages = subscriptionsQuery.data?.pages ?? Math.ceil(total / 20);

  return <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border }}>
    <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>订阅与额度</Text>
    <Text style={{ color: colors.subtext, fontSize: 12, lineHeight: 18, marginTop: 6 }}>查看每个订阅的日、周、月限额和剩余额度，可按周期重置或延长有效期。</Text>
    {subscriptionsQuery.isLoading ? <Text style={{ color: colors.subtext, marginTop: 12 }}>正在加载订阅...</Text> : null}
    {subscriptionsQuery.error ? <>
      <Feedback text={`订阅加载失败：${getManagementError(subscriptionsQuery.error)}`} error />
      <View style={{ marginTop: 10 }}><ActionButton secondary label="重新加载订阅" onPress={() => { void subscriptionsQuery.refetch(); }} disabled={subscriptionsQuery.isFetching} /></View>
    </> : null}
    {subscriptionsQuery.data ? <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <Text style={{ fontSize: 12, color: colors.subtext }}>共 {total} 个订阅</Text>
        <Pressable disabled={subscriptionsQuery.isFetching || busy} onPress={() => { void subscriptionsQuery.refetch(); }} style={{ padding: 6 }}>
          <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>{subscriptionsQuery.isFetching ? '刷新中...' : '刷新列表'}</Text>
        </Pressable>
      </View>
      {!items.length ? <Text style={{ color: colors.subtext, marginTop: 12 }}>此用户暂无订阅。</Text> : null}
      {items.map((item) => <View key={item.id} style={{ backgroundColor: colors.muted, borderWidth: 1, borderColor: selected === item.id ? '#93b8af' : colors.border, borderRadius: 12, padding: 12, marginTop: 10 }}>
        <Pressable disabled={busy} onPress={() => setSelectedId(selected === item.id ? -1 : item.id)} accessibilityRole="button" accessibilityState={{ expanded: selected === item.id, disabled: busy }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ color: colors.text, flex: 1, fontWeight: '700', fontSize: 15 }}>{item.group?.name || `分组 #${item.group_id}`}</Text>
            <Text style={{ color: item.status === 'active' ? colors.primary : colors.subtext, fontSize: 12 }}>{statusLabel(item.status)}</Text>
          </View>
          <Text style={{ color: colors.subtext, fontSize: 12, marginTop: 6 }}>到期：{formatDateTime(item.expires_at)}</Text>
          <Text style={{ color: colors.primary, fontSize: 12, marginTop: 8 }}>{selected === item.id ? '收起额度与操作 ▴' : '查看额度与管理 ▾'}</Text>
        </Pressable>
        {selected === item.id ? <SubscriptionDetails key={item.id} item={item} userId={userId} onBusyChange={setBusy} /> : null}
      </View>)}
      {totalPages > 1 ? <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
        <ActionButton secondary label="上一页" disabled={page <= 1 || busy || subscriptionsQuery.isFetching} onPress={() => { setPage((current) => current - 1); setSelectedId(null); }} />
        <Text style={{ color: colors.subtext }}>{page} / {totalPages}</Text>
        <ActionButton secondary label="下一页" disabled={page >= totalPages || busy || subscriptionsQuery.isFetching} onPress={() => { setPage((current) => current + 1); setSelectedId(null); }} />
      </View> : null}
    </> : null}
  </View>;
}
