import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { loginMusicProvider } from './provider-login'

const h = vi.hoisted(() => ({
  post: vi.fn(),
  settings: { setNeteaseLoggedIn: vi.fn(), setNeteaseProfile: vi.fn(), setQQLoggedIn: vi.fn(), setQQProfile: vi.fn() },
  setAccountState: vi.fn()
}))
vi.mock('./api', () => ({ api: { post: h.post } }))
vi.mock('../stores/settings', () => ({ useSettingsStore: { getState: () => h.settings } }))
vi.mock('../stores/providers', () => ({ useProviderStore: { getState: () => ({ setAccountState: h.setAccountState }) } }))

beforeEach(() => {
  vi.clearAllMocks()
  h.post.mockReset().mockResolvedValue({ avatar: 'avatar', nickname: 'nickname' })
  vi.stubGlobal('window', { desktop: {
    openNeteaseLogin: vi.fn().mockResolvedValue({ ok: true, cookie: 'test-cookie' }),
    openQQLogin: vi.fn().mockResolvedValue({ ok: true, cookie: 'test-cookie' })
  } })
})
afterEach(() => vi.unstubAllGlobals())

it.each(['netease', 'qq'] as const)('%s 登录使用对应窗口与接口，只更新对应音源状态', async (source) => {
  await loginMusicProvider(source)
  const netease = source === 'netease'
  expect(netease ? window.desktop?.openNeteaseLogin : window.desktop?.openQQLogin).toHaveBeenCalledOnce()
  expect(netease ? window.desktop?.openQQLogin : window.desktop?.openNeteaseLogin).not.toHaveBeenCalled()
  expect(h.post).toHaveBeenCalledWith(netease ? '/api/login/cookie' : '/api/qq/login/cookie', { cookie: 'test-cookie' })
  expect(netease ? h.settings.setNeteaseLoggedIn : h.settings.setQQLoggedIn).toHaveBeenCalledWith(true)
  expect(netease ? h.settings.setNeteaseProfile : h.settings.setQQProfile).toHaveBeenCalledWith('avatar', 'nickname')
  expect(netease ? h.settings.setQQLoggedIn : h.settings.setNeteaseLoggedIn).not.toHaveBeenCalled()
  expect(h.setAccountState).toHaveBeenCalledWith(source, 'authenticated', { avatar: 'avatar', nickname: 'nickname' })
})
it('取消登录不交换 Cookie 或改写账号状态', async () => {
  vi.mocked(window.desktop!.openNeteaseLogin).mockResolvedValue({ ok: false, cancelled: true })
  await loginMusicProvider('netease')
  expect(h.post).not.toHaveBeenCalled()
  expect(h.setAccountState).not.toHaveBeenCalled()
})
it('Cookie 交换失败不标记登录成功', async () => {
  h.post.mockRejectedValue(new Error('login failed'))
  await expect(loginMusicProvider('qq')).rejects.toThrow('login failed')
  expect(h.settings.setQQLoggedIn).not.toHaveBeenCalled()
  expect(h.setAccountState).not.toHaveBeenCalled()
})

it('原生窗口返回失败时报告错误，保留原账号状态', async () => {
  vi.mocked(window.desktop!.openQQLogin).mockResolvedValue({ ok: false, error: 'window load failed' })
  await expect(loginMusicProvider('qq')).rejects.toThrow('window load failed')
  expect(h.post).not.toHaveBeenCalled()
  expect(h.setAccountState).not.toHaveBeenCalled()
})
