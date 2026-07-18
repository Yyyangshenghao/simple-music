import type { ReactNode } from 'react'
import { useWindowStore } from '../../stores/window'
import styles from './WindowChrome.module.css'

interface WindowChromeProps {
  children: ReactNode
}

/** Windows/Linux 无原生标题栏，自绘最小化/最大化/关闭。常驻于 WindowChrome 而非 TopBar，
 * 保证歌词页等 TopBar 隐藏的场景下窗口仍可控制（macOS 由系统交通灯负责，这里不渲染）。 */
function CaptionButtons() {
  const isMaximized = useWindowStore((s) => s.isMaximized)

  return (
    <div className={styles.captionButtons}>
      <button
        type="button"
        className={styles.captionBtn}
        aria-label="最小化"
        onClick={() => void window.desktop.minimize()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className={styles.captionBtn}
        aria-label={isMaximized ? '向下还原' : '最大化'}
        onClick={() => void window.desktop.maximize()}
      >
        {isMaximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
            <rect x="0.5" y="2.5" width="6.5" height="6.5" />
            <path d="M2.5 2.5V0.5H9.5V7.5H7.5" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className={`${styles.captionBtn} ${styles.captionClose}`}
        aria-label="关闭"
        onClick={() => void window.desktop.close()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
          <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" />
        </svg>
      </button>
    </div>
  )
}

export function WindowChrome({ children }: WindowChromeProps) {
  const isFullScreen = useWindowStore((s) => s.isFullScreen)
  const platform = window.desktop?.platform
  const showCaptionButtons = !!platform && platform !== 'darwin' && !isFullScreen

  return (
    <div className={`${styles.chrome}${isFullScreen ? ` ${styles.fullScreen}` : ''}`}>
      {children}
      {showCaptionButtons && <CaptionButtons />}
    </div>
  )
}
