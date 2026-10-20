// 预览浮窗分页加载:只给实现了 getPlaylistPage 的音源用(骨架需整单翻页的 QQ / Apple Music)。
// 首屏只取一页,滚到底再取下一页;不写 useLazyPlaylist 缓存,播放/进详情时再按需拉整单。
// 竞态守卫沿用 session 计数 ref:切账号/卸载后丢弃在途响应。

import { useCallback, useEffect, useRef, useState } from 'react'
import { serviceFor } from '../lib/service-registry'
import { isProviderId } from '../providers/types'
import { useProviderStore } from '../stores/providers'
import type { Playlist, Track } from '../types/domain'

/** 首页只取 15 首,尽快出现在浮窗里;之后每页 50 首。 */
export const PREVIEW_FIRST_PAGE_SIZE = 15
export const PREVIEW_PAGE_SIZE = 50

interface PreviewState {
  tracks: Track[]
  total: number | null
  nextOffset: number
  hasMore: boolean
  loading: boolean
  loadingMore: boolean
  error: boolean
  moreError: boolean
}

const initialState: PreviewState = {
  tracks: [], total: null, nextOffset: 0, hasMore: true, loading: true, loadingMore: false, error: false, moreError: false,
}

export function usePlaylistPreview(playlist: Playlist) {
  const service = serviceFor(playlist.source)
  const available = useProviderStore((state) =>
    !isProviderId(playlist.source)
      || (state.byId[playlist.source].enabled && state.byId[playlist.source].auth === 'authenticated' && state.byId[playlist.source].playbackAvailable !== false)
  )
  const [state, setState] = useState<PreviewState>(initialState)
  const stateRef = useRef(state)
  stateRef.current = state
  const sessionRef = useRef(0)
  const busyRef = useRef(false)

  const fetchPage = useCallback(async (session: number, offset: number) => {
    if (!service.getPlaylistPage) throw new Error('该音源不支持分页读取歌单')
    busyRef.current = true
    try {
      const page = await service.getPlaylistPage(playlist.id, offset, offset === 0 ? PREVIEW_FIRST_PAGE_SIZE : PREVIEW_PAGE_SIZE)
      if (sessionRef.current !== session) return
      setState((prev) => {
        const seen = new Set(prev.tracks.map((track) => String(track.id)))
        const fresh = page.tracks.filter((track) => !seen.has(String(track.id)))
        return {
          ...prev,
          tracks: [...prev.tracks, ...fresh],
          total: page.total ?? prev.total,
          nextOffset: page.nextOffset,
          // 游标不前进时停止,避免上游异常时反复请求同一页
          hasMore: page.hasMore && page.nextOffset > offset,
          loading: false,
          loadingMore: false,
          error: false,
          moreError: false,
        }
      })
    } catch {
      if (sessionRef.current !== session) return
      setState((prev) => prev.tracks.length
        ? { ...prev, loading: false, loadingMore: false, moreError: true }
        : { ...prev, loading: false, loadingMore: false, error: true })
    } finally {
      if (sessionRef.current === session) busyRef.current = false
    }
  }, [playlist.id, service])

  useEffect(() => {
    const session = ++sessionRef.current
    busyRef.current = false
    setState(initialState)
    if (!available) {
      setState({ ...initialState, loading: false, hasMore: false, error: true })
      return
    }
    void fetchPage(session, 0)
    return () => { sessionRef.current += 1 }
  }, [available, fetchPage])

  /** 滚动触底时调用;上一页失败后不自动重试,需用户点重试(force)。 */
  const loadMore = useCallback((force = false) => {
    const current = stateRef.current
    if (busyRef.current || current.loading || !current.hasMore || current.error || (current.moreError && !force)) return
    setState((prev) => ({ ...prev, loadingMore: true, moreError: false }))
    void fetchPage(sessionRef.current, current.nextOffset)
  }, [fetchPage])

  return {
    tracks: state.tracks,
    total: state.total ?? (state.hasMore ? playlist.trackCount : state.tracks.length),
    loading: state.loading,
    loadingMore: state.loadingMore,
    hasMore: state.hasMore,
    error: state.error,
    moreError: state.moreError,
    loadMore,
  }
}
