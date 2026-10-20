import { useState, type RefObject } from 'react'
import { useAppPlaylistsStore } from '../stores/app-playlists'
import { useNavigationStore } from '../stores/navigation'
import { AppPlaylistNameDialog } from '../components/Playlist/AppPlaylistDialog'
import { AppPlaylistCover } from '../components/Playlist/AppPlaylistCover'
import { AppPlaylistSources } from '../components/Playlist/AppPlaylistSources'
import { SourceBadge } from '../components/ui/SourceBadge'
import { appPlaylistCoverLayoutId, appPlaylistSources } from '../lib/app-playlist-presentation'
import { SOURCE_BRAND } from '../lib/source-brand'
import { CollectionCard } from '../components/Explore/PlaylistCard'
import { coverReturnTransition, springGentle } from '../lib/motion-presets'
import { AppPlaylistsTag, LibraryShelf, ShelfCreateButton, ShelfGrid, ShelfMessage } from './LibraryShelf'
import styles from './AppPlaylists.module.css'

export function AppPlaylistsTab({ scrollRef }: { scrollRef: RefObject<HTMLDivElement> }) {
  const items = useAppPlaylistsStore(state => state.items)
  const error = useAppPlaylistsStore(state => state.error)
  const returning = useNavigationStore(state => state.lastAction === 'pop')
  const [creating, setCreating] = useState(false)

  return <LibraryShelf label="应用歌单" identity={<AppPlaylistsTag />}
    actions={(items.length > 0 || error) && <ShelfCreateButton disabled={!!error} onClick={() => setCreating(true)} />}>
    {error ? <ShelfMessage alert action={{ label: '重试读取', onClick: () => useAppPlaylistsStore.getState().reload() }}>{error}</ShelfMessage>
      : !items.length ? <div className={styles.welcome}>
        <div className={styles.supportedSources} aria-label="支持的歌曲来源">{(['netease', 'qq', 'apple', 'local'] as const).map(source => <SourceBadge key={source} source={source} showInactive displayMode="always" />)}</div>
        <h3>建一份跨平台歌单</h3>
        <p>在歌曲上点「＋」或右键即可加入，正在播放的歌可在播放栏收藏；整张专辑或歌单从「更多」中加入。</p>
        <button className={`${styles.createButton} ${styles.primary} no-drag`} onClick={() => setCreating(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>新建应用歌单
        </button>
        <small>只在应用内整理，不会更改平台歌单。</small>
      </div>
        : <ShelfGrid items={items} scrollRef={scrollRef} render={item => {
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
        }} />}
    {creating && <AppPlaylistNameDialog title="新建应用歌单" onClose={() => setCreating(false)} onSubmit={name => {
      const id = useAppPlaylistsStore.getState().create(name)
      useNavigationStore.getState().navigateTo({ type: 'app-playlist', id })
    }} />}
  </LibraryShelf>
}
