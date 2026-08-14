import { useEffect, useState } from 'react'
import { providerFor } from '../../providers/registry'
import type { ProviderId } from '../../providers/types'
import type { Playlist } from '../../types/domain'
import styles from './RecentRail.module.css'
import { sizedImage } from '../../lib/image-size'
import { SourceBadge } from '../ui/SourceBadge'

interface RecentRailProps {
  source: ProviderId
  embedded?: boolean
  /** 点击卡片打开歌单预览小卡（复用 Stack 顶卡的预览弹窗）。 */
  onOpen(playlist: Playlist): void
}

/** 最近播放：网易账号级播放记录（record_recent_playlist）；未登录或无记录时整栏隐藏。 */
export function RecentRail({ source, embedded = false, onOpen }: RecentRailProps) {
  const history = providerFor(source).history
  const [playlists, setPlaylists] = useState<Playlist[]>([])

  useEffect(() => {
    // 音源切换时丢弃在途响应
    let cancelled = false
    setPlaylists([])
    history?.getRecentPlaylists?.()
      .then((pls) => { if (!cancelled) setPlaylists(pls) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [history, source])

  if (playlists.length === 0) return null

  return (
    <section className={`${styles.rail}${embedded ? ` ${styles.embedded}` : ''}`}>
      <h2 className={styles.title}>最近播放</h2>
      <div className={styles.row}>
        {playlists.map((pl) => (
          <button key={`${pl.source}:${String(pl.id)}`} className={`${styles.card} no-drag`} onClick={() => onOpen(pl)} title={pl.name}>
            {pl.cover
              ? <img className={styles.cover} src={sizedImage(pl.cover, 200)} alt="" loading="lazy" />
              : <div className={styles.cover} />}
            <SourceBadge source={pl.source} compact className={styles.sourceBadge} />
            <span className={styles.name}>{pl.name}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
