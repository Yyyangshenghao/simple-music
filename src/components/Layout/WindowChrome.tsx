import type { ReactNode } from 'react'
import { useWindowStore } from '../../stores/window'
import styles from './WindowChrome.module.css'

interface WindowChromeProps {
  children: ReactNode
  /** Windows 展开歌词时隐藏自绘窗口按钮，其他平台保持原有行为。 */
  lyricsOpen?: boolean
}

/** Windows/Linux 自绘最小化/最大化/关闭；macOS 由系统交通灯负责，这里不渲染。 */
function CaptionButtons({ isWindows }: { isWindows: boolean }) {
  const isMaximized = useWindowStore((s) => s.isMaximized)

  return (
    <div className={`${styles.captionButtons}${isWindows ? ` ${styles.captionButtonsWin}` : ''}`}>
      <button
        type="button"
        className={styles.captionBtn}
        aria-label="最小化"
        title={isWindows ? '最小化' : undefined}
        onClick={() => void window.desktop.minimize()}
      >
        {isWindows ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
            <path d="M3.5 8h9" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className={styles.captionBtn}
        aria-label={isMaximized ? '向下还原' : '最大化'}
        title={isWindows ? (isMaximized ? '向下还原' : '最大化') : undefined}
        onClick={() => void window.desktop.maximize()}
      >
        {isWindows ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {isMaximized ? (
              <>
                <path d="M6 5V3.5h6.5V10H11" />
                <rect x="3.5" y="6" width="6.5" height="6.5" rx="1" />
              </>
            ) : (
              <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
            )}
          </svg>
        ) : isMaximized ? (
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
        title={isWindows ? '关闭' : undefined}
        onClick={() => void window.desktop.close()}
      >
        {isWindows ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
            <path d="m4 4 8 8m0-8-8 8" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
            <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" />
          </svg>
        )}
      </button>
    </div>
  )
}

export function WindowChrome({ children, lyricsOpen = false }: WindowChromeProps) {
  const isFullScreen = useWindowStore((s) => s.isFullScreen)
  const platform = window.desktop?.platform
  const showCaptionButtons = !!platform && platform !== 'darwin' && !isFullScreen && !(platform === 'win32' && lyricsOpen)

  return (
    <div className={`${styles.chrome}${isFullScreen ? ` ${styles.fullScreen}` : ''}`}>
      {children}
      {showCaptionButtons && <CaptionButtons isWindows={platform === 'win32'} />}
    </div>
  )
}
