import type { Track } from '../../types/domain'
import styles from './TrackRow.module.css'

interface TrackRowProps {
  track: Track
  index?: number
  onPlay(): void
}

export function TrackRow({ track, index, onPlay }: TrackRowProps) {
  return (
    <button className={`${styles.row} no-drag`} onClick={onPlay}>
      {index !== undefined && <span className={styles.index}>{index + 1}</span>}
      {track.cover && <img className={styles.cover} src={track.cover} alt="" loading="lazy" />}
      <div className={styles.info}>
        <span className={styles.name}>{track.name}</span>
        <span className={styles.artist}>{track.artist}</span>
      </div>
      <span className={styles.duration}>
        {track.duration ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, '0')}` : ''}
      </span>
    </button>
  )
}
