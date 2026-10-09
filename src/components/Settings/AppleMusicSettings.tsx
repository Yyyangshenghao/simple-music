import { useEffect } from 'react'
import { useAppleMusicConnection } from '../../stores/apple-music-connection'
import { InfoButton } from '../ui/InfoButton'
import { AccountButton } from './AccountButton'
import styles from './AppleMusicSettings.module.css'

export function AppleMusicAccountInfo() {
  const { account, phase, message, error, refresh, connect } = useAppleMusicConnection()
  const busy = phase !== 'idle' || !!account?.restoring
  const waiting = phase === 'waiting'
  const subscription = account?.subscription ?? 'unknown'
  const badge = account?.restoring
    ? '恢复登录中'
    : waiting && !account?.loggedIn
    ? '等待授权'
    : account?.loggedIn && subscription === 'inactive'
      ? '无有效订阅'
      : account?.loggedIn && subscription === 'unknown'
        ? '确认订阅中'
        : account?.connected && account.loggedIn ? '已登录' : account?.loggedIn ? '连接已中断' : '未登录'

  const subscriptionHint = account?.loggedIn && subscription === 'inactive'
    ? '无有效订阅：此账号没有有效的 Apple Music 订阅，Apple 音源已保持禁用。'
    : account?.loggedIn && subscription === 'active'
      ? '订阅有效，可播放完整歌曲。歌曲会直接在 Simple Music 内播放，可使用播放队列、快捷键和迷你播放器。'
      : account?.loggedIn
        ? '正在确认订阅状态，确认完成前不会启用 Apple 音源。'
        : '完整播放需要有效的 Apple Music 订阅；没有订阅仍可登录，但 Apple 音源不会启用，也不能播放完整歌曲；免费广播暂未接入。完成 Apple 账号授权后，即可在 Simple Music 中选歌和播放。'

  return (
    <span className={styles.actions}>
      <InfoButton label="Apple Music 登录与订阅" align="left" text={`${badge}。${subscriptionHint}${message ? ` ${message}` : ''}`} />
      {account?.loggedIn && !account.connected && !waiting && !account.restoring && <AccountButton label="重新连接 Apple Music" disabled={busy} onClick={() => void connect()} />}
      {!account && error && <AccountButton label="重新检测 Apple Music" disabled={busy} onClick={() => void refresh()} />}
    </span>
  )
}

export function AppleMusicSettings() {
  const { account, phase, refresh, connect, disconnect } = useAppleMusicConnection()
  const waiting = phase === 'waiting'
  useEffect(() => { void refresh() }, [refresh])

  return (
    <span className={styles.actions} aria-label="Apple Music 账户">
      <AccountButton
        label={account?.restoring ? '恢复登录中 Apple Music' : phase === 'opening' ? '打开中 Apple Music' : phase === 'disconnecting' ? '退出中 Apple Music' : waiting ? '取消登录 Apple Music' : account?.loggedIn ? '退出登录 Apple Music' : '登录 Apple Music'}
        exit={!!account?.loggedIn || waiting}
        busy={!!account?.restoring || phase === 'opening' || phase === 'disconnecting'}
        onClick={() => void (account?.loggedIn || waiting ? disconnect() : connect())}
      />
    </span>
  )
}
