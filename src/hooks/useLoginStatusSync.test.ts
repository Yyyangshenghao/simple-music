import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  get: vi.fn(),
  refresh: vi.fn(async () => {}),
  settings: {
    setNeteaseLoggedIn: vi.fn(), setNeteaseProfile: vi.fn(),
    setQQLoggedIn: vi.fn(), setQQProfile: vi.fn()
  },
  providers: {
    byId: {
      netease: { auth: 'unknown', enabled: true, profile: undefined as { avatar: string; nickname: string } | undefined },
      qq: { auth: 'unknown', enabled: true, profile: undefined as { avatar: string; nickname: string } | undefined }
    },
    setAccountState: vi.fn()
  }
}))
vi.mock('react', () => ({ useEffect: (effect: () => void | (() => void)) => h.effects.push(effect) }))
vi.mock('../lib/api', () => ({ api: { get: h.get } }))
vi.mock('../stores/settings', () => ({ useSettingsStore: { getState: () => h.settings } }))
vi.mock('../stores/providers', () => ({ useProviderStore: { getState: () => h.providers } }))
vi.mock('../stores/apple-music-connection', () => ({ useAppleMusicConnection: { getState: () => ({ refresh: h.refresh }) } }))
import { useLoginStatusSync } from './useLoginStatusSync'

const replies = new Map<string, (value: { loggedIn: boolean; avatar?: string; nickname?: string }) => void>()
let cleanup: (() => void) | undefined
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  h.effects = []
  replies.clear()
  for (const source of ['netease', 'qq'] as const) {
    h.providers.byId[source] = { auth: 'unknown', enabled: true, profile: undefined }
  }
  h.get.mockImplementation((path: string) => new Promise((resolve) => replies.set(path, resolve)))
  useLoginStatusSync()
  cleanup = h.effects[0]() || undefined
})
afterEach(() => { cleanup?.(); vi.useRealTimers() })

it.each(['netease', 'qq'] as const)('%s 登录成功后丢弃迟到的启动未登录状态', async (source) => {
  h.providers.byId[source] = { auth: 'authenticated', enabled: true, profile: { avatar: 'new-avatar', nickname: 'new-account' } }
  replies.get(source === 'netease' ? '/api/login/status' : '/api/qq/login/status')?.({ loggedIn: false })
  await flush()
  expect(h.providers.setAccountState).not.toHaveBeenCalled()
  expect(source === 'netease' ? h.settings.setNeteaseLoggedIn : h.settings.setQQLoggedIn).not.toHaveBeenCalled()
})

it.each(['netease', 'qq'] as const)('%s 注销后丢弃迟到的启动已登录状态', async (source) => {
  h.providers.byId[source] = { auth: 'anonymous', enabled: false, profile: undefined }
  replies.get(source === 'netease' ? '/api/login/status' : '/api/qq/login/status')?.({ loggedIn: true, nickname: 'old-account' })
  await flush()
  expect(h.providers.setAccountState).not.toHaveBeenCalled()
  expect(source === 'netease' ? h.settings.setNeteaseLoggedIn : h.settings.setQQLoggedIn).not.toHaveBeenCalled()
})

it('卸载后不再改写账号或继续轮询 Apple 状态', async () => {
  cleanup?.()
  replies.get('/api/login/status')?.({ loggedIn: true })
  replies.get('/api/qq/login/status')?.({ loggedIn: true })
  await flush()
  vi.advanceTimersByTime(6000)
  expect(h.providers.setAccountState).not.toHaveBeenCalled()
  expect(h.refresh).toHaveBeenCalledOnce()
})

it('设置水合与停用音源不丢弃有效检测，也不把用户停用偏好改回启用', async () => {
  // App 的设置水合在请求发出后运行，会替换 runtime 对象，但保留账号身份。
  h.providers.byId.netease = { ...h.providers.byId.netease, enabled: false }
  h.providers.setAccountState.mockImplementationOnce((source: 'netease', auth: string, profile: { avatar: string; nickname: string }) => {
    h.providers.byId[source] = { ...h.providers.byId[source], auth, profile }
  })
  replies.get('/api/login/status')?.({ loggedIn: true, nickname: 'existing-account' })
  await flush()
  expect(h.settings.setNeteaseLoggedIn).toHaveBeenCalledWith(true)
  expect(h.providers.byId.netease).toMatchObject({ auth: 'authenticated', enabled: false })
})
