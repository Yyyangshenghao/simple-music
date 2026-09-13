import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from '../stores/providers'
import { useNavigationStore } from '../stores/navigation'
import { LibraryPage } from './LibraryPage'

vi.mock('../hooks/useContentProvider', () => ({
  useContentProvider: () => ({ current: null, sources: [], select: vi.fn() }),
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
    useNavigationStore.setState({ currentView: 'library', history: [], future: [] })
    useProviderStore.setState({ byId: {
      netease: { enabled: false, auth: 'anonymous' },
      qq: { enabled: false, auth: 'expired' },
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
  })
})
