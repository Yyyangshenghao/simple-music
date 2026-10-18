import type { Track } from '../../types/domain'
import { appPlaylistSources } from '../../lib/app-playlist-presentation'
import { SOURCE_BRAND } from '../../lib/source-brand'
import { SourceBadge } from '../ui/SourceBadge'
import styles from './AppPlaylistSources.module.css'

export function AppPlaylistSources({ tracks, compact = false }: { tracks: Track[]; compact?: boolean }) {
  const sources = appPlaylistSources(tracks)
  if (!sources.length) return null
  const label = sources.map(({ source, count }) => `${SOURCE_BRAND[source].label} ${count} 首`).join('，')
  return <span className={`${styles.sources}${compact ? ` ${styles.compact}` : ''}`} role="group" aria-label={`歌曲来源：${label}`}>
    {sources.map(({ source, count }) => <span className={styles.source} key={source}>
      <SourceBadge source={source} compact={compact} showInactive displayMode="always" />
      <span className={styles.count}>{count}{!compact && ' 首'}</span>
    </span>)}
  </span>
}
