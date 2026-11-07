import type { AppView } from '../../stores/navigation'

interface PageFrame {
  view: AppView
  key: string
  revision: number
}

export interface PageTransitionState {
  current: PageFrame
  origin: PageFrame | null
  /** 评论只额外保留进入前的页面状态，切换评论曲目时复用同一份，不累积历史。 */
  commentOrigin?: PageTransitionState
}

export function isDetailView(view: AppView): view is Extract<AppView, { type: 'playlist' | 'app-playlist' }> {
  return typeof view === 'object' && (view.type === 'playlist' || view.type === 'app-playlist')
}

function pageKey(view: AppView): string {
  if (typeof view === 'string') return view
  if (view.type === 'playlist') return `playlist-${view.playlist.source}-${view.playlist.type}-${String(view.playlist.id)}`
  if (view.type === 'app-playlist') return `app-playlist-${view.id}`
  if (view.type === 'toplist') return `toplist-${view.source}-${view.chartType ?? 'playlists'}`
  if (view.type === 'provider-playlists') return `provider-playlists-${view.source}`
  if (view.type === 'song-comments') return `song-comments-${view.track.source}-${String(view.track.id)}`
  if (view.type === 'search') return `search-${view.keyword}`
  if (view.type === 'bilibili-video') return `bilibili-video-${view.bvid}`
  return `${view.type}-${view.source}-${String(view.id)}`
}

export function initialPageTransition(view: AppView, revision: number): PageTransitionState {
  return { current: { view, key: `${pageKey(view)}-${revision}`, revision }, origin: null }
}

export function nextPageTransition(state: PageTransitionState, view: AppView, revision: number, action: 'push' | 'pop'): PageTransitionState {
  if (state.current.revision === revision && state.current.view === view) return state
  const next = initialPageTransition(view, revision)
  if (typeof view === 'object' && view.type === 'song-comments') {
    next.commentOrigin = typeof state.current.view === 'object' && state.current.view.type === 'song-comments'
      ? state.commentOrigin : state
    next.origin = next.commentOrigin?.current ?? null
    return next
  }
  if (action === 'pop' && state.commentOrigin && pageKey(state.commentOrigin.current.view) === pageKey(view)) {
    return { ...state.commentOrigin, current: { ...state.commentOrigin.current, view, revision } }
  }
  if (isDetailView(view)) {
    // 后退进入详情时，刚离开的页面在详情之后，不能作为封面返回的来源页。
    next.origin = isDetailView(state.current.view) ? state.origin : action === 'push' ? state.current : null
  } else if (action === 'pop' && state.origin && pageKey(state.origin.view) === pageKey(view)) {
    next.current.key = state.origin.key
  }
  return next
}
