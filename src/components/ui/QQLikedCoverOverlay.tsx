import type { Playlist } from '../../types/domain'
import styles from './QQLikedCoverOverlay.module.css'

export function QQLikedCoverOverlay({ playlist }: { playlist: Playlist }) {
  if (playlist.source !== 'qq' || playlist.type !== 'playlist' || String(playlist.id) !== 'qq-liked:201') return null

  return (
    <span className={styles.overlay} data-kind="liked-cover-overlay" aria-hidden="true">
      <svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
        <path d="M50 8C37-3 16-3 6 15C-11 45 18 78 47 98Q50 100 53 98C82 78 111 45 94 15C84-3 63-3 50 8Z" />
      </svg>
    </span>
  )
}
