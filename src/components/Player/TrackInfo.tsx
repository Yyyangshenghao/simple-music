import { usePlayerStore } from '../../stores/player'
import { ArtistLinks } from '../ui/ArtistLinks'
import styles from './TrackInfo.module.css'
import { sizedImage } from '../../lib/image-size'

interface TrackInfoProps {
  onCoverClick?: () => void
}

/** 播放栏左侧：封面 + 曲名 + 歌手。无当前曲目时显示占位。封面可点击打开歌词面板。 */
export function TrackInfo({ onCoverClick }: TrackInfoProps) {
  const track = usePlayerStore((s) => s.currentTrack)

  return (
    <div className={styles.info}>
      <div
        className={`${styles.cover} no-drag`}
        onClick={onCoverClick}
        role={onCoverClick ? 'button' : undefined}
        tabIndex={onCoverClick ? 0 : undefined}
        onKeyDown={
          onCoverClick
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') onCoverClick()
              }
            : undefined
        }
        aria-label={onCoverClick ? '查看歌词' : undefined}
        style={onCoverClick ? { cursor: 'pointer' } : undefined}
      >
        {track?.cover ? (
          <img className={styles.coverImg} src={sizedImage(track.cover, 128)} alt={track.name} draggable={false} />
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
        <ArtistLinks
          className={styles.artist}
          artists={track?.artists}
          fallback={track?.artist ?? '—'}
          source={track?.source ?? 'netease'}
        />
      </div>
    </div>
  )
}
