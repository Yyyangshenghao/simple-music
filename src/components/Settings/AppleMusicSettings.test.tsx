import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppleMusicAccountStatus } from '../../stores/apple-music-connection'
import { AppleMusicAccountInfo, AppleMusicSettings } from './AppleMusicSettings'

const h = vi.hoisted(() => ({ account: null as AppleMusicAccountStatus | null, phase: 'idle' as 'idle' | 'opening' | 'waiting' | 'disconnecting' }))
vi.mock('../../stores/apple-music-connection', () => ({
  useAppleMusicConnection: () => ({
    account: h.account,
    phase: h.phase,
    message: '',
    error: false,
    refresh: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}))

const connected: AppleMusicAccountStatus = {
  loginMode: 'web',
  configured: false,
  ready: true,
  managed: false,
  loggedIn: true,
  connected: true,
  subscription: 'active',
  storefront: 'cn',
}

function renderSettings(): string {
  return renderToStaticMarkup(<><AppleMusicAccountInfo /><AppleMusicSettings /></>)
}

beforeEach(() => {
  h.account = null
  h.phase = 'idle'
})

describe('Apple Music 设置', () => {
  it.each([
    ['登录前', null],
    ['登录后', connected],
  ])('%s始终说明订阅与播放边界', (_, account) => {
    h.account = account
    const html = renderSettings()
    expect(html).toContain('role="tooltip"')
    expect(html).toContain('Apple Music 登录与订阅说明')
    expect(html).not.toContain('<section')

    if (account) {
      expect(html).toContain('订阅有效，可播放完整歌曲')
      expect(html).toContain('歌曲会直接在 Simple Music 内播放')
    } else {
      expect(html).toContain('完整播放需要有效的 Apple Music 订阅')
      expect(html).toContain('Apple 音源不会启用')
      expect(html).toContain('即可在 Simple Music 中选歌和播放')
    }
  })

  it('无订阅时直接显示原因并说明音源保持禁用', () => {
    h.account = { ...connected, subscription: 'inactive' }
    const html = renderSettings()
    expect(html).toContain('无有效订阅')
    expect(html).toContain('此账号没有有效的 Apple Music 订阅')
    expect(html).toContain('Apple 音源已保持禁用')
    expect(html).not.toContain('歌曲会直接在 Simple Music 内播放')
  })

  it('启动恢复期间提示恢复中，不误显示未登录', () => {
    h.account = { ...connected, loggedIn: false, connected: false, subscription: 'unknown', restoring: true }
    const html = renderSettings()
    expect(html).toContain('恢复登录中')
    expect(html).not.toContain('>未登录</span>')
    expect(html).toContain('disabled=""')
  })

  it('已连接时只提供退出图标，断线时保留重新连接入口', () => {
    h.account = connected
    const html = renderSettings()
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*aria-label="退出登录 Apple Music"/)
    expect(html).not.toContain('aria-label="登录 Apple Music"')
    h.account = { ...connected, connected: false }
    const disconnected = renderSettings()
    expect(disconnected).toContain('aria-label="重新连接 Apple Music"')
    expect(disconnected).toContain('aria-label="退出登录 Apple Music"')
  })

  it('等待授权时同一个图标允许取消，处理期间禁用', () => {
    h.phase = 'waiting'
    expect(renderSettings()).toMatch(/<button(?![^>]*disabled)[^>]*aria-label="取消登录 Apple Music"/)
    h.phase = 'opening'
    expect(renderSettings()).toMatch(/<button[^>]*disabled=""[^>]*>/)
  })
})
