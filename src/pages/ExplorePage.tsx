import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useScrollGradient } from '../hooks/useScrollGradient'
import { useNavigationStore } from '../stores/navigation'
import { useContentProvider } from '../hooks/useContentProvider'
import { ProviderRecommendationSection } from '../components/Explore/ProviderRecommendationSection'
import { PlaylistPreviewModal } from '../components/Explore/PlaylistPreviewModal'
import { PlaylistDetailView } from '../components/Playlist/PlaylistDetailView'
import { GradientText } from '../components/ui/GradientText'
import { fadeRise, springGentle } from '../lib/motion-presets'
import type { Playlist } from '../types/domain'
import styles from './ExplorePage.module.css'

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function ExplorePage() {
  const { sources: enabledSources, current: activeHomeSource } = useContentProvider()
  const [preview, setPreview] = useState<Playlist | null>(null)
  const previousSourceRef = useRef(activeHomeSource)
  const currentView = useNavigationStore((state) => state.currentView)
  const detail = typeof currentView === 'object'
    && currentView.type === 'playlist'
    && currentView.from === 'explore'
    ? currentView
    : null
  const { topOpacity, bottomOpacity, handleScroll, setTopOpacity, setBottomOpacity } = useScrollGradient()

  useEffect(() => {
    setTopOpacity(0)
    setBottomOpacity(0)
  }, [detail, setTopOpacity, setBottomOpacity])

  const previousSource = previousSourceRef.current
  const previousIndex = previousSource ? enabledSources.indexOf(previousSource) : 0
  const activeIndex = activeHomeSource ? enabledSources.indexOf(activeHomeSource) : 0
  const switchDirection = activeIndex >= previousIndex ? 1 : -1

  useEffect(() => {
    previousSourceRef.current = activeHomeSource
  }, [activeHomeSource])

  if (detail) {
    return <PlaylistDetailView playlist={detail.playlist} initialTracks={detail.tracks} layoutIdPrefix="explore-cover" />
  }

  return (
    <div className={styles.page} onScroll={handleScroll}>
      <div className="topGradient" style={{ opacity: topOpacity }} />

      <motion.header
        className={styles.intro}
        variants={fadeRise}
        initial="hidden"
        animate="visible"
        transition={springGentle}
      >
        <p className={styles.kicker}>YOUR MUSIC CONSTELLATION</p>
        <h1 className={styles.greeting}><GradientText>{greeting()}</GradientText></h1>
        <p className={styles.summary}>
          {enabledSources.length > 0
            ? `${enabledSources.length} 个音乐平台已启用 · 每个平台保留自己的推荐方式`
            : '还没有启用音乐平台'}
        </p>
      </motion.header>

      {activeHomeSource ? (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeHomeSource}
            initial={{ opacity: 0, y: switchDirection * 44, filter: 'blur(7px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: switchDirection * -36, filter: 'blur(5px)' }}
            transition={springGentle}
          >
            <ProviderRecommendationSection
              source={activeHomeSource}
              onPreview={setPreview}
            />
          </motion.div>
        </AnimatePresence>
      ) : (
        <div className={styles.noProviders}>
          <p>先登录音乐平台，再到设置中明确启用；推荐内容才会出现在这里。</p>
          <button className="no-drag" onClick={() => useNavigationStore.getState().navigateTo('settings')}>
            打开音源设置
          </button>
        </div>
      )}

      <div className={styles.bottomSpace} />
      <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
      <PlaylistPreviewModal playlist={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
