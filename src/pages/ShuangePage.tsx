import { useCallback, useEffect, useRef } from 'react'
import { motion, type PanInfo } from 'motion/react'
import { ShuangeCard } from '../components/Shuange/ShuangeCard'
import { useShuangeStore } from '../stores/shuange'
import { useShuangePlayer } from '../hooks/useShuangePlayer'
import { usePlayerStore } from '../stores/player'
import { useLikesStore } from '../stores/likes'
import { useNavigationStore } from '../stores/navigation'
import styles from './ShuangePage.module.css'

export function ShuangePage() {
  const active = useShuangeStore((s) => s.active)
  const feed = useShuangeStore((s) => s.feed)
  const index = useShuangeStore((s) => s.index)
  const direction = useShuangeStore((s) => s.direction)
  const loading = useShuangeStore((s) => s.loading)
  const error = useShuangeStore((s) => s.error)
  const track = feed[index]
  const wheelDistance = useRef(0)
  const wheelReset = useRef<number | null>(null)
  const gestureUnlock = useRef<number | null>(null)
  const gestureLocked = useRef(false)
  useShuangePlayer()

  const exit = useCallback(() => {
    const navigation = useNavigationStore.getState()
    useShuangeStore.getState().leave()
    if (navigation.history.length) navigation.goBack()
    else navigation.navigateTo('explore')
  }, [])

  const step = useCallback((nextDirection: 1 | -1) => {
    const state = useShuangeStore.getState()
    if (!state.active || gestureLocked.current) return
    if (nextDirection < 0 && state.index <= 0) return
    gestureLocked.current = true
    gestureUnlock.current = window.setTimeout(() => {
      gestureLocked.current = false
      gestureUnlock.current = null
    }, 300)
    if (nextDirection > 0) void state.next()
    else void state.prev()
  }, [])

  // mount 进一次、unmount leave 一次；active 不能作为依赖，否则 enter/cleanup 会互相触发。
  const enterOnce = useRef(false)
  useEffect(() => {
    if (!enterOnce.current) {
      enterOnce.current = true
      if (!useShuangeStore.getState().active) void useShuangeStore.getState().enter()
    }
    return () => {
      if (wheelReset.current != null) window.clearTimeout(wheelReset.current)
      if (gestureUnlock.current != null) window.clearTimeout(gestureUnlock.current)
      if (useShuangeStore.getState().active) useShuangeStore.getState().leave()
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      const shuange = useShuangeStore.getState()
      const player = usePlayerStore.getState()
      if (event.key === 'ArrowDown') { event.preventDefault(); step(1) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); step(-1) }
      else if (event.key === ' ') {
        event.preventDefault()
        if (!shuange.loading && player.status !== 'loading') player.toggle()
      }
      else if (event.key === 'Escape') exit()
      else if (event.key === 'f' || event.key === 'F') shuange.playFullCurrent()
      else if (event.key === 'l' || event.key === 'L') {
        const target = shuange.feed[shuange.index]
        if (!target) return
        if (useLikesStore.getState().supports(target)) void shuange.toggleLike(target)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, exit, step])

  function handleWheel(event: React.WheelEvent) {
    if (Math.abs(event.deltaY) < 2) return
    wheelDistance.current += event.deltaY
    if (wheelReset.current != null) window.clearTimeout(wheelReset.current)
    wheelReset.current = window.setTimeout(() => { wheelDistance.current = 0 }, 160)
    if (Math.abs(wheelDistance.current) < 64) return
    const nextDirection = wheelDistance.current > 0 ? 1 : -1
    wheelDistance.current = 0
    step(nextDirection)
  }

  function handleDragEnd(_: PointerEvent, info: PanInfo) {
    if (info.offset.y < -70 || info.velocity.y < -650) step(1)
    else if (info.offset.y > 70 || info.velocity.y > 650) step(-1)
  }

  return (
    <div className={styles.page} onWheel={handleWheel}>
      {active && track && (
        <motion.div
          key={`${track.source}-${String(track.id)}`}
          className={styles.slide}
          initial={{ opacity: 0.2, y: direction > 0 ? '20%' : '-20%', scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={0.13}
          onDragEnd={handleDragEnd}
        >
          <ShuangeCard track={track} switching={loading} onExit={exit} />
        </motion.div>
      )}

      {loading && !track && (
        <div className={styles.loading} role="status">
          <span className={styles.loadingMark} />
          <strong>正在挑一段好听的</strong>
          <span>从今日推荐里寻找副歌与重复段</span>
        </div>
      )}

      {error && !track && (
        <div className={styles.error} role="alert">
          <strong>{error}</strong>
          <button type="button" onClick={() => void useShuangeStore.getState().enter()}>再试一次</button>
        </div>
      )}
    </div>
  )
}
