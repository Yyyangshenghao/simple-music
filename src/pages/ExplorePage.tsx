import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { useNavigationStore, type AppView } from '../stores/navigation'
import { useContentProvider } from '../hooks/useContentProvider'
import { ProviderRecommendationSection } from '../components/Explore/ProviderRecommendationSection'
import { PlaylistPreviewModal } from '../components/Explore/PlaylistPreviewModal'
import { PlaylistDetailView } from '../components/Playlist/PlaylistDetailView'
import { ListScrollActivity, observeCardScrollActivity } from '../components/ui/list-scroll-activity'
import { GradientText } from '../components/ui/GradientText'
import { pageTransition } from '../lib/motion-presets'
import { providerAccountSession } from '../lib/provider-account-session'
import type { Playlist } from '../types/domain'
import styles from './ExplorePage.module.css'
import pageScroll from '../styles/page-scroll.module.css'
import { usePageTransition } from '../hooks/useMotion'

const scrollPositions = new Map<string, { session: number; top: number }>()

// 滚动状态只通知卡片，避免动画容器重渲染后广播封面布局测量。
function ExploreScrollActivity({ scrollRef, children }: { scrollRef: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const [scrolling, setScrolling] = useState(false)
  useEffect(() => {
    const page = scrollRef.current
    if (!page) return
    const stop = observeCardScrollActivity(page, (active) => {
      page.toggleAttribute('data-explore-scrolling', active)
      setScrolling(active)
    })
    return () => {
      stop()
      page.removeAttribute('data-explore-scrolling')
    }
  }, [scrollRef])
  return <ListScrollActivity.Provider value={scrolling}>{children}</ListScrollActivity.Provider>
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function ExplorePage({ detail = null }: { detail?: Extract<AppView, { type: 'playlist' }> | null } = {}) {
  const pageMotion = usePageTransition()
  const present = useIsPresent()
  const current = useNavigationStore(state => state.currentView === 'explore')
  const active = present && current && !detail
  const { sources: enabledSources, current: activeHomeSource } = useContentProvider()
  const accountSession = activeHomeSource ? providerAccountSession(activeHomeSource) : 0
  const [preview, setPreview] = useState<Playlist | null>(null)
  const previousSourceRef = useRef(activeHomeSource)
  const pageRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const restoringScrollRef = useRef(false)

  const previousSource = previousSourceRef.current
  const previousIndex = previousSource ? enabledSources.indexOf(previousSource) : 0
  const activeIndex = activeHomeSource ? enabledSources.indexOf(activeHomeSource) : 0
  const switchDirection = activeIndex >= previousIndex ? 1 : -1

  useEffect(() => {
    previousSourceRef.current = activeHomeSource
  }, [activeHomeSource])

  // 来源页会为封面转场保留；挂到 body 的预览必须随导航单独关闭。
  useEffect(() => {
    if (!active) setPreview(null)
  }, [active])

  useLayoutEffect(() => {
    const page = pageRef.current
    const content = contentRef.current
    const saved = activeHomeSource ? scrollPositions.get(activeHomeSource) : undefined
    const target = activeHomeSource && saved?.session === accountSession ? saved.top : 0
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
    timeout = setTimeout(cancel, 5000)
    return () => {
      cancel()
    }
  }, [activeHomeSource, accountSession, detail])

  if (detail) {
    return <PlaylistDetailView playlist={detail.playlist} initialTracks={detail.tracks} layoutIdPrefix="explore-cover" />
  }

  return (
    <ExploreScrollActivity scrollRef={pageRef}>
    <motion.div layoutScroll ref={pageRef} className={`${styles.page} ${pageScroll.viewport}`} onScroll={(event) => {
      if (activeHomeSource && !restoringScrollRef.current) scrollPositions.set(activeHomeSource, { session: providerAccountSession(activeHomeSource), top: event.currentTarget.scrollTop })
    }}>

      <motion.header
        className={styles.intro}
      >
        <p className={styles.kicker}>YOUR MUSIC CONSTELLATION</p>
        <h1 className={styles.greeting}><GradientText>{greeting()}</GradientText></h1>
      </motion.header>

      {activeHomeSource ? (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            ref={contentRef}
            key={`${activeHomeSource}:${accountSession}`}
            initial={{ opacity: 0, x: switchDirection * 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: switchDirection * -12 }}
            transition={pageMotion(pageTransition)}
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
      <PlaylistPreviewModal playlist={active ? preview : null} onClose={() => setPreview(null)} />
    </motion.div>
    </ExploreScrollActivity>
  )
}
