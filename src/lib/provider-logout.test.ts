import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { logoutMusicProvider } from './provider-logout'
import { advanceProviderAccountSession } from './provider-account-session'

const h = vi.hoisted(() => ({
  post: vi.fn(),
  settings: { setNeteaseLoggedIn: vi.fn(), setQQLoggedIn: vi.fn() },
  setAccountState: vi.fn(),
}))
vi.mock('./api', () => ({ api: { post: h.post } }))
vi.mock('../stores/settings', () => ({ useSettingsStore: { getState: () => h.settings } }))
vi.mock('../stores/providers', () => ({ useProviderStore: { getState: () => ({ setAccountState: h.setAccountState }) } }))

beforeEach(() => {
  vi.clearAllMocks()
  h.post.mockReset().mockResolvedValue({ ok: true })
  vi.stubGlobal('window', { desktop: {
    clearNeteaseLogin: vi.fn().mockResolvedValue({ ok: true }),
    clearQQLogin: vi.fn().mockResolvedValue({ ok: true }),
  } })
})
afterEach(() => vi.unstubAllGlobals())

it.each(['netease', 'qq'] as const)('%s 退出清除对应窗口和 API 会话，不影响另一音源', async source => {
  await logoutMusicProvider(source)
  const netease = source === 'netease'
  expect(netease ? window.desktop?.clearNeteaseLogin : window.desktop?.clearQQLogin).toHaveBeenCalledOnce()
  expect(netease ? window.desktop?.clearQQLogin : window.desktop?.clearNeteaseLogin).not.toHaveBeenCalled()
  expect(h.post).toHaveBeenCalledWith(netease ? '/api/logout' : '/api/qq/logout')
  expect(netease ? h.settings.setNeteaseLoggedIn : h.settings.setQQLoggedIn).toHaveBeenCalledWith(false)
  expect(netease ? h.settings.setQQLoggedIn : h.settings.setNeteaseLoggedIn).not.toHaveBeenCalled()
  expect(h.setAccountState).toHaveBeenCalledWith(source, 'anonymous')
})

it('清除完成前保留账号状态，避免展示虚假的退出成功', async () => {
  let finish!: () => void
  h.post.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const pending = logoutMusicProvider('netease')
  expect(h.setAccountState).not.toHaveBeenCalled()
  finish()
  await pending
  expect(h.setAccountState).toHaveBeenCalledWith('netease', 'anonymous')
})

it.each(['api', 'window'])('%s 清除失败时保留退出入口并报告错误', async target => {
  if (target === 'api') h.post.mockRejectedValue(new Error('logout failed'))
  else vi.mocked(window.desktop!.clearQQLogin).mockRejectedValue(new Error('logout failed'))
  await expect(logoutMusicProvider('qq')).rejects.toThrow('logout failed')
  expect(h.settings.setQQLoggedIn).not.toHaveBeenCalled()
  expect(h.setAccountState).not.toHaveBeenCalled()
})

it('切到其他入口重新登录后，旧退出回调不覆盖新账号', async () => {
  let finish!: () => void
  h.post.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const pending = logoutMusicProvider('qq')
  advanceProviderAccountSession('qq')
  finish()
  await pending
  expect(h.settings.setQQLoggedIn).not.toHaveBeenCalled()
  expect(h.setAccountState).not.toHaveBeenCalled()
})
