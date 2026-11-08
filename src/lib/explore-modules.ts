import { PROVIDER_IDS, type ProviderId } from '../providers/types'

export type ExploreModuleId = 'recommendations' | 'featured' | 'listening' | 'saved' | 'theme-playlists' | 'listening-modes' | 'apple-recommendations' | 'apple-library' | 'playlists' | 'recent' | 'toplists'
export interface ExploreModule { id: ExploreModuleId; label: string }
export interface ExploreModuleSetting { id: ExploreModuleId; enabled: boolean }
export type ExploreLayouts = Record<ProviderId, ExploreModuleSetting[]>

const modules = {
  recommendations: { id: 'recommendations', label: '推荐与发现' },
  featured: { id: 'featured', label: '歌曲精选' },
  listening: { id: 'listening', label: '本周常听' },
  saved: { id: 'saved', label: '已整理的歌单' },
  'listening-modes': { id: 'listening-modes', label: '听歌模式' },
  'theme-playlists': { id: 'theme-playlists', label: '主题歌单' },
  'apple-recommendations': { id: 'apple-recommendations', label: '推荐与榜单精选' },
  'apple-library': { id: 'apple-library', label: '个人资料库精选' },
  playlists: { id: 'playlists', label: '我的歌单' },
  recent: { id: 'recent', label: '最近播放' },
  toplists: { id: 'toplists', label: '排行榜' },
} satisfies Record<ExploreModuleId, ExploreModule>

// 与探索页现有栏目对应；不为平台尚未提供的内容创建空模块。
export const EXPLORE_MODULES: Record<ProviderId, readonly ExploreModule[]> = {
  netease: [modules.recommendations, modules.featured, modules.listening, modules.playlists, modules.recent, modules.toplists],
  qq: [modules.recommendations, modules.playlists, { ...modules.recent, label: '最近听过' }, modules.toplists],
  apple: [modules['apple-recommendations'], modules['apple-library'], modules.playlists],
  kugou: [modules.recommendations, modules.playlists, modules.toplists],
  qishui: [{ ...modules.listening, label: '继续听' }, modules.saved, modules['theme-playlists'], modules['listening-modes']],
  bilibili: [],
}

export function normalizeExploreLayout(source: ProviderId, value: unknown): ExploreModuleSetting[] {
  const available = EXPLORE_MODULES[source]
  const result: ExploreModuleSetting[] = []
  if (Array.isArray(value)) for (const item of value) {
    if (!item || !available.some(module => module.id === item.id) || result.some(module => module.id === item.id)) continue
    result.push({ id: item.id, enabled: typeof item.enabled === 'boolean' ? item.enabled : true })
  }
  for (const module of available) if (!result.some(item => item.id === module.id)) result.push({ id: module.id, enabled: true })
  return result
}

export function normalizeExploreLayouts(value: unknown): ExploreLayouts {
  const layouts = value && typeof value === 'object' ? value as Partial<Record<ProviderId, unknown>> : {}
  return Object.fromEntries(PROVIDER_IDS.map(source => [source, normalizeExploreLayout(source, layouts[source])])) as ExploreLayouts
}
