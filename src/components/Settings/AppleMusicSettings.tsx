import { useEffect } from 'react'
import { useAppleMusicConnection } from '../../stores/apple-music-connection'
import { InfoButton } from '../ui/InfoButton'
import styles from './AppleMusicSettings.module.css'

export function AppleMusicSettings() {
  const { account, phase, message, error, refresh, connect, disconnect } = useAppleMusicConnection()
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

  useEffect(() => { void refresh() }, [refresh])

  const subscriptionHint = account?.loggedIn && subscription === 'inactive'
    ? '无有效订阅：此账号没有有效的 Apple Music 订阅，Apple 音源已保持禁用。'
    : account?.loggedIn && subscription === 'active'
      ? '订阅有效，可播放完整歌曲。歌曲会直接在 Simple Music 内播放，可使用播放队列、快捷键和迷你播放器。'
      : account?.loggedIn
        ? '正在确认订阅状态，确认完成前不会启用 Apple 音源。'
        : '完整播放需要有效的 Apple Music 订阅；没有订阅仍可登录，但 Apple 音源不会启用，也不能播放完整歌曲；免费广播暂未接入。完成 Apple 账号授权后，即可在 Simple Music 中选歌和播放。'

  return (
    <div className={styles.actions} aria-label="Apple Music 账户">
      <InfoButton label="Apple Music 登录与订阅" text={`${badge}。${subscriptionHint}${message ? ` ${message}` : ''}`} />
      <button disabled={busy || !!(account?.loggedIn && account.connected)} onClick={() => void connect()} aria-label={account?.loggedIn && account.connected ? '已登录 Apple Music' : '登录 Apple Music'}>
        {account?.restoring ? '恢复中…' : phase === 'opening' ? '打开中…' : waiting ? '等待授权…' : account?.loggedIn ? account.connected ? '已登录' : '重新连接' : '登录'}
      </button>
      {(account?.loggedIn || waiting) && <button disabled={phase === 'opening' || phase === 'disconnecting'} onClick={() => void disconnect()}>{waiting ? '取消登录' : '退出登录'}</button>}
      {!account && error && <button disabled={busy} onClick={() => void refresh()}>重新检测</button>}
    </div>
  )
}
