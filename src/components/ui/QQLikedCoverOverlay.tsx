import type { Playlist } from '../../types/domain'
import { HeartIcon } from './HeartIcon'
import styles from './QQLikedCoverOverlay.module.css'

export function QQLikedCoverOverlay({ playlist }: { playlist: Playlist }) {
  if (playlist.source !== 'qq' || playlist.type !== 'playlist' || String(playlist.id) !== 'qq-liked:201') return null

  return (
    <span className={styles.overlay} data-kind="liked-cover-overlay" aria-hidden="true">
      <HeartIcon filled />
    </span>
  )
}
