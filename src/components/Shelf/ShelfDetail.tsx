import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { usePlaylistStore } from '../../stores/playlist'
import { GlassPanel } from '../ui/GlassPanel'
import { CloseIcon } from '../ui/CloseIcon'
import type { Playlist, Track } from '../../types/domain'
import styles from './ShelfDetail.module.css'

interface ShelfDetailProps {
  playlist: Playlist
  onClose: () => void
}

/** 从未知形状的响应里容错提取曲目数组（兼容 { tracks } / { songs } / 数组）。 */
function extractTracks(res: unknown): Track[] {
  if (Array.isArray(res)) return res as Track[]
  if (res && typeof res === 'object') {
    const obj = res as Record<string, unknown>
    const candidate = obj.tracks ?? obj.songs ?? obj.data
    if (Array.isArray(candidate)) return candidate as Track[]
  }
  return []
}

/** mm:ss 格式化，duration 单位毫秒。 */
function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return '--:--'
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** 歌单详情：拉取曲目列表，点击某曲入队并自动播放。 */
export function ShelfDetail({ playlist, onClose }: ShelfDetailProps) {
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    api
      .get<unknown>('/api/playlist/tracks', { id: String(playlist.id) })
      .then((res) => {
        if (!alive) return
        setTracks(extractTracks(res))
      })
      .catch(() => {
        if (!alive) return
        setError(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [playlist.id])

  const handlePick = (index: number): void => {
    usePlaylistStore.getState().setQueue(tracks, index)
  }

  return (
    <div className={styles.overlay}>
      <GlassPanel level="card" className={styles.panel}>
        <header className={styles.header}>
          {playlist.cover ? (
            <img className={styles.cover} src={playlist.cover} alt="" />
          ) : (
            <span className={styles.cover} aria-hidden="true" />
          )}
          <div className={styles.headInfo}>
            <h2 className={styles.title} title={playlist.name}>
              {playlist.name}
            </h2>
            <p className={styles.sub}>
              {playlist.creator} · {playlist.trackCount} 首
            </p>
          </div>
          <button
            type="button"
            className={`${styles.close} no-drag`}
            onClick={onClose}
            aria-label="关闭"
          >
            <CloseIcon size={16} />
          </button>
        </header>

        <div className={styles.body}>
          {loading && <p className={styles.hint}>加载中…</p>}
          {!loading && error && <p className={styles.hint}>曲目加载失败</p>}
          {!loading && !error && tracks.length === 0 && (
            <p className={styles.hint}>暂无曲目</p>
          )}
          {!loading && !error && tracks.length > 0 && (
            <ul className={styles.list}>
              {tracks.map((track, index) => (
                <li key={`${String(track.id)}-${index}`}>
                  <button
                    type="button"
                    className={`${styles.item} no-drag`}
                    onClick={() => handlePick(index)}
                  >
                    <span className={styles.index}>{index + 1}</span>
                    <span className={styles.trackInfo}>
                      <span className={styles.trackName} title={track.name}>
                        {track.name}
                      </span>
                      <span className={styles.trackArtist} title={track.artist}>
                        {track.artist}
                      </span>
                    </span>
                    <span className={styles.trackDuration}>
                      {formatDuration(track.duration)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </GlassPanel>
    </div>
  )
}
