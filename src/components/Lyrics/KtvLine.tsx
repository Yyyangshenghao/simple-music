/** 原生时间戳驱动的逐字高亮：每个词独立裁剪，媒体时钟直接定位浏览器动画。 */

import { memo, useEffect, useRef } from 'react'
import { usePlayerStore } from '../../stores/player'
import { useLyricsStore } from '../../stores/lyrics'
import { lyricPlaybackPosition } from '../../lib/lyric-playback-position'
import { createWordHighlightTimeline, hasWordTiming } from '../../lib/word-highlight-timeline'
import type { WordToken } from '../../types/domain'
import styles from './KtvLine.module.css'

interface KtvLineProps {
  words: WordToken[]
  lineStartMs: number      // 行起始时间（歌曲内绝对毫秒）
  active: boolean          // 是否是当前正在演唱的行
  dim?: boolean            // 非当前行（过去/未来）时为 true
  past?: boolean           // 已唱过的行：字保持点亮，仅整行淡出
  translationText?: string
  romaText?: string        // 罗马音注音行,显示在主歌词与翻译之间
  alignLeft?: boolean      // 左对齐（歌词页左右布局的右栏）；默认居中（3D 叠加层）
}

export const KtvLine = memo(function KtvLine({ words, lineStartMs, active, dim, past, translationText, romaText, alignLeft }: KtvLineProps) {
  const wordsRef = useRef<HTMLDivElement>(null)

  const timed = hasWordTiming(words)
  useEffect(() => {
    if (!active || !timed || !wordsRef.current) return
    const elements = Array.from(wordsRef.current.querySelectorAll(`.${styles.charFill}`))
    const timeline = createWordHighlightTimeline(elements, words)
    if (!timeline) return
    let raf = 0
    const sync = () => {
      const offsetSec = useLyricsStore.getState().offsetSec
      const position = lyricPlaybackPosition(usePlayerStore.getState())
      timeline.seek((position + offsetSec) * 1000 - lineStartMs)
    }
    const loop = () => {
      if (!document.hidden) sync()
      raf = requestAnimationFrame(loop)
    }
    sync()
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      timeline.dispose()
    }
  }, [active, timed, lineStartMs, words])

  return (
    <div className={[
      styles.line,
      active ? styles.active : '',
      !timed ? styles.untimed : '',
      dim ? styles.dim : '',
      past ? styles.past : '',
      alignLeft ? styles.alignLeft : '',
    ].filter(Boolean).join(' ')}>
      <div className={styles.words} ref={wordsRef}>
        {words.map((word, i) => (
          <span key={i} className={styles.char}>
            {word.text}
            <span className={styles.charFill} aria-hidden="true">{word.text}</span>
          </span>
        ))}
      </div>
      {romaText && (
        <div className={styles.roma}>{romaText}</div>
      )}
      {translationText && (
        <div className={styles.translation}>{translationText}</div>
      )}
    </div>
  )
})
