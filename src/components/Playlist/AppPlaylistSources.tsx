import type { MusicSource, Track } from '../../types/domain'
import { appPlaylistSources } from '../../lib/app-playlist-presentation'
import { SOURCE_BRAND } from '../../lib/source-brand'
import { SourceBadge } from '../ui/SourceBadge'
import styles from './AppPlaylistSources.module.css'

interface Props {
  tracks: Track[]
  compact?: boolean
  /** 传入时来源可点击筛选，再点一次取消。 */
  selected?: MusicSource | null
  onSelect?(source: MusicSource | null): void
}

export function AppPlaylistSources({ tracks, compact = false, selected = null, onSelect }: Props) {
  const sources = appPlaylistSources(tracks)
  if (!sources.length) return null
  const label = sources.map(({ source, count }) => `${SOURCE_BRAND[source].label} ${count} 首`).join('，')
  return <span className={`${styles.sources}${compact ? ` ${styles.compact}` : ''}${onSelect ? ` ${styles.filter}` : ''}`} role="group"
    aria-label={onSelect ? `按来源筛选：${label}` : `歌曲来源：${label}`} data-filtered={!!selected || undefined}>
    {sources.map(({ source, count }) => {
      const content = <>
        <SourceBadge source={source} compact={compact} showInactive displayMode="always" />
        <span className={styles.count}>{count}{!compact && ' 首'}</span>
      </>
      return onSelect
        ? <button type="button" className={`${styles.source} no-drag`} key={source} aria-pressed={selected === source}
          title={selected === source ? '取消筛选' : `只看${SOURCE_BRAND[source].label}`} onClick={() => onSelect(selected === source ? null : source)}>{content}</button>
        : <span className={styles.source} key={source}>{content}</span>
    })}
  </span>
}
