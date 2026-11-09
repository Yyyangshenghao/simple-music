import { api } from './api'
import { useSettingsStore } from '../stores/settings'
import { useProviderStore } from '../stores/providers'
import type { LoginResult } from '../types/ipc'
import { advanceProviderAccountSession, providerAccountSession } from './provider-account-session'

/** 设置页与头像菜单复用现有原生登录窗口及 Cookie 交换流程。 */
export async function loginMusicProvider(source: 'netease' | 'qq'): Promise<void> {
  const result: LoginResult | undefined = source === 'netease'
    ? await window.desktop?.openNeteaseLogin()
    : await window.desktop?.openQQLogin()
  if (result?.cancelled) return
  if (result?.error) throw new Error(result.error)
  if (!result?.ok || !result.cookie) return
  await applyLoginCookie(source, result.cookie)
}

/** 网页登录窗与应用内扫码共用：拿到 Cookie 后交播放宿主完成账号切换。 */
export async function applyLoginCookie(source: 'netease' | 'qq', cookie: string): Promise<void> {
  if (window.desktop?.playbackRequest && window.desktop.playbackRole !== 'host') {
    await window.desktop.playbackRequest({ type: 'action', store: 'controls', action: 'loginCookie', args: [source, cookie] })
    return
  }
  await completeMusicProviderLogin(source, cookie)
}

interface ServerAccountStatus { loggedIn?: boolean; nickname?: string; avatar?: string }

/**
 * 酷狗扫码确认后，server 已写好会话；宿主按 server 的权威状态更新账号，
 * 不信任界面层传来的资料。非宿主窗口转发给播放宿主执行。
 */
export async function refreshKugouAccount(): Promise<void> {
  if (window.desktop?.playbackRequest && window.desktop.playbackRole !== 'host') {
    await window.desktop.playbackRequest({ type: 'action', store: 'controls', action: 'refreshKugouAccount', args: [] })
    return
  }
  const status = await api.get<ServerAccountStatus>('/api/kugou/login/status')
  useProviderStore.getState().setAccountState(
    'kugou',
    status.loggedIn ? 'authenticated' : 'anonymous',
    status.loggedIn ? { avatar: status.avatar || '', nickname: status.nickname || '' } : undefined,
  )
}

/** 汽水扫码凭据留在 API 后台，播放宿主只接收已核实的账号资料。 */
export async function commitQishuiLogin(key: string): Promise<void> {
  if (window.desktop?.playbackRequest && window.desktop.playbackRole !== 'host') {
    await window.desktop.playbackRequest({ type: 'action', store: 'controls', action: 'commitQishuiLogin', args: [key] })
    return
  }
  advanceProviderAccountSession('qishui')
  const session = providerAccountSession('qishui')
  const status = await api.post<ServerAccountStatus>(
    `/api/qishui/login/qr/complete?key=${encodeURIComponent(key)}`,
  )
  if (session !== providerAccountSession('qishui') || !status.loggedIn) throw new Error('汽水音乐未能核实登录账号')
  useProviderStore.getState().setAccountState('qishui', 'authenticated', {
    avatar: status.avatar || '', nickname: status.nickname || '',
  })
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
