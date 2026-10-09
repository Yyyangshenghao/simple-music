import { api } from './api'
import { useSettingsStore } from '../stores/settings'
import { useProviderStore } from '../stores/providers'
import { providerAccountSession } from './provider-account-session'

/** 清除原生登录窗口和 API 会话后，再更新对应平台的账户状态。 */
export async function logoutMusicProvider(source: 'netease' | 'qq'): Promise<void> {
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
