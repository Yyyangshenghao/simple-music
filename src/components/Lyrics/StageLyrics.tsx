import { useEffect, useRef } from 'react'
import { useLyricsStore } from '../../stores/lyrics'
import { usePlayerStore } from '../../stores/player'
import { parseLrc, alignTranslation } from '../../lib/lyric-parser'
import { api } from '../../lib/api'
import type { Track, LyricLine as LyricLineType } from '../../types/domain'
import { LyricLine } from './LyricLine'
import styles from './StageLyrics.module.css'

/** 安全地把 unknown 收窄为普通对象。 */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/**
 * 从歌词响应节点提取 LRC 文本：
 * - 节点本身是字符串则直接返回；
 * - 节点是对象则尝试读取常见的 lyric/lrc 字段（兼容网易 { lrc: { lyric } } 嵌套）。
 */
function extractLrc(node: unknown): string {
  if (typeof node === 'string') return node
  const rec = asRecord(node)
  if (typeof rec.lyric === 'string') return rec.lyric
  if (typeof rec.lrc === 'string') return rec.lrc
  return ''
}

/** 读取 track 上可能为 unknown 的字段并转成非空字符串。 */
function pickId(track: Track, key: string): string {
  const v = track[key]
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return ''
}

interface LyricsResult {
  main: LyricLineType[]
  aligned: LyricLineType[]
}

/** 拉取并解析歌词，返回主歌词与对齐后的翻译；失败或无歌词返回空结果。 */
async function fetchLyrics(track: Track): Promise<LyricsResult> {
  const empty: LyricsResult = { main: [], aligned: [] }
  try {
    let res: unknown
    if (track.source === 'qq') {
      const mid = pickId(track, 'mid') || pickId(track, 'songmid') || pickId(track, 'id')
      if (!mid) return empty
      res = await api.get('/api/qq/lyric', { mid })
    } else {
      const id = pickId(track, 'id')
      if (!id) return empty
      res = await api.get('/api/lyric', { id })
    }

    const rec = asRecord(res)
    const mainText = extractLrc(rec.lyric ?? rec.lrc ?? rec.lyrics)
    const transText = extractLrc(rec.tlyric ?? rec.tlrc ?? rec.translation)

    const main = parseLrc(mainText)
    if (!main.length) return empty
    const trans = transText ? parseLrc(transText) : []
    return { main, aligned: trans.length ? alignTranslation(main, trans) : [] }
  } catch {
    return empty
  }
}

/** 舞台歌词：垂直滚动、大字沉浸式，currentIndex 行居中高亮并平滑滚动到中间。 */
export function StageLyrics() {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const lines = useLyricsStore((s) => s.lines)
  const translation = useLyricsStore((s) => s.translation)
  const currentIndex = useLyricsStore((s) => s.currentIndex)

  const containerRef = useRef<HTMLDivElement>(null)

  // 歌曲切换时拉取歌词写入 store；用 cancelled 防竞态。
  useEffect(() => {
    if (!currentTrack) {
      useLyricsStore.getState().setLines([])
      return
    }
    let cancelled = false
    const track = currentTrack
    void (async () => {
      const { main, aligned } = await fetchLyrics(track)
      if (cancelled) return // 已切歌，丢弃过期结果，避免覆盖新歌词。
      if (aligned.length) useLyricsStore.getState().setLines(main, aligned)
      else useLyricsStore.getState().setLines(main)
    })()
    return () => {
      cancelled = true
    }
  }, [currentTrack])

  // 当前行平滑滚动到容器中央。
  useEffect(() => {
    const container = containerRef.current
    if (!container || currentIndex < 0) return
    const el = container.querySelector<HTMLElement>(`[data-line='${currentIndex}']`)
    if (!el) return
    const top = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2
    container.scrollTo({ top, behavior: 'smooth' })
  }, [currentIndex])

  if (!lines.length) {
    return (
      <div className={styles.stage}>
        <div className={styles.empty}>暂无歌词</div>
      </div>
    )
  }

  return (
    <div className={styles.stage}>
      <div className={styles.scroll} ref={containerRef}>
        <div className={styles.pad} aria-hidden="true" />
        {lines.map((line, i) => (
          <div key={`${line.time}-${i}`} data-line={i}>
            <LyricLine
              text={line.text}
              translation={translation[i]?.text || undefined}
              active={i === currentIndex}
            />
          </div>
        ))}
        <div className={styles.pad} aria-hidden="true" />
      </div>
    </div>
  )
}
