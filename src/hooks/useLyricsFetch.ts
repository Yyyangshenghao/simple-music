import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'
import { api } from '../lib/api'
import { parseLrc, alignTranslation, parseYrc, estimateWordTiming } from '../lib/lyric-parser'
import type { Track, LyricLine as LyricLineType, WordLyricLine as WordLyricLineType } from '../types/domain'

interface LyricsResult {
  main: LyricLineType[]
  aligned: LyricLineType[]
  wordLines: WordLyricLineType[]
}

interface NeteaseLyricResponse {
  lyric?: string
  tlyric?: string
  yrc?: string
  error?: string
}

interface QQLyricResponse {
  lyric?: string
  tlyric?: string
  error?: string
}

const empty: LyricsResult = { main: [], aligned: [], wordLines: [] }

async function fetchLyrics(track: Track): Promise<LyricsResult> {
  try {
    if (track.provider === 'netease') {
      const rec = await api.get<NeteaseLyricResponse>('/api/lyric', { id: String(track.id) })
      const mainText = typeof rec.lyric === 'string' ? rec.lyric : ''
      const transText = typeof rec.tlyric === 'string' ? rec.tlyric : ''
      const yrcText = typeof rec.yrc === 'string' ? rec.yrc : ''
      if (!mainText) return empty
      const main = parseLrc(mainText)
      const trans = transText ? parseLrc(transText) : []
      const wordLines = yrcText ? parseYrc(yrcText) : estimateWordTiming(main)
      return {
        main,
        aligned: trans.length ? alignTranslation(main, trans) : [],
        wordLines,
      }
    }

    if (track.provider === 'qq') {
      const mid = String(track.songmid || track.mid || '')
      const id = String(track.id || '')
      const rec = await api.get<QQLyricResponse>('/api/qq/lyric', { mid, id })
      const mainText = typeof rec.lyric === 'string' ? rec.lyric : ''
      const transText = typeof rec.tlyric === 'string' ? rec.tlyric : ''
      if (!mainText) return empty
      const main = parseLrc(mainText)
      const trans = transText ? parseLrc(transText) : []
      return {
        main,
        aligned: trans.length ? alignTranslation(main, trans) : [],
        wordLines: estimateWordTiming(main),
      }
    }

    return empty
  } catch {
    return empty
  }
}

export function useLyricsFetch(): void {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const trackRef = useRef<Track | null>(null)

  useEffect(() => {
    if (currentTrack === trackRef.current) return
    trackRef.current = currentTrack

    if (!currentTrack) {
      useLyricsStore.getState().setLines([])
      useLyricsStore.getState().setWordLines([])
      return
    }

    let cancelled = false

    fetchLyrics(currentTrack).then(({ main, aligned, wordLines }) => {
      if (cancelled) return
      if (aligned.length) useLyricsStore.getState().setLines(main, aligned)
      else useLyricsStore.getState().setLines(main)
      useLyricsStore.getState().setWordLines(wordLines)
    })

    return () => {
      cancelled = true
    }
  }, [currentTrack])
}
