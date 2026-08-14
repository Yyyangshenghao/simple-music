import type { MusicSource } from '../../types/domain'
import { HeartIcon } from './HeartIcon'
import styles from './PlaylistCoverFallback.module.css'

interface PlaylistCoverFallbackProps {
  name: string
  source: MusicSource
  className?: string
}

export function PlaylistCoverFallback({ name, source, className }: PlaylistCoverFallbackProps) {
  const favorite = /我喜欢|喜欢的音乐|favorite|liked/i.test(name)
  return (
    <div
      className={`${styles.cover}${className ? ` ${className}` : ''}`}
      data-kind={favorite ? 'favorite' : 'playlist'}
      data-source={source}
      aria-hidden="true"
    >
      <span className={styles.mark}>
        {favorite ? <HeartIcon filled size={42} /> : <span className={styles.note}>♪</span>}
      </span>
    </div>
  )
}
