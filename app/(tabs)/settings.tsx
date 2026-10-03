import { router } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { getAdminSettings, getDashboardStats } from '@/src/services/admin';
import { queryClient } from '@/src/lib/query-client';
import { verifyAdminConnection } from '@/src/lib/admin-fetch';
import { confirmAction, getManagementError } from '@/src/lib/management';
import { adminConfigState, removeAdminAccount, saveAdminConfig, switchAdminAccount, type AdminAccountProfile } from '@/src/store/admin-config';

const { useSnapshot } = require('valtio/react');

const schema = z
  .object({
    baseUrl: z.string().min(1, '请输入服务器地址'),
    adminApiKey: z.string(),
  })
  .refine((values) => values.adminApiKey.trim().length > 0, {
    path: ['adminApiKey'],
    message: '请输入 Admin Key',
  });

type FormValues = z.infer<typeof schema>;
type ConnectionState = 'idle' | 'checking' | 'success' | 'error';

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

function getConnectionErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    switch (error.message) {
      case 'BASE_URL_REQUIRED':
        return '请先填写服务器地址。';
      case 'ADMIN_API_KEY_REQUIRED':
        return '请先填写 Admin Key。';
      case 'INVALID_SERVER_RESPONSE':
        return '当前地址返回的数据不正确，请确认它是可用的管理接口。';
      default:
        return error.message;
    }
  }

  return '连接失败，请检查服务器地址、Admin Key 和网络连通性。';
}

function ServerCard({
  account,
  active,
  disabled,
  onSelect,
  onDelete,
}: {
  account: AdminAccountProfile;
  active: boolean;
  disabled: boolean;
  onSelect: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onSelect}
      style={{
        backgroundColor: active ? '#e6f4ee' : colors.card,
        borderRadius: 18,
        padding: 16,
        borderWidth: 1,
        borderColor: active ? colors.success : colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{account.label}</Text>
          <Text style={{ marginTop: 6, fontSize: 13, lineHeight: 20, color: colors.subtext }}>{account.baseUrl}</Text>
          <Text style={{ marginTop: 8, fontSize: 11, color: '#8a8072' }}>更新时间 {new Date(account.updatedAt).toLocaleString()}</Text>
        </View>
        {active ? (
          <View style={{ backgroundColor: colors.success, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>当前使用</Text>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <Pressable disabled={disabled} onPress={onSelect} style={{ flex: 1, backgroundColor: active ? '#d7eee4' : colors.primary, borderRadius: 14, paddingVertical: 11, alignItems: 'center' }}>
          <Text style={{ color: active ? colors.success : '#fff', fontSize: 13, fontWeight: '700' }}>{active ? '已选中' : '切换到此服务器'}</Text>
        </Pressable>
        <Pressable disabled={disabled} onPress={onDelete} style={{ backgroundColor: colors.border, borderRadius: 14, paddingHorizontal: 16, justifyContent: 'center' }}>
          <Text style={{ color: '#7a3d31', fontSize: 13, fontWeight: '700' }}>删除</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const config = useSnapshot(adminConfigState);
  const [showForm, setShowForm] = useState(config.accounts.length === 0);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAdminKey, setShowAdminKey] = useState(false);
  const operationLocked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { control, handleSubmit, formState, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      baseUrl: '',
      adminApiKey: '',
    },
  });

  async function handleAdd(values: FormValues) {
    if (operationLocked.current) return;
    operationLocked.current = true;
    const revision = adminConfigState.sessionRevision;
    setConnectionState('checking');
    try {
      await verifyAdminConnection(values);
      if (!mounted.current || revision !== adminConfigState.sessionRevision) return;
      await saveAdminConfig(values);
      router.replace('/monitor');
    } catch (error) {
      if (!mounted.current) return;
      setConnectionState('error');
      setConnectionMessage(getManagementError(error));
    } finally { operationLocked.current = false; }
  }

  async function handleSelect(account: AdminAccountProfile) {
    if (operationLocked.current || account.id === adminConfigState.activeAccountId) return;
    operationLocked.current = true;
    const revision = adminConfigState.sessionRevision;
    setConnectionState('checking');
    try {
      await verifyAdminConnection(account);
      if (!mounted.current || revision !== adminConfigState.sessionRevision) return;
      await switchAdminAccount(account.id);
      router.replace('/monitor');
    } catch (error) {
      if (!mounted.current) return;
      setConnectionState('error');
      setConnectionMessage(getManagementError(error));
    } finally { operationLocked.current = false; }
  }

  async function handleDelete(account: AdminAccountProfile) {
    if (operationLocked.current) return;
    operationLocked.current = true;
    const revision = adminConfigState.sessionRevision;
    try {
      if (!await confirmAction({ title: '移除服务器', message: `从手机移除 ${account.label} 的连接信息？不会删除后台数据。`, destructive: true })) return;
      if (!mounted.current || revision !== adminConfigState.sessionRevision) return;
      await removeAdminAccount(account.id);
    } finally { operationLocked.current = false; }
  }

  async function handleRefresh() {
    if (!config.baseUrl.trim()) {
      return;
    }

    setIsRefreshing(true);
    setConnectionState('idle');
    setConnectionMessage('');

    try {
      await Promise.all([
        queryClient.fetchQuery({ queryKey: ['admin-settings'], queryFn: getAdminSettings }),
        queryClient.prefetchQuery({ queryKey: ['monitor-stats'], queryFn: getDashboardStats }),
      ]);
    } catch (error) {
      setConnectionState('error');
      setConnectionMessage(getConnectionErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.page }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 110, gap: 14 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void handleRefresh()} tintColor="#1d5f55" />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 28, fontWeight: '700', color: colors.text }}>服务器</Text>
            <Text style={{ marginTop: 6, fontSize: 13, color: '#8a8072' }}>选择当前管理的服务器，或添加新的服务器。</Text>
          </View>
          <Pressable
            onPress={() => {
              setShowForm((value) => !value);
              setConnectionState('idle');
              setConnectionMessage('');
            }}
            style={{ backgroundColor: colors.primary, borderRadius: 999, width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: '#fff', fontSize: 24, lineHeight: 24 }}>+</Text>
          </Pressable>
        </View>

        {showForm ? (
          <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16, gap: 14 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>添加服务器</Text>

            <View>
              <Text style={{ marginBottom: 8, fontSize: 12, color: colors.subtext }}>服务器地址</Text>
              <Controller
                control={control}
                name="baseUrl"
                render={({ field: { onChange, value } }) => (
                  <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder="例如：https://api.example.com"
                    placeholderTextColor="#9b9081"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{ backgroundColor: colors.mutedCard, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.text }}
                  />
                )}
              />
            </View>

            <View>
              <Text style={{ marginBottom: 8, fontSize: 12, color: colors.subtext }}>Admin Key</Text>
              <Controller
                control={control}
                name="adminApiKey"
                render={({ field: { onChange, value } }) => (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <TextInput
                      value={value}
                      onChangeText={onChange}
                      placeholder="admin-xxxxxxxx"
                      placeholderTextColor="#9b9081"
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry={!showAdminKey}
                      style={{
                        flex: 1,
                        backgroundColor: colors.mutedCard,
                        borderRadius: 16,
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        fontSize: 16,
                        color: colors.text,
                      }}
                    />
                    <Pressable
                      onPress={() => setShowAdminKey((value) => !value)}
                      style={{ backgroundColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#4e463e' }}>{showAdminKey ? '隐藏' : '显示'}</Text>
                    </Pressable>
                  </View>
                )}
              />
            </View>

            {formState.errors.baseUrl || formState.errors.adminApiKey ? (
              <View style={{ borderRadius: 14, backgroundColor: colors.dangerBg, paddingHorizontal: 14, paddingVertical: 12 }}>
                <Text style={{ color: colors.danger, fontSize: 14 }}>{formState.errors.baseUrl?.message || formState.errors.adminApiKey?.message}</Text>
              </View>
            ) : null}

            {connectionMessage ? (
              <View style={{ borderRadius: 14, backgroundColor: connectionState === 'success' ? colors.successBg : colors.dangerBg, paddingHorizontal: 14, paddingVertical: 12 }}>
                <Text style={{ color: connectionState === 'success' ? colors.success : colors.danger, fontSize: 14 }}>{connectionMessage}</Text>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable
                onPress={handleSubmit(handleAdd)}
                disabled={connectionState === 'checking'}
                style={{ flex: 1, backgroundColor: connectionState === 'checking' ? '#7ca89f' : colors.primary, borderRadius: 16, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{connectionState === 'checking' ? '检测中...' : '保存并使用'}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setShowForm(false);
                  setConnectionState('idle');
                  setConnectionMessage('');
                  reset({ baseUrl: '', adminApiKey: '' });
                }}
                style={{ flex: 1, backgroundColor: colors.border, borderRadius: 16, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ color: '#4e463e', fontSize: 14, fontWeight: '700' }}>取消</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={{ gap: 12 }}>
          {config.accounts.map((account: AdminAccountProfile) => (
            <ServerCard
              key={account.id}
              account={account}
              active={account.id === config.activeAccountId}
              disabled={connectionState === 'checking'}
              onSelect={() => handleSelect(account)}
              onDelete={() => handleDelete(account)}
            />
          ))}

          {config.accounts.length === 0 ? (
            <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 18 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>还没有服务器</Text>
              <Text style={{ marginTop: 8, fontSize: 13, lineHeight: 21, color: colors.subtext }}>点击右上角 + 添加服务器，保存成功后会自动切换并进入概览。</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
