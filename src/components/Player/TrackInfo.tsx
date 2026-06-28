import { usePlayerStore } from '../../stores/player'
import styles from './TrackInfo.module.css'

/** 播放栏左侧：封面 + 曲名 + 歌手。无当前曲目时显示占位。 */
export function TrackInfo() {
  const track = usePlayerStore((s) => s.currentTrack)

  return (
    <div className={styles.info}>
      <div className={styles.cover}>
        {track?.cover ? (
          <img className={styles.coverImg} src={track.cover} alt={track.name} draggable={false} />
        ) : (
          <span className={styles.coverPlaceholder} aria-hidden="true">
            ♪
          </span>
        )}
      </div>
      <div className={styles.meta}>
        <span className={styles.name} title={track?.name}>
          {track?.name ?? '未在播放'}
        </span>
        <span className={styles.artist} title={track?.artist}>
          {track?.artist ?? '—'}
        </span>
      </div>
    </div>
  )
}
