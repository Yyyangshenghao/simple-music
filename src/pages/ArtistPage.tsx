import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { TrackSearch } from '../components/ui/TrackSearch'
import { matchingTrackIndices } from '../lib/track-search'
import { useArtistSearch } from '../hooks/useArtistSearch'
import { serviceFor } from '../lib/service-registry'
import { useNavigationStore } from '../stores/navigation'
import { usePlaylistStore } from '../stores/playlist'
import { useBackdropStore } from '../stores/backdrop'
import { ArtistHeader } from '../components/Artist/ArtistHeader'
import { TrackRow } from '../components/Explore/TrackRow'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { ArtistPill } from '../components/Explore/ArtistPill'
import { ScrollArea } from '../components/ui/ScrollArea'
import { VirtualList } from '../components/ui/VirtualList'
import { tapScale, springSnappy } from '../lib/motion-presets'
import { isCatalogUnavailable } from '../lib/track-availability'
import type { ArtistInfo, MusicSource, Track, Playlist } from '../types/domain'
import styles from './ArtistPage.module.css'
import { useProviderStore } from '../stores/providers'

type ArtistTab = 'songs' | 'albums' | 'similar'
const ARTIST_SONG_PAGE_SIZE = 50
const TRACK_ROW_HEIGHT = 56

interface ArtistPageProps {
  id: unknown
  source: 'netease' | 'qq' | 'apple'
}

export function ArtistPage({ id, source }: ArtistPageProps) {
  const [query, setQuery] = useState('')
  const searching = Boolean(query.trim())
  const [artist, setArtist] = useState<ArtistInfo | null>(null)
  const [songs, setSongs] = useState<Track[]>([])
  const [albums, setAlbums] = useState<Playlist[]>([])
  const [similar, setSimilar] = useState<ArtistInfo[]>([])
  const [similarLoaded, setSimilarLoaded] = useState(false)
  const [similarError, setSimilarError] = useState(false)
  const [similarRetry, setSimilarRetry] = useState(0)
  const [tab, setTab] = useState<ArtistTab>('songs')
  const [scrolled, setScrolled] = useState(false)
  const [songsHasMore, setSongsHasMore] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // 必须按导航条目自带的 source 取 service：歌手可能来自另一音源（跨音源兜底的曲目、
  // 跨平台导航留下的历史条目也必须按实体自身 source 查询，避免把网易 id 发给 QQ。
  const service = useMemo(() => serviceFor(source), [source])
  const participating = useProviderStore((state) =>
    state.byId[source].enabled && state.byId[source].auth === 'authenticated'
  )
  const search = useArtistSearch(id, source, tab === 'songs' && searching && participating)
  useEffect(() => { setQuery('') }, [id, source])
  const goBack = useNavigationStore((s) => s.goBack)
  const navigateTo = useNavigationStore((s) => s.navigateTo)

  useEffect(() => {
    // 快速连点歌手时，先发的请求可能后返回；用 cancelled 丢弃过期响应
    let cancelled = false
    setArtist(null); setSongs([]); setAlbums([])
    setSongsHasMore(false)
    if (!participating) {
      return () => { cancelled = true }
    }
    void service.getArtistDetail(id).then((v) => { if (!cancelled) setArtist(v) }).catch(() => {})
    void (async () => {
      if (!service.getArtistSongsPage) {
        const list = await service.getArtistSongs(id)
        if (!cancelled) {
          const available = list.filter((song) => !isCatalogUnavailable(song))
          setSongs(available.slice(0, ARTIST_SONG_PAGE_SIZE))
          setSongsHasMore(list.length > ARTIST_SONG_PAGE_SIZE || available.length !== list.length)
        }
        return
      }

      let offset = 0
      let hasMore = true
      let skippedUnavailable = false
      const available: Track[] = []
      const seen = new Set<string>()
      while (!cancelled && hasMore && available.length < ARTIST_SONG_PAGE_SIZE) {
        const page = await service.getArtistSongsPage(id, offset, ARTIST_SONG_PAGE_SIZE)
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
      if (cancelled) return
      setSongs(available.slice(0, ARTIST_SONG_PAGE_SIZE))
      setSongsHasMore(hasMore || skippedUnavailable || available.length > ARTIST_SONG_PAGE_SIZE)
    })().catch(() => {})
    void service.getArtistAlbums(id).then((v) => { if (!cancelled) setAlbums(v) }).catch(() => {})
    return () => { cancelled = true }
  }, [id, participating, service])

  useEffect(() => {
    let cancelled = false
    setSimilar([])
    setSimilarLoaded(false)
    setSimilarError(false)
    if (!participating) {
      setSimilarLoaded(true)
      return () => { cancelled = true }
    }
    if (service.getSimilarArtists) {
      void service.getSimilarArtists(id)
        .then((list) => { if (!cancelled) setSimilar(list) })
        .catch(() => { if (!cancelled) setSimilarError(true) })
        .finally(() => { if (!cancelled) setSimilarLoaded(true) })
    } else {
      setSimilarLoaded(true)
    }
    return () => { cancelled = true }
  }, [id, participating, service, similarRetry])

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
      onClick={() => setTab(t)}
    >
      {{ songs: '热门单曲', albums: '专辑', similar: '相似歌手' }[t]}
    </button>
  ))

  // 歌手头像模糊后作为全局背景(铺满整个应用);离开详情页时清空
  useEffect(() => {
    useBackdropStore.getState().setCover(artist?.avatar)
    return () => useBackdropStore.getState().setCover(null)
  }, [artist?.avatar])

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
          <TrackSearch value={query} onChange={setQuery} placeholder="搜索该歌手的歌曲"
            count={displayedSongs.length} loading={search.loading} error={search.error} onRetry={search.retry}>
            <div className={styles.tabGroup}>{tabButtons}</div>
          </TrackSearch>
        ) : (
          <div className={styles.tabsOnly}>{tabButtons}</div>
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
