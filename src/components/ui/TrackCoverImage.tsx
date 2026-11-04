import type { ReactNode } from 'react'
import { useTrackCover } from '../../hooks/useTrackCover'
import { sizedImage } from '../../lib/image-size'
import type { Track } from '../../types/domain'

interface TrackCoverImageProps {
  track: Track
  px: number
  className?: string
  /** 没有封面时的占位；不传则不渲染。 */
  fallback?: ReactNode
}

/** 列表里的曲目封面；哔哩哔哩曲目按设置显示匹配到的专辑封面。 */
export function TrackCoverImage({ track, px, className, fallback = null }: TrackCoverImageProps) {
  const cover = useTrackCover(track)
  return cover ? <img className={className} src={sizedImage(cover, px)} alt="" loading="lazy" /> : <>{fallback}</>
}
