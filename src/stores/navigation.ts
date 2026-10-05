import { create } from 'zustand'
import type { Playlist, Track } from '../types/domain'

export interface ArtistPageState {
  tab: 'songs' | 'albums' | 'similar'
  query: string
  scrollTop: number
}

export type AppView =
  | 'explore'
  | 'library'
  | 'roam'
  | 'shuange'
  | 'settings'
  | 'release-history'
  | { type: 'search'; keyword: string }
  | { type: 'artist'; id: unknown; source: 'netease' | 'qq' | 'apple'; pageState?: ArtistPageState }
  | { type: 'artistSongs'; id: unknown; source: 'netease' | 'qq' | 'apple' }
  /** 全部榜单页(探索页「榜单精选」的展开态)。 */
  | { type: 'toplist'; source: 'netease' | 'qq' | 'apple' }
  /** 歌单详情:tracks 为可选初始数据(每日推荐/雷达已全量在手);普通歌单由详情视图懒加载。 */
  | { type: 'playlist'; from: 'explore' | 'library'; playlist: Playlist; tracks?: Track[] }

interface NavigationStore {
  currentView: AppView
  artistPageState: ArtistPageState
  settingsMusicRequest: number
  history: AppView[]
  /** 后退后可前进的视图栈；任何新导航都会清空。 */
  future: AppView[]
  /** 最近一次导航方向：navigateTo/goForward 为 push，goBack 为 pop（供转场方向使用）。 */
  lastAction: 'push' | 'pop'
  navigateTo(view: AppView): void
  updateArtistPageState(id: unknown, source: 'netease' | 'qq' | 'apple', patch: Partial<ArtistPageState>): void
  requestSettingsMusic(): void
  goBack(): void
  goForward(): void
}

/** 历史栈上限:playlist 视图可能内嵌全量 tracks(每日推荐/雷达),不设限会随浏览无限涨内存。 */
const MAX_HISTORY = 50
const DEFAULT_ARTIST_PAGE_STATE: ArtistPageState = { tab: 'songs', query: '', scrollTop: 0 }

function artistPageStateOf(view: AppView): ArtistPageState {
  return typeof view === 'object' && view.type === 'artist' ? view.pageState ?? DEFAULT_ARTIST_PAGE_STATE : DEFAULT_ARTIST_PAGE_STATE
}

function snapshotView(view: AppView, pageState: ArtistPageState): AppView {
  return typeof view === 'object' && view.type === 'artist' ? { ...view, pageState } : view
}

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  currentView: 'explore',
  artistPageState: DEFAULT_ARTIST_PAGE_STATE,
  settingsMusicRequest: 0,
  history: [],
  future: [],
  lastAction: 'push',

  navigateTo(view) {
    set((s) => ({ currentView: view, artistPageState: artistPageStateOf(view),
      history: [...s.history, snapshotView(s.currentView, s.artistPageState)].slice(-MAX_HISTORY), future: [], lastAction: 'push' }))
  },

  updateArtistPageState(id, source, patch) {
    set((state) => {
      const view = state.currentView
      if (typeof view !== 'object' || view.type !== 'artist' || view.source !== source || String(view.id) !== String(id)) return state
      const previous = state.artistPageState
      const pageState = { ...previous, ...patch }
      if (pageState.tab === previous.tab && pageState.query === previous.query && pageState.scrollTop === previous.scrollTop) return state
      return { artistPageState: pageState }
    })
  },

  requestSettingsMusic() {
    set((s) => ({ settingsMusicRequest: s.settingsMusicRequest + 1 }))
  },

  goBack() {
    const { history, currentView, future, artistPageState } = get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    set({
      currentView: prev,
      artistPageState: artistPageStateOf(prev),
      history: history.slice(0, -1),
      future: [snapshotView(currentView, artistPageState), ...future],
      lastAction: 'pop',
    })
  },

  goForward() {
    const { future, currentView, history, artistPageState } = get()
    if (future.length === 0) return
    const next = future[0]
    set({
      currentView: next,
      artistPageState: artistPageStateOf(next),
      future: future.slice(1),
      history: [...history, snapshotView(currentView, artistPageState)].slice(-MAX_HISTORY),
      lastAction: 'push',
    })
  },
}))
