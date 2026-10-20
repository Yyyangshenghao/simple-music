import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { MusicSource, Track } from '../../types/domain'
import { AppPlaylistSources } from './AppPlaylistSources'

vi.mock('../../stores/providers', () => ({ useProviderStore: (selector: (state: unknown) => unknown) => selector({
  sourceBadgeMode: 'hidden',
  byId: { netease: { enabled: false, auth: 'anonymous' }, qq: { enabled: false, auth: 'expired' }, apple: { enabled: false, auth: 'unknown' } },
}) }))

function track(source: MusicSource): Track {
  return { provider: source, source, type: 'song', id: 1, name: '歌曲', artist: '', artists: [], playable: false }
}

describe('应用歌单来源展示', () => {
  const tracks = [track('local'), track('qq'), track('netease'), track('apple'), track('netease')]

  it('停用、退出与隐藏角标偏好不隐藏已收藏来源，提供完整来源统计标签', () => {
    const html = renderToStaticMarkup(<AppPlaylistSources tracks={tracks} />)
    expect(html).toContain('aria-label="歌曲来源：网易云 2 首，QQ音乐 1 首，Apple Music 1 首，本地 1 首"')
    for (const label of ['网易云', 'QQ音乐', 'Apple Music', '本地']) expect(html).toContain(`aria-label="来源：${label}"`)
    expect(html).not.toContain('<button')
    expect(html).toContain('2 首')
  })

  it('紧凑布局保留图标与数量，省略重复的可见平台名', () => {
    const html = renderToStaticMarkup(<AppPlaylistSources tracks={tracks} compact />)
    expect(html).toContain('aria-label="歌曲来源：网易云 2 首，QQ音乐 1 首，Apple Music 1 首，本地 1 首"')
    expect(html).toContain('>2</span>')
    expect(html).not.toContain('>网易云<')
    expect(html).not.toContain('>QQ音乐<')
  })

  it('空歌单不展示空统计，单来源只展示一个徽标', () => {
    expect(renderToStaticMarkup(<AppPlaylistSources tracks={[]} />)).toBe('')
    const html = renderToStaticMarkup(<AppPlaylistSources tracks={[track('qq')]} />)
    expect(html).toContain('歌曲来源：QQ音乐 1 首')
    expect(html).not.toContain('来源：网易云')
  })
})
