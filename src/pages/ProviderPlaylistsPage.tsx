import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useIsPresent } from 'motion/react'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { PlaylistPreviewModal } from '../components/Explore/PlaylistPreviewModal'
import { BackButton } from '../components/ui/BackButton'
import { ScrollArea } from '../components/ui/ScrollArea'
import { SourceBadge } from '../components/ui/SourceBadge'
import { providerFor } from '../providers/registry'
import { providerAccountSession } from '../lib/provider-account-session'
import { canBrowseProviderPlaylists, getProviderPlaylistBrowse, loadProviderPlaylistBrowse, type PlaylistBrowseSource } from '../lib/provider-playlist-browse'
import { useNavigationStore } from '../stores/navigation'
import { useProviderStore } from '../stores/providers'
import type { Playlist } from '../types/domain'
import layout from './ToplistPage.module.css'
import styles from './ProviderPlaylistsPage.module.css'

export function ProviderPlaylistsPage({ source }: { source: PlaylistBrowseSource }) {
  const signature = useProviderStore(state => `${providerAccountSession(source)}:${state.byId[source].enabled}:${state.byId[source].auth}`)
  return <PlaylistBrowse key={`${source}:${signature}`} source={source} />
}

function PlaylistBrowse({ source }: { source: PlaylistBrowseSource }) {
  const present = useIsPresent()
  const currentView = useNavigationStore(state => state.currentView)
  const active = present && typeof currentView === 'object' && currentView.type === 'provider-playlists' && currentView.source === source
  const [data, setData] = useState(() => getProviderPlaylistBrowse(source))
  const [loading, setLoading] = useState(!data && canBrowseProviderPlaylists(source))
  const [failed, setFailed] = useState(false)
  const [preview, setPreview] = useState<Playlist | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const busy = useRef(false)
  const generation = useRef(0)
  const sourceSession = providerAccountSession(source)
  const allowed = canBrowseProviderPlaylists(source)
  const label = providerFor(source).descriptor.label

  async function loadMore(force = false) {
    if (busy.current || !canBrowseProviderPlaylists(source)) return
    busy.current = true
    setLoading(true)
    setFailed(false)
    const request = generation.current
    try {
      const next = await loadProviderPlaylistBrowse(source, data, force)
      if (request === generation.current && providerAccountSession(source) === sourceSession && next) setData(next)
    } catch {
      if (request === generation.current && providerAccountSession(source) === sourceSession) setFailed(true)
    } finally {
      if (request === generation.current) {
        busy.current = false
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    busy.current = false
    if (!data && allowed) void loadMore()
    return () => { generation.current++ }
    // 首次进入读取列表，后续翻页由用户发起。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    const node = viewport.current
    if (!node) return
    const saved = getProviderPlaylistBrowse(source)
    if (saved) node.scrollTop = saved.scrollTop
    const saveScroll = () => {
      const snapshot = getProviderPlaylistBrowse(source)
      if (snapshot) snapshot.scrollTop = node.scrollTop
    }
    node.addEventListener('scroll', saveScroll, { passive: true })
    return () => { node.removeEventListener('scroll', saveScroll) }
  }, [source])

  useEffect(() => { if (!active) setPreview(null) }, [active])

  return (
    <ScrollArea className={layout.page} scrollRef={viewport} pauseCardEffects>
      <BackButton className={layout.back} onClick={() => useNavigationStore.getState().goBack()} ariaLabel="返回探索页" />
      <h1 className={layout.heading}>{label}推荐歌单<SourceBadge source={source} reveal /></h1>
      <section className={`${layout.group} ${styles.content}`} aria-label={`${label}推荐歌单`}>
        {!allowed ? <p className={styles.status}>请登录并启用{label}后浏览歌单。</p> : <>
          {data && data.playlists.length > 0 && <div className={styles.grid}>
            {data.playlists.map(playlist => <div className={styles.card} key={`${playlist.source}:${String(playlist.id)}`}>
              <PlaylistCard playlist={playlist} onClick={() => setPreview(playlist)} />
            </div>)}
          </div>}
          {loading && !data && <p className={styles.status} role="status">正在读取推荐歌单…</p>}
          {failed && <p className={styles.status} role="status">{data ? '下一页暂时无法加载' : '推荐歌单暂时无法加载'} {!data && <button type="button" onClick={() => void loadMore(true)}>重试</button>}</p>}
          {!loading && !failed && data?.playlists.length === 0 && <p className={styles.status}>暂无推荐歌单</p>}
          {data?.nextCursor && <div className={styles.moreWrap}>
            <button type="button" className={`${styles.more} no-drag`} disabled={loading} onClick={() => void loadMore(failed)}>{loading ? '正在加载…' : failed ? '重试加载下一页' : '加载更多歌单'}</button>
          </div>}
        </>}
      </section>
      <PlaylistPreviewModal playlist={active ? preview : null} onClose={() => setPreview(null)} />
    </ScrollArea>
  )
}
