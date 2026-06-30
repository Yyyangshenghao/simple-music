import { useState } from 'react'
import { useSettingsStore } from '../../stores/settings'
import { useNavigationStore } from '../../stores/navigation'
import { api } from '../../lib/api'
import type { LoginResult } from '../../types/ipc'
import styles from './AvatarMenu.module.css'

const SOURCES = [
  { key: 'netease' as const, label: '网易云' },
  { key: 'qq' as const, label: 'QQ 音乐' },
]

interface AvatarMenuProps {
  onClose: () => void
}

export function AvatarMenu({ onClose }: AvatarMenuProps) {
  const activeSource = useSettingsStore((s) => s.activeSource)
  const setActiveSource = useSettingsStore((s) => s.setActiveSource)
  const neteaseLoggedIn = useSettingsStore((s) => s.neteaseLoggedIn)
  const qqLoggedIn = useSettingsStore((s) => s.qqLoggedIn)
  const setNeteaseLoggedIn = useSettingsStore((s) => s.setNeteaseLoggedIn)
  const setQQLoggedIn = useSettingsStore((s) => s.setQQLoggedIn)
  const navigateTo = useNavigationStore((s) => s.navigateTo)

  const [accountOpen, setAccountOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const loginNetease = () => {
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

  const logoutNetease = () => {
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

  const loginQQ = () => {
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

  const logoutQQ = () => {
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

  const openSettings = () => {
    navigateTo('settings')
    onClose()
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.menu}>
        {/* 来源切换 */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>音乐来源</div>
          <div className={styles.sourceRow}>
            {SOURCES.map((s) => (
              <button
                key={s.key}
                className={`${styles.sourceBtn} ${activeSource === s.key ? styles.sourceBtnActive : ''}`}
                onClick={() => setActiveSource(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.divider} />

        {/* 账号设置（inline 展开） */}
        <button className={styles.menuRow} onClick={() => setAccountOpen((v) => !v)}>
          <span>账号设置</span>
          <svg
            className={`${styles.chevron} ${accountOpen ? styles.chevronOpen : ''}`}
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {accountOpen && (
          <div className={styles.accountSection}>
            <div className={styles.accountRow}>
              <div className={styles.accountInfo}>
                <span className={styles.platform}>网易云音乐</span>
                <span className={`${styles.loginState} ${neteaseLoggedIn ? styles.loggedIn : ''}`}>
                  {neteaseLoggedIn ? '已登录' : '未登录'}
                </span>
              </div>
              {neteaseLoggedIn ? (
                <button className={styles.ghostBtn} disabled={busy} onClick={logoutNetease}>退出</button>
              ) : (
                <button className={styles.primaryBtn} disabled={busy} onClick={loginNetease}>登录</button>
              )}
            </div>

            <div className={styles.accountRow}>
              <div className={styles.accountInfo}>
                <span className={styles.platform}>QQ 音乐</span>
                <span className={`${styles.loginState} ${qqLoggedIn ? styles.loggedIn : ''}`}>
                  {qqLoggedIn ? '已登录' : '未登录'}
                </span>
              </div>
              {qqLoggedIn ? (
                <button className={styles.ghostBtn} disabled={busy} onClick={logoutQQ}>退出</button>
              ) : (
                <button className={styles.primaryBtn} disabled={busy} onClick={loginQQ}>登录</button>
              )}
            </div>
          </div>
        )}

        <div className={styles.divider} />

        {/* 设置 */}
        <button className={styles.menuRow} onClick={openSettings}>
          设置
        </button>
      </div>
    </>
  )
}
