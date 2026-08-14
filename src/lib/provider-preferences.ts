import { PROVIDER_IDS, isProviderId, type ProviderId } from '../providers/types'

export const PROVIDER_SETTINGS_STORAGE_KEY = 'simplemusic-provider-settings'
export const PROVIDER_SETTINGS_SCHEMA = 2

export interface ProviderPreference {
  enabled: boolean
}

export type SourceBadgeMode = 'always' | 'dynamic' | 'hidden'

export interface ProviderPreferences {
  providers: Record<ProviderId, ProviderPreference>
  playbackOrder: ProviderId[]
  preferOriginSource: boolean
  multiSourceFallback: boolean
  sourceBadgeMode: SourceBadgeMode
}

export interface ProviderSettingsArchive extends ProviderPreferences {
  schema: typeof PROVIDER_SETTINGS_SCHEMA
}

export interface LegacyProviderSettings {
  activeSource?: unknown
  crossSourceFallback?: unknown
}

export function readLegacyProviderSettings(raw: string | null): LegacyProviderSettings {
  if (!raw) return {}
  try {
    const parsed = asObject(JSON.parse(raw) as unknown)
    return {
      activeSource: parsed?.activeSource,
      crossSourceFallback: parsed?.crossSourceFallback,
    }
  } catch {
    return {}
  }
}

export const DEFAULT_PROVIDER_PREFERENCES: ProviderPreferences = {
  providers: {
    netease: { enabled: true },
    qq: { enabled: true },
  },
  playbackOrder: ['netease', 'qq'],
  preferOriginSource: true,
  multiSourceFallback: true,
  sourceBadgeMode: 'dynamic',
}

function enabledIds(providers: Record<ProviderId, ProviderPreference>): ProviderId[] {
  return PROVIDER_IDS.filter((id) => providers[id].enabled)
}

export function normalizePlaybackOrder(
  order: readonly unknown[],
  providers: Record<ProviderId, ProviderPreference>
): ProviderId[] {
  const enabled = new Set(enabledIds(providers))
  const seen = new Set<ProviderId>()
  const normalized: ProviderId[] = []
  for (const value of order) {
    if (!isProviderId(value) || !enabled.has(value) || seen.has(value)) continue
    seen.add(value)
    normalized.push(value)
  }
  for (const id of PROVIDER_IDS) {
    if (enabled.has(id) && !seen.has(id)) normalized.push(id)
  }
  return normalized
}

export function migrateLegacyProviderSettings(legacy: LegacyProviderSettings): ProviderPreferences {
  const first = isProviderId(legacy.activeSource) ? legacy.activeSource : 'netease'
  return {
    providers: {
      netease: { enabled: first === 'netease' },
      qq: { enabled: first === 'qq' },
    },
    playbackOrder: [first],
    preferOriginSource: true,
    multiSourceFallback:
      typeof legacy.crossSourceFallback === 'boolean' ? legacy.crossSourceFallback : true,
    sourceBadgeMode: 'dynamic',
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

export function normalizeProviderPreferences(
  value: unknown,
  fallback: ProviderPreferences = DEFAULT_PROVIDER_PREFERENCES
): ProviderPreferences {
  const raw = asObject(value)
  const rawProviders = asObject(raw?.providers)
  const providers = {} as Record<ProviderId, ProviderPreference>
  for (const id of PROVIDER_IDS) {
    const item = asObject(rawProviders?.[id])
    providers[id] = {
      enabled: typeof item?.enabled === 'boolean' ? item.enabled : fallback.providers[id].enabled,
    }
  }
  const rawOrder = Array.isArray(raw?.playbackOrder) ? raw.playbackOrder : fallback.playbackOrder
  return {
    providers,
    playbackOrder: normalizePlaybackOrder(rawOrder, providers),
    preferOriginSource:
      typeof raw?.preferOriginSource === 'boolean'
        ? raw.preferOriginSource
        : fallback.preferOriginSource,
    multiSourceFallback:
      typeof raw?.multiSourceFallback === 'boolean'
        ? raw.multiSourceFallback
        : fallback.multiSourceFallback,
    sourceBadgeMode:
      raw?.sourceBadgeMode === 'always' || raw?.sourceBadgeMode === 'dynamic' || raw?.sourceBadgeMode === 'hidden'
        ? raw.sourceBadgeMode
        : fallback.sourceBadgeMode,
  }
}

export function readProviderSettings(raw: string | null, legacy: LegacyProviderSettings): ProviderPreferences {
  const migrated = migrateLegacyProviderSettings(legacy)
  if (!raw) return migrated
  try {
    const parsed = JSON.parse(raw) as unknown
    const archive = asObject(parsed)
    if (archive?.schema !== PROVIDER_SETTINGS_SCHEMA) return migrated
    return normalizeProviderPreferences(archive, migrated)
  } catch {
    return migrated
  }
}

export function toProviderSettingsArchive(preferences: ProviderPreferences): ProviderSettingsArchive {
  return {
    schema: PROVIDER_SETTINGS_SCHEMA,
    ...normalizeProviderPreferences(preferences),
  }
}
