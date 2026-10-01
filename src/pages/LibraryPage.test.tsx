import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from '../stores/providers'
import { useNavigationStore } from '../stores/navigation'
import { LibraryPage } from './LibraryPage'

const content = vi.hoisted(() => ({ current: null as 'apple' | 'qq' | null }))
vi.mock('../hooks/useContentProvider', () => ({
  useContentProvider: () => ({ current: content.current, sources: [], select: vi.fn() }),
}))

// 静态渲染默认读取 Zustand 初始快照；此处使用当前状态模拟账号请求完成后的重渲染。
vi.mock('../stores/providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../stores/providers')>()
  const store = original.useProviderStore
  return { ...original, useProviderStore: Object.assign(
    (selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()),
    store
  ) }
})

describe('我的库账号失效提示', () => {
  beforeEach(() => {
    content.current = null
    useNavigationStore.setState({ currentView: 'library', history: [], future: [] })
    useProviderStore.setState({ byId: {
      netease: { enabled: false, auth: 'anonymous' },
      qq: { enabled: false, auth: 'expired' },
      apple: { enabled: false, auth: 'anonymous' },
    } })
  })

  it('QQ 失效后仍给出明确说明和重新登录入口', () => {
    const html = renderToStaticMarkup(<LibraryPage />)
    expect(html).toContain('QQ音乐登录已失效')
    expect(html).toContain('前往设置重新登录')
    expect(html).not.toContain('没有已启用的在线音乐平台')
  })

  it('未登录不误报为登录失效', () => {
    useProviderStore.getState().setAccountState('qq', 'anonymous')
    const html = renderToStaticMarkup(<LibraryPage />)
    expect(html).toContain('没有已启用的在线音乐平台')
    expect(html).not.toContain('登录已失效')
    expect(html).toContain('>离线音乐</button>')
  })

  it('Apple Music 提供独立专辑入口，其他平台不显示空入口', () => {
    content.current = 'apple'
    const apple = renderToStaticMarkup(<LibraryPage />)
    expect(apple).toContain('>专辑</button>')
    content.current = 'qq'
    expect(renderToStaticMarkup(<LibraryPage />)).not.toContain('>专辑</button>')
  })

  it('Apple 播放器断开时不展示可点的资料库，并提示重新连接', () => {
    content.current = 'apple'
    useProviderStore.setState(state => ({ byId: {
      ...state.byId,
      apple: { enabled: true, auth: 'authenticated', playbackAvailable: false },
    } }))
    const html = renderToStaticMarkup(<LibraryPage />)
    expect(html).toContain('Apple Music 暂时不可用')
    expect(html).toContain('前往设置重新连接')
    expect(html).not.toContain('加载中…')
  })
})
