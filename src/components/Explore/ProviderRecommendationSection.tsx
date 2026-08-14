import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { providerErrorOf, type ProviderResult } from '../../lib/content-hub'
import { requestProviderData } from '../../lib/provider-request-cache'
import { createPool, needsRefill, redeal, refill, swipeTop, type StackPoolState } from '../../lib/stack-pool'
import { springGentle } from '../../lib/motion-presets'
import { providerFor } from '../../providers/registry'
import type {
  ProviderId,
  RecommendationPage,
  RecommendationSurface,
} from '../../providers/types'
import { useNavigationStore } from '../../stores/navigation'
import type { Playlist, Track } from '../../types/domain'
import { HeroCard } from './HeroCard'
import { Stack } from './Stack'
import { SourceBadge } from '../ui/SourceBadge'
import { RecentRail } from './RecentRail'
import { ToplistSection } from './ToplistSection'
import { ProviderPlaylistRail } from './ProviderPlaylistRail'
import styles from './ProviderRecommendationSection.module.css'

type SurfaceResult = ProviderResult<RecommendationPage> & { surface: RecommendationSurface }

const EMPTY_POOL: StackPoolState<Playlist> = { hand: [], reserve: [], discarded: [] }

function isEmptyPage(page: RecommendationPage): boolean {
  if (page.content.type === 'tracks') return page.content.tracks.length === 0
  if (page.content.type === 'playlists') return page.content.playlists.length === 0
  return page.content.radar === null
}

function playlistFromTracks(surface: RecommendationSurface, tracks: Track[]): Playlist {
  return {
    provider: surface.source,
    source: surface.source,
    type: 'playlist',
    id: surface.id,
    name: surface.title,
    cover: tracks[0]?.cover ?? '',
    trackCount: tracks.length,
    playCount: 0,
    creator: '',
  }
}

interface ProviderRecommendationSectionProps {
  source: ProviderId
  onPreview(playlist: Playlist): void
}

export function ProviderRecommendationSection({ source, onPreview }: ProviderRecommendationSectionProps) {
  const provider = providerFor(source)
  const surfaces = provider.recommendations?.listSurfaces() ?? []
  const [results, setResults] = useState<Record<string, SurfaceResult>>({})
  const [pool, setPool] = useState<StackPoolState<Playlist>>(EMPTY_POOL)
  const [dealId, setDealId] = useState(0)
  const sessionRef = useRef(0)
  const nextCursorRef = useRef<string | undefined>()
  const refilling = useRef(false)

  const commit = useCallback((surface: RecommendationSurface, result: ProviderResult<RecommendationPage>) => {
    setResults((current) => ({ ...current, [surface.id]: { ...result, surface } }))
  }, [])

  const loadSurface = useCallback(async (surface: RecommendationSurface, session: number, force = false) => {
    commit(surface, { source, status: 'loading', data: null })
    try {
      const page = await requestProviderData(
        source,
        `recommendation:${surface.id}:root`,
        () => provider.recommendations!.load(surface.id),
        { force }
      )
      if (sessionRef.current !== session) return
      commit(surface, {
        source,
        status: isEmptyPage(page) ? 'empty' : 'ready',
        data: page,
      })
      if (surface.kind === 'playlist-feed' && page.content.type === 'playlists') {
        setPool(createPool(page.content.playlists))
        nextCursorRef.current = page.nextCursor
      }
    } catch (error) {
      if (sessionRef.current !== session) return
      commit(surface, {
        source,
        status: 'error',
        data: null,
        error: providerErrorOf(source, error),
      })
    }
  }, [commit, provider, source])

  useEffect(() => {
    const session = ++sessionRef.current
    setResults({})
    setPool(EMPTY_POOL)
    nextCursorRef.current = undefined
    void Promise.all(surfaces.map((surface) => loadSurface(surface, session)))
    return () => { sessionRef.current++ }
    // provider 和 surfaces 由静态注册表提供，source 变化时才需重建会话。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  const feedSurface = surfaces.find((surface) => surface.kind === 'playlist-feed')

  useEffect(() => {
    if (!feedSurface || !nextCursorRef.current || pool.hand.length === 0 || !needsRefill(pool) || refilling.current) return
    refilling.current = true
    const session = sessionRef.current
    const cursor = nextCursorRef.current
    requestProviderData(
      source,
      `recommendation:${feedSurface.id}:${cursor}`,
      () => provider.recommendations!.load(feedSurface.id, cursor)
    )
      .then((page) => {
        if (sessionRef.current !== session || page.content.type !== 'playlists') return
        const playlists = page.content.playlists
        nextCursorRef.current = page.nextCursor
        setPool((current) => refill(current, playlists, (playlist) => `${playlist.source}:${String(playlist.id)}`))
      })
      .catch(() => {})
      .finally(() => { refilling.current = false })
  }, [feedSurface, pool, provider])

  function openSurface(result: SurfaceResult): void {
    const page = result.data
    if (!page) return
    if (page.content.type === 'tracks') {
      const playlist = playlistFromTracks(result.surface, page.content.tracks)
      useNavigationStore.getState().navigateTo({
        type: 'playlist',
        from: 'explore',
        playlist,
        tracks: page.content.tracks,
      })
    } else if (page.content.type === 'radar' && page.content.radar) {
      useNavigationStore.getState().navigateTo({
        type: 'playlist',
        from: 'explore',
        playlist: page.content.radar.playlist,
        tracks: page.content.radar.tracks,
      })
    }
  }

  const heroResults = surfaces
    .filter((surface) => surface.kind !== 'playlist-feed')
    .map((surface) => results[surface.id])
    .filter((result): result is SurfaceResult => !!result)
  const readyHeroes = heroResults.filter((result) => result.status === 'ready' && result.data)
  const errors = Object.values(results).filter((result) => result.status === 'error')
  const loading = Object.keys(results).length < surfaces.length
    || Object.values(results).some((result) => result.status === 'loading')
  const top = pool.hand.at(-1) ?? null

  return (
    <motion.section
      className={styles.section}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springGentle}
      aria-label={`${provider.descriptor.label}推荐`}
    >
      <header className={styles.header}>
        <div>
          <SourceBadge source={source} reveal />
          <h2 className={styles.title}>{provider.descriptor.label}，为你而来</h2>
        </div>
        <div className={styles.status}>
          <span>{loading ? '正在连接平台…' : errors.length > 0 ? `${errors.length} 个栏目暂不可用` : '已更新'}</span>
          {errors.length > 0 && (
            <button
              className="no-drag"
              onClick={() => {
                const session = sessionRef.current
                void Promise.all(errors.map((result) => loadSurface(result.surface, session, true)))
              }}
            >
              重试
            </button>
          )}
        </div>
      </header>

      <div className={styles.content}>
        {readyHeroes.length > 0 && (
          <div className={styles.heroCards}>
            {readyHeroes.map((result) => {
              const content = result.data!.content
              const cover = content.type === 'tracks'
                ? content.tracks[0]?.cover
                : content.type === 'radar'
                  ? content.radar?.playlist.cover
                  : undefined
              const count = content.type === 'tracks'
                ? content.tracks.length
                : content.type === 'radar'
                  ? content.radar?.tracks.length ?? 0
                  : 0
              const layoutEntityId = content.type === 'radar' && content.radar
                ? content.radar.playlist.id
                : result.surface.id
              return (
                <HeroCard
                  key={result.surface.id}
                  title={result.surface.title}
                  subtitle={`${count} 首 · ${result.surface.subtitle ?? '平台原生推荐'}`}
                  source={source}
                  cover={cover}
                  badge={result.surface.kind === 'daily-tracks' ? <span>{new Date().getDate()}</span> : undefined}
                  layoutId={`explore-cover-${String(layoutEntityId)}`}
                  onClick={() => openSurface(result)}
                />
              )
            })}
          </div>
        )}

        {pool.hand.length > 0 && (
          <div className={styles.stage}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={dealId}
                initial={{ x: 70, opacity: 0, rotate: 4 }}
                animate={{ x: 0, opacity: 1, rotate: 0 }}
                exit={{ x: -90, opacity: 0, rotate: -6 }}
                transition={springGentle}
              >
                <Stack cards={pool.hand} onSwipe={() => setPool((current) => swipeTop(current))} onCardClick={onPreview} />
              </motion.div>
            </AnimatePresence>
            {top && (
              <div className={styles.topInfo}>
                <p className={styles.eyebrow}>发现歌单</p>
                <p className={styles.topName}>{top.name}</p>
                {top.description && <p className={styles.topDesc}>{top.description}</p>}
                <p className={styles.hint}>拖拽换一张 · 点击查看</p>
                <button
                  className={`${styles.redealButton} no-drag`}
                  onClick={() => {
                    setDealId((current) => current + 1)
                    setPool((current) => redeal(current))
                  }}
                >
                  ↻ 换一叠
                </button>
              </div>
            )}
          </div>
        )}

        {!loading && readyHeroes.length === 0 && pool.hand.length === 0 && (
          <div className={styles.empty}>
            <p>{errors[0]?.error?.message ?? '这个平台暂时没有推荐内容'}</p>
            {errors.length > 0 && (
              <button
                className={`${styles.retryButton} no-drag`}
                onClick={() => {
                  const session = ++sessionRef.current
                  void Promise.all(surfaces.map((surface) => loadSurface(surface, session, true)))
                }}
              >
                重试平台栏目
              </button>
            )}
          </div>
        )}
      </div>
      {provider.library?.getUserPlaylists && <ProviderPlaylistRail source={source} onOpen={onPreview} />}
      {provider.history?.getRecentPlaylists && <RecentRail source={source} embedded onOpen={onPreview} />}
      {provider.toplists && <ToplistSection source={source} embedded onOpen={onPreview} />}
    </motion.section>
  )
}
