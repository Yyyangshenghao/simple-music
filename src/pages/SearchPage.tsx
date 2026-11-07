import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LayoutGroup, useIsPresent } from 'motion/react'
import { withBilibiliDisplayReading } from '../lib/bilibili-track-display'
import { seedBilibiliCovers } from '../stores/bilibili-covers'
import { useSettingsStore } from '../stores/settings'
import type { ProviderId } from '../providers/types'
import { sizedImage } from '../lib/image-size'
import { isCatalogUnavailable } from '../lib/track-availability'
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
import { useSearchResults } from '../hooks/useSearchResults'
import { SearchForm } from '../components/Search/SearchForm'
import { searchPreview, type SearchPreviewKind } from '../lib/search-preview'
import type { Playlist, Track } from '../types/domain'
import styles from './SearchPage.module.css'

type Category = SearchPageState['category']
const categories: Record<Category, string> = { all: '全部', songs: '歌曲', artists: '歌手', albums: '专辑', playlists: '歌单' }
const trackKey = (track: Track) => `track:${track.source}:${String(track.id)}`
const collectionKey = (item: Playlist) => `${item.type}:${item.source}:${String(item.id)}`

function Chevron() {
  return <svg className={styles.chevron} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
}

export function SearchPage({ keyword, initialState, focusInput }: { keyword: string; initialState?: SearchPageState; focusInput?: boolean }) {
  const present = useIsPresent()
  const currentView = useNavigationStore(state => state.currentView)
  const active = present && typeof currentView === 'object' && currentView.type === 'search' && currentView.keyword === keyword
  const { songs, artists, albums, playlists, sources, signature, busy, refresh, retryFailed } = useSearchResults(keyword, active)
  const [selectedCategory, setCategory] = useState<Category>(initialState?.category ?? 'all')
  const [selecting, setSelecting] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<ProviderId | null>(initialState?.sourceFilter ?? null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const artistScrollRef = useRef<HTMLDivElement>(null)
  const artistScrollRestored = useRef(false)
  const savedArtistScrollTop = useRef(initialState?.artistScrollTop ?? 0)
  const route = useRef(useNavigationStore.getState().currentView)
  if (active) route.current = currentView
  const savedScrollTop = useRef(initialState?.scrollTop ?? 0)
  const scrollRestored = useRef(false)
  const navigateTo = useNavigationStore((state) => state.navigateTo)
  const updatePageState = useNavigationStore((state) => state.updateSearchPageState)
  const activeFilter = sourceFilter && sources.includes(sourceFilter) ? sourceFilter : null
  const visibleSources = activeFilter ? [activeFilter] : sources
  const visibleCatalogSources = visibleSources.filter((source) => source !== 'bilibili')
  const songsOnly = visibleSources.length > 0 && visibleCatalogSources.length === 0
  const category = songsOnly ? 'songs' : selectedCategory

  const bilibiliTracks = useMemo(() => {
    const catalogTracks = sources.filter(source => source !== 'bilibili').flatMap(source => songs[source]?.data ?? [])
    const tracks = (songs.bilibili?.data ?? []).map(track => withBilibiliDisplayReading(track, catalogTracks))
    return { tracks, catalogTracks }
  }, [songs, sources])
  // 聚合搜索已拿到各平台结果，先从中补哔哩哔哩的专辑封面，少发额外搜索。
  useEffect(() => {
    void seedBilibiliCovers(bilibiliTracks.tracks, bilibiliTracks.catalogTracks).catch(() => {})
  }, [bilibiliTracks])
  const visibleSongs = visibleSources.flatMap(source => source === 'bilibili' ? bilibiliTracks.tracks : songs[source]?.data ?? [])
  const visibleArtists = visibleSources.flatMap((source) => artists[source]?.data ?? [])
  const visibleAlbums = visibleSources.flatMap((source) => albums[source]?.data ?? [])
  const visiblePlaylists = visibleSources.flatMap((source) => playlists[source]?.data ?? [])
  const albumsLoading = visibleCatalogSources.some((source) => !albums[source] || albums[source]?.status === 'loading')
  const playlistsLoading = visibleCatalogSources.some((source) => !playlists[source] || playlists[source]?.status === 'loading')
  const songsLoading = visibleSources.some((source) => !songs[source] || songs[source]?.status === 'loading')
  const artistsLoading = visibleCatalogSources.some((source) => !artists[source] || artists[source]?.status === 'loading')
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

  // 「全部」只预览每类前几项，其余经「查看全部」进入分类；多选范围与可见条目一致。
  const artistPreview = searchPreview(visibleArtists, 'artists', category)
  const songPreview = searchPreview(visibleSongs, 'songs', category)
  const albumPreview = searchPreview(visibleAlbums, 'albums', category)
  const playlistPreview = searchPreview(visiblePlaylists, 'playlists', category)
  const displayedTracks = category === 'all' || category === 'songs' ? songPreview.items : []
  const displayedCollections = [
    ...(category === 'all' || category === 'albums' ? albumPreview.items : []),
    ...(category === 'all' || category === 'playlists' ? playlistPreview.items : []),
  ]
  const selection = useMultiSelection({
    enabled: selecting,
    keys: [...displayedTracks.map(trackKey), ...displayedCollections.map(collectionKey)],
    resetKey: `${keyword}:${signature}:${category}:${activeFilter}`,
    onExit: () => setSelecting(false),
  })
  const { selected } = selection
  const resultCount = { songs: visibleSongs.length, artists: visibleArtists.length, albums: visibleAlbums.length, playlists: visiblePlaylists.length }
  const hasResults = Object.values(resultCount).some(count => count > 0)
  const showSection = (kind: SearchPreviewKind) => category === kind || (category === 'all' && resultCount[kind] > 0)
  const selectableCount = displayedTracks.length + displayedCollections.length
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
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    if (patch.category !== undefined) setCategory(patch.category)
    if (patch.sourceFilter !== undefined) setSourceFilter(patch.sourceFilter)
    updatePageState(keyword, { ...patch, scrollTop: scrollRef.current?.scrollTop ?? 0, artistScrollTop: 0 })
    selection.clear()
    setSelecting(false)
  }

  function viewAllButton(kind: SearchPreviewKind, hidden: number, total: number) {
    if (!hidden) return null
    const unit = { songs: '首', artists: '位', albums: '张', playlists: '个' }[kind]
    return <button type="button" className={styles.viewAll} onClick={() => changeFilters({ category: kind })}
      aria-label={`查看全部${total}${unit}${categories[kind]}`}>查看全部<Chevron /></button>
  }

  function playSong(track: Track) {
    if (isCatalogUnavailable(track)) return
    const queue = visibleSongs.filter((song) => !isCatalogUnavailable(song))
    const index = queue.findIndex((song) => song.source === track.source && String(song.id) === String(track.id))
    if (index >= 0) usePlaylistStore.getState().setQueue(queue, index)
  }

  return (
    <ScrollArea className={styles.page} scrollRef={scrollRef} onScrolledChange={setScrolled}>
      <div className={styles.content}>
        <SearchForm keyword={keyword} focusInput={focusInput} busy={busy} scrolled={scrolled} onRefresh={refresh} />
        <div className={styles.results} ref={selection.rootRef} {...selection.surfaceProps}>
          {keyword && sources.length > 0 && <div className={styles.toolbar}>
            {!songsOnly && <div className={styles.categories} role="group" aria-label="筛选搜索类型">
              {(Object.keys(categories) as Category[]).map((item) => <button type="button" key={item} aria-pressed={category === item} onClick={() => changeFilters({ category: item })}>{categories[item]}</button>)}
            </div>}
            <div className={styles.filters} role="group" aria-label="筛选搜索来源">
              <button type="button" aria-pressed={!activeFilter} onClick={() => changeFilters({ sourceFilter: null })}>全部平台</button>
              {sources.map((source) => (
                <button key={source} type="button" aria-pressed={activeFilter === source} onClick={() => changeFilters({ sourceFilter: source })}>
                  <span aria-hidden="true"><SourceBadge source={source} compact reveal /></span>
                  <span><SourceName source={source} /></span>
                </button>
              ))}
            </div>
          </div>}

          {keyword && sources.length > 0 && selecting && <BatchTrackActions tracks={selectedTracks} collections={selectedCollections} onDone={selection.clear}
            selection={{ total: selectableCount, onSelectAll: selection.selectAll, onClear: selection.clear, onExit: selection.exit }} />}

          {sources.length === 0 ? (
            <div className={styles.empty}>
              <h2>暂无可搜索的音源</h2>
              <p>请在设置中启用音源，部分平台需要先登录。</p>
              <button type="button" onClick={() => {
                useNavigationStore.getState().requestSettingsMusic()
                navigateTo('settings')
              }}>前往设置</button>
            </div>
          ) : keyword && (
            <>
              {category === 'all' && resultsLoading && !hasResults && <p className={styles.status} role="status">正在搜索各平台…</p>}
              {category === 'all' && !resultsLoading && !hasResults && failures.length === 0 && (
                <div className={styles.empty}><h2>没有找到相关结果</h2><p>试试其他关键词，或切换搜索平台。</p></div>
              )}
              {failures.length > 0 && (
                <div className={styles.errors} role="status">
                  {failures.length === 1 ? failures.map(({ source, label, error }) => (
                    <p key={`${source}:${label}`}><SourceName source={source} /> · {label}：{error?.message ?? '搜索失败'}</p>
                  )) : <details>
                    <summary>{failures.length} 项搜索失败</summary>
                    <ul>{failures.map(({ source, label, error }) => (
                      <li key={`${source}:${label}`}><SourceName source={source} /> · {label}：{error?.message ?? '搜索失败'}</li>
                    ))}</ul>
                  </details>}
                  <button type="button" onClick={retryFailed}>重试失败项</button>
                </div>
              )}

              <div className={styles.overview} data-split={category === 'all' && showSection('songs') && showSection('artists')}>
                {showSection('songs') && <section className={styles.section} aria-label="歌曲搜索结果" aria-busy={songsLoading}>
                  <div className={styles.sectionHeading}>
                    <h2>歌曲{resultCount.songs > 0 && <span>{resultCount.songs}</span>}</h2>
                    <div className={styles.sectionActions}>
                      {category === 'songs' && songsLoading && visibleSongs.length > 0 && <span aria-hidden="true">搜索中…</span>}
                      {viewAllButton('songs', songPreview.hidden, visibleSongs.length)}
                      {visibleSongs.length > 0 && !selecting && <BatchTrackActions compact menuLabel="歌曲搜索结果更多操作" label="当前歌曲搜索结果" selectLabel="多选搜索结果"
                        tracks={visibleSongs} onSelect={enterSelection} />}
                    </div>
                  </div>
                  {visibleSongs.length > 0 ? songPreview.items.map((song, index) => (
                    <div className={styles.selectableRow} key={`${song.source}:${String(song.id)}`} data-selected={selected.has(trackKey(song))} data-selection-key={trackKey(song)} data-unavailable={isCatalogUnavailable(song)}>
                      {selecting && <SelectionCheck label={`选择歌曲：${song.name}`} checked={selected.has(trackKey(song))} />}
                      <TrackRow track={song} index={index} expandedCaption hideOfflineAction={selecting} hideLikeAction={selecting} onPlay={() => { if (!selecting) playSong(song) }} disabled={isCatalogUnavailable(song)} statusLabel={isCatalogUnavailable(song) ? '暂无版权' : undefined} statusColumn />
                    </div>
                  )) : <p className={styles.hint}>{songsLoading ? '正在搜索各平台的歌曲…' : failures.some((item) => item.label === '歌曲') ? '部分平台未能完成歌曲搜索，请重试。' : '没有找到相关歌曲，试试歌曲名或歌手名。'}</p>}
                </section>}

                {showSection('artists') && <section className={styles.section} aria-label="歌手搜索结果" aria-busy={artistsLoading}>
                  <div className={styles.sectionHeading}>
                    <h2>歌手{resultCount.artists > 0 && <span>{resultCount.artists}</span>}</h2>
                    <div className={styles.sectionActions}>
                      {category === 'artists' && artistsLoading && visibleArtists.length > 0 && <span aria-hidden="true">搜索中…</span>}
                      {viewAllButton('artists', artistPreview.hidden, visibleArtists.length)}
                    </div>
                  </div>
                  {visibleArtists.length > 0 ? (
                    <div className={`${styles.artistGrid}${artistPreview.items.length <= 10 ? ` ${styles.artistGridFit}` : ''}`} ref={artistScrollRef} onScroll={(event) => {
                      if (artistScrollRestored.current && useNavigationStore.getState().currentView === route.current) {
                        updatePageState(keyword, { artistScrollTop: event.currentTarget.scrollTop })
                      }
                    }}>
                      {artistPreview.items.map((artist) => (
                        <button key={`${artist.source}:${String(artist.id)}`} className={styles.artist} type="button" onClick={() => {
                          if (artist.source !== 'local' && artist.source !== 'bilibili') navigateTo({ type: 'artist', id: artist.id, source: artist.source })
                        }}>
                          {artist.avatar
                            ? <img src={sizedImage(artist.avatar, 160)} alt="" loading="lazy" />
                            : <span className={styles.avatarFallback} aria-hidden="true">{artist.name.slice(0, 1)}</span>}
                          <span className={styles.artistInfo}><strong title={artist.name}>{artist.name}</strong><span><SourceBadge source={artist.source} compact reveal /><SourceName source={artist.source} /></span></span>
                          <Chevron />
                        </button>
                      ))}
                    </div>
                  ) : <p className={styles.hint}>{artistsLoading ? '正在寻找相关歌手…' : failures.some((item) => item.label === '歌手') ? '部分平台未能完成歌手搜索，请重试。' : '没有找到相关歌手，试试其他关键词。'}</p>}
                </section>}

              </div>

              {(['albums', 'playlists'] as const).filter(showSection).map((kind) => {
                const items = kind === 'albums' ? visibleAlbums : visiblePlaylists
                const preview = kind === 'albums' ? albumPreview : playlistPreview
                const loading = kind === 'albums' ? albumsLoading : playlistsLoading
                const label = categories[kind]
                return <section className={styles.section} key={kind} aria-label={`${label}搜索结果`} aria-busy={loading}>
                  <div className={styles.sectionHeading}>
                    <h2>{label}{items.length > 0 && <span>{items.length}</span>}</h2>
                    <div className={styles.sectionActions}>
                      {category === kind && loading && items.length > 0 && <span aria-hidden="true">搜索中…</span>}
                      {viewAllButton(kind, preview.hidden, items.length)}
                      {items.length > 0 && !selecting && <BatchTrackActions compact menuLabel={`${label}搜索结果更多操作`} label={`当前${label}搜索结果`} selectLabel="多选搜索结果"
                        tracks={[]} collections={items} onSelect={enterSelection} />}
                    </div>
                  </div>
                  {items.length ? <div className={styles.collectionGrid} data-preview={category === 'all'}>
                    {preview.items.map((item) => <div key={collectionKey(item)} className={styles.selectableCard} data-selected={selected.has(collectionKey(item))} data-selection-key={collectionKey(item)}>
                      {selecting && <div className={styles.cardCheck}><SelectionCheck label={`选择${label}：${item.name}`} checked={selected.has(collectionKey(item))} /></div>}
                      {/* 隔离布局测量，筛选增删卡片时不触发其他封面的转场。 */}
                      <LayoutGroup inherit="id">
                        <PlaylistCard playlist={item} quiet selectionMode={selecting} meta={[item.creator, item.trackCountKnown === false ? '' : `${item.trackCount} 首`].filter(Boolean).join(' · ')} layoutId={`explore-cover-${String(item.id)}`} layoutDependency="search-results" onClick={() => { if (!selecting) navigateTo({ type: 'playlist', from: 'explore', playlist: item }) }} />
                      </LayoutGroup>
                    </div>)}
                  </div> : <p className={styles.hint}>{loading ? `正在寻找相关${label}…` : failures.some((item) => item.label === label) ? `部分平台未能完成${label}搜索，请重试。` : `没有找到相关${label}，试试其他关键词。`}</p>}
                </section>
              })}
            </>
          )}
        </div>
      </div>
      <SelectionMarquee rect={selection.marquee} />
    </ScrollArea>
  )
}
