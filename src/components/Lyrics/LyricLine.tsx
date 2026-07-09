import styles from './LyricLine.module.css'

interface LyricLineProps {
  text: string
  translation?: string
  active: boolean
  /** 左对齐(歌词页左右布局的右栏);默认居中(3D 叠加层) */
  alignLeft?: boolean
}

/** 单行舞台歌词：active 行高亮放大发光，非 active 半透明。 */
export function LyricLine({ text, translation, active, alignLeft }: LyricLineProps) {
  return (
    <div
      className={`${styles.line}${active ? ` ${styles.active}` : ''}${alignLeft ? ` ${styles.alignLeft}` : ''}`}
      data-active={active}
      aria-current={active ? 'true' : undefined}
    >
      <span className={styles.main}>{text}</span>
      {translation ? <span className={styles.translation}>{translation}</span> : null}
    </div>
  )
}
