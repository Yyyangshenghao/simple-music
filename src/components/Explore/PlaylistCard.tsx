import { memo } from 'react'
import { motion } from 'motion/react'
import { BorderGlow } from '../BorderGlow/BorderGlow'
import { TiltCard } from '../ui/TiltCard'
import { albumCoverTransition, springGentle } from '../../lib/motion-presets'
import type { Playlist } from '../../types/domain'
import styles from './PlaylistCard.module.css'
import { sizedImage } from '../../lib/image-size'
import { SourceBadge } from '../ui/SourceBadge'
import { PlaylistCoverFallback } from '../ui/PlaylistCoverFallback'

interface PlaylistCardProps {
  playlist: Playlist
  onClick(): void
  /** 上游没有可靠曲目数时，可传入辅助信息；空字符串隐藏辅助文字。 */
  meta?: string
  selectionMode?: boolean
  /** 传入时封面参与共享元素转场（与详情页头部封面同 ID）。 */
  layoutId?: string
}

export const PlaylistCard = memo(function PlaylistCard({ playlist, onClick, meta, layoutId, selectionMode = false }: PlaylistCardProps) {
  const displayMeta = meta ?? (playlist.trackCountKnown === false ? '查看歌曲' : `${playlist.trackCount} 首`)
  return (
    <TiltCard className={styles.glowWrap} disabled={selectionMode}>
      <BorderGlow borderRadius={16}>
        <button
          className={`${styles.card} no-drag`}
          onClick={onClick}
          aria-label={`${playlist.type === 'album' ? '专辑' : '歌单'}：${playlist.name}${displayMeta ? `，${displayMeta}` : ''}`}
        >
          <motion.div
            className={styles.coverWrap}
            layoutId={playlist.type === 'album' ? `album-cover-${playlist.source}-${String(playlist.id)}` : layoutId}
            layoutCrossfade={false}
            transition={playlist.type === 'album' ? albumCoverTransition : springGentle}
            style={{ borderRadius: 12 }}
          >
            {playlist.cover
              ? <img className={styles.cover} src={sizedImage(playlist.cover, 512)} alt="" loading="lazy" />
              : <PlaylistCoverFallback name={playlist.name} source={playlist.source} />}
            <SourceBadge source={playlist.source} className={styles.sourceBadge} />
          </motion.div>
          <p className={styles.name}>{playlist.name}</p>
          {displayMeta && <p className={styles.meta}>{displayMeta}</p>}
        </button>
      </BorderGlow>
    </TiltCard>
  )
})
