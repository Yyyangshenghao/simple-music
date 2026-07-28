import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ShuangeCard } from '../components/Shuange/ShuangeCard'
import { useShuangeStore } from '../stores/shuange'
import { useShuangePlayer } from '../hooks/useShuangePlayer'
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