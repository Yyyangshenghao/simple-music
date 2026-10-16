import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from '../stores/providers'
import { useLikesStore } from '../stores/likes'
import { useNavigationStore } from '../stores/navigation'
import { LibraryPage } from './LibraryPage'
import { clearProviderRequestCache, requestProviderData } from '../lib/provider-request-cache'
import type { Playlist } from '../types/domain'

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

vi.mock('../stores/likes', async (importOriginal) => {
  const original = await importOriginal<typeof import('../stores/likes')>()
  const store = original.useLikesStore
  return { ...original, useLikesStore: Object.assign(
    (selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()),
    store
  ) }
})

describe('我的库账号失效提示', () => {
  beforeEach(() => {
    clearProviderRequestCache()
    useLikesStore.setState({ likedByKey: {}, qqMutationRevision: 0 })
    content.current = null
    useNavigationStore.setState({ currentView: 'library', history: [], future: [] })
    useProviderStore.setState({ byId: {
      netease: { enabled: false, auth: 'anonymous' },
      qq: { enabled: false, auth: 'expired' },
      apple: { enabled: false, auth: 'anonymous' },
    } })
  })

  it('切回歌单时首帧复用已缓存内容，不显示加载空档', async () => {
    content.current = 'qq'
    useProviderStore.setState(state => ({ byId: { ...state.byId, qq: { enabled: true, auth: 'authenticated' } } }))
    const playlist: Playlist = { id: 1, source: 'qq', provider: 'qq', type: 'playlist', name: '缓存歌单', cover: '', trackCount: 870, playCount: 0, creator: '' }
    await requestProviderData('qq', 'library:user-playlists:0', async () => [playlist])
    const html = renderToStaticMarkup(<LibraryPage />)
    expect(html).toContain('缓存歌单')
    expect(html).not.toContain('加载中…')
    clearProviderRequestCache('qq')
    expect(renderToStaticMarkup(<LibraryPage />)).not.toContain('缓存歌单')
  })

  it('QQ 红心写成功后首帧读取新版本的库缓存，不再展示旧歌单数量', async () => {
    content.current = 'qq'
    useProviderStore.setState(state => ({ byId: { ...state.byId, qq: { enabled: true, auth: 'authenticated' } } }))
    const playlist: Playlist = { id: 'qq-liked:201', source: 'qq', provider: 'qq', type: 'playlist', name: '写入前的收藏', cover: '', trackCount: 1, playCount: 0, creator: '' }
    await requestProviderData('qq', 'library:user-playlists:0', async () => [playlist])
    expect(renderToStaticMarkup(<LibraryPage />)).toContain('写入前的收藏')

    useLikesStore.setState({ qqMutationRevision: 1 })
    expect(renderToStaticMarkup(<LibraryPage />)).not.toContain('写入前的收藏')
    await requestProviderData('qq', 'library:user-playlists:1', async () => [{ ...playlist, name: '写入后的收藏', trackCount: 2 }])

    const html = renderToStaticMarkup(<LibraryPage />)
    expect(html).toContain('写入后的收藏')
    expect(html).toContain('>2 首<')
    expect(html).not.toContain('>1 首<')
    expect(html).not.toContain('写入前的收藏')
    expect(html).not.toContain('加载中…')
  })

  it('QQ 版本更新前发起的库请求迟到也不污染新版本首帧', async () => {
    content.current = 'qq'
    useProviderStore.setState(state => ({ byId: { ...state.byId, qq: { enabled: true, auth: 'authenticated' } } }))
    const playlist: Playlist = { id: 'qq-liked:201', source: 'qq', provider: 'qq', type: 'playlist', name: '新的收藏入口', cover: '', trackCount: 2, playCount: 0, creator: '' }
    let finish!: (value: Playlist[]) => void
    const oldRequest = requestProviderData('qq', 'library:user-playlists:0', () => new Promise(resolve => { finish = resolve }))
    useLikesStore.setState({ qqMutationRevision: 1 })
    await requestProviderData('qq', 'library:user-playlists:1', async () => [playlist])
    finish([{ ...playlist, name: '迟到的旧收藏入口', trackCount: 1 }])
    await oldRequest

    const html = renderToStaticMarkup(<LibraryPage />)
    expect(html).toContain('新的收藏入口')
    expect(html).not.toContain('迟到的旧收藏入口')
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
