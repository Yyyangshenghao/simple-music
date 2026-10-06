import { useEffect, useMemo, useState } from 'react'
import { providerFor } from '../providers/registry'
import { PROVIDER_IDS, type ProviderId } from '../providers/types'
import { runProviderTasks, type ProviderResult } from '../lib/content-hub'
import { sizedImage } from '../lib/image-size'
import { isCatalogUnavailable } from '../lib/track-availability'
import { useProviderStore } from '../stores/providers'
import { useNavigationStore } from '../stores/navigation'
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

type Category = 'all' | 'songs' | 'artists' | 'albums' | 'playlists'
const categories: Record<Category, string> = { all: '全部', songs: '歌曲', artists: '歌手', albums: '专辑', playlists: '歌单' }
const trackKey = (track: Track) => `track:${track.source}:${String(track.id)}`
const collectionKey = (item: Playlist) => `${item.type}:${item.source}:${String(item.id)}`

type Results<T> = Partial<Record<ProviderId, ProviderResult<T[]>>>

export function SearchPage({ keyword }: { keyword: string }) {
  const [songs, setSongs] = useState<Results<Track>>({})
  const [artists, setArtists] = useState<Results<ArtistInfo>>({})
  const [albums, setAlbums] = useState<Results<Playlist>>({})
  const [playlists, setPlaylists] = useState<Results<Playlist>>({})
  const [category, setCategory] = useState<Category>('all')
  const [selecting, setSelecting] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<ProviderId | null>(null)
  const [retry, setRetry] = useState(0)
  const navigateTo = useNavigationStore((state) => state.navigateTo)
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

  function playSong(track: Track) {
    if (isCatalogUnavailable(track)) return
    const queue = visibleSongs.filter((song) => !isCatalogUnavailable(song))
    const index = queue.findIndex((song) => song.source === track.source && String(song.id) === String(track.id))
    if (index >= 0) usePlaylistStore.getState().setQueue(queue, index)
  }

  return (
    <ScrollArea className={styles.page}>
      <div className={styles.content} ref={selection.rootRef} {...selection.surfaceProps}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>聚合搜索</p>
          <h1>“{keyword}”<span>的搜索结果</span></h1>
          <p className={styles.summary}>在 {sources.length} 个音乐平台中发现歌曲、歌手、专辑与歌单</p>
        </header>

        <div className={styles.filters} role="group" aria-label="筛选搜索来源">
          <button type="button" aria-pressed={!activeFilter} onClick={() => { setSourceFilter(null); selection.clear(); setSelecting(false) }}>全部平台</button>
          {sources.map((source) => (
            <button key={source} type="button" aria-pressed={activeFilter === source} onClick={() => { setSourceFilter(source); selection.clear(); setSelecting(false) }}>
              <SourceBadge source={source} compact reveal />
              <span><SourceName source={source} /></span>
            </button>
          ))}
        </div>

        {sources.length > 0 && <>
          <div className={styles.categories} role="group" aria-label="筛选搜索类型">
            {(Object.keys(categories) as Category[]).map((item) => <button type="button" key={item} aria-pressed={category === item} onClick={() => { setCategory(item); selection.clear(); setSelecting(false) }}>{categories[item]}</button>)}
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
              <div className={styles.sectionHeading}><h2>歌手 <span>{visibleArtists.length}</span></h2>{artistsLoading && <span role="status">搜索中…</span>}</div>
              {visibleArtists.length > 0 ? (
                <div className={styles.artistGrid}>
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
                <h2>歌曲 <span>{visibleSongs.length}</span></h2>
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
                  <h2>{label} <span>{items.length}</span></h2>
                  <div className={styles.sectionActions}>
                    {loading && <span role="status">搜索中…</span>}
                    {!selecting && <BatchTrackActions compact menuLabel={`${label}搜索结果更多操作`} label={`当前${label}搜索结果`} selectLabel="多选搜索结果"
                      tracks={[]} collections={items} onSelect={enterSelection} />}
                  </div>
                </div>
                {items.length ? <div className={styles.collectionGrid}>
                  {items.map((item) => <div key={collectionKey(item)} className={styles.selectableCard} data-selected={selected.has(collectionKey(item))} data-selection-key={collectionKey(item)}>
                    {selecting && <div className={styles.cardCheck}><SelectionCheck label={`选择${label}：${item.name}`} checked={selected.has(collectionKey(item))} /></div>}
                    <PlaylistCard playlist={item} selectionMode={selecting} meta={[item.creator, item.trackCountKnown === false ? '' : `${item.trackCount} 首`].filter(Boolean).join(' · ')} layoutId={`explore-cover-${String(item.id)}`} onClick={() => { if (!selecting) navigateTo({ type: 'playlist', from: 'explore', playlist: item }) }} />
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
