import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ShuangeCard } from '../components/Shuange/ShuangeCard'
import { useShuangeStore } from '../stores/shuange'
import { useShuangePlayer } from '../hooks/useShuangePlayer'
import { usePlayerStore } from '../stores/player'
import { useLikesStore } from '../stores/likes'
import { useNavigationStore } from '../stores/navigation'
import styles from './ShuangePage.module.css'

export function ShuangePage() {
  const active = useShuangeStore((s) => s.active)
  const loading = useShuangeStore((s) => s.loading)
  const error = useShuangeStore((s) => s.error)
  useShuangePlayer()

  // mount 进一次、unmount leave 一次。不能依赖 [active] —— 否则 enter 同步置 active=true
  // 后 effect 重跑、cleanup 调 leave() 翻回 false、body 再 enter() → 无限循环。
  const enterOnce = useRef(false)
  useEffect(() => {
    if (!enterOnce.current) {
      enterOnce.current = true
      if (!useShuangeStore.getState().active) void useShuangeStore.getState().enter()
    }
    return () => {
      if (useShuangeStore.getState().active) useShuangeStore.getState().leave()
    }
  }, [])

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