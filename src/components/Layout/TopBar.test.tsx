import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderId } from '../../providers/types'
import type { AppView } from '../../stores/navigation'
import { TopBar } from './TopBar'

const state = vi.hoisted(() => ({ current: 'qq' as ProviderId | null, qqEnabled: true, view: 'explore' as AppView }))

vi.mock('../../stores/navigation', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/navigation')>()
  const store = original.useNavigationStore
  return { ...original, useNavigationStore: Object.assign(
    (selector: (value: ReturnType<typeof store.getState>) => unknown) => selector({ ...store.getState(), currentView: state.view }), store
  ) }
})

vi.mock('../../hooks/useContentProvider', () => ({
  useContentProvider: () => ({ current: state.current }),
}))
vi.mock('../../stores/providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/providers')>()
  return { ...original, useProviderStore: Object.assign(
    (selector: (value: unknown) => unknown) => selector({ byId: {
      qq: { enabled: state.qqEnabled, auth: 'authenticated' },
      netease: { enabled: true, auth: 'authenticated' },
      apple: { enabled: false, auth: 'anonymous' },
    } }), original.useProviderStore
  ) }
})

describe('顶栏搜索入口与导航', () => {
  beforeEach(() => {
    state.current = 'qq'
    state.qqEnabled = true
    state.view = 'explore'
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(['qq', 'netease', null] as const)('当前平台为 %s 时，搜索入口只展示图标并保留无障碍名称', (source) => {
    state.current = source
    const html = renderToStaticMarkup(<TopBar />)
    const search = html.match(/<div[^>]*role="search"[^>]*>(.*?)<\/div>/)?.[1]
    expect(html).toContain('aria-label="搜索歌曲、歌手"')
    expect(search).toContain('<svg')
    expect(search?.replace(/<[^>]*>/g, '').trim()).toBe('')
  })

  it('更新日志页面归属设置导航，不误选探索', () => {
    state.view = 'release-history'
    const html = renderToStaticMarkup(<TopBar />)
    const navigation = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'))
    const active = navigation.match(/<button[^>]*aria-current="page"[^>]*>.*?<\/button>/)?.[0]
    expect(active).toContain('设置')
    expect(active).not.toContain('探索')
  })
})
