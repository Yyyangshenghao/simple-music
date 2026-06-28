import { useState } from 'react'
import { useSettingsStore } from '../../stores/settings'
import { api } from '../../lib/api'
import { Toggle } from '../ui/Toggle'
import type { LoginResult } from '../../types/ipc'
import styles from './AccountSettings.module.css'

const isMacOS = (): boolean => window.desktop?.platform === 'darwin'

/** 账号设置：网易/QQ 登录态，壁纸与桌面歌词开关（macOS 禁用）。 */
export function AccountSettings() {
  const neteaseLoggedIn = useSettingsStore((s) => s.neteaseLoggedIn)
  const qqLoggedIn = useSettingsStore((s) => s.qqLoggedIn)
  const setNeteaseLoggedIn = useSettingsStore((s) => s.setNeteaseLoggedIn)
  const setQQLoggedIn = useSettingsStore((s) => s.setQQLoggedIn)

  const [busy, setBusy] = useState(false)
  const [wallpaper, setWallpaper] = useState(false)
  const [desktopLyrics, setDesktopLyrics] = useState(false)
  const macOS = isMacOS()

  const loginNetease = (): void => {
    void (async () => {
      setBusy(true)
      try {
        const r = (await window.desktop?.openNeteaseLogin()) as LoginResult | undefined
        if (r?.ok && r.cookie) {
          await api.post('/api/login/cookie', { cookie: r.cookie })
          setNeteaseLoggedIn(true)
        }
      } finally {
        setBusy(false)
      }
    })()
  }

  const logoutNetease = (): void => {
    void (async () => {
      setBusy(true)
      try {
        await window.desktop?.clearNeteaseLogin()
        await api.post('/api/logout')
        setNeteaseLoggedIn(false)
      } finally {
        setBusy(false)
      }
    })()
  }

  const loginQQ = (): void => {
    void (async () => {
      setBusy(true)
      try {
        const r = (await window.desktop?.openQQLogin()) as LoginResult | undefined
        if (r?.ok && r.cookie) {
          await api.post('/api/qq/login/cookie', { cookie: r.cookie })
          setQQLoggedIn(true)
        }
      } finally {
        setBusy(false)
      }
    })()
  }

  const logoutQQ = (): void => {
    void (async () => {
      setBusy(true)
      try {
        await window.desktop?.clearQQLogin()
        await api.post('/api/qq/logout')
        setQQLoggedIn(false)
      } finally {
        setBusy(false)
      }
    })()
  }

  const toggleWallpaper = (v: boolean): void => {
    setWallpaper(v)
    void window.desktop?.setWallpaperEnabled(v)
  }

  const toggleDesktopLyrics = (v: boolean): void => {
    setDesktopLyrics(v)
    void window.desktop?.setDesktopLyricsEnabled(v)
  }

  return (
    <div className={styles.root}>
      <section className={styles.section}>
        <h3 className={styles.heading}>音乐账号</h3>

        <div className={styles.account}>
          <div className={styles.meta}>
            <span className={styles.platform}>网易云音乐</span>
            <span className={`${styles.state}${neteaseLoggedIn ? ` ${styles.online}` : ''}`}>
              {neteaseLoggedIn ? '已登录' : '未登录'}
            </span>
          </div>
          {neteaseLoggedIn ? (
            <button type="button" className={styles.ghost} disabled={busy} onClick={logoutNetease}>
              退出登录
            </button>
          ) : (
            <button type="button" className={styles.primary} disabled={busy} onClick={loginNetease}>
              登录
            </button>
          )}
        </div>

        <div className={styles.account}>
          <div className={styles.meta}>
            <span className={styles.platform}>QQ 音乐</span>
            <span className={`${styles.state}${qqLoggedIn ? ` ${styles.online}` : ''}`}>
              {qqLoggedIn ? '已登录' : '未登录'}
            </span>
          </div>
          {qqLoggedIn ? (
            <button type="button" className={styles.ghost} disabled={busy} onClick={logoutQQ}>
              退出登录
            </button>
          ) : (
            <button type="button" className={styles.primary} disabled={busy} onClick={loginQQ}>
              登录
            </button>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>桌面增强</h3>

        <div className={styles.toggleRow}>
          <Toggle label="桌面壁纸" checked={wallpaper} disabled={macOS} onChange={toggleWallpaper} />
          {macOS && <span className={styles.note}>仅 Windows 支持</span>}
        </div>

        <div className={styles.toggleRow}>
          <Toggle
            label="桌面歌词（中键切换）"
            checked={desktopLyrics}
            disabled={macOS}
            onChange={toggleDesktopLyrics}
          />
          {macOS && <span className={styles.note}>仅 Windows 支持</span>}
        </div>
      </section>
    </div>
  )
}
