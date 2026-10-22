import { useLayoutEffect, useMemo, useState } from 'react'
import { indexForPosition } from '../stores/lyrics'
import { readLyricFrame, subscribeLyricFrames } from '../lib/lyric-frame-clock'
import { hasWordTiming } from '../lib/word-highlight-timeline'
import type { LyricLine, WordLyricLine } from '../types/domain'

/** 新句最多提前这么久登场，淡入在首字开唱前走完 */
const LINE_LEAD_SEC = 0.2

/**
 * 换句时机按帧时钟的精确媒体时间判断。store 的当前句由播放宿主按进度事件推进（约每 250ms 一次），
 * 新句会晚到最多约 0.27 秒，句首第一个字的跃起就被吞掉了。
 * 新句在上一句最后一个字唱完之后、最多提前 LINE_LEAD_SEC 登场，不截断上一句。
 */
export function lyricSwitchTimes(lines: readonly LyricLine[], wordLines: readonly (WordLyricLine | undefined)[]): LyricLine[] {
  return lines.map((line, i) => {
    if (i === 0) return line
    const prev = lines[i - 1]
    const words = wordLines[i - 1]?.words
    // 没有可信的逐字时序就不提前，免得在上一句尾字还在唱时换句。
    if (!words?.length || !hasWordTiming(words)) return line
    const last = words[words.length - 1]
    const prevEnd = prev.time + (last.startMs + (last.durationMs ?? 0)) / 1000
    if (!Number.isFinite(prevEnd)) return line
    return { ...line, time: line.time - Math.min(LINE_LEAD_SEC, Math.max(0, line.time - prevEnd)) }
  })
}

export function usePreciseLineIndex(lines: LyricLine[], wordLines: (WordLyricLine | undefined)[], fallback: number): number {
  const [index, setIndex] = useState<number | null>(null)
  const switches = useMemo(() => lyricSwitchTimes(lines, wordLines), [lines, wordLines])
  useLayoutEffect(() => {
    if (!switches.length) { setIndex(null); return }
    const apply = (time: number) => {
      const next = indexForPosition(switches, time)
      setIndex(prev => (prev === next ? prev : next))
    }
    apply(readLyricFrame().time)
    return subscribeLyricFrames(frame => apply(frame.time))
  }, [switches])
  return index ?? fallback
}
