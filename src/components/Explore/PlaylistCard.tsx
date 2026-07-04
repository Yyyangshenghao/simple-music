import { BorderGlow } from '../BorderGlow/BorderGlow'
import { TiltCard } from '../ui/TiltCard'
import type { Playlist } from '../../types/domain'
import styles from './PlaylistCard.module.css'

interface PlaylistCardProps {
  playlist: Playlist
  onClick(): void
}

export function PlaylistCard({ playlist, onClick }: PlaylistCardProps) {
  return (
    <TiltCard className={styles.glowWrap}>
      <BorderGlow borderRadius={16}>
        <button className={`${styles.card} no-drag`} onClick={onClick}>
          <div className={styles.coverWrap}>
            {playlist.cover
              ? <img className={styles.cover} src={playlist.cover} alt="" loading="lazy" />
              : <div className={styles.coverFallback} />}
          </div>
          <p className={styles.name}>{playlist.name}</p>
          <p className={styles.meta}>{playlist.trackCount} 首</p>
        </button>
      </BorderGlow>
    </TiltCard>
  )
}
