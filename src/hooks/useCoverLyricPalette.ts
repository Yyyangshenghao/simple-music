import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { sizedImage, CANVAS_COVER_PX } from '../lib/image-size'
import { lyricPaletteFromCoverPixels, silverBlueLyricPalette } from '../lib/lyric-palette'

const FALLBACK_PALETTE = silverBlueLyricPalette()

/** 舞台与聚焦歌词共享封面取色，切歌时丢弃上一张封面的结果。 */
export function useCoverLyricPalette(coverUrl?: string) {
  const [result, setResult] = useState(() => ({ coverUrl, palette: FALLBACK_PALETTE }))
  useEffect(() => {
    if (!coverUrl) return
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const applyFallback = () => {
      if (!cancelled) setResult({ coverUrl, palette: FALLBACK_PALETTE })
    }
    img.onload = () => {
      if (cancelled) return
      try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 64
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          applyFallback()
          return
        }
        ctx.drawImage(img, 0, 0, 64, 64)
        setResult({ coverUrl, palette: lyricPaletteFromCoverPixels(ctx.getImageData(0, 0, 64, 64).data, 64, 64) })
      } catch {
        applyFallback()
      }
    }
    img.onerror = applyFallback
    img.src = api.coverImage(sizedImage(coverUrl, CANVAS_COVER_PX))
    return () => {
      cancelled = true
      img.onload = img.onerror = null
      img.src = ''
    }
  }, [coverUrl])
  return result.coverUrl === coverUrl && coverUrl ? result.palette : FALLBACK_PALETTE
}
