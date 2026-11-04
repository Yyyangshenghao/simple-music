import { useEffect, useMemo } from 'react'
import { appPlaylistCovers } from '../lib/app-playlist-presentation'
import { requestBilibiliCover, trackCoverOf, useBilibiliCoverStore } from '../stores/bilibili-covers'
import { usePlayerStore } from '../stores/player'
import { useSettingsStore } from '../stores/settings'
import type { Track } from '../types/domain'

/** 曲目的展示封面；哔哩哔哩曲目按设置换成匹配到的专辑封面，查询在后台排队进行。 */
export function useTrackCover(track: Track | null | undefined): string | undefined {
  const enabled = useSettingsStore(s => s.bilibiliAlbumCover)
  const bilibili = track?.source === 'bilibili'
  const albumCover = useBilibiliCoverStore(s => bilibili && enabled ? s.entries[`bilibili:${String(track!.id)}`]?.cover : undefined)
  useEffect(() => {
    if (bilibili && enabled) requestBilibiliCover(track)
  }, [bilibili, enabled, track])
  return bilibili && enabled && albumCover ? albumCover : trackCoverOf(track, {}, false)
}

/** 当前播放曲目的展示封面。 */
export function useCurrentTrackCover(): string | undefined {
  return useTrackCover(usePlayerStore(s => s.currentTrack))
}

/** 应用歌单拼贴封面最多用到的哔哩哔哩曲目数（拼贴最多 4 格）。 */
const PLAYLIST_COVER_REQUESTS = 4

/** 应用歌单拼贴封面：哔哩哔哩曲目同样按设置换成专辑封面，只为排在前面、可能入选的几首发起匹配。 */
export function useAppPlaylistCovers(tracks: Track[]) {
  const enabled = useSettingsStore(s => s.bilibiliAlbumCover)
  const entries = useBilibiliCoverStore(s => s.entries)
  useEffect(() => {
    if (!enabled) return
    tracks.filter(track => track.source === 'bilibili').slice(0, PLAYLIST_COVER_REQUESTS).forEach(requestBilibiliCover)
  }, [enabled, tracks])
  return useMemo(() => appPlaylistCovers(tracks, track => trackCoverOf(track, entries, enabled)), [tracks, entries, enabled])
}
