import { create } from 'zustand'

export type AppView =
  | 'explore'
  | 'library'
  | 'settings'
  | { type: 'artist'; id: unknown; source: 'netease' | 'qq' }

interface NavigationStore {
  currentView: AppView
  history: AppView[]
  navigateTo(view: AppView): void
  goBack(): void
}

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  currentView: 'explore',
  history: [],

  navigateTo(view) {
    set((s) => ({ currentView: view, history: [...s.history, s.currentView] }))
  },

  goBack() {
    const { history } = get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    set({ currentView: prev, history: history.slice(0, -1) })
  },
}))
