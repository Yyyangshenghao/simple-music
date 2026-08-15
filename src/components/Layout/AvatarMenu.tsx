import { useState } from 'react'
import { motion } from 'motion/react'
import { useSettingsStore } from '../../stores/settings'
import { useProviderStore } from '../../stores/providers'
import { useNavigationStore } from '../../stores/navigation'
import { api } from '../../lib/api'
import type { LoginResult } from '../../types/ipc'
import type { ProviderId } from '../../providers/types'
import { listProviders } from '../../providers/registry'
import { springSnappy, tapScale } from '../../lib/motion-presets'
import { SourceBadge } from '../ui/SourceBadge'
import { Switch } from '../ui/Switch'
import styles from './AvatarMenu.module.css'

interface AvatarMenuProps {
  onClose(): void
}

export function AvatarMenu({ onClose }: AvatarMenuProps) {
  const providers = listProviders()
  const runtime = useProviderStore((state) => state.byId)
  const setEnabled = useProviderStore((state) => state.setEnabled)
  const neteaseLoggedIn = useSettingsStore((state) => state.neteaseLoggedIn)
  const qqLoggedIn = useSettingsStore((state) => state.qqLoggedIn)
  const setNeteaseLoggedIn = useSettingsStore((state) => state.setNeteaseLoggedIn)
  const setQQLoggedIn = useSettingsStore((state) => state.setQQLoggedIn)
  const setNeteaseProfile = useSettingsStore((state) => state.setNeteaseProfile)
  const setQQProfile = useSettingsStore((state) => state.setQQProfile)
  const navigateTo = useNavigationStore((state) => state.navigateTo)
  const [busySource, setBusySource] = useState<ProviderId | null>(null)

  async function login(source: ProviderId): Promise<void> {
    setBusySource(source)
    try {
      if (source === 'netease') {
        const result = (await window.desktop?.openNeteaseLogin()) as LoginResult | undefined
        if (result?.ok && result.cookie) {
          const info = await api.post<{ avatar?: string; nickname?: string }>('/api/login/cookie', { cookie: result.cookie })
          const profile = { avatar: info.avatar || '', nickname: info.nickname || '' }
          setNeteaseLoggedIn(true)
          setNeteaseProfile(profile.avatar, profile.nickname)
          useProviderStore.getState().setAccountState('netease', 'authenticated', profile)
        }
      } else {
        const result = (await window.desktop?.openQQLogin()) as LoginResult | undefined
        if (result?.ok && result.cookie) {
          const info = await api.post<{ avatar?: string; nickname?: string }>('/api/qq/login/cookie', { cookie: result.cookie })
          const profile = { avatar: info.avatar || '', nickname: info.nickname || '' }
          setQQLoggedIn(true)
          setQQProfile(profile.avatar, profile.nickname)
          useProviderStore.getState().setAccountState('qq', 'authenticated', profile)
        }
      }
    } finally {
      setBusySource(null)
    }
  }

  async function logout(source: ProviderId): Promise<void> {
    setBusySource(source)
    try {
      if (source === 'netease') {
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
          <strong>音源与账号</strong>
          <span>平台可同时启用</span>
        </div>

        <div className={styles.providerList}>
          {providers.map((provider) => {
            const source = provider.descriptor.id
            const loggedIn = source === 'netease' ? neteaseLoggedIn : qqLoggedIn
            const state = runtime[source]
            return (
              <section className={styles.providerCard} key={source} aria-label={provider.descriptor.label}>
                <div className={styles.providerTop}>
                  <div className={styles.providerIdentity}>
                    <SourceBadge source={source} reveal />
                    <strong>{provider.descriptor.label}</strong>
                  </div>
                  <Switch
                    checked={loggedIn && state.enabled}
                    disabled={!loggedIn}
                    onChange={(enabled) => setEnabled(source, enabled)}
                    aria-label={`${loggedIn && state.enabled ? '停用' : '启用'}${provider.descriptor.label}`}
                  />
                </div>
                <div className={styles.accountRow}>
                  <div className={styles.accountInfo}>
                    <span className={styles.accountName}>{state.profile?.nickname || provider.descriptor.label}</span>
                    <span className={`${styles.loginState}${loggedIn ? ` ${styles.loggedIn}` : ''}`}>
                      {loggedIn ? state.enabled ? '账号已连接 · 已参与' : '账号已连接 · 尚未启用' : '未登录 · 不参与应用内容'}
                    </span>
                  </div>
                  <button
                    className={loggedIn ? styles.ghostBtn : styles.primaryBtn}
                    disabled={busySource !== null}
                    onClick={() => void (loggedIn ? logout(source) : login(source))}
                  >
                    {busySource === source ? '处理中…' : loggedIn ? '退出' : '登录'}
                  </button>
                </div>
              </section>
            )
          })}
        </div>

        <div className={styles.divider} />
        <motion.button
          className={styles.menuRow}
          onClick={() => {
            navigateTo('settings')
            onClose()
          }}
          whileTap={tapScale}
          transition={springSnappy}
        >
          <span>打开完整设置</span>
          <svg
            className={styles.menuChevron}
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </motion.button>
      </div>
    </>
  )
}
