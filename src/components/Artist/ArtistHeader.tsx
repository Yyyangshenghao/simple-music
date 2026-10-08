import type { ArtistInfo } from '../../types/domain'
import styles from './ArtistHeader.module.css'
import { sizedImage } from '../../lib/image-size'
import { SourceBadge } from '../ui/SourceBadge'

interface ArtistHeaderProps {
  artist: ArtistInfo
  onPlayAll(): void
}

export function ArtistHeader({ artist, onPlayAll }: ArtistHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.content}>
        <div className={styles.identity}>
          {artist.avatar && (
            <img className={styles.avatar} src={sizedImage(artist.avatar, 320)} alt="" />
          )}
          <div className={styles.info}>
            <h1 className={styles.name}>{artist.name}</h1>
            <SourceBadge source={artist.source} reveal />
            <p className={styles.meta}>
              {artist.musicSize ? `${artist.musicSize} 首单曲` : ''}
            </p>
            <button className={`${styles.playAll} no-drag`} onClick={onPlayAll}>▶ 播放全部</button>
          </div>
        </div>
        {artist.description?.trim() && (
          <details className={styles.description}>
            <summary className="no-drag" aria-label="歌手简介">
              <span className={styles.descriptionHeading}>
                <span>歌手简介</span>
                <span className={styles.expand}>展开</span>
                <span className={styles.collapse}>收起</span>
              </span>
              <span className={styles.descriptionPreview}>{artist.description}</span>
            </summary>
            <p className="no-drag" tabIndex={0} aria-label="完整歌手简介">{artist.description}</p>
          </details>
        )}
      </div>
    </div>
  )
}
