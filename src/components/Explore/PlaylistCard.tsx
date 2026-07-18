import { memo } from 'react'
import { motion } from 'motion/react'
import { BorderGlow } from '../BorderGlow/BorderGlow'
import { TiltCard } from '../ui/TiltCard'
import { springGentle } from '../../lib/motion-presets'
import type { Playlist } from '../../types/domain'
import styles from './PlaylistCard.module.css'

interface PlaylistCardProps {
  playlist: Playlist
  onClick(): void
  /** 传入时封面参与共享元素转场（与详情页头部封面同 ID）。 */
  layoutId?: string
}

export const PlaylistCard = memo(function PlaylistCard({ playlist, onClick, layoutId }: PlaylistCardProps) {
  return (
    <TiltCard className={styles.glowWrap}>
      <BorderGlow borderRadius={16}>
        <button className={`${styles.card} no-drag`} onClick={onClick}>
          <motion.div className={styles.coverWrap} layoutId={layoutId} transition={springGentle}>
            {playlist.cover
              ? <img className={styles.cover} src={playlist.cover} alt="" loading="lazy" />
              : <div className={styles.coverFallback} />}
          </motion.div>
          <p className={styles.name}>{playlist.name}</p>
          <p className={styles.meta}>{playlist.trackCount} 首</p>
        </button>
      </BorderGlow>
    </TiltCard>
  )
})
