import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { queryClient } from '@/src/lib/query-client';
const { proxy } = require('valtio');

const BASE_URL_KEY = 'sub2api_base_url';
const ADMIN_KEY_KEY = 'sub2api_admin_api_key';
const ACCOUNTS_KEY = 'sub2api_accounts';
const ACTIVE_ACCOUNT_ID_KEY = 'sub2api_active_account_id';
const IS_WEB = Platform.OS === 'web';

export type AdminAccountProfile = {
  id: string;
  label: string;
  baseUrl: string;
  adminApiKey: string;
  updatedAt: string;
  enabled?: boolean;
};

function createAccountId() {
  return `acct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getAccountLabel(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return url.host || baseUrl;
  } catch {
    return baseUrl;
  }
}

function normalizeConfig(input: { baseUrl: string; adminApiKey: string }) {
  return {
    baseUrl: input.baseUrl.trim().replace(/\/$/, ''),
    adminApiKey: input.adminApiKey.trim(),
  };
}

function sortAccounts(accounts: AdminAccountProfile[]) {
  return [...accounts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function normalizeAccount(account: AdminAccountProfile): AdminAccountProfile {
  return {
    ...account,
    adminApiKey: account.adminApiKey ?? '',
    enabled: account.enabled ?? true,
  };
}

function sanitizeAccountsForWeb(accounts: AdminAccountProfile[]) {
  if (!IS_WEB) {
    return accounts;
  }

  return accounts.map((account) => ({
    ...account,
    adminApiKey: '',
  }));
}

function persistAdminApiKey(value: string) {
  if (IS_WEB) {
    return deleteItem(ADMIN_KEY_KEY);
  }

  return setItem(ADMIN_KEY_KEY, value);
}

function persistAccounts(accounts: AdminAccountProfile[]) {
  return setItem(ACCOUNTS_KEY, JSON.stringify(sanitizeAccountsForWeb(accounts)));
}

export function hasAuthenticatedAdminSession(config: { baseUrl: string; adminApiKey: string }) {
  const hasBaseUrl = Boolean(config.baseUrl.trim());

  if (!hasBaseUrl) {
    return false;
  }

  return Boolean(config.adminApiKey.trim());
}

function getNextActiveAccount(accounts: AdminAccountProfile[], activeAccountId?: string) {
  const enabledAccounts = accounts.filter((account) => account.enabled !== false);

  if (activeAccountId) {
    const preferred = enabledAccounts.find((account) => account.id === activeAccountId);
    if (preferred) {
      return preferred;
    }
  }

  return enabledAccounts[0];
}

export function getDefaultAdminConfig() {
  return {
    baseUrl: '',
    adminApiKey: '',
  };
}

async function getItem(key: string) {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') {
        return null;
      }

      return localStorage.getItem(key);
    }

    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function setItem(key: string, value: string) {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
      }

      return;
    }

    await SecureStore.setItemAsync(key, value);
  } catch {
    return;
  }
}

async function deleteItem(key: string) {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }

      return;
    }

    await SecureStore.deleteItemAsync(key);
  } catch {
    return;
  }
}

export const adminConfigState = proxy({
  ...getDefaultAdminConfig(),
  accounts: [] as AdminAccountProfile[],
  activeAccountId: '',
  hydrated: false,
  saving: false,
  sessionRevision: 0,
});

function activateSession(account?: AdminAccountProfile) {
  // Cancel old reads and remove their cache before activating another server.
  adminConfigState.sessionRevision += 1;
  void queryClient.cancelQueries();
  queryClient.clear();
  adminConfigState.activeAccountId = account?.id ?? '';
  adminConfigState.baseUrl = account?.baseUrl ?? '';
  adminConfigState.adminApiKey = account?.adminApiKey ?? '';
}

export async function hydrateAdminConfig() {
  const defaults = getDefaultAdminConfig();

  try {
    const [baseUrl, adminApiKey, rawAccounts, activeAccountId] = await Promise.all([
      getItem(BASE_URL_KEY),
      getItem(ADMIN_KEY_KEY),
      getItem(ACCOUNTS_KEY),
      getItem(ACTIVE_ACCOUNT_ID_KEY),
    ]);

    let accounts: AdminAccountProfile[] = [];

    if (rawAccounts) {
      try {
        const parsed = JSON.parse(rawAccounts) as AdminAccountProfile[];
        accounts = Array.isArray(parsed) ? sanitizeAccountsForWeb(parsed.map((account) => normalizeAccount(account))) : [];
      } catch {
        accounts = [];
      }
    }

    if (accounts.length === 0 && baseUrl) {
      const legacyConfig = normalizeConfig({
        baseUrl,
        adminApiKey: IS_WEB ? defaults.adminApiKey : adminApiKey ?? defaults.adminApiKey,
      });

      accounts = [
        {
          id: createAccountId(),
          label: getAccountLabel(legacyConfig.baseUrl),
          ...legacyConfig,
          updatedAt: new Date().toISOString(),
          enabled: true,
        },
      ];
    }

    const sortedAccounts = sortAccounts(accounts);
    const activeAccount = getNextActiveAccount(sortedAccounts, activeAccountId ?? undefined);
    const nextActiveAccountId = activeAccount?.id || '';

    adminConfigState.accounts = sortedAccounts;
    activateSession(activeAccount);

    await Promise.all([
      persistAccounts(sortedAccounts),
      nextActiveAccountId ? setItem(ACTIVE_ACCOUNT_ID_KEY, nextActiveAccountId) : deleteItem(ACTIVE_ACCOUNT_ID_KEY),
      setItem(BASE_URL_KEY, activeAccount?.baseUrl ?? defaults.baseUrl),
      persistAdminApiKey(activeAccount?.adminApiKey ?? defaults.adminApiKey),
    ]);
  } finally {
    adminConfigState.hydrated = true;
  }
}

export async function saveAdminConfig(input: { baseUrl: string; adminApiKey: string }) {
  adminConfigState.saving = true;

  try {
    const normalized = normalizeConfig(input);
    const nextUpdatedAt = new Date().toISOString();
    const existingAccount = adminConfigState.accounts.find(
      (account: AdminAccountProfile) => account.baseUrl === normalized.baseUrl && account.adminApiKey === normalized.adminApiKey
    );
    const nextAccount: AdminAccountProfile = existingAccount
      ? {
          ...existingAccount,
          label: getAccountLabel(normalized.baseUrl),
          updatedAt: nextUpdatedAt,
        }
      : {
          id: createAccountId(),
          label: getAccountLabel(normalized.baseUrl),
          ...normalized,
          updatedAt: nextUpdatedAt,
          enabled: true,
        };
    const nextAccounts = sortAccounts([
      nextAccount,
      ...adminConfigState.accounts.filter((account: AdminAccountProfile) => account.id !== nextAccount.id),
    ]);

    await Promise.all([
      setItem(BASE_URL_KEY, normalized.baseUrl),
      persistAdminApiKey(normalized.adminApiKey),
      persistAccounts(nextAccounts),
      setItem(ACTIVE_ACCOUNT_ID_KEY, nextAccount.id),
    ]);

    adminConfigState.accounts = nextAccounts;
    activateSession(nextAccount);
  } finally {
    adminConfigState.saving = false;
  }
}

export async function switchAdminAccount(accountId: string) {
  const account = adminConfigState.accounts.find((item: AdminAccountProfile) => item.id === accountId);

  if (!account) {
    return;
  }

  if (account.enabled === false) {
    return;
  }

  const nextAccount = {
    ...account,
    updatedAt: new Date().toISOString(),
  };
  const nextAccounts = sortAccounts([
    nextAccount,
    ...adminConfigState.accounts.filter((item: AdminAccountProfile) => item.id !== accountId),
  ]);

  await Promise.all([
    setItem(BASE_URL_KEY, nextAccount.baseUrl),
    persistAdminApiKey(nextAccount.adminApiKey),
    persistAccounts(nextAccounts),
    setItem(ACTIVE_ACCOUNT_ID_KEY, nextAccount.id),
  ]);

  adminConfigState.accounts = nextAccounts;
  activateSession(nextAccount);
}

export async function removeAdminAccount(accountId: string) {
  const nextAccounts = adminConfigState.accounts.filter((item: AdminAccountProfile) => item.id !== accountId);
  const nextActiveAccount = getNextActiveAccount(nextAccounts, adminConfigState.activeAccountId === accountId ? '' : adminConfigState.activeAccountId);

  await Promise.all([
    persistAccounts(nextAccounts),
    nextActiveAccount ? setItem(ACTIVE_ACCOUNT_ID_KEY, nextActiveAccount.id) : deleteItem(ACTIVE_ACCOUNT_ID_KEY),
    setItem(BASE_URL_KEY, nextActiveAccount?.baseUrl ?? ''),
    persistAdminApiKey(nextActiveAccount?.adminApiKey ?? ''),
  ]);

  adminConfigState.accounts = nextAccounts;
  activateSession(nextActiveAccount);
}

export async function logoutAdminAccount() {
  await Promise.all([setItem(BASE_URL_KEY, ''), persistAdminApiKey(''), deleteItem(ACTIVE_ACCOUNT_ID_KEY)]);

  activateSession();
}

export async function setAdminAccountEnabled(accountId: string, enabled: boolean) {
  const nextAccounts = sortAccounts(
    adminConfigState.accounts.map((account: AdminAccountProfile) =>
      account.id === accountId ? { ...account, enabled, updatedAt: new Date().toISOString() } : account
    )
  );
  const nextActiveAccount = getNextActiveAccount(nextAccounts, enabled ? accountId : adminConfigState.activeAccountId);

  await Promise.all([
    persistAccounts(nextAccounts),
    nextActiveAccount ? setItem(ACTIVE_ACCOUNT_ID_KEY, nextActiveAccount.id) : deleteItem(ACTIVE_ACCOUNT_ID_KEY),
    setItem(BASE_URL_KEY, nextActiveAccount?.baseUrl ?? ''),
    persistAdminApiKey(nextActiveAccount?.adminApiKey ?? ''),
  ]);

  adminConfigState.accounts = nextAccounts;
  activateSession(nextActiveAccount);
}
