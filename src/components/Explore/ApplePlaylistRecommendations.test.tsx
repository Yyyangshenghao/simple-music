import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { clearProviderRequestCache, requestProviderData } from '../../lib/provider-request-cache'
import type { Playlist } from '../../types/domain'
import { ApplePlaylistRecommendations } from './ApplePlaylistRecommendations'

const charts: Playlist[] = Array.from({ length: 25 }, (_, index) => ({
  provider: 'apple', source: 'apple', type: 'playlist', id: `pl.${index + 1}`,
  name: `热门歌单 ${index + 1}`, cover: '', trackCount: 0, playCount: 0, creator: 'Apple Music',
}))

afterEach(() => clearProviderRequestCache())

describe('ApplePlaylistRecommendations', () => {
  it('热门榜单在探索页固定展示 12 张，并提供独立榜单页入口', () => {
    const html = renderToStaticMarkup(<ApplePlaylistRecommendations charts={charts} onOpen={() => {}} />)
    const chartSection = html.split('aria-label="热门榜单"')[1]?.split('</section>')[0] ?? ''
    expect(html).toContain('热门榜单')
    expect(new Set(chartSection.match(/热门歌单 \d+/g)).size).toBe(12)
    expect(chartSection).toContain('role="group" aria-label="热门榜单，可横向滚动"')
    expect(html).toContain('浏览热门与地区榜单')
    expect(html).not.toContain('精选 12 张 · 点击打开')
    expect(html).not.toContain('打开榜单')
    expect(html).not.toContain('横向浏览')
    expect(html).not.toContain('0 首')
  })
  it('精选、推荐分组和地区榜单均复用无箭头的横排，保持内容打开入口', async () => {
    const groups = Array.from({ length: 5 }, (_, index) => ({ id: `group-${index}`, title: `推荐分组 ${index}`, items: charts.map(item => ({ ...item, id: `personal-${index}-${item.id}` })) }))
    await requestProviderData('apple', 'recommendation:personal-groups', async () => groups)
    await requestProviderData('apple', 'charts:storefront', async () => charts.map(item => ({ ...item, id: `store-${item.id}` })))
    const html = renderToStaticMarkup(<ApplePlaylistRecommendations charts={charts} onOpen={() => {}} />)
    for (const title of ['为你精选', '热门榜单', '地区榜单', '推荐分组 0']) expect(html).toContain(`role="group" aria-label="${title}，可横向滚动"`)
    expect(html).toContain('打开歌单：')
    for (const label of ['上一张精选内容', '下一张精选内容', '上一页', '下一页']) expect(html).not.toContain(label)
  })
})
