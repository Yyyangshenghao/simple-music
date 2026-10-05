import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expireProviderAccount, initProviderAuthFailureSync, isProviderAuthFailure } from './provider-auth'
import { api } from '../lib/api'
import { useProviderStore } from './providers'
import { useSettingsStore } from './settings'
import { useToastStore } from './toast'

describe('provider auth expiry', () => {
  afterEach(() => {
    useToastStore.getState().dismiss()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    useToastStore.getState().dismiss()
    useSettingsStore.setState({ neteaseLoggedIn: true, qqLoggedIn: true })
    useProviderStore.setState({
      byId: {
        netease: { enabled: true, auth: 'authenticated' },
        qq: { enabled: true, auth: 'authenticated' },
        apple: { enabled: false, auth: 'anonymous' },
      },
      playbackOrder: ['netease', 'qq'],
    })
  })

  it('401/403 与结构化鉴权错误会识别，普通失败不会误伤账号', () => {
    expect(isProviderAuthFailure(new Error('HTTP 401'))).toBe(true)
    expect(isProviderAuthFailure(new Error('HTTP 403'))).toBe(true)
    expect(isProviderAuthFailure(new Error('AUTH_EXPIRED'))).toBe(true)
    expect(isProviderAuthFailure(new Error('REQUEST_TIMEOUT'))).toBe(false)
  })

  it('只让报错平台过期并停用，另一平台保持参与', () => {
    expect(expireProviderAccount('netease', new Error('HTTP 401'))).toBe(true)
    expect(useSettingsStore.getState().neteaseLoggedIn).toBe(false)
    expect(useProviderStore.getState().byId.netease).toMatchObject({ enabled: false, auth: 'expired' })
    expect(useProviderStore.getState().byId.qq).toMatchObject({ enabled: true, auth: 'authenticated' })
    expect(useSettingsStore.getState().qqLoggedIn).toBe(true)
    expect(useToastStore.getState().message).toBe('网易云登录已失效，请前往设置重新登录')
  })

  it('并发鉴权失败只提示一次，普通业务失败不弹登录失效', () => {
    const show = vi.spyOn(useToastStore.getState(), 'show')
    expect(expireProviderAccount('qq', new Error('HTTP 502'))).toBe(false)
    expect(show).not.toHaveBeenCalled()
    expireProviderAccount('qq', new Error('HTTP 401'))
    expireProviderAccount('qq', new Error('HTTP 403'))
    expect(show).toHaveBeenCalledTimes(1)
    expect(show).toHaveBeenCalledWith('QQ音乐登录已失效，请前往设置重新登录')
  })

  it.each([
    ['netease', '/api/song/detail', 401],
    ['qq', '/api/qq/playlist', 403],
    ['apple', '/api/apple-music/library', 401],
  ] as const)('%s 旧请求的鉴权失败不能停用新账号，业务层重复处理也应丢弃', async (source, path, status) => {
    useProviderStore.getState().setAccountState(source, 'authenticated')
    useProviderStore.getState().setEnabled(source, true)
    let respond!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { respond = resolve })))
    const dispose = initProviderAuthFailureSync()
    try {
      const request = api.get(path).catch((error: unknown) => error)
      // auth/profile 均相同时重新登录，也必须使上一次账号会话过期。
      useProviderStore.getState().setAccountState(source, 'authenticated')
      respond({ ok: false, status, json: async () => ({ error: 'AUTH_EXPIRED' }) })
      const error = await request

      expect(expireProviderAccount(source, error)).toBe(false)
      expect(useProviderStore.getState().byId[source]).toMatchObject({ enabled: true, auth: 'authenticated' })
      expect(useSettingsStore.getState().neteaseLoggedIn).toBe(true)
      expect(useSettingsStore.getState().qqLoggedIn).toBe(true)
      expect(useToastStore.getState().message).toBeNull()
    } finally {
      dispose()
    }
  })

  it('当前账号的 API 鉴权失败仍正常过期，平台启停不等于账号切换', async () => {
    let respond!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { respond = resolve })))
    const dispose = initProviderAuthFailureSync()
    try {
      const request = api.get('/api/song/detail').catch((error: unknown) => error)
      useProviderStore.getState().setEnabled('netease', false)
      useProviderStore.getState().setEnabled('netease', true)
      respond({ ok: false, status: 401 })
      await request
      expect(useProviderStore.getState().byId.netease.auth).toBe('expired')
      expect(useSettingsStore.getState().neteaseLoggedIn).toBe(false)
    } finally {
      dispose()
    }
  })
})
