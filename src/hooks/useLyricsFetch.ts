import { useEffect } from 'react'
import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'
import { useProviderStore } from '../stores/providers'
import { isProviderId } from '../providers/types'
import { fetchLyrics, emptyLyrics } from '../lib/lyrics-fetch'
import type { Track } from '../types/domain'

function lyricTrackKey(track: Track): string {
  return `${track.source}:${String(track.id)}`
}

export function useLyricsFetch(enabled = true): void {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const resolvedTrack = usePlayerStore((s) => s.resolvedTrack)
  const playbackOrder = useProviderStore((state) => state.playbackOrder)
  const participation = useProviderStore((state) => ({
    netease: state.byId.netease.enabled && state.byId.netease.auth === 'authenticated',
    qq: state.byId.qq.enabled && state.byId.qq.auth === 'authenticated',
    apple: state.byId.apple.enabled && state.byId.apple.auth === 'authenticated',
  }))

  useEffect(() => {
    if (!enabled || !currentTrack) {
      useLyricsStore.setState({ trackKey: null, source: null, loading: false, lines: [], translation: [], romaji: [], wordLines: [], currentIndex: -1, currentCharProgress: 0, offsetSec: 0 })
      return
    }

    const key = lyricTrackKey(currentTrack)
    // currentTrack 在 URL 解析前就会同步切换；先标记归属并清空，避免新歌卡片闪出上一首歌词。
    useLyricsStore.setState({ trackKey: key, source: null, loading: true, lines: [], translation: [], romaji: [], wordLines: [], currentIndex: -1, currentCharProgress: 0, offsetSec: 0 })

    let cancelled = false
    const controller = new AbortController()
    const lyricSources = playbackOrder.filter(source => participation[source])
    const canUse = (track: Track) => !isProviderId(track.source) || participation[track.source]
    const candidates = [currentTrack, resolvedTrack]
      .filter((track): track is Track => !!track && canUse(track))
      .filter((track, index, all) => all.findIndex((item) => lyricTrackKey(item) === lyricTrackKey(track)) === index)

    void (async () => {
      for (const track of candidates) {
        const result = await fetchLyrics(track, lyricSources, controller.signal)
        if (cancelled) return emptyLyrics
        if (result.main.length > 0) return result
      }
      return emptyLyrics
    })().then(({ main, aligned, roma, wordLines, source }) => {
      if (cancelled || useLyricsStore.getState().trackKey !== key) return
      useLyricsStore.getState().setLines(main, aligned, roma)
      useLyricsStore.getState().setWordLines(wordLines)
      useLyricsStore.setState({ source: main.length ? source : null, loading: false })
      useLyricsStore.getState().tick(usePlayerStore.getState().position)
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [enabled, currentTrack, participation.netease, participation.qq, participation.apple, playbackOrder, resolvedTrack])
}
