import { useLyricsSourceStore } from '../stores/lyrics-source'
import { useLyricsStore } from '../stores/lyrics'
import { usePlayerStore } from '../stores/player'
import { LYRIC_SOURCE_LABELS } from '../types/lyrics-source'

/** 当前曲目实际在用的歌词来源文字；更多菜单与歌词设置浮层共用，保证两处一致。 */
export function useLyricsSourceLabel(): string {
  const trackKey = usePlayerStore((s) => s.currentTrack ? `${s.currentTrack.source}:${String(s.currentTrack.id)}` : null)
  const lyricsTrackKey = useLyricsStore((s) => s.trackKey)
  const lyricsLoading = useLyricsStore((s) => s.loading)
  const lyricsInstrumental = useLyricsStore((s) => s.instrumental)
  const appliedOrigin = useLyricsSourceStore((s) => s.appliedOrigin)
  return lyricsLoading ? '正在加载…'
    : lyricsTrackKey === trackKey && appliedOrigin ? LYRIC_SOURCE_LABELS[appliedOrigin]
    : lyricsTrackKey === trackKey && lyricsInstrumental ? '纯音乐' : '暂无歌词'
}
