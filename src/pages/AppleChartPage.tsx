import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BROWSE_CACHE_MAX_AGE_MS, requestProviderData } from '../lib/provider-request-cache'
import { appendUniqueAppleCharts, type AppleChartKind } from '../lib/apple-music-service'
import { providerAccountSession } from '../lib/provider-account-session'
import { appleMusicService } from '../providers/apple-music-provider'
import { useNavigationStore } from '../stores/navigation'
import { useProviderStore } from '../stores/providers'
import { usePlaylistStore } from '../stores/playlist'
import type { Playlist, Track } from '../types/domain'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { PlaylistPreviewModal } from '../components/Explore/PlaylistPreviewModal'
import { TrackRow } from '../components/Explore/TrackRow'
import { SourceBadge } from '../components/ui/SourceBadge'
import { GradientText } from '../components/ui/GradientText'
import { ScrollArea } from '../components/ui/ScrollArea'
import { ActionButton } from '../components/ui/ActionButton'
import { BackButton } from '../components/ui/BackButton'
import layout from './ToplistPage.module.css'
import styles from './AppleChartPage.module.css'

interface ChartPage {
  collections: Playlist[]
  tracks: Track[]
  nextCursor?: string
  cursors: string[]
}

export function mergeAppleChartPage(current: ChartPage, incoming: Omit<ChartPage, 'cursors'>, cursor: string): ChartPage {
  const cursors = [...current.cursors, cursor]
  const knownTracks = new Set(current.tracks.map(track => String(track.id)))
  const addedTracks = incoming.tracks.filter(track => {
    const id = String(track.id)
    if (knownTracks.has(id)) return false
    knownTracks.add(id)
    return true
  })
  const collections = appendUniqueAppleCharts(current.collections, incoming.collections)
  const hasNewItems = addedTracks.length > 0 || collections.length > current.collections.length
  return {
    tracks: [...current.tracks, ...addedTracks], collections,
    nextCursor: hasNewItems && incoming.nextCursor && !cursors.includes(incoming.nextCursor) ? incoming.nextCursor : undefined,
    cursors,
  }
}

interface ChartSnapshot {
  session: string
  time: number
  initialKind: AppleChartKind
  kind: AppleChartKind
  pages: Partial<Record<AppleChartKind, ChartPage>>
  scroll: Partial<Record<AppleChartKind, number>>
  storefront: Playlist[] | null
}

// 只保留最近一次榜单访问的三个分类，换号或启停平台后失效。
let snapshot: ChartSnapshot | undefined
const labels: Record<AppleChartKind, string> = { playlists: '热门歌单', songs: '热门歌曲', albums: '热门专辑' }
const kinds: AppleChartKind[] = ['songs', 'albums', 'playlists']

async function loadChartPage(kind: AppleChartKind, cursor?: string): Promise<Omit<ChartPage, 'cursors'>> {
  if (kind === 'songs') {
    const page = await appleMusicService.getChartSongsPage(cursor)
    return { tracks: page.tracks, collections: [], nextCursor: page.nextCursor }
  }
  if (kind === 'albums') {
    const page = await appleMusicService.getChartAlbumsPage(cursor)
    return { tracks: [], collections: page.albums, nextCursor: page.nextCursor }
  }
  const page = await appleMusicService.getChartPlaylistsPage(cursor)
  return { tracks: [], collections: page.playlists, nextCursor: page.nextCursor }
}

export function AppleChartPage({ initialKind = 'playlists' }: { initialKind?: AppleChartKind } = {}) {
  const session = useProviderStore(state => {
    const apple = state.byId.apple
    return `${providerAccountSession('apple')}:${apple.enabled}:${apple.auth}:${apple.playbackAvailable}`
  })
  const available = useProviderStore(state => state.byId.apple.enabled && state.byId.apple.auth === 'authenticated')
  return <AppleCharts key={`${session}:${initialKind}`} session={session} available={available} initialKind={initialKind} />
}

function AppleCharts({ session, available, initialKind }: { session: string; available: boolean; initialKind: AppleChartKind }) {
  const goBack = useNavigationStore(state => state.goBack)
  const active = useNavigationStore(state => typeof state.currentView === 'object' && state.currentView.type === 'toplist' && state.currentView.source === 'apple')
  const saved = snapshot?.session === session && snapshot.initialKind === initialKind && snapshot.time > Date.now() - BROWSE_CACHE_MAX_AGE_MS ? snapshot : undefined
  const [kind, setKind] = useState<AppleChartKind>(saved?.kind ?? initialKind)
  const [pages, setPages] = useState<Partial<Record<AppleChartKind, ChartPage>>>(saved?.pages ?? {})
  const [storefront, setStorefront] = useState<Playlist[] | null>(saved?.storefront ?? null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [storefrontFailed, setStorefrontFailed] = useState(false)
  const [storefrontRevision, setStorefrontRevision] = useState(0)
  const [preview, setPreview] = useState<Playlist | null>(null)
  const request = useRef(0)
  const busy = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scroll = useRef<Partial<Record<AppleChartKind, number>>>({ ...saved?.scroll })
  const latest = useRef({ kind, pages, storefront })
  latest.current = { kind, pages, storefront }
  const page = pages[kind]

  useEffect(() => () => {
    snapshot = { session, initialKind, time: Date.now(), ...latest.current, scroll: scroll.current }
  }, [session, initialKind])

  useEffect(() => {
    if (!active) setPreview(null)
  }, [active])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const remember = () => { scroll.current[kind] = node.scrollTop }
    node.addEventListener('scroll', remember, { passive: true })
    return () => node.removeEventListener('scroll', remember)
  }, [kind])

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scroll.current[kind] ?? 0
  }, [kind])

  useEffect(() => {
    const generation = ++request.current
    const cancel = () => { if (request.current === generation) request.current++ }
    busy.current = false
    setLoading(false)
    setFailed(false)
    if (!available || (pages[kind] && revision === 0)) return cancel
    busy.current = true
    setLoading(true)
    void requestProviderData('apple', `charts:${kind}:first`, () => loadChartPage(kind), { force: revision > 0, maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
      .then(result => {
        if (request.current !== generation) return
        setPages(current => ({ ...current, [kind]: {
          ...result,
          tracks: [...new Map(result.tracks.map(track => [String(track.id), track])).values()],
          collections: appendUniqueAppleCharts([], result.collections),
          cursors: [],
        } }))
      })
      .catch(() => { if (request.current === generation) setFailed(true) })
      .finally(() => {
        if (request.current === generation) { busy.current = false; setLoading(false) }
      })
    return cancel
    // 分类切换复用已加载页，重试只刷新当前分类。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, revision, available])

  useEffect(() => {
    let cancelled = false
    if (!available || kind !== 'playlists' || (storefront !== null && storefrontRevision === 0)) return
    setStorefrontFailed(false)
    void requestProviderData('apple', 'charts:storefront', () => appleMusicService.getStorefrontChartPlaylists(), { force: storefrontRevision > 0, maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
      .then(items => { if (!cancelled) setStorefront(appendUniqueAppleCharts([], items)) })
      .catch(() => { if (!cancelled) setStorefrontFailed(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, available, storefrontRevision])

  async function loadMore() {
    if (!page?.nextCursor || busy.current || !available) return
    const cursor = page.nextCursor
    const generation = request.current
    busy.current = true
    setLoading(true)
    setFailed(false)
    try {
      const next = await requestProviderData('apple', `charts:${kind}:${cursor}`, () => loadChartPage(kind, cursor), { maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
      if (generation !== request.current) return
      setPages(current => ({ ...current, [kind]: mergeAppleChartPage(page, next, cursor) }))
    } catch {
      if (generation === request.current) setFailed(true)
    } finally {
      if (generation === request.current) { busy.current = false; setLoading(false) }
    }
  }

  const count = (page?.tracks.length ?? 0) + (page?.collections.length ?? 0)
  return <ScrollArea className={layout.page} scrollRef={scrollRef} pauseCardEffects>
    <BackButton className={layout.back} onClick={() => goBack()} ariaLabel="返回探索页" />
    <h1 className={layout.heading}><GradientText>Apple Music 榜单</GradientText><SourceBadge source="apple" reveal /></h1>
    <div className={layout.group}>
      <div className={styles.categories} role="group" aria-label="榜单类型">
        {kinds.map(value => <button key={value} type="button" aria-pressed={kind === value} onClick={() => {
          if (kind === value) return
          if (scrollRef.current) scroll.current[kind] = scrollRef.current.scrollTop
          setKind(value)
          setRevision(0)
        }}>{labels[value]}</button>)}
      </div>
    </div>
    {!available ? <p className={`${layout.group} ${styles.status}`}>连接并启用 Apple Music 后浏览榜单</p> : <>
      <section className={`${layout.group} ${styles.group}`} aria-label={labels[kind]}>
        <div className={styles.groupHeading}>
          <h2>{labels[kind]}</h2>
          {kind === 'songs' && !!page?.tracks.length
            ? <ActionButton label="播放全部" icon="play" compact onClick={() => usePlaylistStore.getState().setQueue(page.tracks, 0)} />
            : count > 0 && <span>已浏览 {count} 张</span>}
        </div>
        {page?.tracks.map((track, index) => <TrackRow key={String(track.id)} track={track} index={index} hideSource hideOfflineAction hideLikeAction
          onPlay={() => usePlaylistStore.getState().setQueue(page.tracks, index)} />)}
        {!!page?.collections.length && <div className={styles.grid}>
          {page.collections.map(collection => <div className={styles.card} key={String(collection.id)}>
            <PlaylistCard playlist={collection} meta={kind === 'albums' ? collection.creator : ''} onClick={() => setPreview(collection)} />
          </div>)}
        </div>}
        {(loading || (!page && !failed)) && <p className={styles.status}>正在读取{labels[kind]}…</p>}
        {failed && !page && <p className={styles.status}>{labels[kind]}暂时无法加载 <button type="button" onClick={() => setRevision(value => value + 1)}>重试</button></p>}
        {!loading && !failed && page && count === 0 && !page.nextCursor && <p className={styles.status}>暂无{labels[kind]}</p>}
        {page?.nextCursor && <div className={styles.moreWrap}>
          <button type="button" className={`${styles.more} no-drag`} disabled={loading} onClick={() => void loadMore()}>
            {loading ? '正在加载…' : failed ? '重试加载下一页' : '加载下一页'}
          </button>
        </div>}
      </section>
      {kind === 'playlists' && (!!storefront?.length || storefrontFailed) && <section className={`${layout.group} ${styles.group}`} aria-label="地区榜单">
        <div className={styles.groupHeading}><h2>地区榜单</h2></div>
        {!!storefront?.length && <div className={styles.grid}>
          {storefront.map(playlist => <div className={styles.card} key={String(playlist.id)}>
            <PlaylistCard playlist={playlist} meta="" onClick={() => setPreview(playlist)} />
          </div>)}
        </div>}
        {storefrontFailed && <p className={styles.status}>地区榜单暂时无法加载 <button type="button" onClick={() => setStorefrontRevision(value => value + 1)}>重试</button></p>}
      </section>}
    </>}
    <PlaylistPreviewModal playlist={active ? preview : null} onClose={() => setPreview(null)} />
  </ScrollArea>
}
