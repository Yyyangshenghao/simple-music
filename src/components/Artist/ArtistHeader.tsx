import { useId, useRef, useState } from 'react'
import type { ArtistInfo } from '../../types/domain'
import styles from './ArtistHeader.module.css'
import { sizedImage } from '../../lib/image-size'
import { SourceBadge } from '../ui/SourceBadge'
import { RevealText } from '../ui/RevealText'
import { ActionButton } from '../ui/ActionButton'

interface ArtistHeaderProps {
  artist: ArtistInfo
  onPlayAll(): void
  canPlay?: boolean
}

export function ArtistHeader({ artist, onPlayAll, canPlay = true }: ArtistHeaderProps) {
  const [expanded, setExpanded] = useState(false)
  const descriptionId = useId()
  const descriptionTrigger = useRef<HTMLButtonElement>(null)
  return (
    <div className={styles.header}>
      <div className={styles.content}>
        <div className={styles.identity}>
          {artist.avatar ? <img className={styles.avatar} src={sizedImage(artist.avatar, 320)} alt="" />
            : <span className={`${styles.avatar} ${styles.avatarFallback}`} aria-hidden="true">{artist.name.slice(0, 1)}</span>}
          <div className={styles.info}>
            <h1 className={styles.name}>{artist.name}</h1>
            <div className={styles.meta}>
              <SourceBadge source={artist.source} reveal />
              {!!artist.musicSize && <span>{artist.musicSize} 首单曲</span>}
            </div>
            <ActionButton className={styles.playAll} label="播放全部" icon="play" primary disabled={!canPlay} onClick={onPlayAll} />
          </div>
        </div>
        {artist.description?.trim() && (
          <section className={styles.description} data-open={expanded} onKeyDown={(event) => {
            if (event.key !== 'Escape' || !expanded) return
            event.preventDefault()
            event.stopPropagation()
            setExpanded(false)
            descriptionTrigger.current?.focus()
          }}>
            <button ref={descriptionTrigger} type="button" className={`${styles.descriptionTrigger} no-drag`} aria-label="歌手简介"
              aria-expanded={expanded} aria-controls={descriptionId} onClick={() => setExpanded((value) => !value)}>
              <span className={styles.descriptionHeading}>
                <span>歌手简介</span>
                <span className={styles.expand}>展开</span>
                <span className={styles.collapse}>收起</span>
              </span>
            </button>
            <div className={styles.descriptionBody}>
              <p className={styles.descriptionPreview} aria-hidden={expanded}>{artist.description}</p>
              <p id={descriptionId} className={`${styles.descriptionFull} no-drag`} tabIndex={expanded ? 0 : -1}
                aria-label="完整歌手简介" aria-hidden={!expanded}><RevealText text={artist.description} /></p>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
