import { useEffect, useState } from 'react'
import { useMusicService } from '../../hooks/useMusicService'
import type { Playlist } from '../../types/domain'
import styles from './RecentRail.module.css'

interface RecentRailProps {
  /** 点击卡片打开歌单预览小卡（复用 Stack 顶卡的预览弹窗）。 */
  onOpen(playlist: Playlist): void
}

/** 最近播放：网易账号级播放记录（record_recent_playlist）；未登录或无记录时整栏隐藏。 */
export function RecentRail({ onOpen }: RecentRailProps) {
  const service = useMusicService()
  const [playlists, setPlaylists] = useState<Playlist[]>([])

  useEffect(() => {
    // 音源切换时丢弃在途响应
    let cancelled = false
    setPlaylists([])
    service.getRecentPlaylists?.()
      .then((pls) => { if (!cancelled) setPlaylists(pls) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [service])

  if (playlists.length === 0) return null

  return (
    <section className={styles.rail}>
      <h2 className={styles.title}>最近播放</h2>
      <div className={styles.row}>
        {playlists.map((pl) => (
          <button key={String(pl.id)} className={`${styles.card} no-drag`} onClick={() => onOpen(pl)} title={pl.name}>
            {pl.cover
              ? <img className={styles.cover} src={pl.cover} alt="" loading="lazy" />
              : <div className={styles.cover} />}
            <span className={styles.name}>{pl.name}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
