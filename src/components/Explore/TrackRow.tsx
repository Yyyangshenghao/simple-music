import { usePlayerStore } from '../../stores/player'
import type { Track } from '../../types/domain'
import styles from './TrackRow.module.css'

interface TrackRowProps {
  track: Track
  index?: number
  onPlay(): void
}

/** 播放中指示：3 根氛围色动画柱，暂停时定格。 */
function EqIndicator({ paused }: { paused: boolean }) {
  return (
    <span className={`${styles.eq}${paused ? ` ${styles.eqPaused}` : ''}`} aria-hidden="true">
      <i /><i /><i />
    </span>
  )
}

export function TrackRow({ track, index, onPlay }: TrackRowProps) {
  // 窄布尔 selector：只在"是否当前曲目/是否播放中"变化时重渲染，不受高频 position 更新影响
  const isCurrent = usePlayerStore(
    (s) => s.currentTrack?.provider === track.provider && String(s.currentTrack?.id) === String(track.id)
  )
  const isPlaying = usePlayerStore(
    (s) =>
      s.status === 'playing' &&
      s.currentTrack?.provider === track.provider &&
      String(s.currentTrack?.id) === String(track.id)
  )

  return (
    <button className={`${styles.row}${isCurrent ? ` ${styles.rowActive}` : ''} no-drag`} onClick={onPlay}>
      {index !== undefined && (
        isCurrent
          ? <EqIndicator paused={!isPlaying} />
          : <span className={styles.index}>{index + 1}</span>
      )}
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
