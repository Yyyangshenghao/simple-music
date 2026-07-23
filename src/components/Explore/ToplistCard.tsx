import { memo, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { loadPlaylistQueue } from '../../hooks/useLazyPlaylist'
import { usePlaylistStore } from '../../stores/playlist'
import { serviceFor } from '../../lib/service-registry'
import { springGentle } from '../../lib/motion-presets'
import type { ToplistEntry, ToplistPreviewTrack } from '../../lib/music-service'
import styles from './ToplistCard.module.css'

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.6c0-.9 1-1.5 1.8-1l7.7 5.4a1.2 1.2 0 0 1 0 2L5.8 14.4c-.8.5-1.8-.1-1.8-1V2.6z" fill="currentColor" />
    </svg>
  )
}

interface ToplistCardProps {
  entry: ToplistEntry
  /** 点击卡片主体：打开榜单详情。 */
  onOpen(): void
}

/**
 * 榜单精选卡片:榜名 + 更新节奏 + 叠层封面 + Top3 预览。
 * 整卡点击进详情,封面上的圆钮直接把整榜灌进播放队列(不进详情页)。
 */
export const ToplistCard = memo(function ToplistCard({ entry, onOpen }: ToplistCardProps) {
  const [loading, setLoading] = useState(false)
  const { playlist, updateFrequency } = entry
  const [preview, setPreview] = useState<ToplistPreviewTrack[]>(entry.preview)
  /** 预览是否已有定论：false 时铺骨架行，避免补拉期间卡片先塌成一行又弹回去。 */
  const [resolved, setResolved] = useState(entry.preview.length > 0)
  const cardRef = useRef<HTMLElement>(null)

  // 上游只对少数榜单直接给 Top3，其余等卡片进视口再补：一次性替 38 个榜拉预览会把上游打崩
  useEffect(() => {
    setPreview(entry.preview)
    setResolved(entry.preview.length > 0)
    if (entry.preview.length > 0) return
    const el = cardRef.current
    if (!el) return
    let cancelled = false
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        io.disconnect()
        // 榜单可能来自另一音源(导航历史/缓存)，按数据自身 source 取 service
        const service = serviceFor(entry.playlist.source)
        if (!service.getToplistPreview) { setResolved(true); return }
        service.getToplistPreview(entry.playlist.id)
          .then((tracks) => { if (!cancelled) setPreview(tracks) })
          .catch(() => {})
          .finally(() => { if (!cancelled) setResolved(true) })
      },
      { rootMargin: '200px' }
    )
    io.observe(el)
    return () => { cancelled = true; io.disconnect() }
  }, [entry])

  async function play(e: React.MouseEvent) {
    // 播放钮嵌在可点击的卡片里,不拦截会连带触发详情导航
    e.stopPropagation()
    if (loading) return
    setLoading(true)
    try {
      const queue = await loadPlaylistQueue(playlist)
      if (queue.length) usePlaylistStore.getState().setQueue(queue, 0, playlist.id)
    } catch {
      // 拉取失败静默忽略:详情页里还能重试
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.article
      ref={cardRef}
      className={`${styles.card} no-drag`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      whileHover={{ y: -3 }}
      transition={springGentle}
      aria-label={`${playlist.name},共 ${playlist.trackCount} 首`}
    >
      <header className={styles.head}>
        <h3 className={styles.name}>{playlist.name}</h3>
        {updateFrequency && <span className={styles.freq}>{updateFrequency}</span>}
      </header>

      <div className={styles.body}>
        <div className={styles.coverWrap}>
          {/* 两层错位薄片:模仿一叠唱片，暗示这张卡背后是一整个榜单而不是单曲 */}
          <span className={styles.sheetBack} />
          <span className={styles.sheetMid} />
          {playlist.cover
            ? <img className={styles.cover} src={playlist.cover} alt="" loading="lazy" />
            : <span className={`${styles.cover} ${styles.coverFallback}`} />}
          <button
            className={`${styles.playBtn} no-drag`}
            onClick={play}
            aria-label={`播放${playlist.name}`}
            title="播放整个榜单"
          >
            {loading ? <span className={styles.spinner} /> : <PlayIcon />}
          </button>
        </div>

        <ol className={styles.list}>
          {preview.length > 0
            ? preview.map((t, i) => (
                <li className={styles.row} key={`${t.name}-${i}`}>
                  <span className={styles.rank}>{i + 1}</span>
                  <span className={styles.song} title={`${t.name} - ${t.artist}`}>
                    {t.name}
                    {t.artist && <span className={styles.artist}> – {t.artist}</span>}
                  </span>
                </li>
              ))
            : resolved
              ? <li className={styles.empty}>{playlist.trackCount} 首</li>
              : [0, 1, 2].map((i) => (
                  <li className={styles.row} key={i}>
                    <span className={styles.rank}>{i + 1}</span>
                    <span className={styles.skeleton} style={{ width: `${72 - i * 12}%` }} />
                  </li>
                ))}
        </ol>
      </div>
    </motion.article>
  )
})
