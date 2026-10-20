import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MusicSource, Track } from '../types/domain'
import { appPlaylistCovers, appPlaylistSources } from './app-playlist-presentation'

function track(source: MusicSource, cover?: string, id: unknown = 1): Track {
  return { source, provider: source, type: 'song', id, name: '歌曲', artist: '歌手', artists: [], cover }
}

afterEach(() => vi.unstubAllGlobals())

describe('应用歌单来源构成', () => {
  it('按固定顺序统计四个来源，同 ID 和不可播放收藏仍各自计数', () => {
    const tracks = [track('local'), track('qq'), track('apple'), { ...track('netease'), playable: false }, track('qq', undefined, '1')]
    expect(appPlaylistSources(tracks)).toEqual([
      { source: 'netease', count: 1 }, { source: 'qq', count: 2 },
      { source: 'apple', count: 1 }, { source: 'local', count: 1 },
    ])
  })

  it('空歌单没有来源，单平台只展示实际来源', () => {
    expect(appPlaylistSources([])).toEqual([])
    expect(appPlaylistSources([track('apple')])).toEqual([{ source: 'apple', count: 1 }])
  })
})

describe('应用歌单代表封面', () => {
  it('优先展示各来源不同封面，而非被最前面的平台占满', () => {
    const tracks = [
      track('netease', 'https://covers.test/n1'), track('netease', 'https://covers.test/n2'),
      track('netease', 'https://covers.test/n3'), track('netease', 'https://covers.test/n4'),
      track('qq', 'https://covers.test/q'), track('apple', 'https://covers.test/a'), track('local', 'local-cover'),
    ]
    expect(appPlaylistCovers(tracks)).toEqual([
      { source: 'netease', url: 'https://covers.test/n1' }, { source: 'qq', url: 'https://covers.test/q' },
      { source: 'apple', url: 'https://covers.test/a' }, { source: 'local', url: '/api/local/cover?id=1' },
    ])
  })

  it('每个来源跳过已用封面再选择，剩余位置补足但最多四张', () => {
    const tracks = [track('netease', 'https://covers.test/shared'), track('qq', 'https://covers.test/shared'), track('qq', 'https://covers.test/q'),
      ...['n2', 'n3', 'n4', 'n5'].map(id => track('netease', `https://covers.test/${id}`, id))]
    expect(appPlaylistCovers(tracks).map(cover => cover.url)).toEqual([
      'https://covers.test/shared', 'https://covers.test/q', 'https://covers.test/n2', 'https://covers.test/n3',
    ])
  })

  it('过滤在线非法图片地址并规范化协议相对地址', () => {
    expect(appPlaylistCovers([
      track('netease', '?n=1'), track('qq', 'local-cover'), track('apple', 'javascript:alert(1)'),
      track('netease', ' //covers.test/n '), track('qq', 'https://covers.test/q'),
    ])).toEqual([{ source: 'netease', url: 'https://covers.test/n' }, { source: 'qq', url: 'https://covers.test/q' }])
  })

  it('本地存档标记与旧会话地址都重建为当前端口和 token，不修改原始收藏', () => {
    vi.stubGlobal('window', { desktop: { serverPort: 36666, serverToken: 'current-token' } })
    const tracks = [track('local', 'local-cover', 'a/b'), track('local', 'http://127.0.0.1:1234/api/local/cover?id=old&token=expired', 'two')]
    const original = structuredClone(tracks)
    tracks.forEach(Object.freeze)
    Object.freeze(tracks)
    expect(appPlaylistCovers(tracks)).toEqual([
      { source: 'local', url: 'http://127.0.0.1:36666/api/local/cover?id=a%2Fb&token=current-token' },
      { source: 'local', url: 'http://127.0.0.1:36666/api/local/cover?id=two&token=current-token' },
    ])
    expect(tracks).toEqual(original)
  })

  it('单张封面与没有封面均保持真实内容', () => {
    expect(appPlaylistCovers([track('local'), track('netease', ''), track('qq', '?n=1')])).toEqual([])
    expect(appPlaylistCovers([track('apple', 'https://covers.test/a')])).toEqual([{ source: 'apple', url: 'https://covers.test/a' }])
  })
})
