import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'
import { api } from '../lib/api'
import { localMusicService } from '../lib/local-music-service'
import { parseLrc, alignTranslation, parseYrc, estimateWordTiming } from '../lib/lyric-parser'
import type { Track, LyricLine as LyricLineType, WordLyricLine as WordLyricLineType } from '../types/domain'

interface LyricsResult {
  main: LyricLineType[]
  aligned: LyricLineType[]
  roma: LyricLineType[]
  wordLines: WordLyricLineType[]
}

interface NeteaseLyricResponse {
  lyric?: string
  tlyric?: string
  romalrc?: string
  yrc?: string
  error?: string
}

interface QQLyricResponse {
  lyric?: string
  tlyric?: string
  roma?: string
  error?: string
}

const empty: LyricsResult = { main: [], aligned: [], roma: [], wordLines: [] }

async function fetchLyrics(track: Track): Promise<LyricsResult> {
  try {
    if (track.provider === 'netease') {
      const rec = await api.get<NeteaseLyricResponse>('/api/lyric', { id: String(track.id) })
      const mainText = typeof rec.lyric === 'string' ? rec.lyric : ''
      const transText = typeof rec.tlyric === 'string' ? rec.tlyric : ''
      const romaText = typeof rec.romalrc === 'string' ? rec.romalrc : ''
      const yrcText = typeof rec.yrc === 'string' ? rec.yrc : ''
      if (!mainText) return empty
      const main = parseLrc(mainText)
      const trans = transText ? parseLrc(transText) : []
      const roma = romaText ? parseLrc(romaText) : []
      const wordLines = yrcText ? parseYrc(yrcText) : estimateWordTiming(main)
      return {
        main,
        aligned: trans.length ? alignTranslation(main, trans) : [],
        roma: roma.length ? alignTranslation(main, roma) : [],
        wordLines,
      }
    }

    if (track.provider === 'qq') {
      const mid = String(track.songmid || track.mid || '')
      const id = String(track.id || '')
      const rec = await api.get<QQLyricResponse>('/api/qq/lyric', { mid, id })
      const mainText = typeof rec.lyric === 'string' ? rec.lyric : ''
      const transText = typeof rec.tlyric === 'string' ? rec.tlyric : ''
      const romaText = typeof rec.roma === 'string' ? rec.roma : ''
      if (!mainText) return empty
      const main = parseLrc(mainText)
      const trans = transText ? parseLrc(transText) : []
      // QQ 的 roma 可能是 QRC 等非 LRC 格式,parseLrc 解析不出时间标签时得到空数组,静默降级
      const roma = romaText ? parseLrc(romaText) : []
      return {
        main,
        aligned: trans.length ? alignTranslation(main, trans) : [],
        roma: roma.length ? alignTranslation(main, roma) : [],
        wordLines: estimateWordTiming(main),
      }
    }

    // 本地音乐:曲目同目录的同名 .lrc。server 端点与 localMusicService.getLyrics 一直都在,
    // 但这条管线（App 里唯一的歌词入口）此前只有网易/QQ 两个分支,本地曲目直接落到下面的
    // return empty —— 表现为本地音乐永远没有歌词。
    if (track.provider === 'local') {
      const main = await localMusicService.getLyrics(track)
      if (!main.length) return empty
      return { main, aligned: [], roma: [], wordLines: estimateWordTiming(main) }
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

    fetchLyrics(currentTrack).then(({ main, aligned, roma, wordLines }) => {
      if (cancelled) return
      useLyricsStore.getState().setLines(main, aligned, roma)
      useLyricsStore.getState().setWordLines(wordLines)
    })

    return () => {
      cancelled = true
    }
  }, [currentTrack])
}
