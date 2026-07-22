import { formatDuration } from '../../lib/format-duration'
import type { Track } from '../../types/domain'
import styles from './SearchResults.module.css'

interface SearchResultsProps {
  results: Track[]
  onPick: (index: number) => void
}

/** 搜索结果列表：每项封面/名/歌手/时长，点击回调下标。 */
export function SearchResults({ results, onPick }: SearchResultsProps) {
  return (
    <ul className={styles.list}>
      {results.map((track, index) => (
        <li key={`${String(track.id)}-${index}`}>
          <button
            type="button"
            className={`${styles.item} no-drag`}
            onClick={() => onPick(index)}
          >
            {track.cover ? (
              <img className={styles.cover} src={track.cover} alt="" loading="lazy" />
            ) : (
              <span className={styles.cover} aria-hidden="true" />
            )}
            <span className={styles.info}>
              <span className={styles.name} title={track.name}>
                {track.name}
              </span>
              <span className={styles.artist} title={track.artist}>
                {track.artist}
              </span>
            </span>
            <span className={styles.duration}>{formatDuration(track.duration, '--:--')}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
