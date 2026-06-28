import styles from './TitleBar.module.css'

/**
 * 无边框窗口顶栏。
 * - 顶栏整体可拖拽（依赖全局 `.desktop-shell` 的 `-webkit-app-region: drag`），
 *   交互按钮通过 `className="no-drag"` 标记为不可拖拽。
 * - macOS 下系统自带「红绿灯」交通灯按钮负责最小化 / 全屏 / 关闭，
 *   因此隐藏这里自绘的窗口控制按钮，并在左侧留出交通灯的空间，
 *   仅保留应用名。非 macOS（Windows/Linux）则展示自绘三按钮。
 */
export function TitleBar() {
  const isMacOS = window.desktop?.platform === 'darwin'

  const handleMinimize = (): void => {
    void window.desktop?.minimize()
  }
  const handleToggleFullscreen = (): void => {
    void window.desktop?.toggleFullscreen()
  }
  const handleClose = (): void => {
    void window.desktop?.close()
  }

  return (
    <div className={`${styles.titleBar}${isMacOS ? ` ${styles.macOS}` : ''}`}>
      <div className={styles.brand}>SimpleMusic</div>

      {/* macOS 使用系统交通灯，不渲染自绘按钮 */}
      {!isMacOS && (
        <div className={styles.controls}>
          <button
            type="button"
            className={`no-drag ${styles.button}`}
            aria-label="最小化"
            title="最小化"
            onClick={handleMinimize}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <line x1="2.5" y1="6" x2="9.5" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>

          <button
            type="button"
            className={`no-drag ${styles.button}`}
            aria-label="切换全屏"
            title="切换全屏"
            onClick={handleToggleFullscreen}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none">
              <rect
                x="2.3"
                y="2.3"
                width="7.4"
                height="7.4"
                rx="1.4"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </button>

          <button
            type="button"
            className={`no-drag ${styles.button} ${styles.close}`}
            aria-label="关闭"
            title="关闭"
            onClick={handleClose}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
