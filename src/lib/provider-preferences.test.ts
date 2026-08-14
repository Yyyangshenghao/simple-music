import { describe, expect, it } from 'vitest'
import {
  PROVIDER_SETTINGS_SCHEMA,
  migrateLegacyProviderSettings,
  normalizePlaybackOrder,
  normalizeProviderPreferences,
  readLegacyProviderSettings,
  readProviderSettings,
  toProviderSettingsArchive,
} from './provider-preferences'

describe('provider preferences', () => {
  it('只从 1.x 原始设置提取迁移字段，坏存档安全回退', () => {
    expect(readLegacyProviderSettings(JSON.stringify({
      activeSource: 'qq',
      crossSourceFallback: false,
      themeMode: 'dark',
    }))).toEqual({ activeSource: 'qq', crossSourceFallback: false })
    expect(readLegacyProviderSettings('{bad')).toEqual({})
    expect(readLegacyProviderSettings(null)).toEqual({})
  })

  it.each([
    ['netease', true, ['netease', 'qq']],
    ['netease', false, ['netease', 'qq']],
    ['qq', true, ['qq', 'netease']],
    ['qq', false, ['qq', 'netease']],
  ] as const)('从 1.x 迁移 activeSource=%s fallback=%s', (activeSource, fallback, order) => {
    const result = migrateLegacyProviderSettings({ activeSource, crossSourceFallback: fallback })
    expect(result.providers).toEqual({
      netease: { enabled: activeSource === 'netease' },
      qq: { enabled: activeSource === 'qq' },
    })
    expect(result.playbackOrder).toEqual([order[0]])
    expect(result.preferOriginSource).toBe(true)
    expect(result.multiSourceFallback).toBe(fallback)
    expect(result.sourceBadgeMode).toBe('dynamic')
  })

  it('顺序归一化会删除禁用项和重复项，并补齐已启用音源', () => {
    const providers = { netease: { enabled: true }, qq: { enabled: true } }
    expect(normalizePlaybackOrder(['qq', 'qq', 'unknown'], providers)).toEqual(['qq', 'netease'])
    expect(normalizePlaybackOrder(['qq'], { ...providers, qq: { enabled: false } })).toEqual(['netease'])
  })

  it('已存在的新 schema 优先于旧设置，并归一化损坏字段', () => {
    const raw = JSON.stringify({
      schema: PROVIDER_SETTINGS_SCHEMA,
      providers: { netease: { enabled: true }, qq: { enabled: false } },
      playbackOrder: ['qq', 'netease', 'netease'],
      preferOriginSource: false,
      multiSourceFallback: false,
      sourceBadgeMode: 'dynamic',
    })
    const result = readProviderSettings(raw, { activeSource: 'qq', crossSourceFallback: true })
    expect(result).toEqual({
      providers: { netease: { enabled: true }, qq: { enabled: false } },
      playbackOrder: ['netease'],
      preferOriginSource: false,
      multiSourceFallback: false,
      sourceBadgeMode: 'dynamic',
    })
  })

  it('未知 schema 或坏 JSON 回退到旧设置迁移', () => {
    const legacy = { activeSource: 'qq', crossSourceFallback: false }
    expect(readProviderSettings('{bad', legacy)).toEqual(migrateLegacyProviderSettings(legacy))
    expect(readProviderSettings(JSON.stringify({ schema: 99 }), legacy)).toEqual(
      migrateLegacyProviderSettings(legacy)
    )
  })

  it('序列化后重复读取幂等', () => {
    const preferences = normalizeProviderPreferences({
      providers: { netease: { enabled: false }, qq: { enabled: true } },
      playbackOrder: ['qq'],
      preferOriginSource: false,
      multiSourceFallback: true,
      sourceBadgeMode: 'hidden',
    })
    const raw = JSON.stringify(toProviderSettingsArchive(preferences))
    expect(readProviderSettings(raw, {})).toEqual(preferences)
  })
})
