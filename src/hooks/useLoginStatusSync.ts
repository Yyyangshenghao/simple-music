import { useEffect } from 'react'
import { api } from '../lib/api'
import { useSettingsStore } from '../stores/settings'
import { useProviderStore } from '../stores/providers'

// 应用启动时，服务端可能已持有上次登录留存的 cookie（见 server/lib/cookie.ts 落盘），
// 但渲染层 neteaseLoggedIn/qqLoggedIn 不持久化、默认 false，需主动拉一次状态对齐 UI。
interface LoginStatusResponse {
  loggedIn?: boolean
  avatar?: string
  nickname?: string
}

export function useLoginStatusSync(): void {
  useEffect(() => {
    void api
      .get<LoginStatusResponse>('/api/login/status')
      .then((r) => {
        const store = useSettingsStore.getState()
        const loggedIn = !!r.loggedIn
        const profile = loggedIn ? { avatar: r.avatar || '', nickname: r.nickname || '' } : undefined
        store.setNeteaseLoggedIn(loggedIn)
        if (profile) store.setNeteaseProfile(profile.avatar, profile.nickname)
        useProviderStore.getState().setAccountState('netease', loggedIn ? 'authenticated' : 'anonymous', profile)
      })
      .catch(() => {})

    void api
      .get<LoginStatusResponse>('/api/qq/login/status')
      .then((r) => {
        const store = useSettingsStore.getState()
        const loggedIn = !!r.loggedIn
        const profile = loggedIn ? { avatar: r.avatar || '', nickname: r.nickname || '' } : undefined
        store.setQQLoggedIn(loggedIn)
        if (profile) store.setQQProfile(profile.avatar, profile.nickname)
        useProviderStore.getState().setAccountState('qq', loggedIn ? 'authenticated' : 'anonymous', profile)
      })
      .catch(() => {})
  }, [])
}
