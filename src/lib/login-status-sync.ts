import { api } from './api'
import { providerAccountSession } from './provider-account-session'
import { useSettingsStore } from '../stores/settings'
import { useProviderStore } from '../stores/providers'
import { useAppleMusicConnection } from '../stores/apple-music-connection'
import { useGameModeStore } from '../stores/game-mode'

interface LoginStatusResponse {
  loggedIn?: boolean
  avatar?: string
  nickname?: string
}

let stopSync: (() => void) | undefined

/** 宿主核实留存账号；界面重挂不重复查询，游戏模式暂停 Apple 状态轮询。 */
export function initLoginStatusSync(): () => void {
  if (stopSync) return stopSync
  let stopped = false
  const controller = new AbortController()
  const initialAccounts = { ...useProviderStore.getState().byId }
  for (const source of ['netease', 'qq'] as const) {
    const session = providerAccountSession(source)
    const initial = initialAccounts[source]
    void api.get<LoginStatusResponse>(source === 'netease' ? '/api/login/status' : '/api/qq/login/status', undefined, { signal: controller.signal })
      .then(result => {
        const current = useProviderStore.getState().byId[source]
        if (stopped || session !== providerAccountSession(source) || current.auth !== initial.auth || current.profile !== initial.profile) return
        const settings = useSettingsStore.getState()
        const loggedIn = !!result.loggedIn
        const profile = loggedIn ? { avatar: result.avatar || '', nickname: result.nickname || '' } : undefined
        if (source === 'netease') {
          settings.setNeteaseLoggedIn(loggedIn)
          if (profile) settings.setNeteaseProfile(profile.avatar, profile.nickname)
        } else {
          settings.setQQLoggedIn(loggedIn)
          if (profile) settings.setQQProfile(profile.avatar, profile.nickname)
        }
        useProviderStore.getState().setAccountState(source, loggedIn ? 'authenticated' : 'anonymous', profile)
      }).catch(() => {})
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let appleRequest: AbortController | undefined
  function pauseApple(): void {
    clearTimeout(timer)
    timer = undefined
    appleRequest?.abort()
    appleRequest = undefined
  }
  async function syncApple(): Promise<void> {
    timer = undefined
    const request = new AbortController()
    appleRequest = request
    try { await useAppleMusicConnection.getState().refresh(request.signal) } catch { /* 单次刷新失败不停止后续检测。 */ }
    if (stopped || request !== appleRequest || request.signal.aborted) return
    appleRequest = undefined
    timer = setTimeout(() => void syncApple(), 3000)
  }
  const unsubscribe = useGameModeStore.subscribe((state, previous) => {
    if (state.enabled === previous.enabled) return
    pauseApple()
    if (!state.enabled) void syncApple()
  })
  if (!useGameModeStore.getState().enabled) void syncApple()
  stopSync = () => {
    if (stopped) return
    stopped = true
    controller.abort()
    pauseApple()
    unsubscribe()
    stopSync = undefined
  }
  return stopSync
}
