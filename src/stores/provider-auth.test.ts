import { beforeEach, describe, expect, it } from 'vitest'
import { expireProviderAccount, isProviderAuthFailure } from './provider-auth'
import { useProviderStore } from './providers'
import { useSettingsStore } from './settings'

describe('provider auth expiry', () => {
  beforeEach(() => {
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
  })
})
