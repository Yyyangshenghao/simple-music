import { useRef, useState } from 'react'
import type { ArtistInfo } from '../../types/domain'
import { extractColor } from '../../lib/extract-color'
import styles from './ArtistHeader.module.css'

interface ArtistHeaderProps {
  artist: ArtistInfo
  onPlayAll(): void
}

export function ArtistHeader({ artist, onPlayAll }: ArtistHeaderProps) {
  const [bgColor, setBgColor] = useState('#10141e')
  const imgRef = useRef<HTMLImageElement>(null)

  return (
    <div className={styles.header} style={{ '--artist-bg': bgColor } as React.CSSProperties}>
      <div className={styles.bg} />
      <div className={styles.content}>
        {artist.avatar && (
          <img
            ref={imgRef}
            className={styles.avatar}
            src={artist.avatar}
            alt=""
            crossOrigin="anonymous"
            onLoad={() => { if (imgRef.current) setBgColor(extractColor(imgRef.current)) }}
          />
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
