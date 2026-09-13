import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expireProviderAccount, isProviderAuthFailure } from './provider-auth'
import { useProviderStore } from './providers'
import { useSettingsStore } from './settings'
import { useToastStore } from './toast'

describe('provider auth expiry', () => {
  afterEach(() => {
    useToastStore.getState().dismiss()
    vi.restoreAllMocks()
  })
  beforeEach(() => {
    useToastStore.getState().dismiss()
    useSettingsStore.setState({ neteaseLoggedIn: true, qqLoggedIn: true })
    useProviderStore.setState({
      byId: {
        netease: { enabled: true, auth: 'authenticated' },
        qq: { enabled: true, auth: 'authenticated' },
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
})
