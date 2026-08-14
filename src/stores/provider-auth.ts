import type { ProviderId } from '../providers/types'
import { registerApiProviderAuthFailureHandler } from '../lib/api'
import { useProviderStore } from './providers'
import { useSettingsStore } from './settings'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '')
}

export function isProviderAuthFailure(error: unknown): boolean {
  const message = errorMessage(error)
  return /\bHTTP\s+(401|403)\b/i.test(message)
    || /\b(AUTH_REQUIRED|AUTH_EXPIRED)\b/i.test(message)
}

/**
 * 把账号接口返回的鉴权失效统一同步到兼容 UI 状态与 provider 运行态。
 * 返回 true 表示已处理；普通网络/业务失败保持原平台参与状态。
 */
export function expireProviderAccount(source: ProviderId, error: unknown): boolean {
  if (!isProviderAuthFailure(error)) return false
  const settings = useSettingsStore.getState()
  if (source === 'netease') settings.setNeteaseLoggedIn(false)
  else settings.setQQLoggedIn(false)
  useProviderStore.getState().setAccountState(source, 'expired')
  return true
}

/** API 边界统一同步鉴权失效，覆盖业务层为容错而静默降级的读写请求。 */
export function initProviderAuthFailureSync(): () => void {
  return registerApiProviderAuthFailureHandler((source, status) => {
    expireProviderAccount(source, new Error(`HTTP ${status}`))
  })
}
