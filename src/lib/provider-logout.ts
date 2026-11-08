import { api } from './api'
import { useSettingsStore } from '../stores/settings'
import { useProviderStore } from '../stores/providers'
import { advanceProviderAccountSession, providerAccountSession } from './provider-account-session'

/** 清除原生登录窗口和 API 会话后，再更新对应平台的账户状态。 */
export async function logoutMusicProvider(source: 'netease' | 'qq' | 'kugou' | 'qishui'): Promise<void> {
  if (window.desktop?.playbackRequest && window.desktop.playbackRole !== 'host') {
    await window.desktop.playbackRequest({ type: 'action', store: 'controls', action: 'logout', args: [source] })
    return
  }
  if (source === 'kugou' || source === 'qishui') {
    // 可选登录平台只清除后台账号，继续使用游客会话。
    if (source === 'qishui') advanceProviderAccountSession(source)
    const accountSession = providerAccountSession(source)
    await api.post(`/api/${source}/logout`)
    if (accountSession === providerAccountSession(source)) useProviderStore.getState().setAccountState(source, 'anonymous')
    return
  }
  const accountSession = providerAccountSession(source)
  const results = await Promise.allSettled([
    source === 'netease' ? window.desktop?.clearNeteaseLogin() : window.desktop?.clearQQLogin(),
    api.post(source === 'netease' ? '/api/logout' : '/api/qq/logout'),
  ])
  if (accountSession !== providerAccountSession(source)) return
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  const settings = useSettingsStore.getState()
  if (source === 'netease') settings.setNeteaseLoggedIn(false)
  else settings.setQQLoggedIn(false)
  useProviderStore.getState().setAccountState(source, 'anonymous')
}
