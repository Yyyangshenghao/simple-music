import { useState, useEffect, useRef, useCallback } from 'react'
import { BorderGlow } from '../BorderGlow/BorderGlow'
import type { Banner } from '../../types/domain'
import { usePlaylistStore } from '../../stores/playlist'
import { extractColor } from '../../lib/extract-color'
import styles from './HeroBanner.module.css'

interface HeroBannerProps {
  banners: Banner[]
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
    <BorderGlow borderRadius={0} glowRadius={60} glowIntensity={0.5} edgeSensitivity={20}>
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
    </BorderGlow>
  )
}
