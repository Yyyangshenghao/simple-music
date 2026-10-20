import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearProviderRequestCache, requestProviderData } from '../../lib/provider-request-cache'
import { RecentRail } from './RecentRail'

vi.mock('../../providers/registry', () => ({
  providerFor: (source: string) => ({ history: source === 'qq'
    ? { getRecentTracks: async () => [] }
    : { getRecentPlaylists: async () => [] } }),
}))

afterEach(() => clearProviderRequestCache())

describe('RecentRail', () => {
  it('QQ 最近歌曲使用共享拖动横排，保留歌曲播放入口', async () => {
    await requestProviderData('qq', 'history:recent-tracks', async () => [{
      provider: 'qq', source: 'qq', type: 'track', id: 'song', name: '测试歌曲', artist: '歌手', artists: [],
    }])
    const html = renderToStaticMarkup(<RecentRail source="qq" embedded onOpen={() => {}} />)
    expect(html).toContain('role="group" aria-label="最近听过"')
    expect(html).toContain('data-arrow-navigation="true"')
    expect(html).toContain('aria-label="播放 测试歌曲"')
  })

  it('网易最近歌单同样使用共享横排，保留歌单入口', async () => {
    await requestProviderData('netease', 'history:recent-playlists', async () => [{
      provider: 'netease', source: 'netease', type: 'playlist', id: 1, name: '最近的歌单',
      cover: '', trackCount: 5, playCount: 0, creator: '',
    }])
    const html = renderToStaticMarkup(<RecentRail source="netease" onOpen={() => {}} />)
    expect(html).toContain('role="group" aria-label="最近播放"')
    expect(html).toContain('data-arrow-navigation="true"')
    expect(html).toContain('title="最近的歌单"')
  })

  it('无最近记录时隐藏整个分区', () => {
    expect(renderToStaticMarkup(<RecentRail source="qq" onOpen={() => {}} />)).toBe('')
  })
})
