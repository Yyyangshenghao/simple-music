import { useState } from 'react'
import { motion } from 'motion/react'
import { useAppPlaylistsStore } from '../stores/app-playlists'
import { useNavigationStore } from '../stores/navigation'
import { AppPlaylistNameDialog } from '../components/Playlist/AppPlaylistDialog'
import { AppPlaylistCover } from '../components/Playlist/AppPlaylistCover'
import { AppPlaylistSources } from '../components/Playlist/AppPlaylistSources'
import { SourceBadge } from '../components/ui/SourceBadge'
import { appPlaylistCoverLayoutId, appPlaylistSources } from '../lib/app-playlist-presentation'
import { SOURCE_BRAND } from '../lib/source-brand'
import { TiltCard } from '../components/ui/TiltCard'
import { BorderGlow } from '../components/BorderGlow/BorderGlow'
import { coverReturnTransition, springGentle } from '../lib/motion-presets'
import libraryStyles from './LibraryPage.module.css'
import cardStyles from '../components/Explore/PlaylistCard.module.css'
import styles from './AppPlaylists.module.css'

export function AppPlaylistsTab() {
  const items = useAppPlaylistsStore(state => state.items)
  const error = useAppPlaylistsStore(state => state.error)
  const returning = useNavigationStore(state => state.lastAction === 'pop')
  const [creating, setCreating] = useState(false)
  const createButton = <button className={`${libraryStyles.createPlaylist} ${styles.createButton} ${styles.primary} no-drag`} disabled={!!error} onClick={() => setCreating(true)}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>新建应用歌单
  </button>

  return <section className={libraryStyles.providerSection} aria-label="应用歌单">
    <div className={libraryStyles.providerSectionHeader}>
      <span>应用歌单{items.length > 0 && ` · ${items.length}`}</span>
      {(items.length > 0 || error) && createButton}
    </div>
    {error ? <div className={styles.empty} role="alert"><p>{error}</p><button onClick={() => useAppPlaylistsStore.getState().reload()}>重试读取</button></div>
      : !items.length ? <div className={styles.welcome}>
        <div className={styles.supportedSources} aria-label="支持的歌曲来源">{(['netease', 'qq', 'apple', 'local'] as const).map(source => <SourceBadge key={source} source={source} showInactive displayMode="always" />)}</div>
        <h3>建一份跨平台歌单</h3>
        <p>从歌曲、专辑或平台歌单的「更多」中加入，保留原来的歌曲来源。</p>
        {createButton}
        <small>只在应用内整理，不会更改平台歌单。</small>
      </div>
        : <div className={libraryStyles.grid}>{items.map(item => {
          const sources = appPlaylistSources(item.tracks)
          const description = sources.map(({ source, count }) => `${SOURCE_BRAND[source].label} ${count} 首`).join('、')
          return <TiltCard className={cardStyles.glowWrap} key={item.id}>
            <BorderGlow borderRadius={16}>
              <button className={`${cardStyles.card} no-drag`} aria-label={`打开应用歌单：${item.name}，${item.tracks.length} 首${description ? `，包含${description}` : ''}`} onClick={() => useNavigationStore.getState().navigateTo({ type: 'app-playlist', id: item.id })}>
                <motion.div className={cardStyles.coverWrap} layoutId={appPlaylistCoverLayoutId(item.id)} layoutCrossfade={false}
                  transition={returning ? coverReturnTransition : springGentle} style={{ borderRadius: 12 }}>
                  <AppPlaylistCover tracks={item.tracks} />
                </motion.div>
                <p className={cardStyles.name} title={item.name}>{item.name}</p>
                <p className={cardStyles.meta}>{item.tracks.length} 首{sources.length > 1 ? ` · ${sources.length} 种来源` : ''}</p>
                <div className={styles.cardSources}><AppPlaylistSources tracks={item.tracks} compact /></div>
              </button>
            </BorderGlow>
          </TiltCard>
        })}</div>}
    {creating && <AppPlaylistNameDialog title="新建应用歌单" onClose={() => setCreating(false)} onSubmit={name => {
      const id = useAppPlaylistsStore.getState().create(name)
      useNavigationStore.getState().navigateTo({ type: 'app-playlist', id })
    }} />}
  </section>
}
