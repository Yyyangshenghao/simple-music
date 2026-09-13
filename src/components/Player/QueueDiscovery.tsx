import { useEffect, useRef, useState } from 'react'
import { providerFor } from '../../providers/registry'
import { usePlaylistStore } from '../../stores/playlist'
import { useNavigationStore } from '../../stores/navigation'
import { appendDiscoveredTrack } from '../../lib/queue-discovery'
import { sizedImage } from '../../lib/image-size'
import type { RelatedPlaylistsPage } from '../../lib/music-service'
import type { Playlist, Track } from '../../types/domain'
import styles from './QueueDiscovery.module.css'

interface QueueDiscoveryProps {
  track: Track
  onOpenPlaylist: () => void
}

/** 父组件按当前曲目身份挂载，切歌后恢复收起，不自动请求下一首的推荐。 */
export function QueueDiscovery(props: QueueDiscoveryProps) {
  const [expanded, setExpanded] = useState(false)
  return (
    <section className={styles.root} aria-label="QQ 音乐继续发现">
      <button className={styles.toggle} type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <span className={styles.toggleCopy}>
          <strong>发现相似音乐</strong>
          <small>相似歌曲与相关歌单</small>
        </span>
        <span className={styles.toggleAction} aria-hidden="true">{expanded ? '收起 −' : '展开 ＋'}</span>
      </button>
      {expanded && <DiscoveryResults {...props} />}
    </section>
  )
}

function DiscoveryResults({ track, onOpenPlaylist }: QueueDiscoveryProps) {
  const catalog = providerFor('qq').catalog
  const queue = usePlaylistStore((state) => state.queue)
  const [songs, setSongs] = useState<Track[] | null>(null)
  const [songsError, setSongsError] = useState(false)
  const [page, setPage] = useState<RelatedPlaylistsPage>({ playlists: [], hasMore: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const session = useRef(0)
  const busy = useRef(false)

  async function loadPlaylists(previousIds: string[], generation: number) {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    setError(false)
    try {
      const next = await catalog.getRelatedPlaylists!(track, previousIds)
      if (session.current !== generation) return
      // 换一批没有新结果时保留原来的可回访入口，并停止继续翻页。
      setPage((current) => next.playlists.length ? next : { ...current, hasMore: false })
    } catch {
      if (session.current === generation) setError(true)
    } finally {
      if (session.current === generation) {
        busy.current = false
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    const generation = ++session.current
    setSongs(null)
    setSongsError(false)
    setPage({ playlists: [], hasMore: false })
    void catalog.getSimilarTracks!(track).then((tracks) => {
      if (session.current === generation) setSongs(tracks)
    }).catch(() => {
      if (session.current === generation) setSongsError(true)
    })
    void loadPlaylists([], generation)
    return () => { session.current++; busy.current = false }
  }, [catalog, track])

  function openPlaylist(playlist: Playlist) {
    onOpenPlaylist()
    useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'explore', playlist })
  }

  return (
    <div className={styles.content}>
      <p className={styles.seed} title={track.name}>基于「{track.name}」</p>
      <h4 className={styles.heading}>相似歌曲 <span>仅加入队列，不打断播放</span></h4>
      {songsError ? <p className={styles.hint}>相似歌曲暂不可用</p>
        : songs === null ? <p className={styles.hint}>加载中…</p>
          : songs.length === 0 ? <p className={styles.hint}>暂无相似歌曲</p>
            : songs.map((song) => {
              const added = queue.some((item) => item.source === song.source && String(item.id) === String(song.id))
              return (
                <button className={styles.row} type="button" key={`${song.source}:${String(song.id)}`}
                  disabled={added} aria-label={added ? `${song.name} 已在队列` : `添加 ${song.name} 到队列`}
                  onClick={() => appendDiscoveredTrack(song)}>
                  <span className={styles.info}><span className={styles.name}>{song.name}</span><span className={styles.hint}>{song.artist}</span></span>
                  <span className={styles.action}>{added ? '已加入' : '＋'}</span>
                </button>
              )
            })}
      <div className={styles.sectionHeader}>
        <h4 className={styles.heading}>相关歌单</h4>
        {(page.hasMore || error) && <button className={styles.refresh} type="button" disabled={loading}
          onClick={() => { void loadPlaylists(page.playlists.map((playlist) => String(playlist.id)), session.current) }}>
          {loading ? '加载中…' : error ? '重试歌单' : '换一批'}
        </button>}
      </div>
      {error && <p className={styles.hint}>相关歌单暂不可用</p>}
      {loading && page.playlists.length === 0 && <p className={styles.hint}>加载中…</p>}
      {!loading && !error && page.playlists.length === 0 && <p className={styles.hint}>暂无相关歌单</p>}
      {page.playlists.map((playlist) => (
        <button className={styles.row} type="button" key={String(playlist.id)} onClick={() => openPlaylist(playlist)}>
          {playlist.cover && <img className={styles.cover} src={sizedImage(playlist.cover, 80)} alt="" loading="lazy" />}
          <span className={styles.info}><span className={styles.name}>{playlist.name}</span><span className={styles.hint}>{playlist.trackCount} 首 · {playlist.creator}</span></span>
        </button>
      ))}
    </div>
  )
}
