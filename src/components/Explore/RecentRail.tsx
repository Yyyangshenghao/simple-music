import { useEffect, useState } from 'react'
import { getCachedProviderData, requestProviderData } from '../../lib/provider-request-cache'
import { providerFor } from '../../providers/registry'
import type { ProviderId } from '../../providers/types'
import type { Playlist, Track } from '../../types/domain'
import { usePlaylistStore } from '../../stores/playlist'
import styles from './RecentRail.module.css'
import { sizedImage } from '../../lib/image-size'
import { SourceBadge } from '../ui/SourceBadge'
import { HorizontalCardRail } from './HorizontalCardRail'

interface RecentRailProps {
  source: ProviderId
  embedded?: boolean
  /** 点击卡片打开歌单预览小卡（复用 Stack 顶卡的预览弹窗）。 */
  onOpen(playlist: Playlist): void
}

/** 账号级最近记录：按平台分别展示歌单或歌曲，空记录时隐藏。 */
export function RecentRail({ source, embedded = false, onOpen }: RecentRailProps) {
  const history = providerFor(source).history
  const [playlists, setPlaylists] = useState<Playlist[]>(() => getCachedProviderData<Playlist[]>(source, 'history:recent-playlists') ?? [])
  const [tracks, setTracks] = useState<Track[]>(() => getCachedProviderData<Track[]>(source, 'history:recent-tracks') ?? [])
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    // 音源切换时丢弃在途响应
    let cancelled = false
    setFailed(false)
    setPlaylists(getCachedProviderData<Playlist[]>(source, 'history:recent-playlists') ?? [])
    setTracks(getCachedProviderData<Track[]>(source, 'history:recent-tracks') ?? [])
    if (history?.getRecentPlaylists) void requestProviderData(source, 'history:recent-playlists', history.getRecentPlaylists, { maxAgeMs: 30_000 })
      .then((pls) => { if (!cancelled) setPlaylists(pls) })
      .catch(() => {})
    if (history?.getRecentTracks) void requestProviderData(source, 'history:recent-tracks', history.getRecentTracks, { maxAgeMs: 30_000, force: retry > 0 })
      .then((songs) => { if (!cancelled) setTracks(songs.slice(0, 20)) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [history, source, retry])

  if (playlists.length === 0 && tracks.length === 0 && !failed) return null

  return (
    <section className={`${styles.rail}${embedded ? ` ${styles.embedded}` : ''}`}>
      <h2 className={styles.title}>{history?.getRecentTracks ? '最近听过' : '最近播放'}</h2>
      {failed && <div className={styles.error} role="status">
        <span>最近歌曲暂时无法加载</span>
        <button type="button" className="no-drag" onClick={() => setRetry(value => value + 1)}>重试</button>
      </div>}
      <HorizontalCardRail className={styles.row} label={history?.getRecentTracks ? '最近听过' : '最近播放'}>
        {tracks.slice(0, 20).map((track, index) => (
          <button key={`${track.source}:${String(track.id)}`} className={`${styles.card} no-drag`}
            onClick={() => usePlaylistStore.getState().setQueue(tracks.slice(0, 20), index)} title={`${track.name} · ${track.artist}`} aria-label={`播放 ${track.name}`}>
            {track.cover
              ? <img className={styles.cover} src={sizedImage(track.cover, 200)} alt="" loading="lazy" />
              : <div className={styles.cover} />}
            <SourceBadge source={track.source} compact className={styles.sourceBadge} />
            <span className={styles.name}>{track.name}</span>
            <span className={styles.name}>{track.artist}</span>
          </button>
        ))}
        {playlists.map((pl) => (
          <button key={`${pl.source}:${String(pl.id)}`} className={`${styles.card} no-drag`} onClick={() => onOpen(pl)} title={pl.name}>
            {pl.cover
              ? <img className={styles.cover} src={sizedImage(pl.cover, 200)} alt="" loading="lazy" />
              : <div className={styles.cover} />}
            <SourceBadge source={pl.source} compact className={styles.sourceBadge} />
            <span className={styles.name}>{pl.name}</span>
          </button>
        ))}
      </HorizontalCardRail>
    </section>
  )
}
