import { useState, useEffect, useRef, useCallback } from 'react'
import type { Banner } from '../../types/domain'
import { usePlaylistStore } from '../../stores/playlist'
import styles from './HeroBanner.module.css'

interface HeroBannerProps {
  banners: Banner[]
}

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

export function HeroBanner({ banners }: HeroBannerProps) {
  const [idx, setIdx] = useState(0)
  const [bgColor, setBgColor] = useState('#10141e')
  const imgRef = useRef<HTMLImageElement>(null)

  const current = banners[idx]

  const onImgLoad = useCallback(() => {
    if (imgRef.current) setBgColor(extractColor(imgRef.current))
  }, [])

  useEffect(() => {
    if (banners.length <= 1) return
    const t = setInterval(() => setIdx((i) => (i + 1) % banners.length), 5000)
    return () => clearInterval(t)
  }, [banners.length])

  function play() {
    if (!current) return
    if (current.track) {
      usePlaylistStore.getState().setQueue([current.track], 0)
    }
  }

  if (!current) return null

  return (
    <div
      className={styles.hero}
      style={{ '--hero-bg': bgColor } as React.CSSProperties}
    >
      <div className={styles.bg} />
      <div className={styles.content}>
        <img
          ref={imgRef}
          className={styles.cover}
          src={current.cover}
          alt=""
          crossOrigin="anonymous"
          onLoad={onImgLoad}
        />
        <div className={styles.text}>
          <h1 className={styles.title}>{current.title}</h1>
          {current.subtitle && <p className={styles.subtitle}>{current.subtitle}</p>}
          {current.track && (
            <button className={`${styles.playBtn} no-drag`} onClick={play}>
              ▶ 立即播放
            </button>
          )}
        </div>
      </div>
      {banners.length > 1 && (
        <div className={styles.dots}>
          {banners.map((_, i) => (
            <button
              key={i}
              className={`${styles.dot} no-drag ${i === idx ? styles.dotActive : ''}`}
              onClick={() => setIdx(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
