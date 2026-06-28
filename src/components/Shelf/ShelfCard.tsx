import type { Playlist } from '../../types/domain'
import styles from './ShelfCard.module.css'

interface ShelfCardProps {
  playlist: Playlist
  onOpen: () => void
}

/** 单张歌单"书脊/封面"卡片：显示封面、歌单名、曲目数，点击触发 onOpen。 */
export function ShelfCard({ playlist, onOpen }: ShelfCardProps) {
  return (
    <button
      type="button"
      className={`${styles.card} no-drag`}
      onClick={onOpen}
      title={playlist.name}
    >
      <span className={styles.coverWrap}>
        {playlist.cover ? (
          <img className={styles.cover} src={playlist.cover} alt="" loading="lazy" />
        ) : (
          <span className={styles.cover} aria-hidden="true" />
        )}
        <span className={styles.spine} aria-hidden="true" />
        <span className={styles.gloss} aria-hidden="true" />
      </span>
      <span className={styles.meta}>
        <span className={styles.name}>{playlist.name}</span>
        <span className={styles.count}>{playlist.trackCount} 首</span>
      </span>
    </button>
  )
}
