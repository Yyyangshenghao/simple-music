import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useSleepTimerStore } from '../../stores/sleep-timer'
import { tapScale, springSnappy, springGentle } from '../../lib/motion-presets'
import styles from './SleepTimerButton.module.css'

const PRESET_MINUTES = [15, 30, 60, 90]

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 睡眠定时器按钮 + 弹层:预设时长倒计时到点停播,可选播完当前曲再停。 */
export function SleepTimerButton() {
  const [open, setOpen] = useState(false)
  const phase = useSleepTimerStore((s) => s.phase)
  const remainingSec = useSleepTimerStore((s) => s.remainingSec)
  const finishTrack = useSleepTimerStore((s) => s.finishTrack)
  const rootRef = useRef<HTMLDivElement>(null)

  const active = phase !== 'idle'

  // Esc 关闭 + 点击弹层/按钮之外关闭(与 QueuePanel 同款交互)
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const statusText =
    phase === 'counting'
      ? `${formatCountdown(remainingSec)} 后${finishTrack ? '播完当前曲' : ''}停止`
      : phase === 'finishing-track'
        ? '播完当前曲后停止'
        : '未开启'

  return (
    <div className={styles.root} ref={rootRef}>
      <motion.button
        type="button"
        className={`${styles.toggleBtn} no-drag`}
        data-active={open || active}
        onClick={() => setOpen((v) => !v)}
        title={`定时关闭:${statusText}`}
        aria-label="定时关闭"
        aria-expanded={open}
        whileTap={tapScale}
        transition={springSnappy}
      >
        <MoonIcon />
        {phase === 'counting' && <span className={styles.countdown}>{formatCountdown(remainingSec)}</span>}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.panel}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={springGentle}
          >
            <div className={styles.header}>
              <span className={styles.title}>定时关闭</span>
              <span className={styles.status}>{statusText}</span>
            </div>
            <div className={styles.presets}>
              {PRESET_MINUTES.map((m) => (
                <button
                  key={m}
                  className={styles.preset}
                  onClick={() => useSleepTimerStore.getState().start(m)}
                >
                  {m} 分钟
                </button>
              ))}
            </div>
            <button
              className={styles.optionRow}
              data-on={finishTrack}
              onClick={() => useSleepTimerStore.getState().setFinishTrack(!finishTrack)}
            >
              <span>到点后播完当前曲</span>
              <span className={styles.optionState}>{finishTrack ? '开' : '关'}</span>
            </button>
            {active && (
              <button className={styles.cancelBtn} onClick={() => useSleepTimerStore.getState().cancel()}>
                取消定时
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
