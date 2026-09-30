import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { TrackSearch } from '../components/ui/TrackSearch'
import { matchingTrackIndices } from '../lib/track-search'
import { useArtistSearch } from '../hooks/useArtistSearch'
import { serviceFor } from '../lib/service-registry'
import { useNavigationStore } from '../stores/navigation'
import { usePlaylistStore } from '../stores/playlist'
import { useBackdropStore } from '../stores/backdrop'
import { useProviderStore } from '../stores/providers'
import { TrackRow } from '../components/Explore/TrackRow'
import { ScrollArea } from '../components/ui/ScrollArea'
import { VirtualList } from '../components/ui/VirtualList'
import { SourceBadge } from '../components/ui/SourceBadge'
import { sizedImage } from '../lib/image-size'
import { springSnappy, tapScale } from '../lib/motion-presets'
import { isCatalogUnavailable } from '../lib/track-availability'
import type { ArtistInfo, Track } from '../types/domain'
import styles from './ArtistSongsPage.module.css'

const PAGE_SIZE = 50
const TRACK_ROW_HEIGHT = 56

interface ArtistSongsPageProps {
  id: unknown
  source: 'netease' | 'qq' | 'apple'
}

export function ArtistSongsPage({ id, source }: ArtistSongsPageProps) {
  const [query, setQuery] = useState('')
  const searching = Boolean(query.trim())
  const [artist, setArtist] = useState<ArtistInfo | null>(null)
  const [songs, setSongs] = useState<Track[]>([])
  const [cursor, setCursor] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [initialRetry, setInitialRetry] = useState(0)
  const [hideUnavailable, setHideUnavailable] = useState(true)
  const requestScopeRef = useRef<object>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadSentinelRef = useRef<HTMLDivElement>(null)
  const service = useMemo(() => serviceFor(source), [source])
  const participating = useProviderStore((state) =>
    state.byId[source].enabled && state.byId[source].auth === 'authenticated'
  )
  const search = useArtistSearch(id, source, searching && participating)
  useEffect(() => { setQuery('') }, [id, source])
  const goBack = useNavigationStore((state) => state.goBack)

  useEffect(() => {
    let cancelled = false
    const requestScope = {}
    requestScopeRef.current = requestScope
    setArtist(null)
    setSongs([])
    setCursor(0)
    setHasMore(false)
    setLoadError(false)
    setLoading(participating)
    if (!participating) {
      setLoading(false)
      return () => { cancelled = true }
    }

    void service.getArtistDetail(id)
      .then((value) => { if (!cancelled) setArtist(value) })
      .catch(() => {})
    const initialSongs = service.getArtistSongsPage
      ? service.getArtistSongsPage(id, 0, PAGE_SIZE)
      : service.getArtistSongs(id).then((list) => ({ songs: list, nextOffset: list.length, hasMore: false }))
    void initialSongs
      .then((page) => {
        if (cancelled) return
        setSongs(page.songs)
        setCursor(page.nextOffset)
        setHasMore(page.hasMore)
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => {
      cancelled = true
      if (requestScopeRef.current === requestScope) requestScopeRef.current = {}
    }
  }, [id, initialRetry, participating, service])

  useEffect(() => {
    useBackdropStore.getState().setCover(artist?.avatar)
    return () => useBackdropStore.getState().setCover(null)
  }, [artist?.avatar])

  const searchedSongs = searching
    ? matchingTrackIndices(search.songs, query).map((index) => search.songs[index])
    : songs
  const visibleSongs = hideUnavailable ? searchedSongs.filter((song) => !isCatalogUnavailable(song)) : searchedSongs

  function playTrack(track: Track) {
    if (isCatalogUnavailable(track)) return
    const playableSongs = searchedSongs.filter((song) => !isCatalogUnavailable(song))
    const index = playableSongs.findIndex((song) =>
      song.source === track.source && String(song.id) === String(track.id)
    )
    if (index >= 0) usePlaylistStore.getState().setQueue(playableSongs, index)
  }

  const loadMore = useCallback(async () => {
    if (!service.getArtistSongsPage || loading || loadError || !hasMore) return
    const requestScope = requestScopeRef.current
    const requestOffset = cursor
    setLoading(true)
    try {
      const page = await service.getArtistSongsPage(id, requestOffset, PAGE_SIZE)
      if (requestScopeRef.current !== requestScope) return
      setSongs((current) => {
        const seen = new Set(current.map((track) => `${track.source}:${String(track.id)}`))
        const additions = page.songs.filter((track) => {
          const key = `${track.source}:${String(track.id)}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        return [...current, ...additions]
      })
      setCursor(page.nextOffset)
      setHasMore(page.hasMore && page.nextOffset > requestOffset)
    } catch {
      if (requestScopeRef.current === requestScope) setLoadError(true)
    } finally {
      if (requestScopeRef.current === requestScope) setLoading(false)
    }
  }, [cursor, hasMore, id, loadError, loading, service])

  useEffect(() => {
    const sentinel = loadSentinelRef.current
    if (searching || !sentinel || !hasMore || loading || loadError) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void loadMore()
    }, { rootMargin: '320px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadError, loading, loadMore, searching])

  return (
    <ScrollArea className={styles.page} scrollRef={scrollRef}>
      <motion.button
        className={`${styles.back} no-drag`}
        onClick={goBack}
        aria-label="返回歌手页"
        whileTap={tapScale}
        transition={springSnappy}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span>返回</span>
      </motion.button>

      <header className={styles.header}>
        {artist?.avatar && <img className={styles.avatar} src={sizedImage(artist.avatar, 160)} alt="" />}
        <div className={styles.titleBlock}>
          <div className={styles.eyebrow}>全部歌曲</div>
          <h1>{artist?.name ?? '歌手歌曲'}</h1>
          <div className={styles.meta}>
            <SourceBadge source={source} reveal />
            {artist?.musicSize ? <span>共 {artist.musicSize} 首</span> : null}
          </div>
        </div>
        {(searching ? search.songs : songs).some(isCatalogUnavailable) && (
          <button
            type="button"
            className={`${styles.availabilityFilter} no-drag`}
            aria-pressed={hideUnavailable}
            onClick={() => setHideUnavailable((value) => !value)}
          >
            {hideUnavailable ? '显示全部歌曲' : '隐藏无版权'}
          </button>
        )}
      </header>

      <div className={styles.trackList}>
        <TrackSearch value={query} onChange={setQuery} placeholder="搜索该歌手的歌曲"
          count={visibleSongs.length} loading={search.loading} error={search.error} onRetry={search.retry} />
        <VirtualList
          total={visibleSongs.length}
          rowHeight={TRACK_ROW_HEIGHT}
          scrollRef={scrollRef}
          renderRow={(index) => {
            const song = visibleSongs[index]
            return <TrackRow
              track={song}
              index={index}
              onPlay={() => playTrack(song)}
              disabled={isCatalogUnavailable(song)}
              statusLabel={isCatalogUnavailable(song) ? '暂无版权' : undefined}
            />
          }}
        />
      </div>

      {!searching && <div className={styles.pagination}>
        {loading ? (
          <span>正在载入完整曲库…</span>
        ) : loadError ? (
          <button
            type="button"
            onClick={() => songs.length > 0
              ? setLoadError(false)
              : setInitialRetry((value) => value + 1)}
          >
            加载失败，点击重试
          </button>
        ) : songs.length > 0 ? (
          hasMore ? null : <span>{hideUnavailable ? `已展示全部 ${visibleSongs.length} 首可播歌曲` : `已展示全部 ${songs.length} 首`}</span>
        ) : !loading ? (
          <span>{participating ? '暂时拿不到歌曲' : '该平台未登录或未启用'}</span>
        ) : null}
        <div ref={loadSentinelRef} className={styles.loadSentinel} aria-hidden="true" />
      </div>}
    </ScrollArea>
  )
}
