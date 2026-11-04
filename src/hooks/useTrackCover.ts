import { useEffect } from 'react'
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
