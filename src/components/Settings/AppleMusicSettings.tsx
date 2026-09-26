import { useEffect } from 'react'
import { useAppleMusicConnection } from '../../stores/apple-music-connection'
import styles from './AppleMusicSettings.module.css'

export function AppleMusicSettings() {
  const { account, phase, message, error, refresh, connect, disconnect } = useAppleMusicConnection()
  const busy = phase !== 'idle'
  const waiting = phase === 'waiting'
  const subscription = account?.subscription ?? 'unknown'
  const badge = waiting && !account?.loggedIn
    ? '等待授权'
    : account?.loggedIn && subscription === 'inactive'
      ? '无有效订阅'
      : account?.loggedIn && subscription === 'unknown'
        ? '确认订阅中'
        : account?.connected && account.loggedIn ? '已连接' : account?.loggedIn ? '应用内播放器已断开' : '未登录'

  useEffect(() => { void refresh() }, [refresh])

  return (
    <section className={styles.panel} aria-label="Apple Music 账户">
      <div className={styles.header}>
        <div>
          <h3>Apple Music</h3>
          <p>连接你的音乐资料库，在 Simple Music 选歌和控制播放。</p>
        </div>
        <span className={styles.badge}>{badge}</span>
      </div>
      <div className={styles.actions}>
        <button className={styles.primary} disabled={busy || !!(account?.loggedIn && account.connected)} onClick={() => void connect()}>
          {phase === 'opening' ? '正在打开…' : waiting ? '等待 Apple 授权…' : account?.loggedIn ? account.connected
            ? subscription === 'inactive' ? '无有效订阅' : subscription === 'unknown' ? '正在确认订阅…' : '已连接 Apple Music'
            : '重新连接' : '登录 Apple Music'}
        </button>
        {(account?.loggedIn || waiting) && <button disabled={phase === 'opening' || phase === 'disconnecting'} onClick={() => void disconnect()}>{waiting ? '取消登录' : '退出登录'}</button>}
        {!account && <button disabled={busy} onClick={() => void refresh()}>重新检测</button>}
      </div>
      <div className={styles.subscriptionNotice} role="note">
        <strong>{account?.loggedIn && subscription === 'inactive' ? '此账号没有有效的 Apple Music 订阅' : account?.loggedIn && subscription === 'active' ? '订阅有效，可播放完整歌曲' : account?.loggedIn ? '正在确认 Apple Music 订阅状态' : '完整播放需要有效的 Apple Music 订阅'}</strong>
        <span>{account?.loggedIn && subscription === 'inactive'
          ? '账号已登录，但不能播放完整歌曲；Apple 音源已保持禁用。'
          : account?.loggedIn && subscription === 'active'
            ? 'Apple 已确认该账号可播放订阅目录内容。'
            : account?.loggedIn
              ? '确认完成前不会启用 Apple 音源，避免点歌后才出现播放错误。'
              : '没有订阅仍可完成账号登录，但 Apple 音源不会启用，也不能播放完整歌曲；免费广播暂未接入。'}</span>
      </div>
      <p>{account?.loggedIn && account.connected && subscription === 'active' ? '已连接 Apple Music。授权窗口已隐藏，歌曲会直接在 Simple Music 内播放。' : '应用会打开专用的 Apple Music 授权窗口；完成登录后窗口自动隐藏，无需保留外部浏览器。'}</p>
      {message && <p className={error ? styles.error : styles.message} role={error ? 'alert' : 'status'}>{message}</p>}
    </section>
  )
}
