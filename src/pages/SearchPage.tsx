import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LayoutGroup, useIsPresent } from 'motion/react'
import { providerFor } from '../providers/registry'
import { PROVIDER_IDS, type ProviderId } from '../providers/types'
import { runProviderTasks, type ProviderResult } from '../lib/content-hub'
import { sizedImage } from '../lib/image-size'
import { isCatalogUnavailable } from '../lib/track-availability'
import { useProviderStore } from '../stores/providers'
import { useNavigationStore, type SearchPageState } from '../stores/navigation'
import { usePlaylistStore } from '../stores/playlist'
import { ScrollArea } from '../components/ui/ScrollArea'
import { SourceBadge } from '../components/ui/SourceBadge'
import { SourceName } from '../components/ui/SourceName'
import { TrackRow } from '../components/Explore/TrackRow'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { useMultiSelection } from '../hooks/useMultiSelection'
import { SelectionCheck, SelectionMarquee } from '../components/Playlist/SelectionControls'
import { BatchTrackActions } from '../components/Playlist/BatchTrackActions'
import { providerAccountSession } from '../lib/provider-account-session'
import type { ArtistInfo, Playlist, Track } from '../types/domain'
import styles from './SearchPage.module.css'

type Category = SearchPageState['category']
const categories: Record<Category, string> = { all: '全部', songs: '歌曲', artists: '歌手', albums: '专辑', playlists: '歌单' }
const trackKey = (track: Track) => `track:${track.source}:${String(track.id)}`
const collectionKey = (item: Playlist) => `${item.type}:${item.source}:${String(item.id)}`

type Results<T> = Partial<Record<ProviderId, ProviderResult<T[]>>>

export function SearchPage({ keyword, initialState }: { keyword: string; initialState?: SearchPageState }) {
  const [songs, setSongs] = useState<Results<Track>>({})
  const [artists, setArtists] = useState<Results<ArtistInfo>>({})
  const [albums, setAlbums] = useState<Results<Playlist>>({})
  const [playlists, setPlaylists] = useState<Results<Playlist>>({})
  const [category, setCategory] = useState<Category>(initialState?.category ?? 'all')
  const [selecting, setSelecting] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<ProviderId | null>(initialState?.sourceFilter ?? null)
  const [retry, setRetry] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const artistScrollRef = useRef<HTMLDivElement>(null)
  const artistScrollRestored = useRef(false)
  const savedArtistScrollTop = useRef(initialState?.artistScrollTop ?? 0)
  const route = useRef(useNavigationStore.getState().currentView)
  const present = useIsPresent()
  const currentView = useNavigationStore.getState().currentView
  if (present && typeof currentView === 'object' && currentView.type === 'search' && currentView.keyword === keyword) route.current = currentView
  const savedScrollTop = useRef(initialState?.scrollTop ?? 0)
  const scrollRestored = useRef(false)
  const navigateTo = useNavigationStore((state) => state.navigateTo)
  const updatePageState = useNavigationStore((state) => state.updateSearchPageState)
  const enabledSignature = useProviderStore((state) => PROVIDER_IDS.map((source) =>
    `${state.byId[source].enabled && state.byId[source].auth === 'authenticated' ? '1' : '0'}:${providerAccountSession(source)}`
  ).join('|'))
  const sources = useMemo(() => PROVIDER_IDS.filter((_, index) => enabledSignature.split('|')[index].startsWith('1:')), [enabledSignature])
  const activeFilter = sourceFilter && sources.includes(sourceFilter) ? sourceFilter : null
  const visibleSources = activeFilter ? [activeFilter] : sources

  useEffect(() => {
    const controller = new AbortController()
    setSongs({})
    setArtists({})
    setAlbums({})
    setPlaylists({})
    selection.clear()
    setSelecting(false)
    if (!keyword.trim()) return () => controller.abort()
    const sessions = new Map(sources.map((source) => [source, providerAccountSession(source)]))
    const options = {
      signal: controller.signal,
      isEnabled: (source: ProviderId) => {
        const state = useProviderStore.getState().byId[source]
        return state.enabled && state.auth === 'authenticated' && sessions.get(source) === providerAccountSession(source)
      },
      isEmpty: (items: unknown[]) => items.length === 0,
    }
    // 歌曲与歌手分别落地，某一类请求失败不会吞掉另一类的结果。
    void runProviderTasks(sources, (source) => providerFor(source).catalog.searchTracks(keyword.trim()), {
      ...options,
      onUpdate: (result) => setSongs((current) => ({ ...current, [result.source]: result })),
    })
    void runProviderTasks(sources, (source) => providerFor(source).catalog.searchArtists(keyword.trim()), {
      ...options,
      onUpdate: (result) => setArtists((current) => ({ ...current, [result.source]: result })),
    })
    void runProviderTasks(sources, (source) => providerFor(source).catalog.searchAlbums?.(keyword.trim()) ?? Promise.resolve([]), {
      ...options,
      onUpdate: (result) => setAlbums((current) => ({ ...current, [result.source]: result })),
    })
    void runProviderTasks(sources, (source) => providerFor(source).catalog.searchPlaylists?.(keyword.trim()) ?? Promise.resolve([]), {
      ...options,
      onUpdate: (result) => setPlaylists((current) => ({ ...current, [result.source]: result })),
    })
    return () => controller.abort()
  }, [keyword, sources, enabledSignature, retry])

  const visibleSongs = visibleSources.flatMap((source) => songs[source]?.data ?? [])
  const visibleArtists = visibleSources.flatMap((source) => artists[source]?.data ?? [])
  const visibleAlbums = visibleSources.flatMap((source) => albums[source]?.data ?? [])
  const visiblePlaylists = visibleSources.flatMap((source) => playlists[source]?.data ?? [])
  const albumsLoading = visibleSources.some((source) => !albums[source] || albums[source]?.status === 'loading')
  const playlistsLoading = visibleSources.some((source) => !playlists[source] || playlists[source]?.status === 'loading')
  const songsLoading = visibleSources.some((source) => !songs[source] || songs[source]?.status === 'loading')
  const artistsLoading = visibleSources.some((source) => !artists[source] || artists[source]?.status === 'loading')
  const resultsLoading = category === 'all' ? songsLoading || artistsLoading || albumsLoading || playlistsLoading
    : category === 'songs' ? songsLoading : category === 'artists' ? artistsLoading : category === 'albums' ? albumsLoading : playlistsLoading

  useLayoutEffect(() => {
    if (scrollRestored.current || resultsLoading || !scrollRef.current) return
    scrollRef.current.scrollTop = savedScrollTop.current
    scrollRestored.current = true
  }, [resultsLoading])

  useLayoutEffect(() => {
    if (artistScrollRestored.current || artistsLoading || !artistScrollRef.current) return
    artistScrollRef.current.scrollTop = savedArtistScrollTop.current
    artistScrollRestored.current = true
  }, [artistsLoading, category])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const saveScroll = () => {
      if (scrollRestored.current && useNavigationStore.getState().currentView === route.current) updatePageState(keyword, { scrollTop: node.scrollTop })
    }
    const cancelRestore = () => {
      scrollRestored.current = true
      artistScrollRestored.current = true
      if (useNavigationStore.getState().currentView === route.current) {
        updatePageState(keyword, { scrollTop: node.scrollTop, artistScrollTop: artistScrollRef.current?.scrollTop ?? 0 })
      }
    }
    const cancelKeyboardRestore = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
        && !(event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]'))) cancelRestore()
    }
    node.addEventListener('scroll', saveScroll, { passive: true })
    node.addEventListener('wheel', cancelRestore, { passive: true })
    node.addEventListener('touchstart', cancelRestore, { passive: true })
    node.addEventListener('pointerdown', cancelRestore)
    node.addEventListener('keydown', cancelKeyboardRestore)
    return () => {
      node.removeEventListener('scroll', saveScroll)
      node.removeEventListener('wheel', cancelRestore)
      node.removeEventListener('touchstart', cancelRestore)
      node.removeEventListener('pointerdown', cancelRestore)
      node.removeEventListener('keydown', cancelKeyboardRestore)
    }
  }, [keyword, updatePageState])
  const failures = visibleSources.flatMap((source) => [
    ...(songs[source]?.status === 'error' ? [{ source, label: '歌曲', error: songs[source]?.error }] : []),
    ...(albums[source]?.status === 'error' ? [{ source, label: '专辑', error: albums[source]?.error }] : []),
    ...(playlists[source]?.status === 'error' ? [{ source, label: '歌单', error: playlists[source]?.error }] : []),
    ...(artists[source]?.status === 'error' ? [{ source, label: '歌手', error: artists[source]?.error }] : []),
  ])

  const displayedTracks = category === 'all' || category === 'songs' ? visibleSongs : []
  const displayedCollections = [
    ...(category === 'all' || category === 'albums' ? visibleAlbums : []),
    ...(category === 'all' || category === 'playlists' ? visiblePlaylists : []),
  ]
  const selection = useMultiSelection({
    enabled: selecting,
    keys: [...displayedTracks.map(trackKey), ...displayedCollections.map(collectionKey)],
    disabledKeys: displayedTracks.filter(isCatalogUnavailable).map(trackKey),
    resetKey: `${keyword}:${enabledSignature}:${category}:${activeFilter}`,
    onExit: () => setSelecting(false),
  })
  const { selected } = selection
  const selectableCount = displayedTracks.filter((track) => !isCatalogUnavailable(track)).length + displayedCollections.length
  const selectedTracks = displayedTracks.filter((track) => selected.has(trackKey(track)))
  const selectedCollections = displayedCollections.filter((item) => selected.has(collectionKey(item)))

  function enterSelection() {
    setSelecting(true)
    selection.rootRef.current?.focus({ preventScroll: true })
  }

  function changeFilters(patch: Partial<Pick<SearchPageState, 'category' | 'sourceFilter'>>) {
    if (useNavigationStore.getState().currentView !== route.current) return
    scrollRestored.current = true
    savedArtistScrollTop.current = 0
    artistScrollRestored.current = true
    if (artistScrollRef.current) artistScrollRef.current.scrollTop = 0
    if (patch.category !== undefined) setCategory(patch.category)
    if (patch.sourceFilter !== undefined) setSourceFilter(patch.sourceFilter)
    updatePageState(keyword, { ...patch, scrollTop: scrollRef.current?.scrollTop ?? 0, artistScrollTop: 0 })
    selection.clear()
    setSelecting(false)
  }

  function playSong(track: Track) {
    if (isCatalogUnavailable(track)) return
    const queue = visibleSongs.filter((song) => !isCatalogUnavailable(song))
    const index = queue.findIndex((song) => song.source === track.source && String(song.id) === String(track.id))
    if (index >= 0) usePlaylistStore.getState().setQueue(queue, index)
  }

  return (
    <ScrollArea className={styles.page} scrollRef={scrollRef}>
      <div className={styles.content} ref={selection.rootRef} {...selection.surfaceProps}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>聚合搜索</p>
          <h1>“{keyword}”<span>的搜索结果</span></h1>
        </header>

        <div className={styles.filters} role="group" aria-label="筛选搜索来源">
          <button type="button" aria-pressed={!activeFilter} onClick={() => changeFilters({ sourceFilter: null })}>全部平台</button>
          {sources.map((source) => (
            <button key={source} type="button" aria-pressed={activeFilter === source} onClick={() => changeFilters({ sourceFilter: source })}>
              <SourceBadge source={source} compact reveal />
              <span><SourceName source={source} /></span>
            </button>
          ))}
        </div>

        {sources.length > 0 && <>
          <div className={styles.categories} role="group" aria-label="筛选搜索类型">
            {(Object.keys(categories) as Category[]).map((item) => <button type="button" key={item} aria-pressed={category === item} onClick={() => changeFilters({ category: item })}>{categories[item]}</button>)}
          </div>
          {selecting && <BatchTrackActions tracks={selectedTracks} collections={selectedCollections} onDone={selection.clear}
            selection={{ total: selectableCount, onSelectAll: selection.selectAll, onClear: selection.clear, onExit: selection.exit }} />}
        </>}

        {sources.length === 0 ? (
          <div className={styles.empty}>
            <h2>启用音乐平台，开始搜索</h2>
            <p>请先登录并启用至少一个音乐平台。</p>
            <button type="button" onClick={() => navigateTo('settings')}>前往设置</button>
          </div>
        ) : (
          <>
            {failures.length > 0 && (
              <div className={styles.errors} role="status">
                <div>{failures.map(({ source, label, error }) => (
                  <p key={`${source}:${label}`}><SourceName source={source} /> · {label}：{error?.message ?? '搜索失败'}</p>
                ))}</div>
                <button type="button" onClick={() => setRetry((value) => value + 1)}>重新搜索</button>
              </div>
            )}

            {(category === 'all' || category === 'artists') && <section className={styles.section} aria-label="歌手搜索结果" aria-busy={artistsLoading}>
              <div className={styles.sectionHeading}><h2>歌手</h2>{artistsLoading && <span role="status">搜索中…</span>}</div>
              {visibleArtists.length > 0 ? (
                <div className={`${styles.artistGrid}${visibleArtists.length <= 10 ? ` ${styles.artistGridFit}` : ''}`} ref={artistScrollRef} onScroll={(event) => {
                  if (artistScrollRestored.current && useNavigationStore.getState().currentView === route.current) {
                    updatePageState(keyword, { artistScrollTop: event.currentTarget.scrollTop })
                  }
                }}>
                  {visibleArtists.map((artist) => (
                    <button key={`${artist.source}:${String(artist.id)}`} className={styles.artist} type="button" onClick={() => {
                      if (artist.source !== 'local') navigateTo({ type: 'artist', id: artist.id, source: artist.source })
                    }}>
                      {artist.avatar
                        ? <img src={sizedImage(artist.avatar, 160)} alt="" loading="lazy" />
                        : <span className={styles.avatarFallback} aria-hidden="true">{artist.name.slice(0, 1)}</span>}
                      <span className={styles.artistInfo}><strong>{artist.name}</strong><span><SourceBadge source={artist.source} compact reveal /><SourceName source={artist.source} /></span></span>
                    </button>
                  ))}
                </div>
              ) : <p className={styles.hint}>{artistsLoading ? '正在寻找相关歌手…' : failures.some((item) => item.label === '歌手') ? '部分平台未能完成歌手搜索，请重试。' : '没有找到相关歌手，试试其他关键词。'}</p>}
            </section>}

            {(category === 'all' || category === 'songs') && <section className={styles.section} aria-label="歌曲搜索结果" aria-busy={songsLoading}>
              <div className={styles.sectionHeading}>
                <h2>歌曲</h2>
                <div className={styles.sectionActions}>
                  {songsLoading && <span role="status">搜索中…</span>}
                  {!selecting && <BatchTrackActions compact menuLabel="歌曲搜索结果更多操作" label="当前歌曲搜索结果" selectLabel="多选搜索结果"
                    tracks={visibleSongs.filter(song => !isCatalogUnavailable(song))} onSelect={enterSelection} />}
                </div>
              </div>
              {visibleSongs.length > 0 ? visibleSongs.map((song, index) => (
                <div className={styles.selectableRow} key={`${song.source}:${String(song.id)}`} data-selected={selected.has(trackKey(song))} data-selection-key={trackKey(song)} data-unavailable={isCatalogUnavailable(song)}>
                  {selecting && <SelectionCheck label={`选择歌曲：${song.name}`} checked={selected.has(trackKey(song))} disabled={isCatalogUnavailable(song)} />}
                  <TrackRow track={song} index={index} hideOfflineAction={selecting} hideLikeAction={selecting} onPlay={() => { if (!selecting) playSong(song) }} disabled={isCatalogUnavailable(song)} statusLabel={isCatalogUnavailable(song) ? '暂无版权' : undefined} />
                </div>
              )) : <p className={styles.hint}>{songsLoading ? '正在搜索各平台的歌曲…' : failures.some((item) => item.label === '歌曲') ? '部分平台未能完成歌曲搜索，请重试。' : '没有找到相关歌曲，试试歌曲名或歌手名。'}</p>}
            </section>}

            {(['albums', 'playlists'] as const).filter((kind) => category === 'all' || category === kind).map((kind) => {
              const items = kind === 'albums' ? visibleAlbums : visiblePlaylists
              const loading = kind === 'albums' ? albumsLoading : playlistsLoading
              const label = categories[kind]
              return <section className={styles.section} key={kind} aria-label={`${label}搜索结果`} aria-busy={loading}>
                <div className={styles.sectionHeading}>
                  <h2>{label}</h2>
                  <div className={styles.sectionActions}>
                    {loading && <span role="status">搜索中…</span>}
                    {!selecting && <BatchTrackActions compact menuLabel={`${label}搜索结果更多操作`} label={`当前${label}搜索结果`} selectLabel="多选搜索结果"
                      tracks={[]} collections={items} onSelect={enterSelection} />}
                  </div>
                </div>
                {items.length ? <div className={styles.collectionGrid}>
                  {items.map((item) => <div key={collectionKey(item)} className={styles.selectableCard} data-selected={selected.has(collectionKey(item))} data-selection-key={collectionKey(item)}>
                    {selecting && <div className={styles.cardCheck}><SelectionCheck label={`选择${label}：${item.name}`} checked={selected.has(collectionKey(item))} /></div>}
                    {/* 隔离布局测量，筛选增删卡片时不触发其他封面的转场。 */}
                    <LayoutGroup inherit="id">
                      <PlaylistCard playlist={item} selectionMode={selecting} meta={[item.creator, item.trackCountKnown === false ? '' : `${item.trackCount} 首`].filter(Boolean).join(' · ')} layoutId={`explore-cover-${String(item.id)}`} layoutDependency="search-results" onClick={() => { if (!selecting) navigateTo({ type: 'playlist', from: 'explore', playlist: item }) }} />
                    </LayoutGroup>
                  </div>)}
                </div> : <p className={styles.hint}>{loading ? `正在寻找相关${label}…` : failures.some((item) => item.label === label) ? `部分平台未能完成${label}搜索，请重试。` : `没有找到相关${label}，试试其他关键词。`}</p>}
              </section>
            })}
          </>
        )}
      </div>
      <SelectionMarquee rect={selection.marquee} />
    </ScrollArea>
  )
}
