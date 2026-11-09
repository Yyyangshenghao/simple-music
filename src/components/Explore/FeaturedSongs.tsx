import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { providerAccountSession } from '../../lib/provider-account-session'
import { BROWSE_CACHE_MAX_AGE_MS, getCachedProviderData, requestProviderData } from '../../lib/provider-request-cache'
import { useProviderStore } from '../../stores/providers'
import { usePlaylistStore } from '../../stores/playlist'
import type { Track } from '../../types/domain'
import { ActionButton } from '../ui/ActionButton'
import { TrackRow } from './TrackRow'
import styles from './FeaturedSongs.module.css'

interface FeaturedResponse {
  banners: { track: Track }[]
  partial?: boolean
}

export function FeaturedSongs() {
  const enabled = useProviderStore(state => state.byId.netease.enabled && state.byId.netease.auth === 'authenticated')
  const session = useProviderStore(() => providerAccountSession('netease'))
  const scope = `discovery:featured-songs:${session}`
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState(() => ({
    scope,
    data: getCachedProviderData<FeaturedResponse>('netease', scope),
    failed: false,
  }))
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setResult(current => ({ scope, data: current.scope === scope ? current.data : undefined, failed: false }))
    setLoading(true)
    const current = () => !cancelled && session === providerAccountSession('netease')
      && useProviderStore.getState().byId.netease.enabled && useProviderStore.getState().byId.netease.auth === 'authenticated'
    void requestProviderData('netease', scope, () => api.get<FeaturedResponse>('/api/netease/banner'),
      { force: revision > 0, maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
      .then(data => {
        if (current() && getCachedProviderData('netease', scope) === data) setResult({ scope, data, failed: false })
      })
      .catch(() => { if (current()) setResult(previous => ({ ...previous, failed: true })) })
      .finally(() => { if (current()) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled, scope, session, revision])

  if (!enabled) return null
  const data = result.scope === scope ? result.data : undefined
  const failed = result.scope === scope && result.failed
  const seen = new Set<string>()
  const tracks = (data?.banners ?? []).flatMap(item => {
    const track = item.track
    if (track?.source !== 'netease' || seen.has(String(track.id))) return []
    seen.add(String(track.id))
    return [track]
  })
  if (data && !tracks.length && !failed && !data.partial) return null

  return <section className={styles.section} aria-label="歌曲精选">
    <div className={styles.header}>
      <h3>歌曲精选</h3>
      {tracks.length > 0 && <ActionButton label="播放全部" icon="play" compact onClick={() => usePlaylistStore.getState().setQueue(tracks, 0)} />}
    </div>
    <div className={styles.tracks}>
      {tracks.map((track, index) => <TrackRow key={String(track.id)} track={track} index={index} hideSource
        onPlay={() => usePlaylistStore.getState().setQueue(tracks, index)} />)}
    </div>
    {!data && !failed && <p className={styles.status} role="status">正在读取歌曲精选…</p>}
    {(failed || data?.partial) && <div className={styles.feedback} role="status">
      <span>{tracks.length ? '部分精选暂时无法加载' : '歌曲精选暂时无法加载'}</span>
      <ActionButton label={loading ? '正在重试…' : '重试'} compact disabled={loading} onClick={() => setRevision(value => value + 1)} />
    </div>}
  </section>
}
