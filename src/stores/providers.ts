import { create } from 'zustand'
import {
  DEFAULT_PROVIDER_PREFERENCES,
  PROVIDER_SETTINGS_STORAGE_KEY,
  normalizePlaybackOrder,
  readLegacyProviderSettings,
  readProviderSettings,
  toProviderSettingsArchive,
  type ProviderPreferences,
  type SourceBadgeMode,
} from '../lib/provider-preferences'
import { PROVIDER_IDS, hasGuestSession, isFallbackOnlyProvider, isGuestLoginProvider, type ProviderId } from '../providers/types'
import { clearProviderRequestCache } from '../lib/provider-request-cache'
import { advanceProviderAccountSession } from '../lib/provider-account-session'
import {
  readContentProviderPreference,
  writeContentProviderPreference,
} from '../lib/content-provider-preference'
import { SETTINGS_STORAGE_KEY } from './settings'

const LEGACY_BACKUP_STORAGE_KEY = `${SETTINGS_STORAGE_KEY}-v1-backup`

export type ProviderAuthState = 'unknown' | 'anonymous' | 'authenticated' | 'expired'

export interface ProviderProfile {
  avatar: string
  nickname: string
}

export interface ProviderRuntimeState {
  enabled: boolean
  auth: ProviderAuthState
  profile?: ProviderProfile
  playbackAvailable?: boolean
  lastError?: string
  /** 可选登录平台（酷狗、汽水）是否已登录账号；未登录时仍以游客会话参与。 */
  accountLinked?: boolean
}

interface ProviderStore extends Omit<ProviderPreferences, 'providers'> {
  byId: Record<ProviderId, ProviderRuntimeState>
  contentSource: ProviderId | null
  setEnabled(id: ProviderId, enabled: boolean): void
  setPlaybackOrder(order: ProviderId[]): void
  setPreferOriginSource(enabled: boolean): void
  setMultiSourceFallback(enabled: boolean): void
  setSourceBadgeMode(mode: SourceBadgeMode): void
  setContentSource(source: ProviderId): void
  setAccountState(id: ProviderId, auth: ProviderAuthState, profile?: ProviderProfile, options?: { preserveEnabled?: boolean }): void
  setPlaybackAvailability(id: ProviderId, available: boolean, message?: string): void
}

function runtimeMap(
  preferences: ProviderPreferences,
  previous?: Record<ProviderId, ProviderRuntimeState>
): Record<ProviderId, ProviderRuntimeState> {
  const map = {} as Record<ProviderId, ProviderRuntimeState>
  for (const id of PROVIDER_IDS) {
    map[id] = {
      ...(hasGuestSession(id) ? GUEST_SESSION : undefined),
      ...previous?.[id],
      enabled: preferences.providers[id].enabled,
      // 游客平台（含可选登录的酷狗和汽水）会话始终可用；兜底平台没有账号，只用游客接口。
      auth: hasGuestSession(id) ? 'authenticated' : isFallbackOnlyProvider(id) ? 'anonymous' : previous?.[id].auth ?? 'unknown',
    }
  }
  return map
}

// 游客平台没有账号，按“已就绪的游客会话”参与，复用各处已登录判断。
const GUEST_SESSION = { profile: { avatar: '', nickname: '游客' } }

function enabledMap(byId: Record<ProviderId, ProviderRuntimeState>): Record<ProviderId, { enabled: boolean }> {
  const map = {} as Record<ProviderId, { enabled: boolean }>
  for (const id of PROVIDER_IDS) map[id] = { enabled: byId[id].enabled }
  return map
}

function preferencesOf(state: ProviderStore): ProviderPreferences {
  return {
    providers: enabledMap(state.byId),
    playbackOrder: state.playbackOrder,
    preferOriginSource: state.preferOriginSource,
    multiSourceFallback: state.multiSourceFallback,
    sourceBadgeMode: state.sourceBadgeMode,
  }
}

function persist(state: ProviderStore): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      PROVIDER_SETTINGS_STORAGE_KEY,
      JSON.stringify(toProviderSettingsArchive(preferencesOf(state)))
    )
  } catch {
    /* provider 偏好写盘失败不影响当前会话 */
  }
}

function initialRuntime(): Record<ProviderId, ProviderRuntimeState> {
  return runtimeMap(DEFAULT_PROVIDER_PREFERENCES)
}

export const useProviderStore = create<ProviderStore>((set, get) => ({
  byId: initialRuntime(),
  playbackOrder: [...DEFAULT_PROVIDER_PREFERENCES.playbackOrder],
  preferOriginSource: DEFAULT_PROVIDER_PREFERENCES.preferOriginSource,
  multiSourceFallback: DEFAULT_PROVIDER_PREFERENCES.multiSourceFallback,
  sourceBadgeMode: DEFAULT_PROVIDER_PREFERENCES.sourceBadgeMode,
  contentSource: null,

  setEnabled(id, enabled) {
    if (enabled && ((!isFallbackOnlyProvider(id) && get().byId[id].auth !== 'authenticated') || get().byId[id].playbackAvailable === false)) return
    clearProviderRequestCache(id)
    set((state) => {
      const byId = {
        ...state.byId,
        [id]: { ...state.byId[id], enabled },
      }
      return {
        byId,
        playbackOrder: normalizePlaybackOrder(state.playbackOrder, enabledMap(byId)),
      }
    })
    persist(get())
  },

  setPlaybackOrder(order) {
    set((state) => ({
      playbackOrder: normalizePlaybackOrder(order, enabledMap(state.byId)),
    }))
    persist(get())
  },

  setPreferOriginSource(enabled) {
    set({ preferOriginSource: enabled })
    persist(get())
  },

  setMultiSourceFallback(enabled) {
    set({ multiSourceFallback: enabled })
    persist(get())
  },

  setSourceBadgeMode(mode) {
    set({ sourceBadgeMode: mode })
    persist(get())
  },

  setContentSource(source) {
    set({ contentSource: source })
    writeContentProviderPreference(source)
  },

  setAccountState(id, auth, profile, options) {
    if (isGuestLoginProvider(id)) {
      // 账号登出或失效只退回游客会话，平台参与与播放顺序保持不变。
      const linked = auth === 'authenticated'
      const current = get().byId[id]
      const nextProfile = linked && profile ? profile : GUEST_SESSION.profile
      if (current.accountLinked === linked && current.profile?.nickname === nextProfile.nickname && current.profile?.avatar === nextProfile.avatar) return
      advanceProviderAccountSession(id)
      clearProviderRequestCache(id)
      set((state) => ({
        byId: { ...state.byId, [id]: { ...state.byId[id], auth: 'authenticated', accountLinked: linked, profile: nextProfile } },
      }))
      return
    }
    advanceProviderAccountSession(id)
    // 同步通知页面前先失效缓存，避免新账号首帧读取上个会话的数据。
    clearProviderRequestCache(id)
    set((state) => {
      const enabled = auth === 'authenticated' || options?.preserveEnabled ? state.byId[id].enabled : false
      const byId = {
        ...state.byId,
        [id]: { ...state.byId[id], enabled, auth, profile,
          ...(auth === 'authenticated' ? {} : { playbackAvailable: undefined, lastError: undefined }) },
      }
      return {
        byId,
        playbackOrder: normalizePlaybackOrder(state.playbackOrder, enabledMap(byId)),
      }
    })
    if (auth !== 'authenticated') persist(get())
  },

  setPlaybackAvailability(id, available, message) {
    const current = get().byId[id]
    const lastError = available ? undefined : message
    if (current.playbackAvailable === available && current.lastError === lastError) return
    clearProviderRequestCache(id)
    set((state) => ({
      byId: {
        ...state.byId,
        [id]: { ...state.byId[id], playbackAvailable: available, lastError },
      },
    }))
  },
}))

function hydrate(preferences: ProviderPreferences, contentSource: ProviderId | null): void {
  useProviderStore.setState((state) => ({
    byId: runtimeMap(preferences, state.byId),
    playbackOrder: [...preferences.playbackOrder],
    preferOriginSource: preferences.preferOriginSource,
    multiSourceFallback: preferences.multiSourceFallback,
    sourceBadgeMode: preferences.sourceBadgeMode,
    contentSource,
  }))
}

export function initProviderStore(): () => void {
  const raw = typeof localStorage === 'undefined'
    ? null
    : localStorage.getItem(PROVIDER_SETTINGS_STORAGE_KEY)
  const legacyRaw = typeof localStorage === 'undefined'
    ? null
    : localStorage.getItem(SETTINGS_STORAGE_KEY)
  const legacy = readLegacyProviderSettings(legacyRaw)
  const preferences = readProviderSettings(raw, legacy)
  hydrate(preferences, readContentProviderPreference(legacy.activeSource))
  // 启动时账号仍为 unknown；各平台登录状态请求完成后会分别写入权威结果，避免互相误伤。

  if (typeof localStorage !== 'undefined') {
    try {
      if (legacyRaw && !localStorage.getItem(LEGACY_BACKUP_STORAGE_KEY)) {
        localStorage.setItem(LEGACY_BACKUP_STORAGE_KEY, legacyRaw)
      }
      persist(useProviderStore.getState())
    } catch {
      /* 备份或写盘失败不阻断启动 */
    }
  }

  return () => {}
}

export function enabledProviderIds(): ProviderId[] {
  const state = useProviderStore.getState()
  return PROVIDER_IDS.filter((id) => state.byId[id].enabled)
}

export function isProviderParticipating(id: ProviderId): boolean {
  const state = useProviderStore.getState().byId[id]
  return state.enabled && (state.auth === 'authenticated' || isFallbackOnlyProvider(id)) && state.playbackAvailable !== false
}

export function participatingProviderIds(): ProviderId[] {
  return PROVIDER_IDS.filter(isProviderParticipating)
}
