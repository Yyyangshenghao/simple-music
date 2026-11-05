import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppleChartPage, mergeAppleChartPage } from './AppleChartPage'
import { useProviderStore } from '../stores/providers'
import type { Playlist, Track } from '../types/domain'

vi.mock('../components/Explore/PlaylistPreviewModal', () => ({ PlaylistPreviewModal: () => null }))
vi.mock('../stores/providers', async (original) => {
  const module = await original<typeof import('../stores/providers')>()
  return { ...module, useProviderStore: Object.assign((selector: (state: ReturnType<typeof module.useProviderStore.getState>) => unknown) => selector(module.useProviderStore.getState()), module.useProviderStore) }
})

const initial = useProviderStore.getState()
afterEach(() => useProviderStore.setState(initial))

describe('AppleChartPage', () => {
  const track = (id: string): Track => ({ provider: 'apple', source: 'apple', type: 'song', id, name: id, artist: '歌手', artists: [] })
  const album = (id: string): Playlist => ({ provider: 'apple', source: 'apple', type: 'album', id, name: id, cover: '', trackCount: 10, playCount: 0, creator: '歌手' })

  it('上游更换游标但重复返回歌曲或集合时停止分页，已有榜单保留', () => {
    const tracks = [track('1')]
    const collections = [album('a')]
    const current = { tracks, collections, nextCursor: 'page-2', cursors: ['page-1'] }
    for (const incoming of [
      { tracks: [track('1'), track('1')], collections: [] },
      { tracks: [], collections: [album('a'), album('a')] },
      { tracks: [], collections: [] },
    ]) {
      const merged = mergeAppleChartPage(current, { ...incoming, nextCursor: 'page-3' }, 'page-2')
      expect(merged.tracks).toEqual(tracks)
      expect(merged.collections).toEqual(collections)
      expect(merged.nextCursor).toBeUndefined()
    }
  })

  it('只有新增内容且游标未循环时允许继续，单页重复项目只加入一次', () => {
    const current = { tracks: [track('1')], collections: [album('a')], nextCursor: 'page-2', cursors: ['page-1'] }
    const incoming = { tracks: [track('1'), track('2'), track('2')], collections: [album('a'), album('b'), album('b')], nextCursor: 'page-3' }
    const merged = mergeAppleChartPage(current, incoming, 'page-2')
    expect(merged.tracks.map(item => item.id)).toEqual(['1', '2'])
    expect(merged.collections.map(item => item.id)).toEqual(['a', 'b'])
    expect(merged.nextCursor).toBe('page-3')
    expect(mergeAppleChartPage(current, { ...incoming, nextCursor: 'page-1' }, 'page-2').nextCursor).toBeUndefined()
  })

  it('保留默认歌单榜入口，并可指定歌曲榜或专辑榜作为入口', () => {
    useProviderStore.setState({ byId: { ...initial.byId, apple: { enabled: true, auth: 'authenticated' } } })
    const playlists = renderToStaticMarkup(<AppleChartPage />)
    expect(playlists).toContain('aria-pressed="true">热门歌单')
    expect(playlists).toContain('正在读取热门歌单')
    const songs = renderToStaticMarkup(<AppleChartPage initialKind="songs" />)
    expect(songs).toContain('aria-pressed="true">热门歌曲')
    expect(songs).toContain('正在读取热门歌曲')
    const albums = renderToStaticMarkup(<AppleChartPage initialKind="albums" />)
    expect(albums).toContain('aria-pressed="true">热门专辑')
    expect(albums).toContain('正在读取热门专辑')
  })

  it('平台关闭或账号失效时给出连接条件，隐藏榜单内容', () => {
    for (const apple of [{ enabled: false, auth: 'authenticated' as const }, { enabled: true, auth: 'expired' as const }]) {
      useProviderStore.setState({ byId: { ...initial.byId, apple } })
      const html = renderToStaticMarkup(<AppleChartPage initialKind="songs" />)
      expect(html).toContain('连接并启用 Apple Music 后浏览榜单')
      expect(html).not.toContain('正在读取热门歌曲')
      expect(html).not.toContain('加载下一页')
    }
  })
})
