import { forwardRef, type MouseEvent } from 'react'
import { motion } from 'motion/react'
import { tapScale, springSnappy } from '../../lib/motion-presets'
import { sizedImage } from '../../lib/image-size'
import { CheckIcon } from '../ui/CheckIcon'
import type { ArtistInfo } from '../../types/domain'
import styles from './ArtistPill.module.css'

interface ArtistPillProps {
  artist: ArtistInfo
  selected?: boolean
  disabled?: boolean
  size?: 'sm' | 'md'
  onClick(e: MouseEvent<HTMLButtonElement>): void
}

/** 圆形头像 + 名字的歌手胶囊，漫游页猜歌手 rail 与相似歌手气泡共用。 */
export const ArtistPill = forwardRef<HTMLButtonElement, ArtistPillProps>(function ArtistPill(
  { artist, selected, disabled, size = 'md', onClick },
  ref
) {
  return (
    <motion.button
      ref={ref}
      className={`${styles.pill} ${size === 'sm' ? styles.sm : ''} ${selected ? styles.selected : ''} no-drag`}
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : tapScale}
      transition={springSnappy}
      title={artist.name}
    >
      <span className={styles.avatarWrap}>
        {artist.avatar
          ? <img className={styles.avatar} src={sizedImage(artist.avatar, size === 'sm' ? 112 : 152)} alt="" loading="lazy" decoding="async" draggable={false} />
          : <div className={styles.avatarFallback}>{artist.name.slice(0, 1)}</div>}
        {selected && (
          <span className={styles.selectedBadge} aria-hidden="true">
            <CheckIcon size={size === 'sm' ? 9 : 11} />
          </span>
        )}
      </span>
      <span className={styles.name}>{artist.name}</span>
    </motion.button>
  )
})
