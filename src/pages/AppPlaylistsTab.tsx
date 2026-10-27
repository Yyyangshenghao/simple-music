import { useEffect, useRef, useState, type RefObject } from 'react'
import { motion } from 'motion/react'
import { useAppPlaylistsStore } from '../stores/app-playlists'
import { useNavigationStore } from '../stores/navigation'
import { AppPlaylistNameDialog } from '../components/Playlist/AppPlaylistDialog'
import { AppPlaylistCover } from '../components/Playlist/AppPlaylistCover'
import { AppPlaylistSources } from '../components/Playlist/AppPlaylistSources'
import { appPlaylistCoverLayoutId, appPlaylistSources } from '../lib/app-playlist-presentation'
import { SOURCE_BRAND } from '../lib/source-brand'
import { CollectionCard } from '../components/Explore/PlaylistCard'
import { coverReturnTransition, pageTransition, springGentle } from '../lib/motion-presets'
import { usePageTransition } from '../hooks/useMotion'
import { AppPlaylistsTag, LibraryShelf, ShelfCreateButton, ShelfGrid, ShelfMessage } from './LibraryShelf'
import styles from './AppPlaylists.module.css'
import libraryStyles from './LibraryPage.module.css'
import { AppPlaylistKindSwitch, type AppPlaylistKind } from './CollectionKindSwitch'
import { AccompanimentsLibrary } from './AccompanimentsLibrary'

const KIND_STORAGE_KEY = 'simplemusic-library-app-playlists-kind'

function readStoredKind(): AppPlaylistKind {
  try { return localStorage.getItem(KIND_STORAGE_KEY) === 'accompaniments' ? 'accompaniments' : 'playlists' } catch { return 'playlists' }
}

/** 应用歌单：歌单与伴奏二选一展示，选择跨会话记住；交互与「收藏」的歌单/专辑切换一致。 */
export function AppPlaylistsTab({ scrollRef }: { scrollRef: RefObject<HTMLDivElement> }) {
  const pageMotion = usePageTransition()
  const accompanimentsRequest = useNavigationStore(state => state.libraryAccompanimentsRequest)
  const [kind, setKind] = useState<AppPlaylistKind>(() => accompanimentsRequest ? 'accompaniments' : readStoredKind())
  // 首次挂载已有外层 tab 淡入，只在切换歌单/伴奏时播放内层淡入。
  const switched = useRef(false)
  function select(next: AppPlaylistKind) {
    switched.current = true
    setKind(next)
    try { localStorage.setItem(KIND_STORAGE_KEY, next) } catch { /* 存储不可用时仅本次生效 */ }
  }
  useEffect(() => {
    if (!accompanimentsRequest) return
    if (kind !== 'accompaniments') select('accompaniments')
    else try { localStorage.setItem(KIND_STORAGE_KEY, 'accompaniments') } catch { /* 存储不可用时仅本次生效 */ }
    useNavigationStore.getState().consumeLibraryAccompanimentsRequest(accompanimentsRequest)
  }, [accompanimentsRequest]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={libraryStyles.favorites}>
      <AppPlaylistKindSwitch value={kind} onChange={select} />
      <motion.div key={kind} initial={switched.current ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={pageMotion(pageTransition)}>
        {kind === 'accompaniments' ? <AccompanimentsLibrary /> : <AppPlaylistsShelf scrollRef={scrollRef} />}
      </motion.div>
    </div>
  )
}

function AppPlaylistsShelf({ scrollRef }: { scrollRef: RefObject<HTMLDivElement> }) {
  const items = useAppPlaylistsStore(state => state.items)
  const error = useAppPlaylistsStore(state => state.error)
  const returning = useNavigationStore(state => state.lastAction === 'pop')
  const [creating, setCreating] = useState(false)

  return <LibraryShelf label="应用歌单" identity={<AppPlaylistsTag />}
    actions={<ShelfCreateButton disabled={!!error} onClick={() => setCreating(true)} />}>
    {error && <ShelfMessage alert action={{ label: '重试读取', onClick: () => useAppPlaylistsStore.getState().reload() }}>{error}</ShelfMessage>}
    {!error && !items.length && <ShelfMessage>还没有应用歌单</ShelfMessage>}
    <ShelfGrid items={error ? [] : items} scrollRef={scrollRef} render={item => {
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
