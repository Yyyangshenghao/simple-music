import type { Track } from '../../types/domain'
import { sizedImage } from '../../lib/image-size'
import { appPlaylistCovers } from '../../lib/app-playlist-presentation'
import styles from './AppPlaylistCover.module.css'

function CoverFallback() {
  return <svg className={styles.fallback} viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <path d="M21 32V14l17-4v18M21 20l17-4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <ellipse cx="15.5" cy="33" rx="5.5" ry="4" fill="currentColor" />
    <ellipse cx="32.5" cy="29" rx="5.5" ry="4" fill="currentColor" />
  </svg>
}

export function AppPlaylistCover({ tracks, className = '' }: { tracks: Track[]; className?: string }) {
  const covers = appPlaylistCovers(tracks)
  return <span className={`${styles.cover} ${className}`} data-cover-count={covers.length} role="img" aria-label="应用歌单封面">
    {covers.length ? covers.map(cover => <span className={styles.tile} key={cover.url} aria-hidden="true">
      <CoverFallback />
      <img className={styles.image} src={sizedImage(cover.url, 384)} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true }} />
    </span>) : <CoverFallback />}
  </span>
}
