import { api } from './api'
import type { ProviderId } from '../providers/types'
import { useProviderStore } from '../stores/providers'
import { useSettingsStore } from '../stores/settings'
import type { Track } from '../types/domain'

/**
 * 歌词来源与播放平台分开：网易云、QQ 已登录且参与播放时沿用账号；否则在设置允许时以游客身份查询，
 * 请求带 guest=1，服务端不附带账号 Cookie，失败也不会触发账号失效处理。Apple Music 歌词只走账号。
 */
export type LyricServiceMode = 'account' | 'guest'
export type LyricCatalogSource = 'netease' | 'qq'

function participating(source: ProviderId): boolean {
  const state = useProviderStore.getState().byId[source]
  return !!state?.enabled && state.auth === 'authenticated'
}

/** 设置中关闭的网易云、QQ 不参与歌词查询，账号与游客都不用。 */
export function lyricPlatformEnabled(source: ProviderId): boolean {
  return (source !== 'netease' && source !== 'qq') || useSettingsStore.getState().lyricsPlatformSources[source]
}

export function lyricServiceMode(source: ProviderId): LyricServiceMode | null {
  if (!lyricPlatformEnabled(source)) return null
  if (participating(source)) return 'account'
  if (source !== 'netease' && source !== 'qq') return null
  const state = useProviderStore.getState().byId[source]
  // 启动时登录状态尚未确认：已启用的平台先不按游客查询，确认后由歌词加载器重新取词，避免先游客后账号重复请求。
  if (state?.enabled && state.auth === 'unknown') return null
  return useSettingsStore.getState().lyricsGuestSources[source] ? 'guest' : null
}

/** 可用于歌词的平台：参与播放的平台按播放顺序在前，其余可游客查询的网易云、QQ 在后。 */
export function lyricServiceSources(): ProviderId[] {
  const { playbackOrder } = useProviderStore.getState()
  const sources = playbackOrder.filter(source => participating(source) && lyricPlatformEnabled(source))
  for (const source of ['netease', 'qq'] as const) {
    if (!sources.includes(source) && lyricServiceMode(source) === 'guest') sources.push(source)
  }
  return sources
}

/** 游客搜索：只发送关键词（歌名与歌手），结果按平台补齐来源字段。 */
export async function searchGuestTracks(source: LyricCatalogSource, keyword: string, signal?: AbortSignal): Promise<Track[]> {
  const path = source === 'qq' ? '/api/qq/search' : '/api/search'
  const res = await api.get<{ songs?: Track[]; error?: string }>(path, { keywords: keyword, limit: 20, guest: '1' }, { signal })
  if (res.error) throw new Error(res.error)
  return (Array.isArray(res.songs) ? res.songs : []).map(track => ({ ...track, provider: source, source }))
}
