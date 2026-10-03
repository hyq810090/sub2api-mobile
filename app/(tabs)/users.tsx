import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDebouncedValue } from '@/src/hooks/use-debounced-value';
import { queryClient } from '@/src/lib/query-client';
import { getUser, listUsers } from '@/src/services/admin';
import { adminConfigState, hasAuthenticatedAdminSession } from '@/src/store/admin-config';
import type { AdminUser } from '@/src/types/admin';

const { useSnapshot } = require('valtio/react');

const colors = {
  page: '#f4efe4',
  card: '#fbf8f2',
  mutedCard: '#f1ece2',
  primary: '#1d5f55',
  text: '#16181a',
  subtext: '#6f665c',
  dangerBg: '#fbf1eb',
  danger: '#a4512b',
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    switch (error.message) {
      case 'BASE_URL_REQUIRED':
        return '请先到服务器页填写服务地址。';
      case 'ADMIN_API_KEY_REQUIRED':
        return '请先到服务器页填写 Admin Key。';
      default:
        return error.message;
    }
  }
  return '加载失败，请检查服务器连接后重试。';
}

function formatMoney(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(2)}` : '--';
}

function UserCard({ user }: { user: AdminUser }) {
  const disabled = user.status === 'inactive' || user.status === 'disabled';
  const status = disabled ? '已禁用' : user.status === 'active' || !user.status ? '正常' : user.status;
  const isAdmin = user.role?.trim().toLowerCase() === 'admin';

  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{user.username?.trim() || user.email}</Text>
          <Text numberOfLines={1} style={{ marginTop: 5, fontSize: 12, color: colors.subtext }}>{user.email} · #{user.id}</Text>
        </View>
        <View style={{ backgroundColor: disabled ? '#ece5da' : '#dff4ea', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: disabled ? colors.subtext : colors.primary }}>{status}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1, backgroundColor: colors.mutedCard, borderRadius: 12, padding: 12 }}>
          <Text style={{ fontSize: 11, color: colors.subtext }}>余额</Text>
          <Text style={{ marginTop: 5, fontSize: 17, fontWeight: '700', color: colors.primary }}>{formatMoney(user.balance)}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.mutedCard, borderRadius: 12, padding: 12 }}>
          <Text style={{ fontSize: 11, color: colors.subtext }}>并发上限</Text>
          <Text style={{ marginTop: 5, fontSize: 17, fontWeight: '700', color: colors.text }}>{user.concurrency ?? '--'}</Text>
        </View>
        <View style={{ justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 11, color: colors.subtext }}>{isAdmin ? '管理员' : '用户'}</Text>
          <Text style={{ marginTop: 6, fontSize: 12, fontWeight: '700', color: colors.primary }}>详情 ›</Text>
        </View>
      </View>
      {user.notes?.trim() ? <Text numberOfLines={2} style={{ fontSize: 12, lineHeight: 18, color: colors.subtext }}>{user.notes.trim()}</Text> : null}
    </View>
  );
}

export default function UsersScreen() {
  const config = useSnapshot(adminConfigState);
  const hasAccount = hasAuthenticatedAdminSession(config);
  const [searchText, setSearchText] = useState('');
  const keyword = useDebouncedValue(searchText.trim(), 250);

  const usersQuery = useInfiniteQuery({
    queryKey: ['users', config.activeAccountId, keyword],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => listUsers(keyword, pageParam),
    getNextPageParam: (lastPage) => {
      if (!lastPage.items.length) return undefined;
      const pageSize = lastPage.page_size || 20;
      return lastPage.page * pageSize < lastPage.total ? lastPage.page + 1 : undefined;
    },
    enabled: hasAccount,
  });

  const users = useMemo(() => {
    const unique = new Map<number, AdminUser>();
    for (const page of usersQuery.data?.pages ?? []) {
      for (const user of page.items) unique.set(user.id, user);
    }
    return [...unique.values()];
  }, [usersQuery.data?.pages]);
  const total = usersQuery.data?.pages[0]?.total;

  const loadMore = () => {
    if (usersQuery.hasNextPage && !usersQuery.isFetching) void usersQuery.fetchNextPage();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.page }}>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}>
        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontSize: 28, fontWeight: '700', color: colors.text }}>用户</Text>
          <Text style={{ marginTop: 5, fontSize: 12, color: colors.subtext }}>查询余额、额度与订阅，进入详情执行管理操作。</Text>
        </View>

        <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 10 }}>
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="搜索邮箱、用户名或备注"
            placeholderTextColor="#9b9081"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="搜索用户"
            style={{ backgroundColor: colors.mutedCard, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text }}
          />
        </View>

        {typeof total === 'number' ? <Text style={{ marginTop: 10, marginBottom: 2, fontSize: 12, color: colors.subtext }}>已显示 {users.length} / {total} 位用户</Text> : null}

        {!hasAccount ? (
          <View style={{ marginTop: 12, backgroundColor: colors.card, borderRadius: 18, padding: 16, gap: 10 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>未连接服务器</Text>
            <Text style={{ color: colors.subtext }}>请先连接服务器，再查询用户。</Text>
            <Pressable onPress={() => router.push('/settings')} style={{ paddingVertical: 12 }}>
              <Text style={{ color: colors.primary, fontWeight: '700' }}>连接服务器 ›</Text>
            </Pressable>
          </View>
        ) : usersQuery.isPending ? (
          <View style={{ marginTop: 24, alignItems: 'center', gap: 12 }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.subtext }}>正在加载用户…</Text>
          </View>
        ) : (
          <FlatList
            style={{ marginTop: 10, flex: 1 }}
            data={users}
            keyExtractor={(item) => String(item.id)}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            refreshControl={<RefreshControl refreshing={usersQuery.isRefetching} onRefresh={() => void usersQuery.refetch()} tintColor={colors.primary} />}
            contentContainerStyle={{ paddingBottom: 24, gap: 12, flexGrow: users.length === 0 ? 1 : 0 }}
            ListHeaderComponent={usersQuery.isError && !usersQuery.isFetchNextPageError ? (
              <View style={{ backgroundColor: colors.dangerBg, borderRadius: 14, padding: 14, gap: 10 }}>
                <Text style={{ color: colors.danger }}>用户列表加载失败：{getErrorMessage(usersQuery.error)}</Text>
                <Pressable onPress={() => void usersQuery.refetch()} style={{ paddingVertical: 8 }}>
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>重试</Text>
                </Pressable>
              </View>
            ) : null}
            ListEmptyComponent={!usersQuery.isError ? (
              <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16, gap: 8 }}>
                <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>暂无用户</Text>
                <Text style={{ fontSize: 14, lineHeight: 22, color: colors.subtext }}>当前条件下没有匹配结果，可修改关键词后重试。</Text>
              </View>
            ) : null}
            ListFooterComponent={usersQuery.hasNextPage || usersQuery.isFetchNextPageError ? (
              <View style={{ gap: 10, paddingVertical: 8 }}>
                {usersQuery.isFetchNextPageError ? <Text style={{ color: colors.danger }}>下一页加载失败：{getErrorMessage(usersQuery.error)}</Text> : null}
                <Pressable
                  disabled={usersQuery.isFetching}
                  onPress={loadMore}
                  style={{ backgroundColor: colors.card, borderRadius: 14, paddingVertical: 15, alignItems: 'center', opacity: usersQuery.isFetching ? 0.6 : 1 }}
                >
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>{usersQuery.isFetchingNextPage ? '加载中…' : usersQuery.isFetchNextPageError ? '重试加载下一页' : '加载更多用户'}</Text>
                </Pressable>
              </View>
            ) : users.length > 0 ? <Text style={{ paddingVertical: 12, textAlign: 'center', color: colors.subtext, fontSize: 12 }}>已加载全部用户</Text> : null}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`查看用户 ${item.email}`}
                onPress={() => {
                  void queryClient.prefetchQuery({ queryKey: ['user', item.id], queryFn: () => getUser(item.id) });
                  router.push(`/users/${item.id}`);
                }}
              >
                <UserCard user={item} />
              </Pressable>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
