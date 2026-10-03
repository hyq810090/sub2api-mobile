import { useQueries, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ChevronRight, KeyRound, Search } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ListCard } from '@/src/components/list-card';
import { ScreenShell } from '@/src/components/screen-shell';
import { useDebouncedValue } from '@/src/hooks/use-debounced-value';
import { formatTokenValue } from '@/src/lib/formatters';
import { getAccountTodayStats, listAccounts } from '@/src/services/admin';
import type { AdminAccount } from '@/src/types/admin';

type AccountStatusFilter = 'all' | 'active' | 'paused' | 'error';
type UsageSort = 'usage-desc' | 'usage-asc';
type TodaySummary = { requests?: number; tokens?: number; cost?: number; failed: boolean };

function timestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const numeric = /^\d{10,13}$/.test(value) ? Number(value) : undefined;
  const parsed = numeric === undefined ? Date.parse(value) : numeric < 1e12 ? numeric * 1000 : numeric;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getVisualStatus(account: AdminAccount, now: number) {
  const expiresAt = timestamp(account.expires_at);
  if (expiresAt !== undefined && expiresAt <= now) {
    return { key: 'error', label: '已过期', tone: 'danger' } as const;
  }
  if (account.status === 'error' || account.error_message) {
    return { key: 'error', label: '异常', tone: 'danger' } as const;
  }
  if ((timestamp(account.temp_unschedulable_until) ?? 0) > now) {
    return { key: 'error', label: '临时暂停', tone: 'danger' } as const;
  }
  if ((timestamp(account.rate_limit_reset_at) ?? 0) > now) {
    return { key: 'error', label: '限流', tone: 'danger' } as const;
  }
  if ((timestamp(account.overload_until) ?? 0) > now) {
    return { key: 'error', label: '过载冷却', tone: 'danger' } as const;
  }
  if (account.schedulable === false || ['inactive', 'disabled', 'paused', 'stop', 'stopped'].includes((account.status ?? '').toLowerCase())) {
    return { key: 'paused', label: '暂停', tone: 'muted' } as const;
  }
  return { key: 'active', label: '正常', tone: 'success' } as const;
}

function knownNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function AccountsListScreen({ safeAreaEdges }: { safeAreaEdges?: Edge[] }) {
  const router = useRouter();
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<AccountStatusFilter>('all');
  const [usageSort, setUsageSort] = useState<UsageSort>('usage-desc');
  const [refreshing, setRefreshing] = useState(false);
  const [statusTime, setStatusTime] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setStatusTime(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const keyword = useDebouncedValue(searchText.trim(), 300);
  const accountsQuery = useQuery({
    queryKey: ['accounts', keyword, page],
    queryFn: () => listAccounts(keyword, page),
  });
  const items = accountsQuery.data?.items ?? [];
  const todayQueries = useQueries({
    queries: items.map((account) => ({
      queryKey: ['account-today-stats', account.id],
      queryFn: () => getAccountTodayStats(account.id),
      staleTime: 60_000,
    })),
  });
  const todayById = useMemo(() => {
    const result = new Map<number, TodaySummary>();
    items.forEach((account, index) => {
      const query = todayQueries[index];
      result.set(account.id, {
        requests: knownNumber(query?.data?.requests),
        tokens: knownNumber(query?.data?.tokens),
        cost: knownNumber(query?.data?.cost),
        failed: Boolean(query?.isError),
      });
    });
    return result;
  }, [items, todayQueries]);
  const visible = useMemo(() => items
    .filter((item) => filter === 'all' || getVisualStatus(item, statusTime).key === filter)
    .sort((a, b) => {
      const left = todayById.get(a.id)?.requests;
      const right = todayById.get(b.id)?.requests;
      if (left === undefined) return right === undefined ? 0 : 1;
      if (right === undefined) return -1;
      return usageSort === 'usage-desc' ? right - left : left - right;
    }), [filter, items, todayById, usageSort, statusTime]);
  const pages = Math.max(1, accountsQuery.data?.pages ?? Math.ceil((accountsQuery.data?.total ?? 0) / 20));
  const refresh = async () => {
    setStatusTime(Date.now());
    setRefreshing(true);
    try {
      await Promise.all([accountsQuery.refetch(), ...todayQueries.map((query) => query.refetch())]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <ScreenShell
      title="账号清单"
      subtitle="查询用量、账号限额和重置卡，点击账号管理。"
      variant="minimal"
      scroll={false}
      safeAreaEdges={safeAreaEdges}
      bottomInsetClassName="pb-6"
      contentGapClassName="mt-2 gap-2"
    >
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 12, flexGrow: 1 }}
        data={visible}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor="#1d5f55" />}
        ListHeaderComponent={(
          <View className="pb-3">
            <View className="flex-row items-center rounded-[18px] bg-[#f1ece2] px-4 py-3">
              <Search color="#7d7468" size={18} />
              <TextInput
                value={searchText}
                onChangeText={(value) => { setSearchText(value); setPage(1); }}
                placeholder="搜索账号名称"
                placeholderTextColor="#9b9081"
                className="ml-3 flex-1 text-base text-[#16181a]"
              />
            </View>
            <View className="mt-3 flex-row flex-wrap gap-2">
              {([['all', '全部'], ['active', '正常'], ['paused', '暂停'], ['error', '异常']] as const).map(([key, label]) => (
                <Pressable key={key} onPress={() => setFilter(key)} className={filter === key ? 'rounded-full bg-[#1d5f55] px-3 py-2' : 'rounded-full bg-[#e7dfcf] px-3 py-2'}>
                  <Text className={filter === key ? 'text-xs font-semibold text-white' : 'text-xs font-semibold text-[#4e463e]'}>{label}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setUsageSort((current) => current === 'usage-desc' ? 'usage-asc' : 'usage-desc')} className="rounded-full bg-[#4e463e] px-3 py-2">
                <Text className="text-xs font-semibold text-white">{usageSort === 'usage-desc' ? '请求高→低' : '请求低→高'}</Text>
              </Pressable>
            </View>
            <Text className="mt-2 text-xs text-[#7d7468]">共 {accountsQuery.data?.total ?? '--'} 个账号 · 第 {page}/{pages} 页 · 状态筛选和用量排序作用于本页</Text>
            {accountsQuery.isError ? (
              <View className="mt-3 rounded-xl bg-[#f7e1d6] p-3">
                <Text className="text-sm text-[#a4512b]">账号加载失败：{accountsQuery.error instanceof Error ? accountsQuery.error.message : '请重试'}</Text>
                <Pressable onPress={() => void accountsQuery.refetch()} className="mt-2 py-2"><Text className="font-semibold text-[#a4512b]">重试</Text></Pressable>
              </View>
            ) : null}
          </View>
        )}
        renderItem={({ item }) => {
          const status = getVisualStatus(item, statusTime);
          const today = todayById.get(item.id);
          return (
            <Pressable accessibilityRole="button" accessibilityLabel={`查看账号 ${item.name}`} onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: String(item.id) } })}>
              <ListCard title={item.name} meta={`${item.platform} · ${item.type}`} badge={status.label} badgeTone={status.tone} icon={KeyRound}>
                <View className="flex-row gap-2">
                  {[
                    ['今日请求', today?.requests === undefined ? '--' : String(today.requests)],
                    ['今日消费', today?.cost === undefined ? '--' : `$${today.cost.toFixed(2)}`],
                    ['今日 Token', today?.tokens === undefined ? '--' : formatTokenValue(today.tokens)],
                  ].map(([label, value]) => (
                    <View key={label} className="flex-1 rounded-xl bg-[#f1ece2] p-3">
                      <Text className="text-[11px] text-[#7d7468]">{label}</Text>
                      <Text className="mt-1 text-sm font-bold text-[#16181a]">{value}</Text>
                    </View>
                  ))}
                </View>
                {today?.failed ? <Text className="mt-2 text-xs text-[#a4512b]">今日统计暂不可用，可下拉重试。</Text> : null}
                {item.error_message ? <Text numberOfLines={2} className="mt-2 text-xs text-[#a4512b]">{item.error_message}</Text> : null}
                <View className="mt-3 flex-row items-center justify-between">
                  <Text className="flex-1 text-xs text-[#7d7468]">{item.groups?.map((group) => group.name).join(' · ') || '未分组'}</Text>
                  <Text className="text-xs font-semibold text-[#1d5f55]">查看额度与管理</Text>
                  <ChevronRight size={14} color="#1d5f55" />
                </View>
              </ListCard>
            </Pressable>
          );
        }}
        ListEmptyComponent={accountsQuery.isLoading ? <ActivityIndicator className="mt-10" color="#1d5f55" /> : !accountsQuery.isError ? <ListCard title="暂无匹配账号" meta="尝试其他搜索条件或状态筛选。" icon={KeyRound} /> : null}
        ListFooterComponent={(
          <View className="mt-4 flex-row items-center justify-between gap-3">
            <Pressable disabled={page <= 1 || accountsQuery.isFetching} onPress={() => setPage((current) => current - 1)} className="rounded-xl bg-[#e7dfcf] px-5 py-3" style={{ opacity: page <= 1 || accountsQuery.isFetching ? 0.45 : 1 }}><Text className="font-semibold text-[#4e463e]">上一页</Text></Pressable>
            <Text className="text-sm text-[#7d7468]">{page}/{pages}</Text>
            <Pressable disabled={page >= pages || accountsQuery.isFetching} onPress={() => setPage((current) => current + 1)} className="rounded-xl bg-[#1d5f55] px-5 py-3" style={{ opacity: page >= pages || accountsQuery.isFetching ? 0.45 : 1 }}><Text className="font-semibold text-white">下一页</Text></Pressable>
          </View>
        )}
        ItemSeparatorComponent={() => <View className="h-3" />}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
      />
    </ScreenShell>
  );
}
