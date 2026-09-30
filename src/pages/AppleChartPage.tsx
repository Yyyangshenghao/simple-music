import { useEffect, useRef, useState } from 'react'
import { requestProviderData } from '../lib/provider-request-cache'
import { appendUniqueAppleCharts, type AppleChartPlaylistsPage } from '../lib/apple-music-service'
import { appleMusicService } from '../providers/apple-music-provider'
import { useNavigationStore } from '../stores/navigation'
import type { Playlist } from '../types/domain'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { PlaylistPreviewModal } from '../components/Explore/PlaylistPreviewModal'
import { SourceBadge } from '../components/ui/SourceBadge'
import { GradientText } from '../components/ui/GradientText'
import { ScrollArea } from '../components/ui/ScrollArea'
import layout from './ToplistPage.module.css'
import styles from './AppleChartPage.module.css'

export function AppleChartPage() {
  const goBack = useNavigationStore(state => state.goBack)
  const [charts, setCharts] = useState<Playlist[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  const chartSession = useRef(0)
  const [storefrontCharts, setStorefrontCharts] = useState<Playlist[]>([])
  const [storefrontFailed, setStorefrontFailed] = useState(false)
  const [storefrontRevision, setStorefrontRevision] = useState(0)
  const [preview, setPreview] = useState<Playlist | null>(null)

  useEffect(() => {
    let cancelled = false
    const session = ++chartSession.current
    setLoading(true)
    setFailed(false)
    setMoreFailed(false)
    setLoadingMore(false)
    void requestProviderData<AppleChartPlaylistsPage>('apple', 'charts:most-played:first', () => appleMusicService.getChartPlaylistsPage(), { force: revision > 0 })
      .then(page => {
        if (cancelled) return
        setCharts(appendUniqueAppleCharts([], page.playlists))
        setNextCursor(page.nextCursor)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; if (chartSession.current === session) chartSession.current++ }
  }, [revision])

  useEffect(() => {
    let cancelled = false
    setStorefrontFailed(false)
    void requestProviderData('apple', 'charts:storefront', () => appleMusicService.getStorefrontChartPlaylists(), { force: storefrontRevision > 0 })
      .then(items => { if (!cancelled) setStorefrontCharts(appendUniqueAppleCharts([], items)) })
      .catch(() => { if (!cancelled) setStorefrontFailed(true) })
    return () => { cancelled = true }
  }, [storefrontRevision])

  async function loadMore() {
    if (!nextCursor || loading || loadingMore) return
    const cursor = nextCursor
    const session = chartSession.current
    setLoadingMore(true)
    setMoreFailed(false)
    try {
      const page = await requestProviderData('apple', `charts:most-played:${cursor}`, () => appleMusicService.getChartPlaylistsPage(cursor))
      if (session !== chartSession.current) return
      setCharts(items => appendUniqueAppleCharts(items, page.playlists))
      setNextCursor(page.nextCursor === cursor ? undefined : page.nextCursor)
    } catch {
      if (session === chartSession.current) setMoreFailed(true)
    } finally {
      if (session === chartSession.current) setLoadingMore(false)
    }
  }

  return (
    <ScrollArea className={layout.page}>
      <button type="button" className={`${layout.back} no-drag`} onClick={goBack} aria-label="返回探索页">← 返回</button>
      <h1 className={layout.heading}>
        <GradientText>Apple Music 榜单</GradientText>
        <SourceBadge source="apple" reveal />
      </h1>

      <section className={`${layout.group} ${styles.group}`} aria-label="热门榜单">
        <div className={styles.groupHeading}>
          <h2>热门榜单</h2>
          {charts.length > 0 && <span>已浏览 {charts.length} 张</span>}
        </div>
        {charts.length > 0 && (
          <div className={styles.grid}>
            {charts.map(playlist => (
              <div className={styles.card} key={String(playlist.id)}>
                <PlaylistCard playlist={playlist} meta="" onClick={() => setPreview(playlist)} />
              </div>
            ))}
          </div>
        )}
        {loading && <p className={styles.status}>正在读取热门榜单…</p>}
        {failed && <p className={styles.status}>热门榜单暂时无法加载 <button onClick={() => setRevision(value => value + 1)}>重试</button></p>}
        {!loading && !failed && charts.length === 0 && !nextCursor && <p className={styles.status}>暂无热门榜单</p>}
        {nextCursor && (
          <div className={styles.moreWrap}>
            <button type="button" className={`${styles.more} no-drag`} disabled={loading || loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? '正在加载…' : moreFailed ? '重试加载下一页' : '加载下一页'}
            </button>
          </div>
        )}
      </section>

      {(storefrontCharts.length > 0 || storefrontFailed) && (
        <section className={`${layout.group} ${styles.group}`} aria-label="地区榜单">
          <div className={styles.groupHeading}><h2>地区榜单</h2></div>
          {storefrontCharts.length > 0 && (
            <div className={styles.grid}>
              {storefrontCharts.map(playlist => (
                <div className={styles.card} key={String(playlist.id)}>
                  <PlaylistCard playlist={playlist} meta="" onClick={() => setPreview(playlist)} />
                </div>
              ))}
            </div>
          )}
          {storefrontFailed && <p className={styles.status}>地区榜单暂时无法加载 <button onClick={() => setStorefrontRevision(value => value + 1)}>重试</button></p>}
        </section>
      )}

      <PlaylistPreviewModal playlist={preview} onClose={() => setPreview(null)} />
    </ScrollArea>
  )
}
