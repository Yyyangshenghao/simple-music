import { useState } from 'react'
import { motion } from 'motion/react'
import { useSettingsStore } from '../../stores/settings'
import { useProviderStore } from '../../stores/providers'
import { useToastStore } from '../../stores/toast'
import { useNavigationStore } from '../../stores/navigation'
import { api } from '../../lib/api'
import { loginMusicProvider } from '../../lib/provider-login'
import type { ProviderId } from '../../providers/types'
import { listProviders } from '../../providers/registry'
import { springSnappy, tapScale } from '../../lib/motion-presets'
import { SourceName } from '../ui/SourceName'
import { AppleMusicIcon, NeteaseLogo, QQMusicLogo } from '../ui/brand-logos'
import { Switch } from '../ui/Switch'
import styles from './AvatarMenu.module.css'

interface AvatarMenuProps {
  onClose(): void
}

function ProviderMark({ source }: { source: ProviderId }) {
  if (source === 'netease') return <NeteaseLogo />
  if (source === 'qq') return <QQMusicLogo />
  return <AppleMusicIcon />
}

export function AvatarMenu({ onClose }: AvatarMenuProps) {
  const providers = listProviders()
  const runtime = useProviderStore((state) => state.byId)
  const setEnabled = useProviderStore((state) => state.setEnabled)
  const neteaseLoggedIn = useSettingsStore((state) => state.neteaseLoggedIn)
  const qqLoggedIn = useSettingsStore((state) => state.qqLoggedIn)
  const setNeteaseLoggedIn = useSettingsStore((state) => state.setNeteaseLoggedIn)
  const setQQLoggedIn = useSettingsStore((state) => state.setQQLoggedIn)
  const navigateTo = useNavigationStore((state) => state.navigateTo)
  const requestSettingsMusic = useNavigationStore((state) => state.requestSettingsMusic)
  const [busySource, setBusySource] = useState<ProviderId | null>(null)

  async function login(source: ProviderId): Promise<void> {
    if (source === 'apple') {
      navigateTo('settings')
      onClose()
      return
    }
    setBusySource(source)
    try {
      await loginMusicProvider(source)
    } catch {
      useToastStore.getState().show('登录失败，请重试')
    } finally {
      setBusySource(null)
    }
  }

  async function logout(source: ProviderId): Promise<void> {
    setBusySource(source)
    try {
      if (source === 'apple') {
        await api.post('/api/apple-music/bridge/logout')
        useProviderStore.getState().setAccountState('apple', 'anonymous')
      } else if (source === 'netease') {
        setNeteaseLoggedIn(false)
        useProviderStore.getState().setAccountState('netease', 'anonymous')
        await Promise.allSettled([
          window.desktop?.clearNeteaseLogin(),
          api.post('/api/logout'),
        ])
      } else {
        setQQLoggedIn(false)
        useProviderStore.getState().setAccountState('qq', 'anonymous')
        await Promise.allSettled([
          window.desktop?.clearQQLogin(),
          api.post('/api/qq/logout'),
        ])
      }
    } finally {
      setBusySource(null)
    }
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.menu} aria-label="音源与账号">
        <div className={styles.heading}>
          <strong>音源</strong>
          <motion.button
            type="button"
            className={styles.settingsButton}
            aria-label="前往音源与播放设置"
            title="音源与播放设置"
            onClick={() => {
              if (useNavigationStore.getState().currentView !== 'settings') navigateTo('settings')
              requestSettingsMusic()
              onClose()
            }}
            whileTap={tapScale}
            transition={springSnappy}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
              <circle cx="9" cy="7" r="2" fill="var(--glass-bg-card)" />
              <circle cx="16" cy="12" r="2" fill="var(--glass-bg-card)" />
              <circle cx="11" cy="17" r="2" fill="var(--glass-bg-card)" />
            </svg>
          </motion.button>
        </div>

        <div className={styles.providerList}>
          {providers.map((provider) => {
            const source = provider.descriptor.id
            const loggedIn = source === 'apple' ? runtime.apple.auth === 'authenticated' : source === 'netease' ? neteaseLoggedIn : qqLoggedIn
            const state = runtime[source]
            const accountLabel = loggedIn
              ? source === 'apple' ? '已连接' : state.profile?.nickname || '已连接'
              : '未登录'
            const statusLabel = !loggedIn ? '未登录' : state.enabled ? '已启用' : '已登录，未启用'
            return (
              <section className={styles.providerRow} key={source} aria-label={provider.descriptor.label}>
                <span className={styles.providerMark} aria-hidden="true"><ProviderMark source={source} /></span>
                <div className={styles.providerIdentity}>
                  <strong><SourceName source={source} /></strong>
                  <span className={styles.accountName} title={`${accountLabel} · ${statusLabel}`}>
                    <span className={styles.statusDot} data-active={loggedIn && state.enabled} data-connected={loggedIn} aria-hidden="true" />
                    {accountLabel}
                  </span>
                </div>
                <div className={styles.providerActions}>
                  <Switch
                    checked={loggedIn && state.enabled}
                    disabled={!loggedIn}
                    onChange={(enabled) => setEnabled(source, enabled)}
                    aria-label={`${loggedIn && state.enabled ? '停用' : '启用'}${provider.descriptor.label}`}
                  />
                  <button
                    type="button"
                    className={styles.accountButton}
                    disabled={busySource !== null}
                    onClick={() => void (loggedIn ? logout(source) : login(source))}
                    aria-label={`${busySource === source ? '正在处理' : loggedIn ? '退出' : '登录'}${provider.descriptor.label}`}
                    title={busySource === source ? '处理中…' : loggedIn ? '退出登录' : '登录账号'}
                  >
                    {busySource === source ? <span className={styles.spinner} aria-hidden="true" /> : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M13 5h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
                        {loggedIn ? <path d="m8 8-4 4 4 4M4 12h12" /> : <path d="m12 8 4 4-4 4M16 12H4" />}
                      </svg>
                    )}
                  </button>
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </>
  )
}
