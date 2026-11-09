import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settings'
import { ProviderRecommendationSection } from './ProviderRecommendationSection'

vi.mock('../../stores/settings', async importOriginal => {
  const original = await importOriginal<typeof import('../../stores/settings')>()
  const store = original.useSettingsStore
  return { ...original, useSettingsStore: Object.assign((selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()), store) }
})
vi.mock('./RecommendationStage', () => ({ RecommendationStage: () => <div>推荐与发现模块</div> }))
vi.mock('./FeaturedSongs', () => ({ FeaturedSongs: () => <div>歌曲精选模块</div> }))
vi.mock('./PersonalListeningSection', () => ({ PersonalListeningSection: () => <div>个人常听模块</div> }))
vi.mock('./ProviderPlaylistRail', () => ({ ProviderPlaylistRail: () => <div>我的歌单模块</div> }))
vi.mock('./RecentRail', () => ({ RecentRail: () => <div>最近播放模块</div> }))
vi.mock('./ToplistSection', () => ({ ToplistSection: () => <div>排行榜模块</div> }))
const initial = useSettingsStore.getState()
afterEach(() => useSettingsStore.setState(initial, true))

describe('探索页模块组合', () => {
  it('按照音源配置渲染，关闭模块不挂载，其余音源保持默认', () => {
    useSettingsStore.getState().setExploreLayout('netease', [{ id: 'listening', enabled: true }, { id: 'featured', enabled: true }, { id: 'recommendations', enabled: false }])
    const html = renderToStaticMarkup(<ProviderRecommendationSection source="netease" onPreview={() => {}} />)
    expect(html.indexOf('个人常听模块')).toBeLessThan(html.indexOf('歌曲精选模块'))
    expect(html).not.toContain('推荐与发现模块')
    expect(renderToStaticMarkup(<ProviderRecommendationSection source="qq" onPreview={() => {}} />)).toContain('推荐与发现模块')
  })
  it('全部关闭时呈现恢复路径且不挂载任何内容模块', () => {
    useSettingsStore.getState().setExploreLayout('netease', initial.exploreLayouts.netease.map(module => ({ ...module, enabled: false })))
    const html = renderToStaticMarkup(<ProviderRecommendationSection source="netease" onPreview={() => {}} />)
    expect(html).toContain('音源与播放')
    for (const label of ['推荐与发现模块', '歌曲精选模块', '个人常听模块', '排行榜模块', '最近播放模块', '我的歌单模块']) expect(html).not.toContain(label)
  })
})
