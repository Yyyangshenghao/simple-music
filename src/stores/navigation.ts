import { create } from 'zustand'

export type AppView =
  | 'explore'
  | 'library'
  | 'settings'
  | { type: 'artist'; id: unknown; source: 'netease' | 'qq' }

interface NavigationStore {
  currentView: AppView
  history: AppView[]
  /** 最近一次导航方向：navigateTo 为 push，goBack 为 pop（供转场方向使用）。 */
  lastAction: 'push' | 'pop'
  navigateTo(view: AppView): void
  goBack(): void
}

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  currentView: 'explore',
  history: [],
  lastAction: 'push',

  navigateTo(view) {
    set((s) => ({ currentView: view, history: [...s.history, s.currentView], lastAction: 'push' }))
  },

  goBack() {
    const { history } = get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    set({ currentView: prev, history: history.slice(0, -1), lastAction: 'pop' })
  },
}))
