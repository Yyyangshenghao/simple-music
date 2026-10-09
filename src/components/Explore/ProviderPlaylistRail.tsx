import { useEffect, useState } from 'react'
import { providerFor } from '../../providers/registry'
import { BROWSE_CACHE_MAX_AGE_MS, getCachedProviderData, requestProviderData } from '../../lib/provider-request-cache'
import type { ProviderId } from '../../providers/types'
import type { Playlist } from '../../types/domain'
import { PlaylistCard } from './PlaylistCard'
import styles from './ProviderPlaylistRail.module.css'

interface ProviderPlaylistRailProps {
  source: ProviderId
  onOpen(playlist: Playlist): void
}

export function ProviderPlaylistRail({ source, onOpen }: ProviderPlaylistRailProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>(() => getCachedProviderData<Playlist[]>(source, 'library:user-playlists')?.slice(0, 8) ?? [])
  const [loaded, setLoaded] = useState(() => getCachedProviderData(source, 'library:user-playlists') !== undefined)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let cancelled = false
    const cached = getCachedProviderData<Playlist[]>(source, 'library:user-playlists')
    setPlaylists(cached?.slice(0, 8) ?? [])
    setLoaded(cached !== undefined)
    setFailed(false)
    const load = providerFor(source).library?.getUserPlaylists
    if (!load) {
      setLoaded(true)
      return
    }
    requestProviderData(source, 'library:user-playlists', load, { force: revision > 0, maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
      .then((items) => { if (!cancelled) setPlaylists(items.slice(0, 8)) })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [revision, source])

  if (loaded && playlists.length === 0 && !failed) return null

  return (
    <section className={styles.rail} aria-label={`${source}账号歌单`}>
      <div className={styles.header}>
        <h3>你的歌单</h3>
        {!loaded && <span>加载中…</span>}
      </div>
      {failed ? (
        <div className={styles.error}>
          <span>账号歌单暂时无法加载</span>
          <button className="no-drag" onClick={() => setRevision((current) => current + 1)}>重试</button>
        </div>
      ) : playlists.length > 0 && (
        <div className={styles.row}>
          {playlists.map((playlist) => (
            <div className={styles.card} key={`${playlist.source}:${String(playlist.id)}`}>
              <PlaylistCard playlist={playlist} onClick={() => onOpen(playlist)} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
