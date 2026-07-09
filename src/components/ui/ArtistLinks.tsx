import { useNavigationStore } from '../../stores/navigation'
import type { Artist, MusicSource } from '../../types/domain'
import styles from './ArtistLinks.module.css'

interface ArtistLinksProps {
  /** 曲目的完整歌手列表(可能有多个,如 "周杰伦 / 温兆伦")。 */
  artists?: Artist[]
  /** artists 为空时的兜底文本(纯展示,不可点)。 */
  fallback?: string
  source: MusicSource
  className?: string
  /** 导航前的额外动作,如歌词页需先收起面板再跳转。 */
  onBeforeNavigate?: () => void
}

/** 多歌手逐个可点击跳转各自详情页:按 "/" 分隔渲染,而不是把整串歌手名绑定到第一位歌手的 id。 */
export function ArtistLinks({ artists, fallback, source, className, onBeforeNavigate }: ArtistLinksProps) {
  const navigateTo = useNavigationStore((s) => s.navigateTo)

  if (!artists || artists.length === 0) {
    return <span className={`${styles.row} ${className ?? ''}`}>{fallback ?? '—'}</span>
  }

  return (
    <span className={`${styles.row} ${className ?? ''}`}>
      {artists.map((a, i) => (
        <span key={`${String(a.id)}-${i}`}>
          {i > 0 && <span className={styles.sep}> / </span>}
          {a.id != null ? (
            <button
              type="button"
              className={`${styles.link} no-drag`}
              onClick={() => {
                onBeforeNavigate?.()
                navigateTo({ type: 'artist', id: a.id, source })
              }}
            >
              {a.name}
            </button>
          ) : (
            <span className={styles.plain}>{a.name}</span>
          )}
        </span>
      ))}
    </span>
  )
}
