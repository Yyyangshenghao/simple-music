import { memo, type ReactNode } from 'react'
import { motion, type Transition } from 'motion/react'
import { BorderGlow } from '../BorderGlow/BorderGlow'
import { TiltCard } from '../ui/TiltCard'
import { albumCoverTransition, coverReturnTransition, springGentle } from '../../lib/motion-presets'
import { useNavigationStore } from '../../stores/navigation'
import type { Playlist } from '../../types/domain'
import styles from './PlaylistCard.module.css'
import { sizedImage } from '../../lib/image-size'
import { SourceBadge } from '../ui/SourceBadge'
import { PlaylistCoverFallback } from '../ui/PlaylistCoverFallback'
import { QQLikedCoverOverlay } from '../ui/QQLikedCoverOverlay'
import { getCachedPlaylistTrackCount } from '../../hooks/useLazyPlaylist'

interface PlaylistCardProps {
  playlist: Playlist
  onClick(): void
  /** 上游没有可靠曲目数时，可传入辅助信息；空字符串隐藏辅助文字。 */
  meta?: string
  selectionMode?: boolean
  /** 传入时封面参与共享元素转场（与详情页头部封面同 ID）。 */
  layoutId?: string
  /** 指定时仅在依赖变化时测量布局，避免异步结果到达时封面自行移动。 */
  layoutDependency?: string
}

/** 歌单类卡片外壳：倾斜 + 边缘光 + 共享封面转场；平台歌单与应用歌单共用，只替换封面与附加信息。 */
export function CollectionCard({ ariaLabel, onClick, cover, coverLayoutId, coverTransition, layoutDependency, name, meta, metaTitle, footer, selectionMode = false }: {
  ariaLabel: string
  onClick(): void
  cover: ReactNode
  coverLayoutId?: string
  coverTransition: Transition
  layoutDependency?: string
  name: string
  meta?: string
  metaTitle?: string
  footer?: ReactNode
  selectionMode?: boolean
}) {
  return (
    <TiltCard className={styles.glowWrap} disabled={selectionMode}>
      <BorderGlow borderRadius={16}>
        <button className={`${styles.card} no-drag`} onClick={onClick} aria-label={ariaLabel}>
          <motion.div
            className={styles.coverWrap}
            layoutId={coverLayoutId}
            layoutDependency={layoutDependency}
            layoutCrossfade={false}
            transition={coverTransition}
            style={{ borderRadius: 12 }}
          >
            {cover}
          </motion.div>
          <p className={styles.name} title={name}>{name}</p>
          {meta && <p className={styles.meta} title={metaTitle}>{meta}</p>}
          {footer}
        </button>
      </BorderGlow>
    </TiltCard>
  )
}

export const PlaylistCard = memo(function PlaylistCard({ playlist, onClick, meta, layoutId, layoutDependency, selectionMode = false }: PlaylistCardProps) {
  const returning = useNavigationStore((state) => state.lastAction === 'pop')
  const cachedCount = meta === undefined ? getCachedPlaylistTrackCount(playlist) : undefined
  const reported = playlist.source !== 'local' && playlist.type !== 'album'
  const displayMeta = meta ?? (cachedCount !== undefined ? `${cachedCount} 首`
    : playlist.trackCountKnown === false ? '查看歌曲' : `${playlist.trackCount} 首`)
  const countTitle = meta !== undefined || playlist.trackCountKnown === false && cachedCount === undefined ? undefined
    : cachedCount !== undefined ? '以实际读取的歌曲列表计数，包含暂不可播放的歌曲'
      : reported ? '平台返回的汇总数量，打开后按实际读取的歌曲列表计数' : undefined
  return (
    <CollectionCard
      ariaLabel={`${playlist.type === 'album' ? '专辑' : '歌单'}：${playlist.name}${displayMeta ? `，${displayMeta}` : ''}`}
      onClick={onClick}
      selectionMode={selectionMode}
      coverLayoutId={playlist.type === 'album' ? `album-cover-${playlist.source}-${String(playlist.id)}` : layoutId}
      layoutDependency={layoutDependency}
      coverTransition={returning ? coverReturnTransition : playlist.type === 'album' ? albumCoverTransition : springGentle}
      cover={<>
        {playlist.cover
          ? <img className={styles.cover} src={sizedImage(playlist.cover, 512)} alt="" loading="lazy" />
          : <PlaylistCoverFallback name={playlist.name} source={playlist.source} />}
        {playlist.cover && <QQLikedCoverOverlay playlist={playlist} />}
        <SourceBadge source={playlist.source} className={styles.sourceBadge} />
      </>}
      name={playlist.name}
      meta={displayMeta}
      metaTitle={countTitle}
    />
  )
})
