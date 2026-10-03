import { Alert, Platform } from 'react-native';
import { adminConfigState } from '@/src/store/admin-config';

let confirmationInProgress = false;

export async function confirmAction(options: { title: string; message: string; destructive?: boolean }): Promise<boolean> {
  if (confirmationInProgress) return false;
  confirmationInProgress = true;
  const revision = adminConfigState.sessionRevision;
  try {
    const accepted = Platform.OS === 'web'
      ? typeof window !== 'undefined' && window.confirm(`${options.title}\n\n${options.message}`)
      : await new Promise<boolean>((resolve) => Alert.alert(options.title, options.message, [
        { text: '取消', style: 'cancel', onPress: () => resolve(false) },
        { text: '确认', style: options.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) }));
    return accepted && revision === adminConfigState.sessionRevision;
  } finally { confirmationInProgress = false; }
}

export function createOperationKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getManagementError(error: unknown): string {
  if (!(error instanceof Error)) return '操作失败，请稍后查询状态。';
  const messages: Record<string, string> = {
    BASE_URL_REQUIRED: '请先连接管理服务器。',
    ADMIN_API_KEY_REQUIRED: '请填写管理员密钥。',
    SESSION_CHANGED: '服务器已切换，请在当前服务器重新查询。',
    REQUEST_TIMEOUT: '请求超时，操作结果尚未确认。请先查询状态，勿立即重复重置。',
    INVALID_SERVER_RESPONSE: '服务器返回格式异常，请核对后台版本和地址。',
    API_NOT_SUPPORTED: '当前后台版本不支持此功能，请升级后台或在网页版查看。',
    ADMIN_COMPLIANCE_ACK_REQUIRED: '请先在网页版后台完成使用条款确认，再返回手机刷新。',
  };
  if (messages[error.message]) return messages[error.message];
  const status = (error as Error & { status?: number }).status;
  if (status === 401 || status === 403) return '没有访问权限，请检查管理员密钥。';
  if (status === 404 || status === 405) return messages.API_NOT_SUPPORTED;
  if (status === 429) return '请求过于频繁，请稍后再查询。';
  if (error.message === 'Failed to fetch' || error.message === 'Network request failed') return '网络请求未完成；如刚执行重置，请先查询结果再继续。';
  return error.message;
}

export function formatDateTime(value?: string | number | null): string {
  if (value == null || value === '') return '—';
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function formatMoney(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(2)}` : '—';
}
