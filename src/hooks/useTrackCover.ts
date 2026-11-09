import { useMemo } from 'react'
import { appPlaylistCovers } from '../lib/app-playlist-presentation'
import { trackCoverOf, useBilibiliCoverStore } from '../stores/bilibili-covers'
import { usePlayerStore } from '../stores/player'
import { useSettingsStore } from '../stores/settings'
import type { Track } from '../types/domain'

/** 曲目的展示封面；哔哩哔哩曲目按设置换成匹配到的专辑封面，只读取已识别结果。 */
export function useTrackCover(track: Track | null | undefined): string | undefined {
  const enabled = useSettingsStore(s => s.bilibiliAlbumCover)
  const bilibili = track?.source === 'bilibili'
  const albumCover = useBilibiliCoverStore(s => bilibili && enabled ? trackCoverOf(track, s.entries, enabled) : undefined)
  return bilibili && enabled && albumCover ? albumCover : trackCoverOf(track, {}, false)
}

/** 当前播放曲目的展示封面。 */
export function useCurrentTrackCover(): string | undefined {
  return useTrackCover(usePlayerStore(s => s.currentTrack))
}

/** 应用歌单拼贴封面复用已识别结果，不因浏览歌单发起搜索。 */
export function useAppPlaylistCovers(tracks: Track[]) {
  const enabled = useSettingsStore(s => s.bilibiliAlbumCover)
  const entries = useBilibiliCoverStore(s => s.entries)
  return useMemo(() => appPlaylistCovers(tracks, track => trackCoverOf(track, entries, enabled)), [tracks, entries, enabled])
}
