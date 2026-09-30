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

const scrollPositions = new Map<string, number>()

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
  const pageRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const restoringScrollRef = useRef(false)
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

  useEffect(() => {
    const page = pageRef.current
    const content = contentRef.current
    const target = activeHomeSource ? scrollPositions.get(activeHomeSource) ?? 0 : 0
    if (!page || !content || !target || detail) {
      restoringScrollRef.current = false
      return
    }
    let restored = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    restoringScrollRef.current = true
    const removeListeners = () => {
      page.removeEventListener('wheel', cancel)
      page.removeEventListener('touchstart', cancel)
      page.removeEventListener('pointerdown', cancel)
      document.removeEventListener('keydown', cancelOnScrollKey)
      if (timeout) clearTimeout(timeout)
    }
    const cancel = () => {
      restored = true
      restoringScrollRef.current = false
      observer.disconnect()
      removeListeners()
    }
    const cancelOnScrollKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancel()
    }
    const observer = new ResizeObserver(() => {
      if (restored || page.scrollHeight - page.clientHeight < target - 1) return
      page.scrollTop = target
      if (page.scrollTop >= target - 1) cancel()
    })
    observer.observe(content)
    if (page.scrollHeight - page.clientHeight >= target - 1) {
      page.scrollTop = target
      if (page.scrollTop >= target - 1) cancel()
    }
    if (restored) return
    page.addEventListener('wheel', cancel, { once: true })
    page.addEventListener('touchstart', cancel, { once: true })
    page.addEventListener('pointerdown', cancel, { once: true })
    document.addEventListener('keydown', cancelOnScrollKey)
    timeout = setTimeout(() => { restored = true; observer.disconnect() }, 5000)
    return () => {
      cancel()
    }
  }, [activeHomeSource, detail])

  if (detail) {
    return <PlaylistDetailView playlist={detail.playlist} initialTracks={detail.tracks} layoutIdPrefix="explore-cover" />
  }

  return (
    <div ref={pageRef} className={styles.page} onScroll={(event) => {
      handleScroll(event)
      if (activeHomeSource && !restoringScrollRef.current) scrollPositions.set(activeHomeSource, event.currentTarget.scrollTop)
    }}>
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
      </motion.header>

      {activeHomeSource ? (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            ref={contentRef}
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
