import { useEffect, useState } from 'react'
import { BROWSE_CACHE_MAX_AGE_MS, getCachedProviderData, requestProviderData } from '../../lib/provider-request-cache'
import { providerFor } from '../../providers/registry'
import { useProviderStore } from '../../stores/providers'
import type { Playlist } from '../../types/domain'
import { ActionButton } from '../ui/ActionButton'
import { HorizontalCardRail } from './HorizontalCardRail'
import { PlaylistCard } from './PlaylistCard'
import rail from './ProviderPlaylistRail.module.css'
import styles from './QishuiThemePlaylists.module.css'

const themes = ['华语流行', '民谣', '电子', '爵士'] as const
type Theme = typeof themes[number]

function ThemeRail({ theme, onOpen }: { theme: Theme; onOpen(playlist: Playlist): void }) {
  const scope = `explore:theme-playlists:${theme}`
  const [playlists, setPlaylists] = useState(() => getCachedProviderData<Playlist[]>('qishui', scope))
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const isCurrent = () => !cancelled && useProviderStore.getState().byId.qishui.enabled
    void requestProviderData('qishui', scope, async () => {
      const items = await providerFor('qishui').catalog.searchPlaylists!(theme)
      const seen = new Set<string>()
      return items.filter(item => {
        const id = String(item.id)
        if (!item.name.trim() || seen.has(id)) return false
        seen.add(id)
        return true
      })
    }, { maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
      .then(items => { if (isCurrent()) setPlaylists(items) })
      .catch(() => { if (isCurrent()) setFailed(true) })
    return () => { cancelled = true }
  }, [scope, theme, attempt])

  if (failed) return <div className={styles.status} role="status">
    <span>主题歌单暂时无法加载</span>
    <ActionButton label="重试" compact onClick={() => {
      setFailed(false)
      setAttempt(current => current + 1)
    }} />
  </div>
  if (!playlists) return <p className={styles.status} role="status">正在读取主题歌单…</p>
  if (playlists.length === 0) return <p className={styles.status} role="status">暂无{theme}歌单</p>

  return <HorizontalCardRail className={rail.row} label={`${theme}歌单`}>
    {playlists.map(playlist => <div key={String(playlist.id)} className={rail.card}>
      <PlaylistCard playlist={playlist} onClick={() => onOpen(playlist)} />
    </div>)}
  </HorizontalCardRail>
}

export function QishuiThemePlaylists({ onOpen }: { onOpen(playlist: Playlist): void }) {
  const enabled = useProviderStore(state => state.byId.qishui.enabled)
  const [theme, setTheme] = useState<Theme>(themes[0])
  if (!enabled) return null

  return <section className={rail.rail} aria-label="汽水主题歌单">
    <div className={rail.header}><h3>主题歌单</h3></div>
    <div className={styles.themes} role="group" aria-label="选择歌单主题">
      {themes.map(item => <ActionButton key={item} label={item} aria-pressed={theme === item} onClick={() => setTheme(item)} />)}
    </div>
    <ThemeRail key={theme} theme={theme} onOpen={onOpen} />
  </section>
}
