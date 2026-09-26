import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppleMusicAccountStatus } from '../../stores/apple-music-connection'
import { AppleMusicSettings } from './AppleMusicSettings'

const h = vi.hoisted(() => ({ account: null as AppleMusicAccountStatus | null }))
vi.mock('../../stores/apple-music-connection', () => ({
  useAppleMusicConnection: () => ({
    account: h.account,
    phase: 'idle',
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

beforeEach(() => {
  h.account = null
})

describe('Apple Music 设置', () => {
  it.each([
    ['登录前', null],
    ['登录后', connected],
  ])('%s始终说明订阅与播放边界', (_, account) => {
    h.account = account
    const html = renderToStaticMarkup(<AppleMusicSettings />)

    if (account) {
      expect(html).toContain('订阅有效，可播放完整歌曲')
      expect(html).toContain('歌曲会直接在 Simple Music 内播放')
    } else {
      expect(html).toContain('完整播放需要有效的 Apple Music 订阅')
      expect(html).toContain('Apple 音源不会启用')
      expect(html).toContain('无需保留外部浏览器')
    }
  })

  it('无订阅时直接显示原因并说明音源保持禁用', () => {
    h.account = { ...connected, subscription: 'inactive' }
    const html = renderToStaticMarkup(<AppleMusicSettings />)
    expect(html).toContain('无有效订阅')
    expect(html).toContain('此账号没有有效的 Apple Music 订阅')
    expect(html).toContain('Apple 音源已保持禁用')
    expect(html).not.toContain('歌曲会直接在 Simple Music 内播放')
  })
})
