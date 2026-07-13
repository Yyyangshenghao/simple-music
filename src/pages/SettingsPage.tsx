import { motion } from 'motion/react'
import { useSettingsStore } from '../stores/settings'
import { useVisualStore } from '../stores/visual'
import { useUpdateStore } from '../stores/update'
import { springSnappy, tapScale } from '../lib/motion-presets'
import styles from './SettingsPage.module.css'

type ThemeMode = 'auto' | 'light' | 'dark'
type AudioQuality = 'standard' | 'higher' | 'exhigh' | 'lossless'

export function SettingsPage() {
  const themeMode = useSettingsStore((s) => s.themeMode)
  const setThemeMode = useSettingsStore((s) => s.setThemeMode)
  const activeSource = useSettingsStore((s) => s.activeSource)
  const setActiveSource = useSettingsStore((s) => s.setActiveSource)
  const audioQuality = useSettingsStore((s) => s.audioQuality)
  const setAudioQuality = useSettingsStore((s) => s.setAudioQuality)
  const neteaseLoggedIn = useSettingsStore((s) => s.neteaseLoggedIn)
  const lyricsOverlayBlur = useSettingsStore((s) => s.lyricsOverlayBlur)
  const setLyricsOverlayBlur = useSettingsStore((s) => s.setLyricsOverlayBlur)
  const desktopLyrics = useVisualStore((s) => s.fx.desktopLyrics)
  const desktopLyricsSize = useVisualStore((s) => s.fx.desktopLyricsSize)
  const updateFx = useVisualStore((s) => s.updateFx)

  const updateInfo = useUpdateStore((s) => s.info)
  const checking = useUpdateStore((s) => s.checking)
  const downloading = useUpdateStore((s) => s.downloading)
  const job = useUpdateStore((s) => s.job)
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate)
  const startDownload = useUpdateStore((s) => s.startDownload)
  const installing = useUpdateStore((s) => s.installing)
  const installUpdate = useUpdateStore((s) => s.installUpdate)

  const currentVersion = updateInfo?.currentVersion || '1.0.0'
  const ready = job?.status === 'ready'
  const updateStatusText = checking
    ? '检查中…'
    : updateInfo?.updateAvailable
      ? `发现新版本 v${updateInfo.release.version}`
      : updateInfo
        ? '已是最新版本'
        : '尚未检查'

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>设置</h1>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>账户</h2>
        <div className={styles.row}>
          <div className={styles.rowIcon}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z"/>
            </svg>
          </div>
          <span className={styles.rowLabel}>{neteaseLoggedIn ? '已登录网易云' : '未登录'}</span>
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>外观</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>主题模式</span>
          <div className={styles.segControl}>
            {(['auto', 'light', 'dark'] as ThemeMode[]).map((m) => (
              <motion.button
                key={m}
                className={`${styles.seg} no-drag ${themeMode === m ? styles.segActive : ''}`}
                onClick={() => setThemeMode(m)}
                whileTap={tapScale}
                transition={springSnappy}
              >
                {{ auto: '自动', light: '浅色', dark: '深色' }[m]}
              </motion.button>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>音乐</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>音源</span>
          <div className={styles.segControl}>
            {(['netease', 'qq'] as const).map((s) => (
              <motion.button
                key={s}
                className={`${styles.seg} no-drag ${activeSource === s ? styles.segActive : ''}`}
                onClick={() => setActiveSource(s)}
                whileTap={tapScale}
                transition={springSnappy}
              >
                {{ netease: '网易云', qq: 'QQ 音乐' }[s]}
              </motion.button>
            ))}
          </div>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>音质偏好</span>
          <div className={styles.segControl}>
            {(['standard', 'higher', 'exhigh', 'lossless'] as AudioQuality[]).map((q) => (
              <motion.button
                key={q}
                className={`${styles.seg} no-drag ${audioQuality === q ? styles.segActive : ''}`}
                onClick={() => setAudioQuality(q)}
                whileTap={tapScale}
                transition={springSnappy}
              >
                {{ standard: '标准', higher: '高品质', exhigh: '极高', lossless: '无损' }[q]}
              </motion.button>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>3D 歌词</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>底部模糊度</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={lyricsOverlayBlur}
            onChange={(e) => setLyricsOverlayBlur(Number(e.target.value))}
            className="no-drag"
          />
          <span className={styles.rowValue}>{Math.round(lyricsOverlayBlur * 100)}%</span>
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>桌面歌词</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>启用桌面歌词</span>
          <button
            className={`${styles.seg} no-drag ${desktopLyrics ? styles.segActive : ''}`}
            onClick={() => updateFx({ desktopLyrics: !desktopLyrics })}
          >
            {desktopLyrics ? '开' : '关'}
          </button>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>字体大小</span>
          <input
            type="range"
            min={12}
            max={48}
            step={2}
            value={desktopLyricsSize}
            onChange={(e) => updateFx({ desktopLyricsSize: Number(e.target.value) })}
            className="no-drag"
          />
          <span className={styles.rowValue}>{desktopLyricsSize}px</span>
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>关于</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Simple Music</span>
          <span className={styles.rowValue}>v{currentVersion}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>{updateStatusText}</span>
          {ready ? (
            <button className={`${styles.seg} no-drag`} disabled={installing} onClick={() => void installUpdate()}>
              {installing ? '正在安装…' : '重启并安装'}
            </button>
          ) : downloading ? (
            <span className={styles.rowValue}>{job?.progress ?? 0}%</span>
          ) : updateInfo?.updateAvailable ? (
            <button className={`${styles.seg} no-drag`} onClick={() => void startDownload()}>
              下载更新
            </button>
          ) : (
            <button className={`${styles.seg} no-drag`} disabled={checking} onClick={() => void checkForUpdate()}>
              检查更新
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
