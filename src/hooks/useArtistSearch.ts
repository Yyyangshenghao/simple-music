import { useEffect, useState } from 'react'
import { serviceFor } from '../lib/service-registry'
import type { OnlineMusicSource, Track } from '../types/domain'

/** 仅搜索时补齐歌手曲库；切换歌手、清空搜索或离开页面后停止后续分页。 */
export function useArtistSearch(id: unknown, source: OnlineMusicSource, active: boolean) {
  const [songs, setSongs] = useState<Track[]>([])
  // 返回带搜索条件的页面时，首帧也必须等待完整曲库，避免过早恢复滚动。
  const [loading, setLoading] = useState(active)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [started, setStarted] = useState({ id, source, active, attempt })
  useEffect(() => {
    let cancelled = false
    setStarted({ id, source, active, attempt })
    setSongs([])
    setError(false)
    setLoading(active)
    if (!active) return
    const service = serviceFor(source)
    void (async () => {
      if (!service.getArtistSongsPage) {
        const list = await service.getArtistSongs(id)
        if (!cancelled) setSongs(list)
        return
      }
      let offset = 0
      const all: Track[] = []
      const seen = new Set<string>()
      while (!cancelled) {
        const page = await service.getArtistSongsPage(id, offset, 50)
        if (cancelled) return
        for (const song of page.songs) {
          const key = `${song.source}:${String(song.id)}`
          if (seen.has(key)) continue
          seen.add(key)
          all.push(song)
        }
        setSongs([...all])
        if (!page.hasMore || page.nextOffset <= offset) break
        offset = page.nextOffset
      }
    })().catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, source, active, attempt])
  const starting = active && (started.id !== id || started.source !== source || started.active !== active || started.attempt !== attempt)
  return { songs, loading: loading || starting, error, retry: () => setAttempt((value) => value + 1) }
}
