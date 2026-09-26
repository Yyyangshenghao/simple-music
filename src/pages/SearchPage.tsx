import { useEffect, useMemo, useState } from 'react'
import { providerFor } from '../providers/registry'
import { PROVIDER_IDS, type ProviderId } from '../providers/types'
import { runProviderTasks, type ProviderResult } from '../lib/content-hub'
import { SOURCE_BRAND } from '../lib/source-brand'
import { sizedImage } from '../lib/image-size'
import { isCatalogUnavailable } from '../lib/track-availability'
import { useProviderStore } from '../stores/providers'
import { useNavigationStore } from '../stores/navigation'
import { usePlaylistStore } from '../stores/playlist'
import { ScrollArea } from '../components/ui/ScrollArea'
import { SourceBadge } from '../components/ui/SourceBadge'
import { TrackRow } from '../components/Explore/TrackRow'
import type { ArtistInfo, Track } from '../types/domain'
import styles from './SearchPage.module.css'

type Results<T> = Partial<Record<ProviderId, ProviderResult<T[]>>>

export function SearchPage({ keyword }: { keyword: string }) {
  const [songs, setSongs] = useState<Results<Track>>({})
  const [artists, setArtists] = useState<Results<ArtistInfo>>({})
  const [sourceFilter, setSourceFilter] = useState<ProviderId | null>(null)
  const [retry, setRetry] = useState(0)
  const navigateTo = useNavigationStore((state) => state.navigateTo)
  const enabledSignature = useProviderStore((state) => PROVIDER_IDS.map((source) =>
    state.byId[source].enabled && state.byId[source].auth === 'authenticated' ? '1' : '0'
  ).join(''))
  const sources = useMemo(() => PROVIDER_IDS.filter((_, index) => enabledSignature[index] === '1'), [enabledSignature])
  const activeFilter = sourceFilter && sources.includes(sourceFilter) ? sourceFilter : null
  const visibleSources = activeFilter ? [activeFilter] : sources

  useEffect(() => {
    const controller = new AbortController()
    setSongs({})
    setArtists({})
    if (!keyword.trim()) return () => controller.abort()
    const options = {
      signal: controller.signal,
      isEnabled: (source: ProviderId) => {
        const state = useProviderStore.getState().byId[source]
        return state.enabled && state.auth === 'authenticated'
      },
      isEmpty: (items: unknown[]) => items.length === 0,
    }
    // 歌曲与歌手分别落地，某一类请求失败不会吞掉另一类的结果。
    void runProviderTasks(sources, (source) => providerFor(source).catalog.searchTracks(keyword.trim()), {
      ...options,
      onUpdate: (result) => setSongs((current) => ({ ...current, [result.source]: result })),
    })
    void runProviderTasks(sources, (source) => providerFor(source).catalog.searchArtists(keyword.trim()), {
      ...options,
      onUpdate: (result) => setArtists((current) => ({ ...current, [result.source]: result })),
    })
    return () => controller.abort()
  }, [keyword, sources, retry])

  const visibleSongs = visibleSources.flatMap((source) => songs[source]?.data ?? [])
  const visibleArtists = visibleSources.flatMap((source) => artists[source]?.data ?? [])
  const songsLoading = visibleSources.some((source) => !songs[source] || songs[source]?.status === 'loading')
  const artistsLoading = visibleSources.some((source) => !artists[source] || artists[source]?.status === 'loading')
  const failures = visibleSources.flatMap((source) => [
    ...(songs[source]?.status === 'error' ? [{ source, label: '歌曲', error: songs[source]?.error }] : []),
    ...(artists[source]?.status === 'error' ? [{ source, label: '歌手', error: artists[source]?.error }] : []),
  ])

  function playSong(track: Track) {
    if (isCatalogUnavailable(track)) return
    const queue = visibleSongs.filter((song) => !isCatalogUnavailable(song))
    const index = queue.findIndex((song) => song.source === track.source && String(song.id) === String(track.id))
    if (index >= 0) usePlaylistStore.getState().setQueue(queue, index)
  }

  return (
    <ScrollArea className={styles.page}>
      <div className={styles.content}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>聚合搜索</p>
          <h1>“{keyword}”<span>的搜索结果</span></h1>
          <p className={styles.summary}>在 {sources.length} 个音乐平台中发现歌曲与歌手</p>
        </header>

        <div className={styles.filters} role="group" aria-label="筛选搜索来源">
          <button type="button" aria-pressed={!activeFilter} onClick={() => setSourceFilter(null)}>全部平台</button>
          {sources.map((source) => (
            <button key={source} type="button" aria-pressed={activeFilter === source} onClick={() => setSourceFilter(source)}>
              <SourceBadge source={source} compact reveal />
              <span>{providerFor(source).descriptor.label}</span>
            </button>
          ))}
        </div>

        {sources.length === 0 ? (
          <div className={styles.empty}>
            <h2>启用音乐平台，开始搜索</h2>
            <p>请先登录并启用至少一个音乐平台。</p>
            <button type="button" onClick={() => navigateTo('settings')}>前往设置</button>
          </div>
        ) : (
          <>
            {failures.length > 0 && (
              <div className={styles.errors} role="status">
                <div>{failures.map(({ source, label, error }) => (
                  <p key={`${source}:${label}`}>{providerFor(source).descriptor.label} · {label}：{error?.message ?? '搜索失败'}</p>
                ))}</div>
                <button type="button" onClick={() => setRetry((value) => value + 1)}>重新搜索</button>
              </div>
            )}

            <section className={styles.section} aria-label="歌手搜索结果" aria-busy={artistsLoading}>
              <div className={styles.sectionHeading}><h2>歌手 <span>{visibleArtists.length}</span></h2>{artistsLoading && <span role="status">搜索中…</span>}</div>
              {visibleArtists.length > 0 ? (
                <div className={styles.artistGrid}>
                  {visibleArtists.map((artist) => (
                    <button key={`${artist.source}:${String(artist.id)}`} className={styles.artist} type="button" onClick={() => {
                      if (artist.source !== 'local') navigateTo({ type: 'artist', id: artist.id, source: artist.source })
                    }}>
                      {artist.avatar
                        ? <img src={sizedImage(artist.avatar, 160)} alt="" loading="lazy" />
                        : <span className={styles.avatarFallback} aria-hidden="true">{artist.name.slice(0, 1)}</span>}
                      <span className={styles.artistInfo}><strong>{artist.name}</strong><span><SourceBadge source={artist.source} compact reveal />{SOURCE_BRAND[artist.source].label}</span></span>
                    </button>
                  ))}
                </div>
              ) : <p className={styles.hint}>{artistsLoading ? '正在寻找相关歌手…' : failures.some((item) => item.label === '歌手') ? '部分平台未能完成歌手搜索，请重试。' : '没有找到相关歌手，试试其他关键词。'}</p>}
            </section>

            <section className={styles.section} aria-label="歌曲搜索结果" aria-busy={songsLoading}>
              <div className={styles.sectionHeading}><h2>歌曲 <span>{visibleSongs.length}</span></h2>{songsLoading && <span role="status">搜索中…</span>}</div>
              {visibleSongs.length > 0 ? visibleSongs.map((song, index) => (
                <TrackRow key={`${song.source}:${String(song.id)}`} track={song} index={index} onPlay={() => playSong(song)} disabled={isCatalogUnavailable(song)} statusLabel={isCatalogUnavailable(song) ? '暂无版权' : undefined} />
              )) : <p className={styles.hint}>{songsLoading ? '正在搜索各平台的歌曲…' : failures.some((item) => item.label === '歌曲') ? '部分平台未能完成歌曲搜索，请重试。' : '没有找到相关歌曲，试试歌曲名或歌手名。'}</p>}
            </section>
          </>
        )}
      </div>
    </ScrollArea>
  )
}
