import styles from './DesktopLyrics.module.css'

interface DesktopLyricsProps {
  line: string
  translation?: string
  size?: number
  highlight?: boolean
}

/** 桌面歌词展示（overlay 窗口内用，纯展示）。 */
export function DesktopLyrics({ line, translation, size = 38, highlight = true }: DesktopLyricsProps) {
  return (
    <div className={styles.wrap}>
      <div
        className={`${styles.line}${highlight ? ` ${styles.glow}` : ''}`}
        style={{ fontSize: size }}
      >
        {line || '♪'}
      </div>
      {translation ? (
        <div className={styles.translation} style={{ fontSize: size * 0.6 }}>
          {translation}
        </div>
      ) : null}
    </div>
  )
}
