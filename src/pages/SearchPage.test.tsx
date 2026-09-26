import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchPage } from './SearchPage'
import { useProviderStore } from '../stores/providers'
import { useNavigationStore } from '../stores/navigation'

vi.mock('../stores/providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../stores/providers')>()
  const store = original.useProviderStore
  return { ...original, useProviderStore: Object.assign(
    (selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()), store
  ) }
})

describe('聚合搜索页面', () => {
  beforeEach(() => {
    useProviderStore.setState({ byId: {
      netease: { enabled: true, auth: 'authenticated' },
      qq: { enabled: true, auth: 'authenticated' },
      apple: { enabled: false, auth: 'anonymous' },
    } })
    useNavigationStore.setState({ currentView: 'explore', history: [], future: [] })
  })

  it('默认聚合已启用且已登录的平台，首屏提供独立加载提示', () => {
    const html = renderToStaticMarkup(<SearchPage keyword="周杰伦" />)
    expect(html).toContain('在 2 个音乐平台中发现歌曲与歌手')
    expect(html).toContain('全部平台')
    expect(html).toContain('网易云')
    expect(html).toContain('QQ音乐')
    expect(html).not.toContain('Apple Music')
    expect(html).toContain('正在寻找相关歌手')
    expect(html).toContain('正在搜索各平台的歌曲')
    expect(html).not.toContain('没有找到相关歌曲')
  })

  it('无可用平台时引导设置，不显示误导的无结果或加载状态', () => {
    useProviderStore.setState({ byId: {
      netease: { enabled: false, auth: 'authenticated' },
      qq: { enabled: true, auth: 'expired' },
      apple: { enabled: true, auth: 'anonymous' },
    } })
    const html = renderToStaticMarkup(<SearchPage keyword="晴天" />)
    expect(html).toContain('请先登录并启用至少一个音乐平台')
    expect(html).toContain('前往设置')
    expect(html).not.toContain('搜索中')
  })

  it('搜索词作为文本显示', () => {
    const html = renderToStaticMarkup(<SearchPage keyword="<script>alert(1)</script>" />)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('搜索词随导航历史保留，支持歌手页返回和前进', () => {
    const navigation = useNavigationStore.getState()
    navigation.navigateTo({ type: 'search', keyword: '晴天' })
    navigation.navigateTo({ type: 'artist', id: '1', source: 'qq' })
    navigation.goBack()
    expect(useNavigationStore.getState().currentView).toEqual({ type: 'search', keyword: '晴天' })
    navigation.goBack()
    expect(useNavigationStore.getState().currentView).toBe('explore')
    navigation.goForward()
    expect(useNavigationStore.getState().currentView).toEqual({ type: 'search', keyword: '晴天' })
  })
})
