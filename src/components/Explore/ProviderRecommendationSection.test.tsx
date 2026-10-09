import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearProviderRequestCache, requestProviderData } from '../../lib/provider-request-cache'
import { providerFor } from '../../providers/registry'
import type { RecommendationPage } from '../../providers/types'
import { ProviderRecommendationSection } from './ProviderRecommendationSection'

vi.mock('./Stack', () => ({ Stack: ({ cards }: { cards: { name: string }[] }) => <div>{cards.map((card) => card.name).join(',')}</div> }))
vi.mock('./ToplistSection', () => ({ ToplistSection: () => null }))

describe('探索页返回首帧', () => {
  beforeEach(() => clearProviderRequestCache())

  async function seed() {
    for (const surface of providerFor('qq').recommendations!.listSurfaces()) {
      const page = { content: surface.kind === 'playlist-feed'
        ? { type: 'playlists', playlists: [{ id: 'p', source: 'qq', name: '已浏览推荐歌单' }] }
        : { type: 'tracks', tracks: [] } } as unknown as RecommendationPage
      await requestProviderData('qq', `recommendation:${surface.id}:root`, () => Promise.resolve(page))
    }
    await requestProviderData('qq', 'library:user-playlists', () => Promise.resolve([{ id: 'mine', source: 'qq', name: '已有个人歌单', trackCount: 10 }]))
  }

  it('已有推荐与个人歌单直接出现在首帧，不显示重新连接提示', async () => {
    await seed()
    const html = renderToStaticMarkup(<ProviderRecommendationSection source="qq" onPreview={() => {}} />)
    expect(html).toContain('已浏览推荐歌单')
    expect(html).toContain('已有个人歌单')
    expect(html).not.toContain('正在连接平台')
    expect(html).not.toContain('加载中…')
    expect(html).toMatch(/^<section[^>]*style="opacity:1;transform:none"/)
  })

  it('清除平台会话后不会用旧内容填充首帧', async () => {
    await seed()
    clearProviderRequestCache('qq')
    const html = renderToStaticMarkup(<ProviderRecommendationSection source="qq" onPreview={() => {}} />)
    expect(html).not.toContain('已浏览推荐歌单')
    expect(html).not.toContain('已有个人歌单')
    expect(html).toContain('正在连接平台')
  })

  it('Apple 个人栏目与榜单空结果也能在首帧复用，避免反复显示加载提示', async () => {
    for (const scope of ['charts:storefront', 'recommendation:personal-groups', 'library:user-albums']) {
      await requestProviderData('apple', scope, () => Promise.resolve([]))
    }
    await requestProviderData('apple', 'charts:most-played:first', () => Promise.resolve({ playlists: [] }))
    await requestProviderData('apple', 'library:liked-playlist', () => Promise.resolve({ id: 'liked', source: 'apple', name: '收藏的歌曲', trackCount: 8 }))
    const html = renderToStaticMarkup(<ProviderRecommendationSection source="apple" onPreview={() => {}} />)
    expect(html).toContain('收藏的歌曲')
    expect(html).not.toContain('正在读取')
    expect(html).not.toContain('正在连接平台')
  })

  it.each([3136952023, '3136952023'])('网易云发现歌单排除私人雷达（id=%s），保留独立入口及普通同名歌单', async (id) => {
    for (const surface of providerFor('netease').recommendations!.listSurfaces()) {
      const page = { content: surface.kind === 'playlist-feed'
        ? { type: 'playlists', playlists: [
          { id, source: 'netease', name: '私人雷达重复卡片' },
          { id: 'ordinary', source: 'netease', name: '私人雷达同名普通歌单' },
        ] }
        : surface.kind === 'radar'
          ? { type: 'radar', radar: { playlist: { id, source: 'netease', name: '私人雷达' }, tracks: [{ id: 't', cover: '' }] } }
          : { type: 'tracks', tracks: [] } } as unknown as RecommendationPage
      await requestProviderData('netease', `recommendation:${surface.id}:root`, () => Promise.resolve(page))
    }
    const html = renderToStaticMarkup(<ProviderRecommendationSection source="netease" onPreview={() => {}} />)
    expect(html).not.toContain('私人雷达重复卡片')
    expect(html).toContain('私人雷达同名普通歌单')
    expect(html).toContain('根据你的口味')
  })

  it('其他平台的同 ID 歌单仍保留在发现歌单中', async () => {
    await requestProviderData('qq', 'recommendation:qq:playlist-feed:root', () => Promise.resolve({
      content: { type: 'playlists', playlists: [{ id: '3136952023', source: 'qq', name: 'QQ 推荐歌单' }] },
    } as unknown as RecommendationPage))
    const html = renderToStaticMarkup(<ProviderRecommendationSection source="qq" onPreview={() => {}} />)
    expect(html).toContain('QQ 推荐歌单')
  })

})
