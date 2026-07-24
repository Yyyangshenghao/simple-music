import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useSettingsStore } from '../stores/settings'
import { useNavigationStore } from '../stores/navigation'
import { getCachedToplistGroups, loadToplistGroups } from '../lib/toplist-cache'
import { ScrollArea } from '../components/ui/ScrollArea'
import { ToplistCard } from '../components/Explore/ToplistCard'
import { PlaylistPreviewModal } from '../components/Explore/PlaylistPreviewModal'
import { GradientText } from '../components/ui/GradientText'
import { fadeRise, springGentle, springSnappy, tapScale } from '../lib/motion-presets'
import type { ToplistGroup } from '../lib/music-service'
import type { Playlist } from '../types/domain'
import styles from './ToplistPage.module.css'

/** 全部榜单:服务端按主题分组(官方榜/云村特色/曲风/ACG/语种海外/更多),每组一片网格。
 *  卡片交互与探索页「榜单精选」完全一致(点开预览、封面钮直接播放整榜)。 */
export function ToplistPage() {
  const activeSource = useSettingsStore((s) => s.activeSource)
  const goBack = useNavigationStore((s) => s.goBack)
  // 探索页「榜单精选」刚拉过的话直接命中缓存,点进来就是完整网格(卡片随即开始后台预取各自的 Top3)
  const [groups, setGroups] = useState<ToplistGroup[]>(() => getCachedToplistGroups(activeSource) ?? [])
  const [loading, setLoading] = useState(() => !getCachedToplistGroups(activeSource))
  const [preview, setPreview] = useState<Playlist | null>(null)

  useEffect(() => {
    let cancelled = false
    const cached = getCachedToplistGroups(activeSource)
    setGroups(cached ?? [])
    setLoading(!cached)
    loadToplistGroups(activeSource)
      .then((gs) => { if (!cancelled) setGroups(gs) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeSource])

  return (
    <ScrollArea className={styles.page}>
      <motion.button
        className={`${styles.back} no-drag`}
        onClick={goBack}
        aria-label="返回上一页"
        whileTap={tapScale}
        transition={springSnappy}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span>返回</span>
      </motion.button>

      <motion.h1 className={styles.heading} variants={fadeRise} initial="hidden" animate="visible" transition={springGentle}>
        <GradientText>榜单精选</GradientText>
      </motion.h1>

      {groups.map((group) => (
        <section className={styles.group} key={group.title}>
          <h2 className={styles.groupTitle}>{group.title}</h2>
          <div className={styles.grid}>
            {group.entries.map((entry) => (
              <ToplistCard
                key={String(entry.playlist.id)}
                entry={entry}
                onOpen={() => setPreview(entry.playlist)}
              />
            ))}
          </div>
        </section>
      ))}

      {!loading && groups.length === 0 && <p className={styles.empty}>暂时拿不到榜单</p>}

      <PlaylistPreviewModal playlist={preview} onClose={() => setPreview(null)} />
    </ScrollArea>
  )
}
