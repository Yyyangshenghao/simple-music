import { useState } from 'react'
import { api } from '../../lib/api'
import { appleRegionLabel, appleRegionOptions } from '../../lib/apple-music-regions'
import { useAppleMusicConnection } from '../../stores/apple-music-connection'
import { useToastStore } from '../../stores/toast'
import { InfoButton } from '../ui/InfoButton'
import { Select } from '../ui/Select'
import { AccountButton } from './AccountButton'
import styles from './AppleMusicSettings.module.css'

export function AppleMusicAccountInfo() {
  const { account, phase, message, error, refresh, connect } = useAppleMusicConnection()
  const busy = phase !== 'idle' || !!account?.restoring
  const waiting = phase === 'waiting'
  const subscription = account?.subscription ?? 'unknown'
  const badge = account?.restoring
    ? '恢复登录中'
    : account?.suspended
    ? '已暂停'
    : waiting && !account?.loggedIn
    ? '等待授权'
    : account?.loggedIn && subscription === 'inactive'
      ? '无有效订阅'
      : account?.loggedIn && subscription === 'unknown'
        ? '确认订阅中'
        : account?.connected && account.loggedIn ? '已登录' : account?.loggedIn ? '连接已中断' : '未登录'

  const subscriptionHint = account?.suspended
    ? 'Apple 音源已关闭，后台播放页面已释放；重新启用后会自动连接。'
    : account?.loggedIn && subscription === 'inactive'
    ? '无有效订阅：此账号没有有效的 Apple Music 订阅，Apple 音源已保持禁用。'
    : account?.loggedIn && subscription === 'active'
      ? '订阅有效，可播放完整歌曲。歌曲会直接在 Simple Music 内播放，可使用播放队列、快捷键和迷你播放器。'
      : account?.loggedIn
        ? '正在确认订阅状态，确认完成前不会启用 Apple 音源。'
        : '完整播放需要有效的 Apple Music 订阅；没有订阅仍可登录，但 Apple 音源不会启用，也不能播放完整歌曲；免费广播暂未接入。完成 Apple 账号授权后，即可在 Simple Music 中选歌和播放。'

  return (
    <span className={styles.actions}>
      <InfoButton label="Apple Music 登录与订阅" align="left" text={`${badge}。${subscriptionHint}${message ? ` ${message}` : ''}`} />
      {account?.loggedIn && !account.connected && !waiting && !account.restoring && !account.suspended && <AccountButton label="重新连接 Apple Music" disabled={busy} onClick={() => void connect()} />}
      {!account && error && <AccountButton label="重新检测 Apple Music" disabled={busy} onClick={() => void refresh()} />}
    </span>
  )
}

export function AppleMusicSettings() {
  const { account, phase, connect, disconnect } = useAppleMusicConnection()
  const waiting = phase === 'waiting'

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

/**
 * Apple Music 地区：登录前可选登录页地区（默认按网络出口），避免先落到出口所在地区再跳转；
 * 登录后显示账号地区并禁用，地区以 Apple ID 为准，选别的地区搜到的歌可能放不了。
 */
export function AppleMusicRegionSelect() {
  const { account, phase, refresh } = useAppleMusicConnection()
  const [pending, setPending] = useState<string | null>(null)
  const [failed, setFailed] = useState('')
  if (account?.loginMode !== 'web') return null
  const locked = account.loggedIn || !!account.suspended
  const value = locked ? account.storefront : pending ?? account.loginStorefront ?? ''
  const busy = phase !== 'idle' || !!account.restoring || pending !== null
  const title = failed || (locked
    ? `账号地区：${appleRegionLabel(account.storefront)}。登录后地区跟随 Apple 账号`
    : '登录页打开的地区。选与 Apple 账号一致的地区，登录更快')

  async function change(next: string): Promise<void> {
    setPending(next)
    setFailed('')
    try {
      await api.post('/api/apple-music/region', { storefront: next })
    } catch (error) {
      const message = error instanceof Error ? error.message : '设置地区失败'
      setFailed(message)
      // 下拉旁没有空位放错误，用全局提示告知，悬停仍可看到原因。
      useToastStore.getState().show(`Apple Music 地区未更改：${message}`)
    } finally {
      await refresh().catch(() => {})
      setPending(null)
    }
  }

  return (
    <span className={styles.region} title={title}>
      <Select value={value} options={appleRegionOptions(value)} aria-label="Apple Music 地区" disabled={locked || busy}
        onChange={(next) => void change(next)} />
    </span>
  )
}
