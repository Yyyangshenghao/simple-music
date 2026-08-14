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
import { PROVIDER_IDS, type ProviderId } from '../providers/types'
import { clearProviderRequestCache } from '../lib/provider-request-cache'
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
  lastError?: string
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
  setAccountState(id: ProviderId, auth: ProviderAuthState, profile?: ProviderProfile): void
}

function runtimeMap(
  preferences: ProviderPreferences,
  previous?: Record<ProviderId, ProviderRuntimeState>
): Record<ProviderId, ProviderRuntimeState> {
  return {
    netease: {
      ...previous?.netease,
      enabled: preferences.providers.netease.enabled,
      auth: previous?.netease.auth ?? 'unknown',
    },
    qq: {
      ...previous?.qq,
      enabled: preferences.providers.qq.enabled,
      auth: previous?.qq.auth ?? 'unknown',
    },
  }
}

function preferencesOf(state: ProviderStore): ProviderPreferences {
  return {
    providers: {
      netease: { enabled: state.byId.netease.enabled },
      qq: { enabled: state.byId.qq.enabled },
    },
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
    if (enabled && get().byId[id].auth !== 'authenticated') return
    set((state) => {
      const byId = {
        ...state.byId,
        [id]: { ...state.byId[id], enabled },
      }
      const providers = {
        netease: { enabled: byId.netease.enabled },
        qq: { enabled: byId.qq.enabled },
      }
      return {
        byId,
        playbackOrder: normalizePlaybackOrder(state.playbackOrder, providers),
      }
    })
    clearProviderRequestCache(id)
    persist(get())
  },

  setPlaybackOrder(order) {
    set((state) => ({
      playbackOrder: normalizePlaybackOrder(order, {
        netease: { enabled: state.byId.netease.enabled },
        qq: { enabled: state.byId.qq.enabled },
      }),
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

  setAccountState(id, auth, profile) {
    set((state) => {
      const enabled = auth === 'authenticated' ? state.byId[id].enabled : false
      const byId = {
        ...state.byId,
        [id]: { ...state.byId[id], enabled, auth, profile },
      }
      return {
        byId,
        playbackOrder: normalizePlaybackOrder(state.playbackOrder, {
          netease: { enabled: byId.netease.enabled },
          qq: { enabled: byId.qq.enabled },
        }),
      }
    })
    clearProviderRequestCache(id)
    if (auth !== 'authenticated') persist(get())
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
  return state.enabled && state.auth === 'authenticated'
}

export function participatingProviderIds(): ProviderId[] {
  return PROVIDER_IDS.filter(isProviderParticipating)
}
