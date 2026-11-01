import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const sessions = new Map<string, { setProxy: ReturnType<typeof vi.fn> }>()
  const defaultSession = { setProxy: vi.fn(async () => {}) }
  const fromPartition = vi.fn((partition: string) => {
    const existing = sessions.get(partition)
    if (existing) return existing
    const created = { setProxy: vi.fn(async () => {}) }
    sessions.set(partition, created)
    return created
  })
  return { defaultSession, fromPartition, sessions }
})
vi.mock('electron', () => ({ session: { defaultSession: h.defaultSession, fromPartition: h.fromPartition } }))

import { applySessionProxy } from './session-proxy'
import { DEFAULT_PROXY_SETTINGS } from '../../server/lib/proxy-config'

beforeEach(() => {
  vi.clearAllMocks()
  h.sessions.clear()
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

  it('Apple 分区可用独立出口，其余会话仍走默认', async () => {
    await applySessionProxy({ mode: 'custom', url: 'http://127.0.0.1:7890', apple: 'direct', appleUrl: '' })
    expect(h.defaultSession.setProxy).toHaveBeenCalledWith({ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7890', proxyBypassRules: 'localhost,127.0.0.1,::1' })
    expect(h.sessions.get('persist:simplemusic-apple-music')!.setProxy).toHaveBeenCalledWith({ mode: 'direct' })
    expect(h.sessions.get('persist:simplemusic-netease-login')!.setProxy).toHaveBeenCalledWith({
      mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7890', proxyBypassRules: 'localhost,127.0.0.1,::1',
    })
  })

  it('跟随系统时不写死规则', async () => {
    await applySessionProxy({ ...DEFAULT_PROXY_SETTINGS, mode: 'system' })
    expect(h.defaultSession.setProxy).toHaveBeenCalledWith({ mode: 'system' })
  })
})
