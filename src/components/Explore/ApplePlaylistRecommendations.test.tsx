import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Playlist } from '../../types/domain'
import { ApplePlaylistRecommendations } from './ApplePlaylistRecommendations'

const charts: Playlist[] = Array.from({ length: 25 }, (_, index) => ({
  provider: 'apple', source: 'apple', type: 'playlist', id: `pl.${index + 1}`,
  name: `热门歌单 ${index + 1}`, cover: '', trackCount: 0, playCount: 0, creator: 'Apple Music',
}))

describe('ApplePlaylistRecommendations', () => {
  it('热门榜单在探索页固定展示 12 张，并提供独立榜单页入口', () => {
    const html = renderToStaticMarkup(<ApplePlaylistRecommendations charts={charts} onOpen={() => {}} />)
    const chartSection = html.split('aria-label="热门榜单"')[1]?.split('</section>')[0] ?? ''
    expect(html).toContain('热门榜单')
    expect(new Set(chartSection.match(/热门歌单 \d+/g)).size).toBe(12)
    expect(html).toContain('浏览热门与地区榜单')
    expect(html).not.toContain('精选 12 张 · 点击打开')
    expect(html).not.toContain('打开榜单')
    expect(html).not.toContain('横向浏览')
    expect(html).not.toContain('0 首')
  })
})
