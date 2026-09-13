import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderId } from '../../providers/types'
import { TopBar } from './TopBar'

const state = vi.hoisted(() => ({ current: 'qq' as ProviderId | null, qqEnabled: true }))

vi.mock('../../hooks/useContentProvider', () => ({
  useContentProvider: () => ({ current: state.current }),
}))
vi.mock('../../stores/providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/providers')>()
  return { ...original, useProviderStore: Object.assign(
    (selector: (value: unknown) => unknown) => selector({ byId: {
      qq: { enabled: state.qqEnabled, auth: 'authenticated' },
      netease: { enabled: true, auth: 'authenticated' },
    } }), original.useProviderStore
  ) }
})

describe('搜索热搜入口跟随当前内容平台', () => {
  beforeEach(() => {
    state.current = 'qq'
    state.qqEnabled = true
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('当前 QQ 支持热搜时展示入口', () => {
    const html = renderToStaticMarkup(<TopBar />)
    expect(html).toContain('aria-label="QQ音乐热搜"')
    expect(html).toContain('搜索歌曲、歌手</span>')
  })

  it('切到网易云后不借用仍已启用的 QQ 热搜', () => {
    state.current = 'netease'
    const html = renderToStaticMarkup(<TopBar />)
    expect(html).toContain('aria-label="网易云热搜"')
    expect(html).not.toContain('aria-label="QQ音乐热搜"')
  })

  it('当前平台尚未确定时不提前显示其他平台热搜', () => {
    state.current = null
    expect(renderToStaticMarkup(<TopBar />)).not.toContain('>热搜</span>')
  })

  it('QQ 禁用后不显示热搜', () => {
    state.qqEnabled = false
    expect(renderToStaticMarkup(<TopBar />)).not.toContain('>热搜</span>')
  })
})
