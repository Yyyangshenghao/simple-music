import type { AppView } from '../../stores/navigation'

interface PageFrame {
  view: AppView
  key: string
  revision: number
}

export interface PageTransitionState {
  current: PageFrame
  origin: PageFrame | null
}

export function isDetailView(view: AppView): view is Extract<AppView, { type: 'playlist' }> {
  return typeof view === 'object' && view.type === 'playlist'
}

function pageKey(view: AppView): string {
  if (typeof view === 'string') return view
  if (view.type === 'playlist') return `playlist-${view.playlist.source}-${view.playlist.type}-${String(view.playlist.id)}`
  if (view.type === 'toplist') return `toplist-${view.source}`
  if (view.type === 'search') return `search-${view.keyword}`
  return `${view.type}-${view.source}-${String(view.id)}`
}

export function initialPageTransition(view: AppView, revision: number): PageTransitionState {
  return { current: { view, key: `${pageKey(view)}-${revision}`, revision }, origin: null }
}

export function nextPageTransition(state: PageTransitionState, view: AppView, revision: number, action: 'push' | 'pop'): PageTransitionState {
  if (state.current.revision === revision && state.current.view === view) return state
  const next = initialPageTransition(view, revision)
  if (isDetailView(view)) {
    next.origin = isDetailView(state.current.view) ? state.origin : state.current
  } else if (action === 'pop' && state.origin && pageKey(state.origin.view) === pageKey(view)) {
    next.current.key = state.origin.key
  }
  return next
}
