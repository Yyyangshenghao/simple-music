import { useEffect, useState } from 'react'
import { providerAccountSession } from '../../lib/provider-account-session'
import { BROWSE_CACHE_MAX_AGE_MS, getCachedProviderData, requestProviderData } from '../../lib/provider-request-cache'
import { providerFor } from '../../providers/registry'
import { useProviderStore } from '../../stores/providers'
import { useRecentPlaysStore } from '../../stores/recent'
import { useAppPlaylistsStore } from '../../stores/app-playlists'
import { useNavigationStore } from '../../stores/navigation'
import { usePlaylistStore } from '../../stores/playlist'
import type { Playlist, Track } from '../../types/domain'
import { ActionButton } from '../ui/ActionButton'
import { AppPlaylistCover } from '../Playlist/AppPlaylistCover'
import { HorizontalCardRail } from './HorizontalCardRail'
import { TrackRow } from './TrackRow'
import styles from './PersonalListeningSection.module.css'

const WEEKLY_SCOPE = 'history:weekly-tracks'
const PREVIEW_COUNT = 6

function openTrackCollection(source: 'netease' | 'qishui', tracks: Track[], name: string) {
  const playlist: Playlist = {
    provider: source, source, type: 'playlist', id: `${source}:personal-listening`, name,
    cover: tracks.find(track => track.cover)?.cover ?? '', trackCount: tracks.length,
    trackCountKnown: true, playCount: 0, creator: source === 'qishui' ? '本机最近播放' : '网易云音乐',
  }
  useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'explore', playlist, tracks })
}

function ListeningTracks({ source, title, tracks, caption }: { source: 'netease' | 'qishui'; title: string; tracks: Track[]; caption?: string }) {
  return <>
    <div className={styles.header}>
      <div><h3>{title}</h3>{caption && <p className={styles.caption}>{caption}</p>}</div>
      {tracks.length > 0 && <div className={styles.actions}>
        <ActionButton label="播放全部" icon="play" compact onClick={() => usePlaylistStore.getState().setQueue(tracks, 0)} />
        <button type="button" className={`${styles.more} no-drag`} onClick={() => openTrackCollection(source, tracks, title)}>查看全部</button>
      </div>}
    </div>
    <div className={styles.tracks}>
      {tracks.slice(0, PREVIEW_COUNT).map((track, index) => <TrackRow key={`${track.source}:${String(track.id)}`}
        track={track} index={index} hideSource onPlay={() => usePlaylistStore.getState().setQueue(tracks, index)} />)}
    </div>
  </>
}

function SearchPrompt({ children }: { children: string }) {
  return <div className={styles.message}><p>{children}</p><p>通过顶栏搜索歌曲，找到下一首想听的音乐。</p></div>
}

function WeeklyListening() {
  const enabled = useProviderStore(state => state.byId.netease.enabled && state.byId.netease.auth === 'authenticated')
  const session = useProviderStore(() => providerAccountSession('netease'))
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const scope = `${WEEKLY_SCOPE}:${session}:${day}`
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState(() => ({
    scope,
    tracks: getCachedProviderData<Track[]>('netease', scope) ?? [],
    loaded: getCachedProviderData('netease', scope) !== undefined,
    failed: false,
  }))

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const cached = getCachedProviderData<Track[]>('netease', scope)
    setResult({ scope, tracks: cached ?? [], loaded: cached !== undefined, failed: false })
    const isCurrent = () => !cancelled && session === providerAccountSession('netease')
      && useProviderStore.getState().byId.netease.enabled && useProviderStore.getState().byId.netease.auth === 'authenticated'
    void requestProviderData('netease', scope,
      () => providerFor('netease').history!.getListeningRanking!(),
      { force: revision > 0, maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
      .then(tracks => { if (isCurrent()) setResult({ scope, tracks: tracks.filter(track => track.source === 'netease'), loaded: true, failed: false }) })
      .catch(() => { if (isCurrent()) setResult(current => ({ ...current, loaded: true, failed: true })) })
    return () => { cancelled = true }
  }, [enabled, session, scope, revision])

  if (!enabled) return null
  const current = result.scope === scope
  const tracks = current ? result.tracks : []
  const loaded = current && result.loaded
  return <section className={styles.section} aria-label="本周常听">
    <ListeningTracks source="netease" title="本周常听" tracks={tracks} />
    {!loaded && <p className={styles.status} role="status">正在读取本周常听…</p>}
    {current && result.failed && <div className={styles.error} role="status">
      <span>本周常听暂时无法加载</span>
      <ActionButton label="重试" compact onClick={() => setRevision(value => value + 1)} />
    </div>}
    {loaded && !result.failed && tracks.length === 0 && <SearchPrompt>网易云音乐暂时没有本周收听记录。</SearchPrompt>}
  </section>
}

function QishuiListening() {
  const enabled = useProviderStore(state => state.byId.qishui.enabled && state.byId.qishui.auth === 'authenticated')
  const recent = useRecentPlaysStore(state => state.items)
  const playlists = useAppPlaylistsStore(state => state.items)
  const playlistError = useAppPlaylistsStore(state => state.error)
  if (!enabled) return null
  const tracks = recent.map(item => item.track).filter(track => track.source === 'qishui')
  const saved = playlists.filter(playlist => playlist.tracks.some(track => track.source === 'qishui'))

  return <>
    <section className={styles.section} aria-label="汽水继续听">
      <ListeningTracks source="qishui" title="继续听" tracks={tracks} caption="本机最近播放" />
      {tracks.length === 0 && <SearchPrompt>还没有听过汽水音乐。</SearchPrompt>}
    </section>
    {(saved.length > 0 || playlistError) && <section className={styles.section} aria-label="含汽水音乐的应用歌单">
      <div className={styles.header}><h3>已整理的歌单</h3></div>
      {playlistError && <div className={styles.error} role="status">
        <span>{playlistError}</span>
        <ActionButton label="重试读取" compact onClick={() => useAppPlaylistsStore.getState().reload()} />
      </div>}
      {saved.length > 0 && <HorizontalCardRail className={styles.rail} label="含汽水音乐的应用歌单">
        {saved.map(playlist => <button key={playlist.id} type="button" className={`${styles.card} no-drag`}
          onClick={() => useNavigationStore.getState().navigateTo({ type: 'app-playlist', id: playlist.id })}>
          <AppPlaylistCover tracks={playlist.tracks} className={styles.cover} />
          <span className={styles.name}>{playlist.name}</span>
          <span className={styles.meta}>{playlist.tracks.length} 首 · 含 {playlist.tracks.filter(track => track.source === 'qishui').length} 首汽水音乐</span>
        </button>)}
      </HorizontalCardRail>}
    </section>}
  </>
}

export function PersonalListeningSection({ source }: { source: 'netease' | 'qishui' }) {
  return source === 'netease' ? <WeeklyListening /> : <QishuiListening />
}
