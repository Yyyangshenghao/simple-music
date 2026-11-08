import { describe, expect, it } from 'vitest'
import { EXPLORE_MODULES, normalizeExploreLayout, normalizeExploreLayouts } from './explore-modules'
import { listProviders } from '../providers/registry'

describe('探索模块配置', () => {
  it('按平台提供现有栏目，默认全部启用', () => {
    for (const provider of listProviders()) {
      const source = provider.descriptor.id
      const ids = EXPLORE_MODULES[source].map(module => module.id)
      expect(ids.includes('playlists')).toBe(Boolean(provider.library?.getUserPlaylists))
      expect(ids.includes('recent')).toBe(Boolean(provider.history?.getRecentPlaylists || provider.history?.getRecentTracks))
      expect(ids.includes('toplists')).toBe(Boolean(provider.toplists))
      expect(normalizeExploreLayout(source, null)).toEqual(ids.map(id => ({ id, enabled: true })))
    }
  })
  it('保留顺序和关闭状态，忽略重复及跨平台模块，新增栏目补到末尾', () => {
    const layout = normalizeExploreLayout('netease', [{ id: 'listening', enabled: false }, { id: 'featured', enabled: true }, { id: 'listening', enabled: true }, { id: 'apple-library', enabled: true }, null])
    expect(layout.slice(0, 2)).toEqual([{ id: 'listening', enabled: false }, { id: 'featured', enabled: true }])
    expect(layout.map(module => module.id)).toEqual(['listening', 'featured', 'recommendations', 'playlists', 'recent', 'toplists'])
  })
  it('为旧汽水布局追加听歌模式和我的歌单，保留已选顺序和开关', () => {
    const saved = [{ id: 'theme-playlists', enabled: false }, { id: 'saved', enabled: true }, { id: 'listening', enabled: false }]
    expect(normalizeExploreLayout('qishui', saved)).toEqual([...saved, { id: 'listening-modes', enabled: true }, { id: 'playlists', enabled: true }])
  })
  it('允许全部关闭，旧版和无效存档恢复默认', () => {
    const defaults = normalizeExploreLayouts(null)
    expect(normalizeExploreLayouts('invalid')).toEqual(defaults)
    const disabled = defaults.netease.map(module => ({ ...module, enabled: false }))
    expect(normalizeExploreLayouts({ netease: disabled }).netease).toEqual(disabled)
    expect(normalizeExploreLayouts({ qq: {} }).qq).toEqual(defaults.qq)
  })
})
