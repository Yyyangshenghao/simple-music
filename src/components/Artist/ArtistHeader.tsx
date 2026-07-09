import type { ArtistInfo } from '../../types/domain'
import styles from './ArtistHeader.module.css'

interface ArtistHeaderProps {
  artist: ArtistInfo
  onPlayAll(): void
}

export function ArtistHeader({ artist, onPlayAll }: ArtistHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.content}>
        {artist.avatar && (
          <img className={styles.avatar} src={artist.avatar} alt="" />
        )}
        <div className={styles.info}>
          <h1 className={styles.name}>{artist.name}</h1>
          <p className={styles.meta}>
            {artist.musicSize ? `${artist.musicSize} 首单曲` : ''}
          </p>
          <button className={`${styles.playAll} no-drag`} onClick={onPlayAll}>▶ 播放全部</button>
        </div>
      </div>
    </div>
  )
}
