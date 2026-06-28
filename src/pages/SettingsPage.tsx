import { useSettingsStore } from '../stores/settings'
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
              <button
                key={m}
                className={`${styles.seg} no-drag ${themeMode === m ? styles.segActive : ''}`}
                onClick={() => setThemeMode(m)}
              >
                {{ auto: '自动', light: '浅色', dark: '深色' }[m]}
              </button>
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
              <button
                key={s}
                className={`${styles.seg} no-drag ${activeSource === s ? styles.segActive : ''}`}
                onClick={() => setActiveSource(s)}
              >
                {{ netease: '网易云', qq: 'QQ 音乐' }[s]}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>音质偏好</span>
          <div className={styles.segControl}>
            {(['standard', 'higher', 'exhigh', 'lossless'] as AudioQuality[]).map((q) => (
              <button
                key={q}
                className={`${styles.seg} no-drag ${audioQuality === q ? styles.segActive : ''}`}
                onClick={() => setAudioQuality(q)}
              >
                {{ standard: '标准', higher: '高品质', exhigh: '极高', lossless: '无损' }[q]}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>关于</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>SimpleMusic</span>
          <span className={styles.rowValue}>v1.0.0</span>
        </div>
      </section>
    </div>
  )
}
