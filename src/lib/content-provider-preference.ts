import { PROVIDER_IDS, isProviderId, type ProviderId } from '../providers/types'

export const CONTENT_PROVIDER_STORAGE_KEY = 'simplemusic-content-provider'
export const LEGACY_EXPLORE_PROVIDER_STORAGE_KEY = 'simplemusic-explore-provider'

interface ContentProviderRuntime {
  enabled: boolean
  auth: string
}

export function readContentProviderPreference(legacySource?: unknown): ProviderId | null {
  if (typeof localStorage === 'undefined') return isProviderId(legacySource) ? legacySource : null
  try {
    const value = localStorage.getItem(CONTENT_PROVIDER_STORAGE_KEY)
      ?? localStorage.getItem(LEGACY_EXPLORE_PROVIDER_STORAGE_KEY)
      ?? legacySource
    return isProviderId(value) ? value : null
  } catch {
    return isProviderId(legacySource) ? legacySource : null
  }
}

export function writeContentProviderPreference(source: ProviderId): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CONTENT_PROVIDER_STORAGE_KEY, source)
  } catch {
    /* 内容平台偏好写盘失败不影响当前会话 */
  }
}

export function resolveContentProvider(
  preferred: ProviderId | null,
  byId: Record<ProviderId, ContentProviderRuntime>,
  waitForPreferred = true
): ProviderId | null {
  if (preferred) {
    const current = byId[preferred]
    if (current.enabled && current.auth === 'authenticated') return preferred
    // 启动时先等用户上次选择的平台完成登录态核实，避免被更早返回的平台抢走偏好。
    if (waitForPreferred && current.enabled && current.auth === 'unknown') return null
  }
  return PROVIDER_IDS.find((source) => {
    const runtime = byId[source]
    return runtime.enabled && runtime.auth === 'authenticated'
  }) ?? null
}

export function shouldPersistResolvedContentProvider(
  preferred: ProviderId | null,
  current: ProviderId | null,
  byId: Record<ProviderId, ContentProviderRuntime>
): current is ProviderId {
  if (!current || current === preferred) return false
  if (!preferred) return true
  const runtime = byId[preferred]
  return !runtime.enabled || runtime.auth !== 'unknown'
}
