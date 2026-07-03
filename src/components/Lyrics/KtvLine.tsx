/**
 * KTV 风格逐字高亮歌词行。
 *
 * 用法示例（在 LyricsPanel 中）：
 *   import { KtvLine } from './KtvLine'
 *
 *   <KtvLine
 *     words={wordLines[currentIndex]?.words ?? []}
 *     lineDurationMs={wordLines[currentIndex]?.durationMs ?? 4000}
 *     progress={currentCharProgress}   // 来自 useLyricsStore
 *     active={true}
 *     translationText={translation[currentIndex]?.text}
 *   />
 *
 * 外层容器需要设置 font-size（active 行建议 26–30px，非 active 行 18–20px）。
 */

import styles from './KtvLine.module.css'

interface WordToken {
  text: string
  startMs: number   // 相对于行起始时间的毫秒偏移
}

interface KtvLineProps {
  words: WordToken[]
  lineDurationMs: number   // 整行时长（毫秒）
  progress: number         // 0–1，当前行内进度（由外部 tick 传入）
  active: boolean          // 是否是当前正在演唱的行
  dim?: boolean            // 非当前行（过去/未来）时为 true
  translationText?: string
}

export function KtvLine({ words, lineDurationMs, progress, active, dim, translationText }: KtvLineProps) {
  return (
    <div className={[
      styles.line,
      active ? styles.active : '',
      dim ? styles.dim : '',
    ].filter(Boolean).join(' ')}>
      <div className={styles.words}>
        {words.map((word, i) => {
          const threshold = lineDurationMs > 0 ? word.startMs / lineDurationMs : 0
          const charProgress = active
            ? Math.min(1, Math.max(0, (progress - threshold) / 0.05))
            : (dim ? 0 : 1)  // dim 行全暗，非当前非dim全亮
          return (
            <span
              key={i}
              className={styles.char}
              style={{ '--char-progress': charProgress } as React.CSSProperties}
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
