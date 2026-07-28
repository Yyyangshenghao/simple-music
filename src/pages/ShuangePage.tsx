import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ShuangeCard } from '../components/Shuange/ShuangeCard'
import { useShuangeStore } from '../stores/shuange'
import { useShuangePlayer } from '../hooks/useShuangePlayer'
import { usePlayerStore } from '../stores/player'
import { useLikesStore } from '../stores/likes'
import { useNavigationStore } from '../stores/navigation'
import styles from './ShuangePage.module.css'

export function ShuangePage() {
  const enter = useShuangeStore((s) => s.enter)
  const active = useShuangeStore((s) => s.active)
  const loading = useShuangeStore((s) => s.loading)
  const error = useShuangeStore((s) => s.error)
  useShuangePlayer()

  useEffect(() => {
    if (!active) void enter()
    return () => {
      // 离开页面时若仍 active,交还播放器
      if (useShuangeStore.getState().active) useShuangeStore.getState().leave()
    }
  }, [active, enter])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const st = useShuangeStore.getState()
      const player = usePlayerStore.getState()
      if (e.key === 'ArrowDown') { e.preventDefault(); void st.next() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); void st.prev() }
      else if (e.key === ' ') { e.preventDefault(); player.toggle() }
      else if (e.key === 'Escape') {
        st.leave()
        useNavigationStore.getState().navigateTo('explore')
      }
      else if (e.key === 'f' || e.key === 'F') { st.playFullCurrent() }
      else if ((e.key === 'l' || e.key === 'L') && player.currentTrack) {
        const likes = useLikesStore.getState()
        if (likes.supports(player.currentTrack)) void likes.toggleLike(player.currentTrack)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  return (
    <div className={styles.page}>
      <AnimatePresence mode="popLayout">
        {active && !loading && <motion.div key="card" className={styles.slide}><ShuangeCard /></motion.div>}
      </AnimatePresence>
      {loading && <div className={styles.hint}>加载中…</div>}
      {error && <div className={styles.hint}>{error}</div>}
    </div>
  )
}