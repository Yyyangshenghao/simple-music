import { api } from './api'
import { useSettingsStore } from '../stores/settings'
import { useProviderStore } from '../stores/providers'
import type { LoginResult } from '../types/ipc'
import { advanceProviderAccountSession } from './provider-account-session'

/** 设置页与头像菜单复用现有原生登录窗口及 Cookie 交换流程。 */
export async function loginMusicProvider(source: 'netease' | 'qq'): Promise<void> {
  const result: LoginResult | undefined = source === 'netease'
    ? await window.desktop?.openNeteaseLogin()
    : await window.desktop?.openQQLogin()
  if (result?.cancelled) return
  if (result?.error) throw new Error(result.error)
  if (!result?.ok || !result.cookie) return
  if (window.desktop?.playbackRequest && window.desktop.playbackRole !== 'host') {
    await window.desktop.playbackRequest({ type: 'action', store: 'controls', action: 'loginCookie', args: [source, result.cookie] })
    return
  }
  await completeMusicProviderLogin(source, result.cookie)
}

/** 账号切换在唯一播放宿主内完成，先截断会话再交换服务端 Cookie。 */
export async function completeMusicProviderLogin(source: 'netease' | 'qq', cookie: string): Promise<void> {
  // 服务端保存新 Cookie 前即截断旧播放的账号身份。
  advanceProviderAccountSession(source)
  const info = await api.post<{ avatar?: string; nickname?: string }>(
    source === 'netease' ? '/api/login/cookie' : '/api/qq/login/cookie',
    { cookie }
  )
  const profile = { avatar: info.avatar || '', nickname: info.nickname || '' }
  const settings = useSettingsStore.getState()
  if (source === 'netease') {
    settings.setNeteaseLoggedIn(true)
    settings.setNeteaseProfile(profile.avatar, profile.nickname)
  } else {
    settings.setQQLoggedIn(true)
    settings.setQQProfile(profile.avatar, profile.nickname)
  }
  useProviderStore.getState().setAccountState(source, 'authenticated', profile)
}
