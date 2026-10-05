import { useCallback, useEffect, useRef, useState } from 'react'
import { BROWSE_CACHE_MAX_AGE_MS, getCachedProviderData, requestProviderData } from '../../lib/provider-request-cache'
import { appendUniqueAppleCharts, pickAppleRecommendationFeatures, type AppleChartPlaylistsPage, type AppleRecommendationGroup } from '../../lib/apple-music-service'
import { appleMusicService } from '../../providers/apple-music-provider'
import { useNavigationStore } from '../../stores/navigation'
import type { Playlist } from '../../types/domain'
import { sizedImage } from '../../lib/image-size'
import { SourceName } from '../ui/SourceName'
import { PlaylistCoverFallback } from '../ui/PlaylistCoverFallback'
import { PlaylistCard } from './PlaylistCard'
import styles from './ApplePlaylistRecommendations.module.css'

interface ApplePlaylistRecommendationsProps {
  charts: Playlist[]
  onOpen(playlist: Playlist): void
}

const CHART_PREVIEW = 12
const STOREFRONT_PREVIEW = 8
// 只保留最近一组推荐的抽样种子，返回时精选卡片不重新洗牌。
let savedFeatureSeed: { groups: AppleRecommendationGroup[]; seed: number } | undefined
export function ApplePlaylistRecommendations({ charts, onOpen }: ApplePlaylistRecommendationsProps) {
  const [loadedCharts, setLoadedCharts] = useState<Playlist[]>(() => getCachedProviderData<AppleChartPlaylistsPage>('apple', 'charts:most-played:first')?.playlists ?? [])
  const [chartHasNext, setChartHasNext] = useState(() => !!getCachedProviderData<AppleChartPlaylistsPage>('apple', 'charts:most-played:first')?.nextCursor)
  const [chartLoading, setChartLoading] = useState(() => getCachedProviderData('apple', 'charts:most-played:first') === undefined)
  const [chartFailed, setChartFailed] = useState(false)
  const [chartRevision, setChartRevision] = useState(0)
  const [storefrontCharts, setStorefrontCharts] = useState<Playlist[]>(() => getCachedProviderData<Playlist[]>('apple', 'charts:storefront') ?? [])
  const [storefrontLoading, setStorefrontLoading] = useState(() => getCachedProviderData('apple', 'charts:storefront') === undefined)
  const [storefrontFailed, setStorefrontFailed] = useState(false)
  const [storefrontRevision, setStorefrontRevision] = useState(0)
  const cachedGroups = getCachedProviderData<AppleRecommendationGroup[]>('apple', 'recommendation:personal-groups')
  const [groups, setGroups] = useState<AppleRecommendationGroup[]>(cachedGroups ?? [])
  const [featureSeed] = useState(() => cachedGroups && savedFeatureSeed?.groups === cachedGroups
    ? savedFeatureSeed.seed : Math.floor(Math.random() * 0x7fffffff))
  useEffect(() => {
    if (groups === getCachedProviderData('apple', 'recommendation:personal-groups')) savedFeatureSeed = { groups, seed: featureSeed }
  }, [groups, featureSeed])
  const [loading, setLoading] = useState(() => getCachedProviderData('apple', 'recommendation:personal-groups') === undefined)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const carouselRef = useRef<HTMLDivElement>(null)
  const [carouselScrollable, setCarouselScrollable] = useState(false)
  const [carouselHovered, setCarouselHovered] = useState(false)
  const [carouselFocused, setCarouselFocused] = useState(false)
  const [carouselTouched, setCarouselTouched] = useState(false)
  useEffect(() => {
    let cancelled = false
    setStorefrontLoading(getCachedProviderData('apple', 'charts:storefront') === undefined)
    setStorefrontFailed(false)
    void requestProviderData('apple', 'charts:storefront', () => appleMusicService.getStorefrontChartPlaylists(), { force: storefrontRevision > 0, maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
      .then(items => { if (!cancelled) setStorefrontCharts(appendUniqueAppleCharts([], items)) })
      .catch(() => { if (!cancelled) setStorefrontFailed(true) })
      .finally(() => { if (!cancelled) setStorefrontLoading(false) })
    return () => { cancelled = true }
  }, [storefrontRevision])

  useEffect(() => {
    let cancelled = false
    setChartLoading(getCachedProviderData('apple', 'charts:most-played:first') === undefined)
    setChartFailed(false)
    void requestProviderData('apple', 'charts:most-played:first', () => appleMusicService.getChartPlaylistsPage(), { force: chartRevision > 0, maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
      .then(page => {
        if (cancelled) return
        setLoadedCharts(appendUniqueAppleCharts([], page.playlists))
        setChartHasNext(!!page.nextCursor)
      })
      .catch(() => { if (!cancelled) setChartFailed(true) })
      .finally(() => { if (!cancelled) setChartLoading(false) })
    return () => { cancelled = true }
  }, [chartRevision])

  useEffect(() => {
    let cancelled = false
    setLoading(getCachedProviderData('apple', 'recommendation:personal-groups') === undefined)
    setFailed(false)
    void requestProviderData('apple', 'recommendation:personal-groups', () => appleMusicService.getRecommendationGroups(), { force: revision > 0, maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
      .then(items => { if (!cancelled) setGroups(items) })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [revision])

  const chartItems = loadedCharts.length ? loadedCharts : charts
  const featureModules: AppleRecommendationGroup[] = [
    ...groups.map(group => ({ ...group, id: `personal:${group.id}` })),
    ...(chartItems.length > 0 ? [{ id: 'chart:most-played', title: '热门榜单', items: chartItems }] : []),
    ...(storefrontCharts.length > 0 ? [{ id: 'chart:storefront', title: '地区榜单', items: storefrontCharts }] : []),
  ]
  const features = pickAppleRecommendationFeatures(featureModules, featureSeed)
  const featuredKeys = new Set(features.map(({ item }) => `${item.type}:${String(item.id)}`))
  const remaining = (items: Playlist[]) => {
    const seen = new Set(featuredKeys)
    return items.filter(item => {
      const key = `${item.type}:${String(item.id)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  const visibleCharts = remaining(chartItems).slice(0, CHART_PREVIEW)
  const visibleStorefrontCharts = remaining(storefrontCharts).slice(0, STOREFRONT_PREVIEW)
  const openAllCharts = () => useNavigationStore.getState().navigateTo({ type: 'toplist', source: 'apple' })

  const scrollCarousel = useCallback((direction: -1 | 1) => {
    const viewport = carouselRef.current
    const card = viewport?.firstElementChild
    if (!viewport || !(card instanceof HTMLElement)) return
    const gap = Number.parseFloat(getComputedStyle(viewport).columnGap) || 0
    const step = card.getBoundingClientRect().width + gap
    const end = viewport.scrollWidth - viewport.clientWidth
    if (end <= 1) return
    const left = direction === 1
      ? viewport.scrollLeft >= end - 1 ? 0 : Math.min(viewport.scrollLeft + step, end)
      : viewport.scrollLeft <= 1 ? end : Math.max(viewport.scrollLeft - step, 0)
    viewport.scrollTo({ left, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [])

  useEffect(() => {
    const viewport = carouselRef.current
    if (!viewport) { setCarouselScrollable(false); return }
    const measure = () => setCarouselScrollable(viewport.scrollWidth > viewport.clientWidth + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    measure()
    return () => observer.disconnect()
  }, [features.length])

  useEffect(() => {
    if (!carouselScrollable || carouselHovered || carouselFocused || carouselTouched || features.length < 2) return
    const timer = window.setInterval(() => {
      if (!document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) scrollCarousel(1)
    }, 7000)
    return () => window.clearInterval(timer)
  }, [carouselFocused, carouselHovered, carouselScrollable, carouselTouched, features.length, scrollCarousel])

  return (
    <div className={styles.sections} aria-label="Apple Music 内容发现">
      {features.length > 0 && (
        <section
          className={styles.personalized}
          aria-label="为你精选"
          onMouseEnter={() => setCarouselHovered(true)}
          onMouseLeave={() => setCarouselHovered(false)}
          onFocusCapture={() => setCarouselFocused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setCarouselFocused(false)
          }}
          onTouchStart={() => setCarouselTouched(true)}
          onTouchEnd={() => setCarouselTouched(false)}
          onTouchCancel={() => setCarouselTouched(false)}
        >
          <div className={styles.heading}>
            <div>
              <p className={styles.eyebrow}><SourceName source="apple" /> FOR YOU</p>
              <h3>为你精选</h3>
            </div>
            {carouselScrollable && (
              <div className={styles.carouselControls}>
                <button type="button" className="no-drag" onClick={() => scrollCarousel(-1)} aria-label="上一张精选内容">‹</button>
                <button type="button" className="no-drag" onClick={() => scrollCarousel(1)} aria-label="下一张精选内容">›</button>
              </div>
            )}
          </div>
          <div
            ref={carouselRef}
            className={styles.carousel}
            tabIndex={0}
            aria-label="为你精选，可横向滚动"
          >
            {features.map(({ item, groupTitle, moduleId }) => (
              <button
                type="button"
                className={`${styles.recommendationCard} no-drag`}
                key={moduleId}
                onClick={() => onOpen(item)}
                aria-label={`打开${item.type === 'album' ? '专辑' : '歌单'}：${item.name}`}
              >
                <span className={styles.recommendationArtwork}>
                  {item.cover
                    ? <img className={styles.recommendationImage} src={sizedImage(item.cover, 600)} alt="" loading="lazy" />
                    : <PlaylistCoverFallback name={item.name} source="apple" />}
                </span>
                <span className={styles.recommendationShade} aria-hidden="true" />
                <span className={styles.recommendationBrand}><SourceName source="apple" /></span>
                <span className={styles.recommendationCopy}>
                  <span className={styles.recommendationLabel}>{groupTitle}</span>
                  <strong>{item.name}</strong>
                  <span className={styles.recommendationCreator}>{item.creator}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {loading && <p className={styles.status}>正在读取为你推荐的内容…</p>}
      {failed && (
        <p className={styles.status}>
          个性化推荐暂时无法加载
          <button className="no-drag" onClick={() => setRevision(value => value + 1)}>重试</button>
        </p>
      )}
      {groups.map(group => {
        const items = remaining(group.items)
        if (!items.length) return null
        return (
          <section className={styles.section} aria-label={group.title} key={group.id}>
            <div className={styles.heading}><h3>{group.title}</h3></div>
            <div className={styles.row}>
              {items.map(item => (
                <div className={styles.card} key={`${item.type}:${String(item.id)}`}>
                  <PlaylistCard playlist={item} meta="" onClick={() => onOpen(item)} />
                </div>
              ))}
            </div>
          </section>
        )
      })}
      {(chartItems.length > 0 || chartHasNext) && (
        <section className={styles.section} aria-label="热门榜单">
          <div className={styles.heading}>
            <div>
              <p className={styles.eyebrow}><SourceName source="apple" /> CHARTS</p>
              <h3>热门榜单</h3>
            </div>
          </div>
          {visibleCharts.length > 0 && (
            <div className={styles.chartGrid}>
              {visibleCharts.map(playlist => (
                <div className={styles.chartCard} key={String(playlist.id)}>
                  <PlaylistCard playlist={playlist} meta="" onClick={() => onOpen(playlist)} />
                </div>
              ))}
            </div>
          )}
          <div className={styles.chartMoreWrap}>
            <button type="button" className={`${styles.chartMore} no-drag`} onClick={openAllCharts}>浏览热门与地区榜单</button>
          </div>
        </section>
      )}
      {chartLoading && <p className={styles.status}>正在读取热门榜单…</p>}
      {chartFailed && (
        <p className={styles.status}>
          热门榜单暂时无法加载
          <button className="no-drag" onClick={() => setChartRevision(value => value + 1)}>重试</button>
        </p>
      )}
      {visibleStorefrontCharts.length > 0 && (
        <section className={styles.section} aria-label="地区榜单">
          <div className={styles.heading}>
            <h3>地区榜单</h3>
          </div>
          <div className={styles.storefrontGrid}>
            {visibleStorefrontCharts.map(playlist => (
              <div className={styles.chartCard} key={String(playlist.id)}>
                <PlaylistCard playlist={playlist} meta="" onClick={() => onOpen(playlist)} />
              </div>
            ))}
          </div>
        </section>
      )}
      {storefrontFailed && (
        <p className={styles.status}>
          地区榜单暂时无法加载
          <button className="no-drag" onClick={() => setStorefrontRevision(value => value + 1)}>重试</button>
        </p>
      )}
      {!chartLoading && !storefrontLoading && !loading && !chartFailed && !storefrontFailed && !failed && chartItems.length === 0 && storefrontCharts.length === 0 && groups.length === 0 && (
        <p className={styles.status}>暂无可展示的推荐内容</p>
      )}
    </div>
  )
}
