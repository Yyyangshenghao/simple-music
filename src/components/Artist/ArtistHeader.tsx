import { useRef, useState } from 'react'
import type { ArtistInfo } from '../../types/domain'
import styles from './ArtistHeader.module.css'

function extractColor(img: HTMLImageElement): string {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 16; canvas.height = 16
    const ctx = canvas.getContext('2d')
    if (!ctx) return '#10141e'
    ctx.drawImage(img, 0, 0, 16, 16)
    const d = ctx.getImageData(4, 4, 8, 8).data
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; n++ }
    return `rgb(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)})`
  } catch { return '#10141e' }
}

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
