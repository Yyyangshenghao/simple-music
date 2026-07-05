import { create } from 'zustand'
import type { Playlist, Track } from '../types/domain'

export type AppView =
  | 'explore'
  | 'library'
  | 'settings'
  | { type: 'artist'; id: unknown; source: 'netease' | 'qq' }
  /** 歌单详情:tracks 为可选初始数据(每日推荐/雷达已全量在手);普通歌单由详情视图懒加载。 */
  | { type: 'playlist'; from: 'explore' | 'library'; playlist: Playlist; tracks?: Track[] }

interface NavigationStore {
  currentView: AppView
  history: AppView[]
  /** 后退后可前进的视图栈；任何新导航都会清空。 */
  future: AppView[]
  /** 最近一次导航方向：navigateTo/goForward 为 push，goBack 为 pop（供转场方向使用）。 */
  lastAction: 'push' | 'pop'
  navigateTo(view: AppView): void
  goBack(): void
  goForward(): void
}

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  currentView: 'explore',
  history: [],
  future: [],
  lastAction: 'push',

  navigateTo(view) {
    set((s) => ({ currentView: view, history: [...s.history, s.currentView], future: [], lastAction: 'push' }))
  },

  goBack() {
    const { history, currentView, future } = get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    set({
      currentView: prev,
      history: history.slice(0, -1),
      future: [currentView, ...future],
      lastAction: 'pop',
    })
  },

  goForward() {
    const { future, currentView, history } = get()
    if (future.length === 0) return
    const next = future[0]
    set({
      currentView: next,
      future: future.slice(1),
      history: [...history, currentView],
      lastAction: 'push',
    })
  },
}))
