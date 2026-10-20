import type { ReactNode } from 'react'
import { usePlayerStore } from '../../stores/player'
import { ArtistLinks } from '../ui/ArtistLinks'
import styles from './TrackInfo.module.css'
import { sizedImage } from '../../lib/image-size'

interface TrackInfoProps {
  onCoverClick?: () => void
  onArtistNavigate?: () => void
  /** 紧跟歌名的小操作（红心、加入歌单），歌名过长时先省略歌名。 */
  titleAccessory?: ReactNode
}

/** 播放栏左侧：封面 + 曲名 + 歌手。无当前曲目时显示占位。封面可点击打开歌词面板。 */
export function TrackInfo({ onCoverClick, onArtistNavigate, titleAccessory }: TrackInfoProps) {
  const track = usePlayerStore((s) => s.currentTrack)

  return (
    <div className={styles.info}>
      <div
        className={`${styles.cover} no-drag`}
        data-dock-cover
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
        {onCoverClick && (
          <span className={styles.coverHint} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 14l5-5 5 5" />
            </svg>
          </span>
        )}
      </div>
      <div className={styles.meta}>
        <div className={styles.titleRow}>
          <span className={styles.name} title={track?.name}>
            {track?.name ?? '未在播放'}
          </span>
          {titleAccessory}
        </div>
        <ArtistLinks
          className={styles.artist}
          artists={track?.artists}
          fallback={track?.artist ?? '—'}
          source={track?.source ?? 'netease'}
          onBeforeNavigate={onArtistNavigate}
        />
      </div>
    </div>
  )
}
