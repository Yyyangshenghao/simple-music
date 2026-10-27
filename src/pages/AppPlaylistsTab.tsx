import { useEffect, useState, type RefObject } from 'react'
import { useAppPlaylistsStore } from '../stores/app-playlists'
import { useNavigationStore } from '../stores/navigation'
import { AppPlaylistNameDialog } from '../components/Playlist/AppPlaylistDialog'
import { AppPlaylistCover } from '../components/Playlist/AppPlaylistCover'
import { AppPlaylistSources } from '../components/Playlist/AppPlaylistSources'
import { appPlaylistCoverLayoutId, appPlaylistSources } from '../lib/app-playlist-presentation'
import { SOURCE_BRAND } from '../lib/source-brand'
import { CollectionCard } from '../components/Explore/PlaylistCard'
import { coverReturnTransition, springGentle } from '../lib/motion-presets'
import { AppPlaylistsTag, LibraryShelf, ShelfCreateButton, ShelfGrid, ShelfMessage } from './LibraryShelf'
import styles from './AppPlaylists.module.css'
import { useKaraokeStore } from '../stores/karaoke'
import { ACCOMPANIMENTS_PLAYLIST_ID } from '../types/karaoke'

export function AppPlaylistsTab({ scrollRef }: { scrollRef: RefObject<HTMLDivElement> }) {
  const items = useAppPlaylistsStore(state => state.items)
  const error = useAppPlaylistsStore(state => state.error)
  const returning = useNavigationStore(state => state.lastAction === 'pop')
  const [creating, setCreating] = useState(false)
  const stems = useKaraokeStore(state => state.items)
  const jobs = useKaraokeStore(state => state.jobs)
  const loadStems = useKaraokeStore(state => state.load)
  useEffect(() => { void loadStems().catch(() => {}) }, [loadStems])

  return <LibraryShelf label="应用歌单" identity={<AppPlaylistsTag />}
    actions={<ShelfCreateButton disabled={!!error} onClick={() => setCreating(true)} />}>
    {error && <ShelfMessage alert action={{ label: '重试读取', onClick: () => useAppPlaylistsStore.getState().reload() }}>{error}</ShelfMessage>}
    <ShelfGrid items={[null, ...(error ? [] : items)]} scrollRef={scrollRef} render={item => {
      if (!item) return <CollectionCard key={ACCOMPANIMENTS_PLAYLIST_ID} ariaLabel={`打开我的伴奏，${stems.length} 个版本，${jobs.length} 个生成任务`}
        coverTransition={springGentle}
        onClick={() => useNavigationStore.getState().navigateTo({ type: 'app-playlist', id: ACCOMPANIMENTS_PLAYLIST_ID })}
        cover={<div className={styles.accompanimentCover}><svg viewBox="0 0 48 48" width="52" height="52" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 34V12l21-4v22M19 19l21-4" /><ellipse cx="13" cy="35" rx="6" ry="4" /><ellipse cx="34" cy="31" rx="6" ry="4" /></svg></div>}
        name="我的伴奏" meta={jobs.length ? `${stems.length} 个版本 · ${jobs.length} 个任务` : `${stems.length} 个版本`} />
      const sources = appPlaylistSources(item.tracks)
      const description = sources.map(({ source, count }) => `${SOURCE_BRAND[source].label} ${count} 首`).join('、')
      return <CollectionCard key={item.id}
        ariaLabel={`打开应用歌单：${item.name}，${item.tracks.length} 首${description ? `，包含${description}` : ''}`}
        onClick={() => useNavigationStore.getState().navigateTo({ type: 'app-playlist', id: item.id })}
        coverLayoutId={appPlaylistCoverLayoutId(item.id)}
        coverTransition={returning ? coverReturnTransition : springGentle}
        cover={<AppPlaylistCover tracks={item.tracks} />}
        name={item.name}
        meta={`${item.tracks.length} 首${sources.length > 1 ? ` · ${sources.length} 种来源` : ''}`}
        footer={<div className={styles.cardSources}><AppPlaylistSources tracks={item.tracks} compact /></div>} />
    }} />
    {creating && <AppPlaylistNameDialog title="新建应用歌单" onClose={() => setCreating(false)} onSubmit={name => {
      const id = useAppPlaylistsStore.getState().create(name)
      useNavigationStore.getState().navigateTo({ type: 'app-playlist', id })
    }} />}
  </LibraryShelf>
}
