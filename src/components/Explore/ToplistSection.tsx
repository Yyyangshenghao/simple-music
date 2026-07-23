import { useEffect, useState } from 'react'
import { useMusicService } from '../../hooks/useMusicService'
import { useNavigationStore } from '../../stores/navigation'
import { useScrollReveal } from '../../hooks/useScrollReveal'
import { GradientText } from '../ui/GradientText'
import { ToplistCard } from './ToplistCard'
import type { ToplistGroup } from '../../lib/music-service'
import type { Playlist } from '../../types/domain'
import styles from './ToplistSection.module.css'

interface ToplistSectionProps {
  onOpen(playlist: Playlist): void
}

/** 探索页只露头部若干张,其余进「榜单精选」全部页。 */
const PREVIEW_COUNT = 4

/** 榜单精选:双列卡片(榜名 + Top3 预览),标题可点进全部榜单页。
 *  可选实现,未实现的音源(QQ)整栏不渲染。 */
export function ToplistSection({ onOpen }: ToplistSectionProps) {
  const service = useMusicService()
  const [groups, setGroups] = useState<ToplistGroup[]>([])
  const ref = useScrollReveal<HTMLElement>()

  useEffect(() => {
    // 音源切换时丢弃在途响应
    let cancelled = false
    setGroups([])
    service.getToplists?.()
      .then((gs) => { if (!cancelled) setGroups(gs) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [service])

  const entries = groups.flatMap((g) => g.entries).slice(0, PREVIEW_COUNT)
  if (entries.length === 0) return null

  return (
    <section className={styles.section} ref={ref}>
      <button
        className={`${styles.title} no-drag`}
        onClick={() => useNavigationStore.getState().navigateTo({ type: 'toplist' })}
        aria-label="查看全部榜单"
      >
        <GradientText>榜单精选</GradientText>
        <span className={styles.chevron} aria-hidden="true">›</span>
      </button>

      <div className={styles.grid}>
        {entries.map((entry) => (
          <ToplistCard
            key={String(entry.playlist.id)}
            entry={entry}
            onOpen={() => onOpen(entry.playlist)}
          />
        ))}
      </div>
    </section>
  )
}
