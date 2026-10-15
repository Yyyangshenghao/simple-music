import { useState } from 'react'
import { useAppPlaylistsStore } from '../stores/app-playlists'
import { useNavigationStore } from '../stores/navigation'
import { AppPlaylistNameDialog } from '../components/Playlist/AppPlaylistDialog'
import styles from './AppPlaylists.module.css'

export function AppPlaylistsTab() {
  const items = useAppPlaylistsStore(state => state.items)
  const error = useAppPlaylistsStore(state => state.error)
  const [creating, setCreating] = useState(false)
  return <section aria-label="应用歌单">
    <div className={styles.toolbar}>
      <h2 className={styles.sectionTitle}>应用歌单</h2>
      <button className={styles.primary} disabled={!!error} onClick={() => setCreating(true)}>＋ 新建歌单</button>
    </div>
    {error ? <div className={styles.empty} role="alert"><p>{error}</p><button onClick={() => useAppPlaylistsStore.getState().reload()}>重试读取</button></div>
      : !items.length ? <div className={styles.empty}><span className={styles.emptyMark} aria-hidden="true">♫</span><p>还没有应用歌单</p><span className={styles.hint}>新建一个歌单，再从歌曲或专辑的更多操作中加入。</span></div>
        : <div className={styles.grid}>{items.map(item => <button className={styles.card} key={item.id} onClick={() => useNavigationStore.getState().navigateTo({ type: 'app-playlist', id: item.id })}>
          <span className={styles.cover} aria-hidden="true">♫<span>{String(item.tracks.length).padStart(2, '0')}</span></span>
          <strong>{item.name}</strong><small>{item.tracks.length} 首</small>
        </button>)}</div>}
    {creating && <AppPlaylistNameDialog title="新建应用歌单" onClose={() => setCreating(false)} onSubmit={name => { useAppPlaylistsStore.getState().create(name) }} />}
  </section>
}
