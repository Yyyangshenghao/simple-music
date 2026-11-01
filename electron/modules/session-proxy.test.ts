import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const sessions = new Map<string, { setProxy: ReturnType<typeof vi.fn>; forceReloadProxyConfig: ReturnType<typeof vi.fn>; resolveProxy: ReturnType<typeof vi.fn> }>()
  const make = () => ({ setProxy: vi.fn(async () => {}), forceReloadProxyConfig: vi.fn(async () => {}), resolveProxy: vi.fn(async () => 'DIRECT') })
  const defaultSession = make()
  const fromPartition = vi.fn((partition: string) => {
    const existing = sessions.get(partition)
    if (existing) return existing
    const created = make()
    sessions.set(partition, created)
    return created
  })
  return { defaultSession, fromPartition, sessions, app: null as unknown as EventEmitter, power: null as unknown as EventEmitter }
})
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  h.app = new EventEmitter()
  h.power = new EventEmitter()
  return { app: h.app, powerMonitor: h.power, session: { defaultSession: h.defaultSession, fromPartition: h.fromPartition } }
})

import { applySessionProxy, credentialsForProxy, registerProxyAuth, resolveSystemProxy, watchSystemProxy } from './session-proxy'
import { DEFAULT_PROXY_SETTINGS } from '../../server/lib/proxy-config'

const probe = () => h.fromPartition('simplemusic-proxy-probe')

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('会话代理', () => {
  it('默认出口同步到主窗口、登录窗口与播放宿主', async () => {
    await applySessionProxy({ ...DEFAULT_PROXY_SETTINGS, mode: 'direct' })
    expect(h.defaultSession.setProxy).toHaveBeenCalledWith({ mode: 'direct' })
    for (const partition of ['persist:simplemusic-netease-login', 'persist:simplemusic-qqmusic-login', 'persist:simplemusic-playback-v1', 'persist:simplemusic-apple-music']) {
      expect(h.fromPartition).toHaveBeenCalledWith(partition)
      expect(h.sessions.get(partition)!.setProxy).toHaveBeenCalled()
    }
  })

  it('Apple 分区可用独立出口，其余会话仍走默认；规则里不带账号密码', async () => {
    await applySessionProxy({ mode: 'custom', url: 'http://u:p@127.0.0.1:7890', apple: 'direct', appleUrl: '' })
    const fixed = { mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7890', proxyBypassRules: 'localhost,127.0.0.1,::1,<local>' }
    expect(h.defaultSession.setProxy).toHaveBeenCalledWith(fixed)
    expect(h.sessions.get('persist:simplemusic-apple-music')!.setProxy).toHaveBeenCalledWith({ mode: 'direct' })
    expect(h.sessions.get('persist:simplemusic-netease-login')!.setProxy).toHaveBeenCalledWith(fixed)
  })

  it('跟随系统时不写死规则', async () => {
    await applySessionProxy({ ...DEFAULT_PROXY_SETTINGS, mode: 'system' })
    expect(h.defaultSession.setProxy).toHaveBeenCalledWith({ mode: 'system' })
  })
})

describe('系统代理', () => {
  it('在独立探测分区里按系统模式解析，并强制重读配置', async () => {
    probe().resolveProxy.mockResolvedValueOnce('PROXY 127.0.0.1:7890; DIRECT')
    expect(await resolveSystemProxy()).toBe('http://127.0.0.1:7890')
    expect(probe().setProxy).toHaveBeenCalledWith({ mode: 'system' })
    expect(probe().forceReloadProxyConfig).toHaveBeenCalled()
    // 用户的自定义代理不影响探测分区。
    await applySessionProxy({ ...DEFAULT_PROXY_SETTINGS, mode: 'custom', url: 'http://127.0.0.1:1' })
    probe().resolveProxy.mockResolvedValueOnce('DIRECT')
    expect(await resolveSystemProxy()).toBe('')
  })

  it('定时、获焦与唤醒时重读，变化才回调，停止后解绑', async () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    probe().resolveProxy.mockResolvedValue('DIRECT')
    const stop = watchSystemProxy(onChange)
    await vi.advanceTimersByTimeAsync(0)
    expect(onChange).toHaveBeenCalledWith('')

    probe().resolveProxy.mockResolvedValue('PROXY 127.0.0.1:7897')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(onChange).toHaveBeenLastCalledWith('http://127.0.0.1:7897')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(onChange).toHaveBeenCalledTimes(2)

    probe().resolveProxy.mockResolvedValue('DIRECT')
    await vi.advanceTimersByTimeAsync(6_000)
    h.app.emit('browser-window-focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(onChange).toHaveBeenLastCalledWith('')

    stop()
    expect(h.app.listenerCount('browser-window-focus')).toBe(0)
    expect(h.power.listenerCount('resume')).toBe(0)
  })
})

describe('代理认证', () => {
  it('只给用户自己填写的代理送账号密码', () => {
    const settings = { mode: 'custom' as const, url: 'http://u:p@127.0.0.1:7890', apple: 'custom' as const, appleUrl: 'http://a:b@10.0.0.2:3128' }
    expect(credentialsForProxy(settings, '127.0.0.1', 7890)).toMatchObject({ username: 'u', password: 'p' })
    expect(credentialsForProxy(settings, '10.0.0.2', 3128)).toMatchObject({ username: 'a', password: 'b' })
    expect(credentialsForProxy(settings, '127.0.0.1', 7891)).toBeNull()
    expect(credentialsForProxy({ ...settings, mode: 'system' }, '127.0.0.1', 7890)).toBeNull()
  })

  it('响应代理的 login 事件，短时间反复失败后不再重试', async () => {
    await applySessionProxy({ ...DEFAULT_PROXY_SETTINGS, mode: 'custom', url: 'http://u:p@127.0.0.1:7890' })
    registerProxyAuth()
    registerProxyAuth()
    expect(h.app.listenerCount('login')).toBe(1)
    const fire = (isProxy = true) => {
      const event = { preventDefault: vi.fn() }
      const callback = vi.fn()
      h.app.emit('login', event, null, {}, { isProxy, host: '127.0.0.1', port: 7890 }, callback)
      return { event, callback }
    }
    expect(fire(false).callback).not.toHaveBeenCalled()
    const first = fire()
    expect(first.event.preventDefault).toHaveBeenCalled()
    expect(first.callback).toHaveBeenCalledWith('u', 'p')
    fire()
    fire()
    expect(fire().callback).not.toHaveBeenCalled()
  })
})
