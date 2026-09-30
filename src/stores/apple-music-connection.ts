import { create } from 'zustand'
import { api } from '../lib/api'
import { openAppleMusicPlayer } from '../lib/apple-music-playback'
import { useProviderStore } from './providers'

export interface AppleMusicAccountStatus {
  loginMode: 'web' | 'developer'
  configured: boolean
  ready: boolean
  managed: boolean
  loggedIn: boolean
  connected: boolean
  restoring?: boolean
  subscription: 'unknown' | 'active' | 'inactive'
  storefront: string
  error?: string
}

interface ConnectionState {
  account: AppleMusicAccountStatus | null
  phase: 'idle' | 'opening' | 'waiting' | 'disconnecting'
  message: string
  error: boolean
  statusError: boolean
  refresh(): Promise<void>
  connect(config?: { developerToken: string; storefront: string }): Promise<void>
  disconnect(clearConfig?: boolean): Promise<void>
}

let revision = 0
let requestSequence = 0
let deadline = 0
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '连接失败，请重试'

// 登录状态独立于设置页，切换页面后仍可完成授权并启用音源。
export const useAppleMusicConnection = create<ConnectionState>((set, get) => ({
  account: null, phase: 'idle', message: '', error: false, statusError: false,
  async refresh() {
    const version = revision
    const sequence = ++requestSequence
    try {
      const account = await api.get<AppleMusicAccountStatus>('/api/apple-music/status')
      if (version !== revision || sequence !== requestSequence || ['opening', 'disconnecting'].includes(get().phase)) return
      set({ account, ...(get().statusError ? { error: false, statusError: false, message: '' } : {}) })
      if (account.restoring) return
      const store = useProviderStore.getState()
      const auth = account.loggedIn ? 'authenticated' : 'anonymous'
      if (store.byId.apple.auth !== auth) store.setAccountState('apple', auth,
        account.loggedIn ? { avatar: '', nickname: 'Apple Music' } : undefined,
        { preserveEnabled: !account.loggedIn })
      if (account.loggedIn) {
        const unavailable = !account.connected
          ? account.error || 'Apple Music 播放连接已断开，请重新连接。'
          : account.subscription === 'inactive'
            ? '此账号没有有效的 Apple Music 订阅，无法播放完整歌曲。'
            : '正在确认 Apple Music 订阅状态，确认前无法播放。'
        store.setPlaybackAvailability('apple', account.connected && account.subscription === 'active', unavailable)
      }
      if (get().phase === 'waiting') {
        if (!account.connected && account.error) {
          set({ phase: 'idle', error: true, message: account.error })
        } else if (account.loggedIn && account.connected && account.subscription === 'active') {
          store.setEnabled('apple', true)
          set({ phase: 'idle', error: false, message: '已登录，Apple Music 订阅有效，音源已启用。' })
        } else if (account.loggedIn && account.connected && account.subscription === 'inactive') {
          set({ phase: 'idle', error: true, message: '已登录，但此账号没有有效的 Apple Music 订阅，无法播放完整歌曲。' })
        } else if (account.loggedIn && account.connected && account.subscription === 'unknown') {
          if (Date.now() >= deadline) set({ phase: 'idle', error: true, message: '已登录，但暂时无法确认 Apple Music 订阅状态，请检查网络后重试。' })
          else set({ error: false, message: '已登录，正在确认 Apple Music 订阅状态…' })
        } else if (account.loginMode === 'developer' && !account.ready) {
          set({ phase: 'idle', error: true, message: 'Apple Music 登录服务暂不可用，请更新应用配置后重试。' })
        } else if (Date.now() >= deadline) {
          set({ phase: 'idle', error: true, message: '尚未收到授权结果，请重新登录，并在应用内授权窗口完成 Apple 授权。' })
        }
      } else if (!account.connected && (account.loggedIn || account.error)) {
        set({ error: true, message: account.error || 'Apple Music 播放连接已断开，请重新连接。' })
      } else if (account.loggedIn && account.subscription === 'inactive') {
        set({ error: true, message: '已登录，但此账号没有有效的 Apple Music 订阅，Apple 音源已停用。' })
      } else if (account.loggedIn && account.subscription === 'unknown') {
        set({ error: false, message: '已登录，正在确认 Apple Music 订阅状态…' })
      } else if (account.loggedIn && account.subscription === 'active' && !get().statusError) {
        set({ error: false, message: '' })
      }
    } catch {
      if (version !== revision || sequence !== requestSequence || ['opening', 'disconnecting'].includes(get().phase)) return
      if (get().phase === 'waiting' && Date.now() >= deadline) set({ phase: 'idle', error: true, message: '连接超时，请检查网络后重新登录。' })
      else if (!get().account) set({ error: true, statusError: true, message: '无法读取 Apple Music 状态，请重试。' })
    }
  },
  async connect(config) {
    if (get().phase !== 'idle') return
    ++revision
    set({ phase: 'opening', message: '', error: false, statusError: false })
    try {
      if (config) {
        const account = await api.post<AppleMusicAccountStatus>('/api/apple-music/config', config)
        set({ account })
        useProviderStore.getState().setAccountState('apple', 'anonymous')
      }
      await openAppleMusicPlayer(config ? 'developer' : 'web')
      deadline = Date.now() + 120_000
      set({ phase: 'waiting', message: '请完成 Apple 账号授权，登录成功后即可播放。' })
    } catch (error) {
      set({ phase: 'idle', error: true, message: errorMessage(error) })
    }
    await get().refresh()
  },
  async disconnect(clearConfig = false) {
    if (['opening', 'disconnecting'].includes(get().phase)) return
    ++revision
    set({ phase: 'disconnecting', message: '', error: false, statusError: false })
    try {
      await api.post(clearConfig ? '/api/apple-music/config' : '/api/apple-music/bridge/logout', clearConfig ? { developerToken: '' } : undefined)
      useProviderStore.getState().setAccountState('apple', 'anonymous')
      set({ account: get().account ? { ...get().account!, loggedIn: false, connected: false, subscription: 'unknown' } : null, phase: 'idle', message: clearConfig ? '本机配置已清除。' : '已退出 Apple Music。' })
    } catch (error) {
      set({ phase: 'idle', error: true, message: errorMessage(error) })
    }
    await get().refresh()
  },
}))
