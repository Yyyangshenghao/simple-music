import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  get: vi.fn(),
  refresh: vi.fn(async (_signal?: AbortSignal) => {}),
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
vi.mock('../lib/api', () => ({ api: { get: h.get } }))
vi.mock('../stores/settings', () => ({ useSettingsStore: { getState: () => h.settings } }))
vi.mock('../stores/providers', () => ({ useProviderStore: { getState: () => h.providers } }))
vi.mock('../stores/apple-music-connection', () => ({ useAppleMusicConnection: { getState: () => ({ refresh: h.refresh }) } }))
import { initLoginStatusSync } from './login-status-sync'
import { useGameModeStore } from '../stores/game-mode'
import { advanceProviderAccountSession } from './provider-account-session'

const replies = new Map<string, (value: { loggedIn: boolean; avatar?: string; nickname?: string }) => void>()
let cleanup: (() => void) | undefined
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  useGameModeStore.setState({ enabled: false })
  replies.clear()
  for (const source of ['netease', 'qq'] as const) {
    h.providers.byId[source] = { auth: 'unknown', enabled: true, profile: undefined }
  }
  h.get.mockImplementation((path: string) => new Promise((resolve) => replies.set(path, resolve)))
  cleanup = initLoginStatusSync()
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

it('宿主停止后取消请求，不再改写账号或继续轮询 Apple 状态', async () => {
  cleanup?.()
  replies.get('/api/login/status')?.({ loggedIn: true })
  replies.get('/api/qq/login/status')?.({ loggedIn: true })
  await flush()
  vi.advanceTimersByTime(6000)
  expect(h.providers.setAccountState).not.toHaveBeenCalled()
  expect(h.refresh).toHaveBeenCalledOnce()
  expect(h.get.mock.calls.every(call => call[2].signal.aborted)).toBe(true)
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

it('游戏模式暂停 Apple 账户界面轮询，迟到刷新不能重建定时器', async () => {
  cleanup?.()
  await flush()
  h.refresh.mockClear()
  useGameModeStore.setState({ enabled: true })
  cleanup = initLoginStatusSync()
  await flush()
  vi.advanceTimersByTime(6000)
  expect(h.refresh).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['netease', 'qq'] as const)('%s 账号退出后状态回到初值，仍丢弃先前会话的迟到登录结果', async source => {
  advanceProviderAccountSession(source)
  advanceProviderAccountSession(source)
  replies.get(source === 'netease' ? '/api/login/status' : '/api/qq/login/status')?.({ loggedIn: true, nickname: 'old-account' })
  await flush()
  expect(h.providers.setAccountState).not.toHaveBeenCalled()
})

it('无界面轮询且重复启动不重查，进入游戏取消在途请求，退出后仅保留新一轮', async () => {
  await flush()
  expect(initLoginStatusSync()).toBe(cleanup)
  expect(h.get).toHaveBeenCalledTimes(2)
  expect(h.refresh).toHaveBeenCalledOnce()
  let finish!: () => void
  h.refresh.mockImplementationOnce(() => new Promise<void>(done => { finish = done }))
  await vi.advanceTimersByTimeAsync(3000)
  const oldSignal = h.refresh.mock.lastCall?.[0] as AbortSignal
  expect(oldSignal.aborted).toBe(false)
  useGameModeStore.setState({ enabled: true })
  expect(oldSignal.aborted).toBe(true)
  useGameModeStore.setState({ enabled: false })
  await flush()
  expect(h.refresh).toHaveBeenCalledTimes(3)
  finish()
  await flush()
  await vi.advanceTimersByTimeAsync(3000)
  expect(h.refresh).toHaveBeenCalledTimes(4)
  cleanup?.()
  expect(vi.getTimerCount()).toBe(0)
})
