/**
 * KTV 风格逐字高亮歌词行。
 *
 * active 时内部用 rAF 每帧读取音频引擎的精确播放位置，把行内已播放毫秒数
 * 写入行容器的 CSS 变量 --elapsed；每个字按自身时间窗 [--ws, --ws + --wd]
 * 在 CSS 里计算点亮进度，实现丝滑的从左到右亮度扫光（不经过 React 重渲染）。
 *
 * 用法示例（在 LyricsPanel 中）：
 *   <KtvLine
 *     words={wordLine.words}
 *     lineDurationMs={wordLine.durationMs}
 *     lineStartMs={wordLine.time * 1000}
 *     active={true}
 *     translationText={translation[i]?.text}
 *   />
 *
 * 外层容器需要设置 font-size（active 行建议 26–30px，非 active 行 18–20px）。
 */

import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../../stores/player'
import styles from './KtvLine.module.css'

interface WordToken {
  text: string
  startMs: number       // 相对于行起始时间的毫秒偏移
  durationMs?: number   // 该字的精确时长（来自 YRC；估算数据无此字段）
}

interface KtvLineProps {
  words: WordToken[]
  lineDurationMs: number   // 整行时长（毫秒）
  lineStartMs: number      // 行起始时间（歌曲内绝对毫秒）
  active: boolean          // 是否是当前正在演唱的行
  dim?: boolean            // 非当前行（过去/未来）时为 true
  past?: boolean           // 已唱过的行：字保持点亮，仅整行淡出
  translationText?: string
  alignLeft?: boolean      // 左对齐（歌词页左右布局的右栏）；默认居中（3D 叠加层）
}

export function KtvLine({ words, lineDurationMs, lineStartMs, active, dim, past, translationText, alignLeft }: KtvLineProps) {
  const wordsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active) return
    const engine = usePlayerStore.getState()._engine()
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      // backgroundThrottling 关闭时窗口隐藏 rAF 照跑,跳过无意义的样式写入
      if (document.hidden) return
      wordsRef.current?.style.setProperty('--elapsed', (engine.position * 1000 - lineStartMs).toFixed(1))
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active, lineStartMs])

  return (
    <div className={[
      styles.line,
      active ? styles.active : '',
      dim ? styles.dim : '',
      past ? styles.past : '',
      alignLeft ? styles.alignLeft : '',
    ].filter(Boolean).join(' ')}>
      <div className={styles.words} ref={wordsRef}>
        {words.map((word, i) => {
          const nextStartMs = words[i + 1]?.startMs ?? lineDurationMs
          const durMs = Math.max(80, word.durationMs ?? (nextStartMs - word.startMs))
          return (
            <span
              key={i}
              className={styles.char}
              style={{ '--ws': word.startMs, '--wd': durMs } as React.CSSProperties}
            >
              {word.text}
            </span>
          )
        })}
      </div>
      {translationText && (
        <div className={styles.translation}>{translationText}</div>
      )}
    </div>
  )
}
