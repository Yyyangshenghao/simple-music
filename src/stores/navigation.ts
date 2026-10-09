import { create } from 'zustand'
import type { Playlist, Track } from '../types/domain'
import type { ProviderId } from '../providers/types'

export interface SearchPageState {
  category: 'all' | 'songs' | 'artists' | 'albums' | 'playlists'
  sourceFilter: ProviderId | null
  scrollTop: number
  artistScrollTop?: number
}

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
  | { type: 'search'; keyword: string; pageState?: SearchPageState }
  | { type: 'artist'; id: unknown; source: 'netease' | 'qq' | 'apple'; pageState?: ArtistPageState }
  | { type: 'artistSongs'; id: unknown; source: 'netease' | 'qq' | 'apple' }
  /** 全部榜单页(探索页「榜单精选」的展开态)。 */
  | { type: 'toplist'; source: 'netease' | 'qq' | 'apple' }
  /** 歌单详情:tracks 为可选初始数据(每日推荐/雷达已全量在手);普通歌单由详情视图懒加载。 */
  | { type: 'playlist'; from: 'explore' | 'library'; playlist: Playlist; tracks?: Track[] }

interface NavigationStore {
  currentView: AppView
  artistPageState: ArtistPageState
  searchPageState: SearchPageState
  navigationRevision: number
  settingsMusicRequest: number
  history: AppView[]
  /** 后退后可前进的视图栈；任何新导航都会清空。 */
  future: AppView[]
  /** 最近一次导航方向：navigateTo/goForward 为 push，goBack 为 pop（供转场方向使用）。 */
  lastAction: 'push' | 'pop'
  navigateTo(view: AppView): void
  updateArtistPageState(id: unknown, source: 'netease' | 'qq' | 'apple', patch: Partial<ArtistPageState>): void
  updateSearchPageState(keyword: string, patch: Partial<SearchPageState>): void
  requestSettingsMusic(): void
  goBack(): void
  goForward(): void
}

/** 历史栈上限:playlist 视图可能内嵌全量 tracks(每日推荐/雷达),不设限会随浏览无限涨内存。 */
const MAX_HISTORY = 50
const DEFAULT_ARTIST_PAGE_STATE: ArtistPageState = { tab: 'songs', query: '', scrollTop: 0 }
const DEFAULT_SEARCH_PAGE_STATE: SearchPageState = { category: 'all', sourceFilter: null, scrollTop: 0 }

function artistPageStateOf(view: AppView): ArtistPageState {
  return typeof view === 'object' && view.type === 'artist' ? view.pageState ?? DEFAULT_ARTIST_PAGE_STATE : DEFAULT_ARTIST_PAGE_STATE
}

function searchPageStateOf(view: AppView): SearchPageState {
  return typeof view === 'object' && view.type === 'search' ? view.pageState ?? DEFAULT_SEARCH_PAGE_STATE : DEFAULT_SEARCH_PAGE_STATE
}

function snapshotView(view: AppView, artistPageState: ArtistPageState, searchPageState: SearchPageState): AppView {
  if (typeof view !== 'object') return view
  if (view.type === 'artist') return { ...view, pageState: artistPageState }
  if (view.type === 'search') return { ...view, pageState: searchPageState }
  return view
}

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  currentView: 'explore',
  artistPageState: DEFAULT_ARTIST_PAGE_STATE,
  searchPageState: DEFAULT_SEARCH_PAGE_STATE,
  navigationRevision: 0,
  settingsMusicRequest: 0,
  history: [],
  future: [],
  lastAction: 'push',

  navigateTo(view) {
    set((s) => ({ currentView: view, artistPageState: artistPageStateOf(view), searchPageState: searchPageStateOf(view), navigationRevision: s.navigationRevision + 1,
      history: [...s.history, snapshotView(s.currentView, s.artistPageState, s.searchPageState)].slice(-MAX_HISTORY), future: [], lastAction: 'push' }))
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

  updateSearchPageState(keyword, patch) {
    set((state) => {
      const view = state.currentView
      if (typeof view !== 'object' || view.type !== 'search' || view.keyword !== keyword) return state
      const previous = state.searchPageState
      const pageState = { ...previous, ...patch }
      if (pageState.category === previous.category && pageState.sourceFilter === previous.sourceFilter && pageState.scrollTop === previous.scrollTop && pageState.artistScrollTop === previous.artistScrollTop) return state
      return { searchPageState: pageState }
    })
  },

  requestSettingsMusic() {
    set((s) => ({ settingsMusicRequest: s.settingsMusicRequest + 1 }))
  },

  goBack() {
    const { history, currentView, future, artistPageState, searchPageState } = get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    set({
      currentView: prev,
      artistPageState: artistPageStateOf(prev),
      searchPageState: searchPageStateOf(prev),
      navigationRevision: get().navigationRevision + 1,
      history: history.slice(0, -1),
      future: [snapshotView(currentView, artistPageState, searchPageState), ...future],
      lastAction: 'pop',
    })
  },

  goForward() {
    const { future, currentView, history, artistPageState, searchPageState } = get()
    if (future.length === 0) return
    const next = future[0]
    set({
      currentView: next,
      artistPageState: artistPageStateOf(next),
      searchPageState: searchPageStateOf(next),
      navigationRevision: get().navigationRevision + 1,
      future: future.slice(1),
      history: [...history, snapshotView(currentView, artistPageState, searchPageState)].slice(-MAX_HISTORY),
      lastAction: 'push',
    })
  },
}))
