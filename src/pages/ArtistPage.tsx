import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { TrackSearch } from '../components/ui/TrackSearch'
import { matchingTrackIndices } from '../lib/track-search'
import { useArtistSearch } from '../hooks/useArtistSearch'
import { serviceFor } from '../lib/service-registry'
import { useNavigationStore, type ArtistPageState } from '../stores/navigation'
import { usePlaylistStore } from '../stores/playlist'
import { useBackdropStore } from '../stores/backdrop'
import { ArtistHeader } from '../components/Artist/ArtistHeader'
import { TrackRow } from '../components/Explore/TrackRow'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { ArtistPill } from '../components/Explore/ArtistPill'
import { ScrollArea } from '../components/ui/ScrollArea'
import { VirtualList } from '../components/ui/VirtualList'
import { tapScale, springSnappy } from '../lib/motion-presets'
import { BROWSE_CACHE_MAX_AGE_MS, getCachedProviderData, requestProviderData } from '../lib/provider-request-cache'
import { isCatalogUnavailable } from '../lib/track-availability'
import type { ArtistInfo, MusicSource, Track, Playlist } from '../types/domain'
import styles from './ArtistPage.module.css'
import { providerAccountSession } from '../lib/provider-account-session'
import { isProviderParticipating, useProviderStore } from '../stores/providers'

type ArtistTab = 'songs' | 'albums' | 'similar'
const ARTIST_SONG_PAGE_SIZE = 50
const TRACK_ROW_HEIGHT = 56

interface SongPreview { songs: Track[]; hasMore: boolean }

interface ArtistPageProps {
  id: unknown
  source: 'netease' | 'qq' | 'apple'
  initialState?: ArtistPageState
}

export function ArtistPage({ id, source, initialState }: ArtistPageProps) {
  const runtime = useProviderStore((state) => state.byId[source])
  const participating = runtime.enabled && runtime.auth === 'authenticated'
  const scope = (part: string) => `artist:${String(id)}:${part}`
  const cachedArtist = participating ? getCachedProviderData<ArtistInfo>(source, scope('detail')) : undefined
  const cachedSongs = participating ? getCachedProviderData<SongPreview>(source, scope('songs')) : undefined
  const cachedAlbums = participating ? getCachedProviderData<Playlist[]>(source, scope('albums')) : undefined
  const cachedSimilar = participating ? getCachedProviderData<ArtistInfo[]>(source, scope('similar')) : undefined
  const savedState = useRef(initialState)
  const scrollRestored = useRef(false)
  const [query, setQuery] = useState(initialState?.query ?? '')
  const searching = Boolean(query.trim())
  const [artist, setArtist] = useState<ArtistInfo | null>(cachedArtist ?? null)
  const [artistLoaded, setArtistLoaded] = useState(cachedArtist !== undefined)
  const [songs, setSongs] = useState<Track[]>(cachedSongs?.songs ?? [])
  const [albums, setAlbums] = useState<Playlist[]>(cachedAlbums ?? [])
  const [songsLoaded, setSongsLoaded] = useState(cachedSongs !== undefined)
  const [albumsLoaded, setAlbumsLoaded] = useState(cachedAlbums !== undefined)
  const [similar, setSimilar] = useState<ArtistInfo[]>(cachedSimilar ?? [])
  const [similarLoaded, setSimilarLoaded] = useState(cachedSimilar !== undefined)
  const [similarError, setSimilarError] = useState(false)
  const [similarRetry, setSimilarRetry] = useState(0)
  const [tab, setTab] = useState<ArtistTab>(initialState?.tab ?? 'songs')
  const [scrolled, setScrolled] = useState(false)
  const [songsHasMore, setSongsHasMore] = useState(cachedSongs?.hasMore ?? false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // 必须按导航条目自带的 source 取 service：歌手可能来自另一音源（跨音源兜底的曲目、
  // 跨平台导航留下的历史条目也必须按实体自身 source 查询，避免把网易 id 发给 QQ。
  const service = useMemo(() => serviceFor(source), [source])
  const search = useArtistSearch(id, source, tab === 'songs' && searching && participating)
  const active = useNavigationStore((state) => {
    const view = state.currentView
    return typeof view === 'object' && view.type === 'artist' && view.source === source && String(view.id) === String(id)
  })
  const goBack = useNavigationStore((s) => s.goBack)
  const navigateTo = useNavigationStore((s) => s.navigateTo)
  const updatePageState = useNavigationStore((s) => s.updateArtistPageState)

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const saveScroll = () => {
      if (scrollRestored.current) updatePageState(id, source, { scrollTop: node.scrollTop })
    }
    const cancelRestore = () => {
      scrollRestored.current = true
      updatePageState(id, source, { scrollTop: node.scrollTop })
    }
    node.addEventListener('scroll', saveScroll, { passive: true })
    node.addEventListener('wheel', cancelRestore, { passive: true })
    node.addEventListener('touchmove', cancelRestore, { passive: true })
    return () => {
      node.removeEventListener('scroll', saveScroll)
      node.removeEventListener('wheel', cancelRestore)
      node.removeEventListener('touchmove', cancelRestore)
    }
  }, [id, source, updatePageState])

  useLayoutEffect(() => {
    const ready = tab === 'albums' ? albumsLoaded : tab === 'similar' ? similarLoaded : songsLoaded && !search.loading
    if (scrollRestored.current || !artistLoaded || !ready || !scrollRef.current) return
    scrollRef.current.scrollTop = savedState.current?.scrollTop ?? 0
    setScrolled(scrollRef.current.scrollTop > 8)
    scrollRestored.current = true
  }, [artistLoaded, tab, albumsLoaded, similarLoaded, songsLoaded, search.loading])

  useLayoutEffect(() => {
    // 快速连点歌手时，先发的请求可能后返回；用 cancelled 丢弃过期响应
    let cancelled = false
    setArtist(cachedArtist ?? null); setSongs(cachedSongs?.songs ?? []); setAlbums(cachedAlbums ?? [])
    setArtistLoaded(cachedArtist !== undefined)
    setSongsLoaded(cachedSongs !== undefined); setAlbumsLoaded(cachedAlbums !== undefined)
    setSongsHasMore(cachedSongs?.hasMore ?? false)
    if (!participating) {
      return () => { cancelled = true }
    }
    void requestProviderData(source, scope('detail'), () => service.getArtistDetail(id), { maxAgeMs: BROWSE_CACHE_MAX_AGE_MS }).then((v) => { if (!cancelled) setArtist(v) }).catch(() => {})
      .finally(() => { if (!cancelled) setArtistLoaded(true) })
    const accountSession = providerAccountSession(source)
    const checkSession = () => {
      if (!isProviderParticipating(source) || providerAccountSession(source) !== accountSession) throw new Error('歌手数据会话已失效')
    }
    void requestProviderData<SongPreview>(source, scope('songs'), async () => {
      if (!service.getArtistSongsPage) {
        const list = await service.getArtistSongs(id)
        checkSession()
        const available = list.filter((song) => !isCatalogUnavailable(song))
        return { songs: available.slice(0, ARTIST_SONG_PAGE_SIZE), hasMore: list.length > ARTIST_SONG_PAGE_SIZE || available.length !== list.length }
      }

      let offset = 0
      let hasMore = true
      let skippedUnavailable = false
      const available: Track[] = []
      const seen = new Set<string>()
      while (hasMore && available.length < ARTIST_SONG_PAGE_SIZE) {
        const page = await service.getArtistSongsPage(id, offset, ARTIST_SONG_PAGE_SIZE)
        checkSession()
        skippedUnavailable ||= page.songs.some(isCatalogUnavailable)
        for (const song of page.songs) {
          if (isCatalogUnavailable(song)) continue
          const key = `${song.source}:${String(song.id)}`
          if (seen.has(key)) continue
          seen.add(key)
          available.push(song)
        }
        hasMore = page.hasMore && page.nextOffset > offset
        offset = page.nextOffset
      }
      return { songs: available.slice(0, ARTIST_SONG_PAGE_SIZE), hasMore: hasMore || skippedUnavailable || available.length > ARTIST_SONG_PAGE_SIZE }
    }, { maxAgeMs: BROWSE_CACHE_MAX_AGE_MS }).then((preview) => {
      if (cancelled) return
      setSongs(preview.songs)
      setSongsHasMore(preview.hasMore)
    }).catch(() => {}).finally(() => { if (!cancelled) setSongsLoaded(true) })
    void requestProviderData(source, scope('albums'), () => service.getArtistAlbums(id), { maxAgeMs: BROWSE_CACHE_MAX_AGE_MS }).then((v) => { if (!cancelled) setAlbums(v) }).catch(() => {})
      .finally(() => { if (!cancelled) setAlbumsLoaded(true) })
    return () => { cancelled = true }
  }, [id, runtime, service])

  useEffect(() => {
    let cancelled = false
    setSimilar(cachedSimilar ?? [])
    setSimilarLoaded(cachedSimilar !== undefined)
    setSimilarError(false)
    if (!participating) {
      setSimilarLoaded(true)
      return () => { cancelled = true }
    }
    if (service.getSimilarArtists) {
      void requestProviderData(source, scope('similar'), () => service.getSimilarArtists!(id), { force: similarRetry > 0, maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
        .then((list) => { if (!cancelled) setSimilar(list) })
        .catch(() => { if (!cancelled) setSimilarError(true) })
        .finally(() => { if (!cancelled) setSimilarLoaded(true) })
    } else {
      setSimilarLoaded(true)
    }
    return () => { cancelled = true }
  }, [id, runtime, service, similarRetry])

  // 相似歌手可能跨音源，跟着条目自己的 source 走，别沿用当前页的 source
  function openArtist(nextId: unknown, nextSource: MusicSource) {
    if (nextSource !== 'netease' && nextSource !== 'qq' && nextSource !== 'apple') return
    navigateTo({ type: 'artist', id: nextId, source: nextSource })
  }

  const tabs: ArtistTab[] = service.getSimilarArtists ? ['songs', 'albums', 'similar'] : ['songs', 'albums']

  const tabButtons = tabs.map((t) => (
    <button
      key={t}
      className={`${styles.subTab} no-drag ${tab === t ? styles.active : ''}`}
      aria-pressed={tab === t}
      onClick={() => {
        scrollRestored.current = true
        setTab(t)
        updatePageState(id, source, { tab: t, scrollTop: scrollRef.current?.scrollTop ?? 0 })
      }}
    >
      {{ songs: '热门单曲', albums: '专辑', similar: '相似歌手' }[t]}
    </button>
  ))

  // 歌手头像模糊后作为全局背景(铺满整个应用);离开详情页时清空
  useEffect(() => {
    if (active) return useBackdropStore.getState().setCover(artist?.avatar)
  }, [active, artist?.avatar])

  const displayedSongs = searching
    ? matchingTrackIndices(search.songs, query).map((index) => search.songs[index]).filter((song) => !isCatalogUnavailable(song))
    : songs

  function playAll() {
    const playableSongs = (searching ? displayedSongs : songs).filter((song) => !isCatalogUnavailable(song))
    if (playableSongs.length) usePlaylistStore.getState().setQueue(playableSongs, 0)
  }

  function playTrack(track: Track) {
    if (isCatalogUnavailable(track)) return
    const playableSongs = (searching ? displayedSongs : songs).filter((song) => !isCatalogUnavailable(song))
    const index = playableSongs.findIndex((song) =>
      song.source === track.source && String(song.id) === String(track.id)
    )
    if (index >= 0) usePlaylistStore.getState().setQueue(playableSongs, index)
  }

  return (
    <ScrollArea className={styles.page} scrollRef={scrollRef} onScrolledChange={setScrolled}>
      <motion.button
        className={`${styles.back} no-drag`}
        onClick={goBack}
        aria-label="返回上一页"
        whileTap={tapScale}
        transition={springSnappy}
      >
        <svg
          className={styles.backIcon}
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

      {artist && <ArtistHeader artist={artist} onPlayAll={playAll} />}

      <div className={`${styles.subTabs} ${scrolled ? styles.subTabsScrolled : ''}`}>
        {tab === 'songs' ? (
          <TrackSearch value={query} onChange={(value) => {
            scrollRestored.current = true
            setQuery(value)
            updatePageState(id, source, { query: value, scrollTop: scrollRef.current?.scrollTop ?? 0 })
          }} placeholder="搜索该歌手的歌曲"
            count={displayedSongs.length} loading={search.loading} error={search.error} onRetry={search.retry}>
            <div className={styles.tabGroup}>{tabButtons}</div>
          </TrackSearch>
        ) : (
          <div className={styles.tabsOnly}><div className={styles.tabGroup}>{tabButtons}</div></div>
        )}
      </div>

      {tab === 'songs' && (
        <div className={styles.trackList}>
          <VirtualList
            total={displayedSongs.length}
            rowHeight={TRACK_ROW_HEIGHT}
            scrollRef={scrollRef}
            renderRow={(index) => {
              const song = displayedSongs[index]
              return <TrackRow
                track={song}
                index={index}
                onPlay={() => playTrack(song)}
                disabled={isCatalogUnavailable(song)}
                statusLabel={isCatalogUnavailable(song) ? '暂无版权' : undefined}
              />
            }}
          />
          {!searching && songsHasMore && (
            <button
              type="button"
              className={`${styles.viewAllSongs} no-drag`}
              onClick={() => navigateTo({ type: 'artistSongs', id, source })}
            >
              查看全部歌曲
            </button>
          )}
        </div>
      )}

      {tab === 'albums' && albums.length > 0 && (
        <div className={styles.albumGrid}>
          {albums.map((a, i) => (
            <PlaylistCard
              key={String(a.id) + i}
              playlist={a}
              meta={a.trackCount > 0 ? `${a.trackCount} 首` : '专辑'}
              onClick={() => useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'explore', playlist: a })}
            />
          ))}
        </div>
      )}

      {tab === 'similar' && (
        <div className={styles.similarGrid}>
          {similar.map((a, i) => (
            <ArtistPill key={String(a.id) + i} artist={a} onClick={() => openArtist(a.id, a.source)} />
          ))}
          {similarError ? (
            <div className={styles.similarError}>
              <p>相似歌手暂时无法加载。</p>
              <button type="button" onClick={() => setSimilarRetry((value) => value + 1)}>重试</button>
            </div>
          ) : similarLoaded && similar.length === 0 && (
            <p className={styles.similarEmpty}>暂无相似歌手数据</p>
          )}
        </div>
      )}
    </ScrollArea>
  )
}
