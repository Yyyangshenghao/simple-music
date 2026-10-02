import styles from './DesktopLyrics.module.css'
import { fontFamilyCssValue } from '../../lib/font-family'
import { DESKTOP_LYRICS_GAP, DESKTOP_LYRICS_LINE_HEIGHT, DESKTOP_LYRICS_TRANSLATION_SCALE } from '../../lib/desktop-lyrics-layout'

interface DesktopLyricsProps {
  line: string
  translation?: string
  roma?: string
  size?: number
  highlight?: boolean
  fontFamily?: string
  color?: string
  fitHeight?: boolean
}

/** 桌面歌词展示（overlay 窗口内用，纯展示）。 */
export function DesktopLyrics({ line, translation, roma, size = 38, highlight = true, fontFamily = '', color = '#ffffff', fitHeight = false }: DesktopLyricsProps) {
  const secondaryLines = Number(!!translation) + Number(!!roma)
  const fontSize = fitHeight
    ? `calc((100cqh - 8px - ${secondaryLines * DESKTOP_LYRICS_GAP}px) / ${DESKTOP_LYRICS_LINE_HEIGHT * (1 + secondaryLines * DESKTOP_LYRICS_TRANSLATION_SCALE)})`
    : size
  return (
    <div className={styles.wrap} style={{ fontSize, fontFamily: fontFamilyCssValue(fontFamily), color: /^#[\da-f]{6}$/i.test(color) ? color : '#ffffff' }}>
      <div
        data-desktop-lyrics-text
        className={`${styles.line}${highlight ? ` ${styles.glow}` : ''}`}
      >
        {line || '♪'}
      </div>
      {roma ? <div data-desktop-lyrics-text className={styles.translation}>{roma}</div> : null}
      {translation ? (
        <div data-desktop-lyrics-text className={styles.translation}>
          {translation}
        </div>
      ) : null}
    </div>
  )
}
