import { useState } from 'react'
import { motion } from 'motion/react'
import { useSettingsStore } from '../../stores/settings'
import { useProviderStore } from '../../stores/providers'
import { useAppleMusicConnection } from '../../stores/apple-music-connection'
import { useToastStore } from '../../stores/toast'
import { useNavigationStore } from '../../stores/navigation'
import { logoutMusicProvider } from '../../lib/provider-logout'
import { isGuestLoginProvider, isGuestOnlyProvider, type ProviderId } from '../../providers/types'
import { useQrLoginDialog } from '../Settings/QrLoginDialog'
import { listProviders } from '../../providers/registry'
import { springSnappy, tapScale } from '../../lib/motion-presets'
import { SourceName } from '../ui/SourceName'
import { AppleMusicIcon, KugouLogo, NeteaseLogo, QQMusicLogo, QishuiLogo } from '../ui/brand-logos'
import { Switch } from '../ui/Switch'
import styles from './AvatarMenu.module.css'
import { useFeedback } from '../../hooks/useMotion'

interface AvatarMenuProps {
  onClose(): void
}

function ProviderMark({ source }: { source: ProviderId }) {
  if (source === 'netease') return <NeteaseLogo />
  if (source === 'qq') return <QQMusicLogo />
  if (source === 'kugou') return <KugouLogo />
  if (source === 'qishui') return <QishuiLogo />
  return <AppleMusicIcon />
}

export function AvatarMenu({ onClose }: AvatarMenuProps) {
  const tap = useFeedback('tapFeedbackMotion')
  const providers = listProviders()
  const runtime = useProviderStore((state) => state.byId)
  const setEnabled = useProviderStore((state) => state.setEnabled)
  const neteaseLoggedIn = useSettingsStore((state) => state.neteaseLoggedIn)
  const qqLoggedIn = useSettingsStore((state) => state.qqLoggedIn)
  const navigateTo = useNavigationStore((state) => state.navigateTo)
  const requestSettingsMusic = useNavigationStore((state) => state.requestSettingsMusic)
  const apple = useAppleMusicConnection()
  const [busySource, setBusySource] = useState<ProviderId | null>(null)

  async function login(source: ProviderId): Promise<void> {
    if (isGuestOnlyProvider(source)) return
    if (source === 'kugou' || source === 'netease' || source === 'qq') {
      // 应用内扫码：浮层自己管理进度，菜单先收起让出视线。
      useQrLoginDialog.getState().show(source)
      onClose()
      return
    }
    setBusySource(source)
    try {
      if (source === 'apple') {
        await useAppleMusicConnection.getState().connect()
        const connection = useAppleMusicConnection.getState()
        if (connection.error) useToastStore.getState().show(connection.message)
      }
    } catch {
      useToastStore.getState().show('登录失败，请重试')
    } finally {
      setBusySource(null)
    }
  }

  async function logout(source: ProviderId): Promise<void> {
    if (isGuestOnlyProvider(source)) return
    setBusySource(source)
    try {
      if (source === 'apple') {
        await useAppleMusicConnection.getState().disconnect()
        const connection = useAppleMusicConnection.getState()
        if (connection.error) useToastStore.getState().show(connection.message)
      } else if (source !== 'bilibili') {
        await logoutMusicProvider(source)
      }
    } catch {
      useToastStore.getState().show('退出登录失败，请重试')
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
              // 先记下跳转请求再进入设置页，挂载时直接落位。
              requestSettingsMusic()
              if (useNavigationStore.getState().currentView !== 'settings') navigateTo('settings')
              onClose()
            }}
            whileTap={tap(tapScale)}
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
            // 兜底平台没有账号，只在设置的播放偏好里开关。
            if (source === 'bilibili') return null
            const guest = isGuestOnlyProvider(source)
            const state = runtime[source]
            const guestLogin = isGuestLoginProvider(source)
            // 酷狗不登录也有游客会话：开关看会话，账号按钮看是否登录了账号。
            const loggedIn = source === 'apple' ? runtime.apple.auth === 'authenticated' : source === 'netease' ? neteaseLoggedIn : source === 'qq' ? qqLoggedIn : guest || guestLogin
            const accountIn = guestLogin ? !!state.accountLinked : loggedIn
            const waiting = source === 'apple' && apple.phase === 'waiting'
            // 重新启用 Apple 时后台页面需要几秒静默重连；平台关着时页面已销毁，只保留登录。
            const reconnecting = source === 'apple' && !!apple.account?.restoring
            const processing = busySource === source || reconnecting || (source === 'apple' && ['opening', 'disconnecting'].includes(apple.phase))
            const accountLabel = reconnecting ? '连接中' : waiting && !loggedIn ? '等待授权' : loggedIn
              ? guest || (guestLogin && !accountIn) ? '游客' : source === 'apple' ? apple.account?.suspended ? '已登录' : '已连接' : state.profile?.nickname || '已连接'
              : '未登录'
            const statusLabel = !loggedIn ? '未登录' : state.enabled ? '已启用' : guest ? '未启用' : '已登录，未启用'
            return (
              <section className={styles.providerRow} key={source} aria-label={provider.descriptor.label}>
                <span className={styles.providerMark} aria-hidden="true"><ProviderMark source={source} /></span>
                <div className={styles.providerIdentity}>
                  <strong><SourceName source={source} /></strong>
                  <span className={styles.accountName} title={source === 'apple' && apple.message ? apple.message : `${accountLabel} · ${statusLabel}`}>
                    <span className={styles.statusDot} data-active={loggedIn && state.enabled} data-connected={loggedIn} aria-hidden="true" />
                    {accountLabel}
                  </span>
                </div>
                <div className={styles.providerActions}>
                  <Switch
                    checked={loggedIn && state.enabled}
                    disabled={!loggedIn}
                    onChange={(enabled) => {
                      setEnabled(source, enabled)
                      if (source === 'apple') void useAppleMusicConnection.getState().refresh()
                    }}
                    aria-label={`${loggedIn && state.enabled ? '停用' : '启用'}${provider.descriptor.label}`}
                  />
                  {!guest && <button
                    type="button"
                    className={styles.accountButton}
                    disabled={busySource !== null || processing}
                    onClick={() => void (accountIn || waiting ? logout(source) : login(source))}
                    aria-label={`${processing ? '正在处理' : waiting ? '取消登录' : accountIn ? '退出' : '登录'}${provider.descriptor.label}`}
                    title={processing ? '处理中…' : waiting ? '取消登录' : accountIn ? '退出登录' : '登录账号'}
                  >
                    {processing ? <span className={styles.spinner} aria-hidden="true" /> : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M13 5h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
                        {accountIn || waiting ? <path d="m8 8-4 4 4 4M4 12h12" /> : <path d="m12 8 4 4-4 4M16 12H4" />}
                      </svg>
                    )}
                  </button>}
                  {/* 游客音源没有账号，占位保持开关与其他平台同一位置。 */}
                  {guest && <span className={styles.accountButton} aria-hidden="true" style={{ visibility: 'hidden' }} />}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </>
  )
}
