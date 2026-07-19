import { memo } from 'react'
import styles from './LyricLine.module.css'

interface LyricLineProps {
  text: string
  translation?: string
  /** 罗马音注音行,显示在主歌词与翻译之间 */
  roma?: string
  active: boolean
  /** 左对齐(歌词页左右布局的右栏);默认居中(3D 叠加层) */
  alignLeft?: boolean
  /** 3D 叠加层模式:字号继承外层容器(`.overlayCurrentLine`/`.overlayNextLine`),
   * 不再自压透明度,避免与叠加层自身的 opacity 叠乘 */
  overlay?: boolean
}

/** 单行舞台歌词：active 行高亮放大发光，非 active 半透明。 */
export const LyricLine = memo(function LyricLine({ text, translation, roma, active, alignLeft, overlay }: LyricLineProps) {
  return (
    <div
      className={`${styles.line}${active ? ` ${styles.active}` : ''}${alignLeft ? ` ${styles.alignLeft}` : ''}${overlay ? ` ${styles.overlay}` : ''}`}
      data-active={active}
      aria-current={active ? 'true' : undefined}
    >
      <span className={styles.main}>{text}</span>
      {roma ? <span className={styles.roma}>{roma}</span> : null}
      {translation ? <span className={styles.translation}>{translation}</span> : null}
    </div>
  )
})
