import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONTENT_PROVIDER_STORAGE_KEY,
  LEGACY_EXPLORE_PROVIDER_STORAGE_KEY,
  readContentProviderPreference,
  resolveContentProvider,
  shouldPersistResolvedContentProvider,
  writeContentProviderPreference,
  CONTENT_PROVIDER_IDS,
} from './content-provider-preference'

describe('content provider preference', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
  })

  it('优先读取全局偏好，并兼容探索页和 1.x 旧选择', () => {
    storage.set(LEGACY_EXPLORE_PROVIDER_STORAGE_KEY, 'qq')
    expect(readContentProviderPreference('netease')).toBe('qq')

    storage.set(CONTENT_PROVIDER_STORAGE_KEY, 'netease')
    expect(readContentProviderPreference('qq')).toBe('netease')

    storage.set(CONTENT_PROVIDER_STORAGE_KEY, 'unknown')
    expect(readContentProviderPreference()).toBeNull()
  })

  it('保存全局内容平台', () => {
    writeContentProviderPreference('qq')
    expect(storage.get(CONTENT_PROVIDER_STORAGE_KEY)).toBe('qq')
  })

  it('汽水有本机内容入口后可选择并恢复为内容平台，哔哩哔哩仍走搜索', () => {
    expect(CONTENT_PROVIDER_IDS).toContain('qishui')
    expect(CONTENT_PROVIDER_IDS).not.toContain('bilibili')
    writeContentProviderPreference('qishui')
    expect(readContentProviderPreference()).toBe('qishui')
    const byId = Object.fromEntries(['netease', 'qq', 'apple', 'kugou', 'qishui', 'bilibili'].map(source => [source, { enabled: source === 'qishui', auth: 'authenticated' }])) as Parameters<typeof resolveContentProvider>[1]
    expect(resolveContentProvider('qishui', byId)).toBe('qishui')
    expect(resolveContentProvider(null, byId)).toBe('qishui')
  })

  it('保留待核实的选择，并在失效后回退到参与平台', () => {
    const pending = {
      netease: { enabled: true, auth: 'authenticated' },
      qq: { enabled: true, auth: 'unknown' },
      apple: { enabled: false, auth: 'anonymous' }, qishui: { enabled: false, auth: 'anonymous' }, kugou: { enabled: false, auth: 'authenticated' }, bilibili: { enabled: false, auth: 'anonymous' },
    }
    expect(resolveContentProvider('qq', pending)).toBeNull()
    const temporaryFallback = resolveContentProvider('qq', pending, false)
    expect(temporaryFallback).toBe('netease')
    expect(shouldPersistResolvedContentProvider('qq', temporaryFallback, pending)).toBe(false)

    const invalid = {
      netease: { enabled: true, auth: 'authenticated' },
      qq: { enabled: false, auth: 'anonymous' },
      apple: { enabled: false, auth: 'anonymous' }, qishui: { enabled: false, auth: 'anonymous' }, kugou: { enabled: false, auth: 'authenticated' }, bilibili: { enabled: false, auth: 'anonymous' },
    }
    const stableFallback = resolveContentProvider('qq', invalid)
    expect(stableFallback).toBe('netease')
    expect(shouldPersistResolvedContentProvider('qq', stableFallback, invalid)).toBe(true)
  })
})
