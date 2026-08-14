import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROVIDER_SETTINGS_SCHEMA, PROVIDER_SETTINGS_STORAGE_KEY } from '../lib/provider-preferences'
import { CONTENT_PROVIDER_STORAGE_KEY } from '../lib/content-provider-preference'
import { SETTINGS_STORAGE_KEY, useSettingsStore } from './settings'
import { enabledProviderIds, initProviderStore, participatingProviderIds, useProviderStore } from './providers'

let dispose: (() => void) | null = null
let storage: Record<string, string>

function resetStores(): void {
  useSettingsStore.setState({
    neteaseLoggedIn: false,
    neteaseAvatar: '',
    neteaseNickname: '',
    qqLoggedIn: false,
    qqAvatar: '',
    qqNickname: '',
  })
  useProviderStore.setState({
    byId: {
      netease: { enabled: true, auth: 'authenticated' },
      qq: { enabled: true, auth: 'authenticated' },
    },
    playbackOrder: ['netease', 'qq'],
    preferOriginSource: true,
    multiSourceFallback: true,
    sourceBadgeMode: 'dynamic',
    contentSource: null,
  })
}

describe('provider store', () => {
  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
      removeItem: (key: string) => { delete storage[key] },
    })
    resetStores()
  })

  afterEach(() => {
    dispose?.()
    dispose = null
    vi.unstubAllGlobals()
  })

  it('首次初始化迁移旧设置、备份原文并写入新 schema', () => {
    useSettingsStore.setState({
      neteaseLoggedIn: true,
      qqLoggedIn: true,
    })
    storage[SETTINGS_STORAGE_KEY] = JSON.stringify({ activeSource: 'qq', crossSourceFallback: false })

    dispose = initProviderStore()

    expect(useProviderStore.getState().playbackOrder).toEqual(['qq'])
    expect(useProviderStore.getState().multiSourceFallback).toBe(false)
    expect(storage[`${SETTINGS_STORAGE_KEY}-v1-backup`]).toBe(storage[SETTINGS_STORAGE_KEY])
    expect(JSON.parse(storage[PROVIDER_SETTINGS_STORAGE_KEY]).schema).toBe(PROVIDER_SETTINGS_SCHEMA)
  })

  it('已有新设置优先，初始化不会被旧 activeSource 覆盖', () => {
    storage[PROVIDER_SETTINGS_STORAGE_KEY] = JSON.stringify({
      schema: PROVIDER_SETTINGS_SCHEMA,
      providers: { netease: { enabled: true }, qq: { enabled: false } },
      playbackOrder: ['netease'],
      preferOriginSource: false,
      multiSourceFallback: false,
    })
    useSettingsStore.setState({ neteaseLoggedIn: true })
    storage[SETTINGS_STORAGE_KEY] = JSON.stringify({ activeSource: 'qq', themeMode: 'dark' })

    dispose = initProviderStore()

    expect(enabledProviderIds()).toEqual(['netease'])
    expect(useProviderStore.getState().playbackOrder).toEqual(['netease'])
    expect(useProviderStore.getState().preferOriginSource).toBe(false)
    expect(useProviderStore.getState().multiSourceFallback).toBe(false)
    expect(storage[`${SETTINGS_STORAGE_KEY}-v1-backup`]).toBe(storage[SETTINGS_STORAGE_KEY])
  })

  it('全局内容平台兼容旧探索偏好并独立持久化', () => {
    storage['simplemusic-explore-provider'] = 'qq'
    dispose = initProviderStore()
    expect(useProviderStore.getState().contentSource).toBe('qq')

    useProviderStore.getState().setContentSource('netease')
    expect(storage[CONTENT_PROVIDER_STORAGE_KEY]).toBe('netease')
  })

  it('启用状态与播放顺序保持不变量', () => {
    const store = useProviderStore.getState()
    store.setEnabled('qq', false)
    expect(enabledProviderIds()).toEqual(['netease'])
    expect(useProviderStore.getState().playbackOrder).toEqual(['netease'])

    useProviderStore.getState().setEnabled('netease', false)
    expect(enabledProviderIds()).toEqual([])
    expect(useProviderStore.getState().playbackOrder).toEqual([])

    useProviderStore.getState().setEnabled('qq', true)
    expect(enabledProviderIds()).toEqual(['qq'])
    expect(useProviderStore.getState().playbackOrder).toEqual(['qq'])
  })

  it('未登录平台不能启用，退出登录会自动停用', () => {
    useProviderStore.getState().setAccountState('qq', 'anonymous')
    useProviderStore.getState().setEnabled('qq', true)
    expect(useProviderStore.getState().byId.qq.enabled).toBe(false)
    expect(participatingProviderIds()).toEqual(['netease'])

    useProviderStore.getState().setAccountState('qq', 'authenticated')
    expect(useProviderStore.getState().byId.qq.enabled).toBe(false)
    useProviderStore.getState().setEnabled('qq', true)
    expect(participatingProviderIds()).toEqual(['netease', 'qq'])
  })

  it('启动核实登录态前保留启用偏好，权威未登录结果才自动停用', () => {
    storage[PROVIDER_SETTINGS_STORAGE_KEY] = JSON.stringify({
      schema: PROVIDER_SETTINGS_SCHEMA,
      providers: { netease: { enabled: true }, qq: { enabled: false } },
      playbackOrder: ['netease'],
      preferOriginSource: true,
      multiSourceFallback: true,
      sourceBadgeMode: 'dynamic',
    })
    useProviderStore.setState((state) => ({
      byId: {
        netease: { ...state.byId.netease, auth: 'unknown' },
        qq: { ...state.byId.qq, auth: 'unknown' },
      },
    }))

    dispose = initProviderStore()
    expect(useProviderStore.getState().byId.netease).toMatchObject({ enabled: true, auth: 'unknown' })

    useProviderStore.getState().setAccountState('netease', 'anonymous')
    expect(useProviderStore.getState().byId.netease.enabled).toBe(false)
  })

  it('通用设置里的账号兼容字段不再反向改写平台运行态', () => {
    dispose = initProviderStore()
    useSettingsStore.setState({
      qqLoggedIn: true,
      qqAvatar: 'avatar',
      qqNickname: 'nickname',
    })

    expect(useProviderStore.getState().byId.qq).toMatchObject({ enabled: false, auth: 'authenticated' })
    expect(useProviderStore.getState().playbackOrder).toEqual(['netease'])
    expect(useProviderStore.getState().multiSourceFallback).toBe(true)

    dispose()
    dispose = null
    useSettingsStore.setState({ qqLoggedIn: false })
    expect(useProviderStore.getState().byId.qq.auth).toBe('authenticated')
  })

  it('重复初始化幂等，cleanup 无副作用', () => {
    storage[SETTINGS_STORAGE_KEY] = JSON.stringify({
      activeSource: 'netease',
      crossSourceFallback: true,
    })

    const firstDispose = initProviderStore()
    const firstArchive = storage[PROVIDER_SETTINGS_STORAGE_KEY]
    const firstBackup = storage[`${SETTINGS_STORAGE_KEY}-v1-backup`]
    dispose = initProviderStore()
    firstDispose()

    expect(storage[PROVIDER_SETTINGS_STORAGE_KEY]).toBe(firstArchive)
    expect(storage[`${SETTINGS_STORAGE_KEY}-v1-backup`]).toBe(firstBackup)

    expect(useProviderStore.getState().playbackOrder[0]).toBe('netease')
    expect(useProviderStore.getState().multiSourceFallback).toBe(true)

    dispose()
    dispose = null
    expect(useProviderStore.getState().playbackOrder[0]).toBe('netease')
  })
})
