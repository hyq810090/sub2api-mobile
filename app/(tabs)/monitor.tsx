import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BarChartCard } from '@/src/components/bar-chart-card';
import { formatTokenValue } from '@/src/lib/formatters';
import { DonutChartCard } from '@/src/components/donut-chart-card';
import { LineTrendChart } from '@/src/components/line-trend-chart';
import { getAdminSettings, getDashboardModels, getDashboardStats, getDashboardTrend, listAccounts } from '@/src/services/admin';
import { adminConfigState, hasAuthenticatedAdminSession } from '@/src/store/admin-config';

const { useSnapshot } = require('valtio/react');

type RangeKey = '24h' | '7d' | '30d';

const colors = {
  page: '#f4efe4',
  card: '#fbf8f2',
  mutedCard: '#f1ece2',
  primary: '#1d5f55',
  text: '#16181a',
  subtext: '#6f665c',
  border: '#e7dfcf',
  dangerBg: '#fbf1eb',
  danger: '#c25d35',
  successBg: '#e6f4ee',
  success: '#1d5f55',
};

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: '24h', label: '今日' },
  { key: '7d', label: '7天' },
  { key: '30d', label: '30天' },
];

const RANGE_TITLE_MAP: Record<RangeKey, string> = {
  '24h': '今日',
  '7d': '近7天',
  '30d': '近30天',
};

function hasAccountError(account: { status?: string; error_message?: string | null }) {
  return Boolean(account.status === 'error' || account.error_message);
}

function hasAccountRateLimited(account: {
  rate_limit_reset_at?: string | null;
  extra?: Record<string, unknown>;
}) {
  if (account.rate_limit_reset_at) {
    const resetTime = new Date(account.rate_limit_reset_at).getTime();
    if (!Number.isNaN(resetTime) && resetTime > Date.now()) {
      return true;
    }
  }

  const modelLimits = account.extra?.model_rate_limits;
  if (!modelLimits || typeof modelLimits !== 'object' || Array.isArray(modelLimits)) {
    return false;
  }

  const now = Date.now();
  return Object.values(modelLimits as Record<string, unknown>).some((info) => {
    if (!info || typeof info !== 'object' || Array.isArray(info)) return false;

    const resetAt = (info as { rate_limit_reset_at?: unknown }).rate_limit_reset_at;
    if (typeof resetAt !== 'string' || !resetAt.trim()) return false;

    const resetTime = new Date(resetAt).getTime();
    return !Number.isNaN(resetTime) && resetTime > now;
  });
}

function getDateRange(rangeKey: RangeKey) {
  const end = new Date();
  const start = new Date();

  if (rangeKey === '24h') {
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
    granularity: rangeKey === '24h' ? ('hour' as const) : ('day' as const),
  };
}

function formatNumber(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return new Intl.NumberFormat('en-US').format(value);
}

function formatMoney(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `$${value.toFixed(2)}`;
}

function formatCompactNumber(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatTokenDisplay(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return formatTokenValue(value);
}

function getPointLabel(value: string, rangeKey: RangeKey) {
  if (rangeKey === '24h') {
    return value.slice(11, 13);
  }

  return value.slice(5, 10);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    switch (error.message) {
      case 'BASE_URL_REQUIRED':
        return '请先去服务器页填写服务地址。';
      case 'ADMIN_API_KEY_REQUIRED':
        return '请先去服务器页填写 Admin Token。';
      case 'INVALID_SERVER_RESPONSE':
        return '当前服务返回的数据格式不正确，请确认它是可用的 Sub2API 管理接口。';
      default:
        return error.message;
    }
  }

  return '当前无法加载概览数据，请检查服务地址、Token 和网络。';
}

function Section({ title, subtitle, children, right }: { title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{title}</Text>
          {subtitle ? <Text style={{ marginTop: 6, fontSize: 12, color: colors.subtext }}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      <View style={{ marginTop: 14 }}>{children}</View>
    </View>
  );
}

function StatCard({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 16, padding: 14 }}>
      <Text style={{ fontSize: 12, color: '#8a8072' }}>{title}</Text>
      <Text style={{ marginTop: 8, fontSize: 24, fontWeight: '700', color: colors.text }}>{value}</Text>
      {detail ? <Text style={{ marginTop: 6, fontSize: 12, color: colors.subtext }}>{detail}</Text> : null}
    </View>
  );
}

function QueryNotice({ label, error, loading, retry }: { label: string; error?: unknown; loading?: boolean; retry: () => void }) {
  if (!error && !loading) return null;
  return (
    <View style={{ backgroundColor: error ? colors.dangerBg : colors.card, borderRadius: 14, padding: 14, gap: 8 }}>
      <Text style={{ fontSize: 12, lineHeight: 18, color: error ? colors.danger : colors.subtext }}>
        {error ? `${label}加载失败：${getErrorMessage(error)}` : `正在加载${label}…`}
      </Text>
      {error ? <Pressable onPress={retry} style={{ paddingVertical: 8 }}><Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>重试{label}</Text></Pressable> : null}
    </View>
  );
}

export default function MonitorScreen() {
  const config = useSnapshot(adminConfigState);
  const hasAccount = hasAuthenticatedAdminSession(config);
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d');
  const range = getDateRange(rangeKey);

  const statsQuery = useQuery({
    queryKey: ['monitor-stats'],
    queryFn: getDashboardStats,
    enabled: hasAccount,
    staleTime: 60_000,
  });
  const settingsQuery = useQuery({
    queryKey: ['admin-settings'],
    queryFn: getAdminSettings,
    enabled: hasAccount,
    staleTime: 120_000,
  });
  const accountsQuery = useQuery({
    queryKey: ['monitor-accounts'],
    queryFn: () => listAccounts(''),
    enabled: hasAccount,
    staleTime: 60_000,
  });
  const trendQuery = useQuery({
    queryKey: ['monitor-trend', rangeKey, range.start_date, range.end_date, range.granularity],
    queryFn: () => getDashboardTrend(range),
    enabled: hasAccount,
    staleTime: 60_000,
  });
  const modelsQuery = useQuery({
    queryKey: ['monitor-models', rangeKey, range.start_date, range.end_date],
    queryFn: () => getDashboardModels(range),
    enabled: hasAccount,
    staleTime: 60_000,
  });

  function refetchAll() {
    statsQuery.refetch();
    settingsQuery.refetch();
    accountsQuery.refetch();
    trendQuery.refetch();
    modelsQuery.refetch();
  }

  const stats = statsQuery.data;
  const siteName = settingsQuery.data?.site_name?.trim() || '管理控制台';
  const accounts = accountsQuery.data?.items ?? [];
  const trend = trendQuery.data?.trend ?? [];
  const topModels = (modelsQuery.data?.models ?? []).slice(0, 5);
  const errorMessage = getErrorMessage(statsQuery.error);
  const sampleStatus = { healthy: 0, paused: 0, busy: 0, limited: 0, error: 0 };
  for (const account of accounts) {
    if (hasAccountError(account)) sampleStatus.error += 1;
    else if (account.schedulable === false || ['inactive', 'disabled', 'paused'].includes(account.status ?? '')) sampleStatus.paused += 1;
    else if (hasAccountRateLimited(account)) sampleStatus.limited += 1;
    else if ((account.current_concurrency ?? 0) > 0) sampleStatus.busy += 1;
    else sampleStatus.healthy += 1;
  }
  const totalAccounts = stats?.total_accounts ?? accountsQuery.data?.total;
  const errorAccounts = stats?.error_accounts;
  const healthyAccounts = stats?.normal_accounts;
  const latestTrendPoints = trend.slice(-6).reverse();
  const selectedTokenTotal = trendQuery.data ? trend.reduce((sum, item) => sum + item.total_tokens, 0) : undefined;
  const selectedCostTotal = trendQuery.data ? trend.reduce((sum, item) => sum + item.cost, 0) : undefined;
  const selectedOutputTotal = trendQuery.data ? trend.reduce((sum, item) => sum + item.output_tokens, 0) : undefined;
  const rangeTitle = RANGE_TITLE_MAP[rangeKey];
  const isLoading = statsQuery.isPending;
  const hasError = Boolean(statsQuery.error && !stats);

  const throughputPoints = useMemo(
    () => trend.map((item) => ({ label: getPointLabel(item.date, rangeKey), value: item.total_tokens })),
    [rangeKey, trend]
  );
  const requestPoints = useMemo(
    () => trend.map((item) => ({ label: getPointLabel(item.date, rangeKey), value: item.requests })),
    [rangeKey, trend]
  );
  const costPoints = useMemo(
    () => trend.map((item) => ({ label: getPointLabel(item.date, rangeKey), value: item.cost })),
    [rangeKey, trend]
  );
  const totalInputTokens = useMemo(() => trend.reduce((sum, item) => sum + item.input_tokens, 0), [trend]);
  const totalOutputTokens = useMemo(() => trend.reduce((sum, item) => sum + item.output_tokens, 0), [trend]);
  const totalCacheReadTokens = useMemo(() => trend.reduce((sum, item) => sum + item.cache_read_tokens, 0), [trend]);
  const isRefreshing = statsQuery.isRefetching || settingsQuery.isRefetching || accountsQuery.isRefetching || trendQuery.isRefetching || modelsQuery.isRefetching;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.page }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refetchAll()} tintColor="#1d5f55" />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 28, fontWeight: '700', color: colors.text }}>概览</Text>
            <Text style={{ marginTop: 6, fontSize: 13, color: '#8a8072' }}>{siteName} 的当前运行状态。</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {RANGE_OPTIONS.map((option) => {
                const active = option.key === rangeKey;
                return (
                  <Pressable
                    key={option.key}
                    style={{ backgroundColor: active ? colors.primary : colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}
                    onPress={() => setRangeKey(option.key)}
                  >
                    <Text style={{ color: active ? '#fff' : '#4e463e', fontSize: 12, fontWeight: '700' }}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={{ marginTop: 8, fontSize: 12, color: colors.subtext }}>{range.start_date} 到 {range.end_date}</Text>
          </View>
        </View>

        {!hasAccount ? (
          <Section title="未连接服务器" subtitle="需要先配置连接">
            <Text style={{ fontSize: 14, lineHeight: 22, color: colors.subtext }}>请先前往“服务器”页填写服务地址和 Admin Token，再返回查看概览数据。</Text>
            <Pressable style={{ marginTop: 14, alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 }} onPress={() => router.push('/settings')}>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>去配置服务器</Text>
            </Pressable>
          </Section>
        ) : isLoading ? (
          <Section title="正在加载概览" subtitle="请稍候">
            <Text style={{ fontSize: 14, lineHeight: 22, color: colors.subtext }}>正在查询服务器运行统计…</Text>
          </Section>
        ) : hasError ? (
          <Section title="加载失败" subtitle="请检查连接配置">
            <View style={{ borderRadius: 14, backgroundColor: colors.dangerBg, paddingHorizontal: 14, paddingVertical: 12 }}>
              <Text style={{ color: colors.danger, fontSize: 14, lineHeight: 20 }}>{errorMessage}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
              <Pressable style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 12, alignItems: 'center' }} onPress={refetchAll}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>重试</Text>
              </Pressable>
            </View>
          </Section>
        ) : (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => router.push('/users')} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 14, padding: 14 }}>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>用户管理 ›</Text>
                <Text style={{ marginTop: 5, color: '#d7eee6', fontSize: 11 }}>余额、额度与订阅</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/accounts')} style={{ flex: 1, backgroundColor: colors.card, borderRadius: 14, padding: 14 }}>
                <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '700' }}>账号查询 ›</Text>
                <Text style={{ marginTop: 5, color: colors.subtext, fontSize: 11 }}>限额、用量与重置卡</Text>
              </Pressable>
            </View>
            <QueryNotice label="概览统计" error={statsQuery.error} retry={() => void statsQuery.refetch()} />
            {statsQuery.error ? <Text style={{ color: colors.subtext, fontSize: 12 }}>当前保留上次成功查询的统计。</Text> : null}
            <QueryNotice label="站点名称" error={settingsQuery.error} retry={() => void settingsQuery.refetch()} />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <StatCard title="今日请求" value={formatNumber(stats?.today_requests)} detail={`RPM ${formatNumber(stats?.rpm)}`} />
              <StatCard title="活跃用户" value={formatNumber(stats?.active_users)} detail={`共 ${formatNumber(stats?.total_users)} 位用户`} />
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <StatCard
                title={`${rangeTitle} Token`}
                value={formatTokenDisplay(rangeKey === '24h' ? stats?.today_tokens : selectedTokenTotal)}
                detail={`输出 ${formatTokenDisplay(rangeKey === '24h' ? stats?.today_output_tokens : selectedOutputTotal)}`}
              />
              <StatCard
                title={`${rangeTitle} 成本`}
                value={formatMoney(rangeKey === '24h' ? stats?.today_cost : selectedCostTotal)}
                detail={`TPM ${formatNumber(stats?.tpm)}`}
              />
            </View>
            <Section
              title="账号概览"
              subtitle="全部账号的总数、健康与异常数量"
              right={(
                <Pressable
                  style={{ alignSelf: 'flex-start', backgroundColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}
                  onPress={() => router.push('/accounts')}
                >
                  <Text style={{ color: '#4e463e', fontSize: 12, fontWeight: '700' }}>账号清单</Text>
                </Pressable>
              )}
            >
              <Pressable onPress={() => router.push('/accounts')}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1, backgroundColor: colors.mutedCard, borderRadius: 14, padding: 12 }}>
                    <Text style={{ fontSize: 11, color: '#8a8072' }}>总数</Text>
                    <Text style={{ marginTop: 6, fontSize: 18, fontWeight: '700', color: colors.text }}>{formatNumber(totalAccounts)}</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: colors.mutedCard, borderRadius: 14, padding: 12 }}>
                    <Text style={{ fontSize: 11, color: '#8a8072' }}>健康</Text>
                    <Text style={{ marginTop: 6, fontSize: 18, fontWeight: '700', color: colors.text }}>{formatNumber(healthyAccounts)}</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: colors.dangerBg, borderRadius: 14, padding: 12 }}>
                    <Text style={{ fontSize: 11, color: colors.danger }}>异常</Text>
                    <Text style={{ marginTop: 6, fontSize: 18, fontWeight: '700', color: colors.danger }}>{formatNumber(errorAccounts)}</Text>
                  </View>
                </View>
                <Text style={{ marginTop: 10, fontSize: 12, color: colors.subtext }}>进入账号清单查看每个账号的用量和限额。</Text>
              </Pressable>
            </Section>

            <QueryNotice label="用量趋势" error={trendQuery.error} loading={trendQuery.isPending} retry={() => void trendQuery.refetch()} />

            {throughputPoints.length > 1 ? (
              <LineTrendChart title="Token 吞吐" subtitle="当前时间范围内的 Token 变化趋势" points={throughputPoints} color="#a34d2d" formatValue={formatTokenDisplay} />
            ) : null}

            {requestPoints.length > 1 ? (
              <LineTrendChart title="请求趋势" subtitle="当前时间范围内的请求变化趋势" points={requestPoints} color="#1d5f55" formatValue={formatCompactNumber} />
            ) : null}

            {costPoints.length > 1 ? (
              <LineTrendChart title="成本趋势" subtitle="当前时间范围内的成本变化趋势" points={costPoints} color="#7651c8" formatValue={formatMoney} />
            ) : null}

            {trendQuery.data ? <BarChartCard
              title="Token 结构"
              subtitle="输入、输出、缓存读取占比"
              items={[
                { label: '输入 Token', value: totalInputTokens, color: '#1d5f55', hint: '请求进入模型前消耗的 token。' },
                { label: '输出 Token', value: totalOutputTokens, color: '#d38b36', hint: '模型返回内容消耗的 token。' },
                { label: '缓存读取 Token', value: totalCacheReadTokens, color: '#7d7468', hint: '命中缓存后复用的 token。' },
              ]}
              formatValue={formatTokenDisplay}
            /> : null}

            <QueryNotice label="账号状态" error={accountsQuery.error} loading={accountsQuery.isPending} retry={() => void accountsQuery.refetch()} />
            {accountsQuery.data ? <DonutChartCard
              title="已查询账号状态"
              subtitle={`以下仅覆盖已查询的 ${accounts.length} 个账号，共 ${formatNumber(totalAccounts)} 个；其余账号请到清单查询。`}
              centerLabel="已查询账号"
              centerValue={String(accounts.length)}
              segments={[
                { label: '正常', value: sampleStatus.healthy, color: '#1d5f55' },
                { label: '繁忙', value: sampleStatus.busy, color: '#d38b36' },
                { label: '限流', value: sampleStatus.limited, color: '#7d7468' },
                { label: '暂停', value: sampleStatus.paused, color: '#b6a78f' },
                { label: '异常', value: sampleStatus.error, color: '#a34d2d' },
              ]}
            /> : null}

            <QueryNotice label="模型统计" error={modelsQuery.error} loading={modelsQuery.isPending} retry={() => void modelsQuery.refetch()} />
            {modelsQuery.data ? <BarChartCard
              title="热点模型"
              subtitle="当前时间范围内最活跃的模型"
              items={topModels.map((model) => ({
                label: model.model,
                value: model.total_tokens,
                color: '#a34d2d',
                meta: `请求 ${formatNumber(model.requests)} · 成本 ${formatMoney(model.cost)}`,
              }))}
              formatValue={formatCompactNumber}
            /> : null}

            {trendQuery.data ? <Section title="趋势摘要" subtitle="最近几个统计点的请求、Token 和成本变化">
              {latestTrendPoints.length === 0 ? (
                <Text style={{ fontSize: 14, color: colors.subtext }}>当前时间范围没有趋势数据。</Text>
              ) : (
                <View style={{ gap: 12 }}>
                  <View style={{ gap: 10 }}>
                    {latestTrendPoints.map((point) => (
                      <View key={point.date} style={{ backgroundColor: colors.mutedCard, borderRadius: 14, padding: 12 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>{point.date}</Text>
                        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 11, color: '#8a8072' }}>请求</Text>
                            <Text style={{ marginTop: 4, fontSize: 15, fontWeight: '700', color: colors.text }}>{formatCompactNumber(point.requests)}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 11, color: '#8a8072' }}>Token</Text>
                            <Text style={{ marginTop: 4, fontSize: 15, fontWeight: '700', color: colors.text }}>{formatTokenDisplay(point.total_tokens)}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 11, color: '#8a8072' }}>成本</Text>
                            <Text style={{ marginTop: 4, fontSize: 15, fontWeight: '700', color: colors.text }}>{formatMoney(point.cost)}</Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </Section> : null}

          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
