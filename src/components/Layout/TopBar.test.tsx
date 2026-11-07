import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderId } from '../../providers/types'
import type { AppView } from '../../stores/navigation'
import { useSettingsStore } from '../../stores/settings'
import { TopBar } from './TopBar'
import styles from './TopBar.module.css'

const state = vi.hoisted(() => ({ history: [] as AppView[], current: 'qq' as ProviderId | null, qqEnabled: true, view: 'explore' as AppView }))

vi.mock('../../stores/navigation', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/navigation')>()
  const store = original.useNavigationStore
  return { ...original, useNavigationStore: Object.assign(
    (selector: (value: ReturnType<typeof store.getState>) => unknown) => selector({ ...store.getState(), currentView: state.view, history: state.history }), store
  ) }
})

vi.mock('../../hooks/useContentProvider', () => ({
  useContentProvider: () => ({ current: state.current }),
}))
vi.mock('../../stores/settings', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/settings')>()
  const store = original.useSettingsStore
  return { ...original, useSettingsStore: Object.assign(
    (selector: (value: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()), store
  ) }
})
vi.mock('../../stores/providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/providers')>()
  return { ...original, useProviderStore: Object.assign(
    (selector: (value: unknown) => unknown) => selector({ byId: {
      qq: { enabled: state.qqEnabled, auth: 'authenticated' },
      netease: { enabled: true, auth: 'authenticated' },
      apple: { enabled: false, auth: 'anonymous' },
      qishui: { enabled: false, auth: 'authenticated' }, kugou: { enabled: false, auth: 'authenticated' }, bilibili: { enabled: false, auth: 'anonymous' },
    } }), original.useProviderStore
  ) }
})

describe('顶栏搜索入口与导航', () => {
  beforeEach(() => {
    state.current = 'qq'
    state.qqEnabled = true
    state.view = 'explore'
    state.history = []
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('搜索入口属于主导航，顶栏无需搜索输入框', () => {
    const html = renderToStaticMarkup(<TopBar />)
    const navigation = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'))
    expect(navigation).toContain('>搜索</span>')
    expect(html).not.toContain('role="search"')
    expect(html).not.toContain('<input')
  })

  it('搜索打开的歌手详情保持搜索导航选中', () => {
    state.history = [{ type: 'search', keyword: '晴天' }]
    state.view = { type: 'artist', source: 'qq', id: '1' }
    const html = renderToStaticMarkup(<TopBar />)
    expect(html.match(/<button[^>]*aria-current="page"[^>]*>.*?<\/button>/)?.[0]).toContain('搜索')
  })

  it('更新日志页面归属设置导航，不误选探索', () => {
    state.view = 'release-history'
    const html = renderToStaticMarkup(<TopBar />)
    const navigation = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'))
    const active = navigation.match(/<button[^>]*aria-current="page"[^>]*>.*?<\/button>/)?.[0]
    expect(active).toContain('设置')
    expect(active).not.toContain('探索')
  })

  it('按设置顺序展示菜单，全部关闭时仍保留账号入口', () => {
    const { topMenu } = useSettingsStore.getState()
    const render = () => renderToStaticMarkup(<TopBar />)
    try {
      useSettingsStore.setState({ topMenu: [{ id: 'library', enabled: true }, { id: 'explore', enabled: false }, { id: 'search', enabled: true }] })
      const html = render()
      const navigation = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'))
      expect(navigation).toMatch(/>我的库<.*>搜索</)
      expect(navigation).not.toContain('探索')
      useSettingsStore.setState({ topMenu: topMenu.map(item => ({ ...item, enabled: false })) })
      const hidden = render()
      expect(hidden).not.toContain('aria-label="主导航"')
      expect(hidden).toContain('aria-label="音源与账号')
    } finally {
      useSettingsStore.setState({ topMenu })
    }
  })
})

describe('顶栏为自绘窗口按钮留白', () => {
  // Windows 和 Linux 都是无边框窗口，WindowChrome 会在右上角画最小化/最大化/关闭；
  // 顶栏必须同时留出这段宽度，否则最右边的关闭按钮压在头像上，点头像会关掉窗口。
  it.each([
    ['win32', true],
    ['linux', true],
    ['darwin', false],
    [undefined, false]
  ] as const)('%s 平台是否预留窗口按钮宽度：%s', (platform, reserved) => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      desktop: platform ? { platform } : undefined
    })
    const html = renderToStaticMarkup(<TopBar />)
    expect(html.includes(styles.barCaption)).toBe(reserved)
  })
})
