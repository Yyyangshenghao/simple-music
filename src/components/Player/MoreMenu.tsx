import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { usePlayerStore } from '../../stores/player'
import { useSleepTimerStore } from '../../stores/sleep-timer'
import { fetchTrackQualities, type TrackQualityOption } from '../../lib/track-qualities'
import { tapScale, springSnappy, springGentle } from '../../lib/motion-presets'
import type { AudioQuality } from '../../types/domain'
import styles from './MoreMenu.module.css'

const QUALITY_LABELS: Record<AudioQuality, string> = {
  standard: '标准',
  higher: '较高',
  exhigh: '极高',
  lossless: '无损',
  hires: '臻音',
  jyeffect: '鲸云',
  sky: '环绕',
  jymaster: '母带',
  aac: 'AAC',
  max: '最高'
}

const RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 2]
const SLEEP_PRESETS = [15, 30, 60, 90]

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  )
}

function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 音质分区:面板打开时探测当前曲目真实可得的档位,选中即切偏好并热重载。 */
function QualitySection({ open }: { open: boolean }) {
  const quality = usePlayerStore((s) => s.quality)
  const setQuality = usePlayerStore((s) => s.setQuality)
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const currentQuality = usePlayerStore((s) => s.currentQuality)
  // null = 检测中;[] = 无可选档(本地音乐/探测失败)
  const [options, setOptions] = useState<TrackQualityOption[] | null>(null)
  const fetchSession = useRef(0)

  const trackKey = currentTrack ? `${currentTrack.source}:${String(currentTrack.mid ?? currentTrack.id ?? '')}` : ''

  // 打开或换曲时探测;晚到的过期响应丢弃
  useEffect(() => {
    if (!open) return
    const session = ++fetchSession.current
    setOptions(null)
    const track = usePlayerStore.getState().currentTrack
    if (!track) {
      setOptions([])
      return
    }
    fetchTrackQualities(track)
      .then((list) => {
        if (session === fetchSession.current) setOptions(list)
      })
      .catch(() => {
        if (session === fetchSession.current) setOptions([])
      })
  }, [open, trackKey])

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>音质</span>
        <span className={styles.sectionStatus}>
          {currentQuality ? `当前播放:${currentQuality}` : QUALITY_LABELS[quality]}
        </span>
      </div>
      <div className={styles.chips}>
        <button
          type="button"
          className={styles.chip}
          data-on={quality === 'max'}
          onClick={() => setQuality('max')}
          title="自动取本曲最高档"
        >
          最高
        </button>
        {options == null ? (
          <span className={styles.tip}>检测中…</span>
        ) : options.length === 0 ? (
          <span className={styles.tip}>本曲无可选档位</span>
        ) : (
          options.map((opt) => (
            <button
              key={opt.level}
              type="button"
              className={styles.chip}
              data-on={quality === opt.level}
              onClick={() => setQuality(opt.level as AudioQuality)}
              title={opt.br ? `${Math.round(opt.br / 1000)} kbps` : opt.label}
            >
              {opt.label}
            </button>
          ))
        )}
      </div>
    </section>
  )
}

/** 倍速分区:整档切换,保留音高。 */
function RateSection() {
  const rate = usePlayerStore((s) => s.rate)
  const setRate = usePlayerStore((s) => s.setRate)
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>倍速</span>
        <span className={styles.sectionStatus}>{rate}x</span>
      </div>
      <div className={styles.rateChips}>
        {RATE_OPTIONS.map((r) => (
          <button key={r} type="button" className={styles.chip} data-on={rate === r} onClick={() => setRate(r)}>
            {r}x
          </button>
        ))}
      </div>
    </section>
  )
}

/** 定时关闭分区:预设时长倒计时到点停播,可选播完当前曲再停。 */
function SleepSection() {
  const phase = useSleepTimerStore((s) => s.phase)
  const remainingSec = useSleepTimerStore((s) => s.remainingSec)
  const finishTrack = useSleepTimerStore((s) => s.finishTrack)
  const active = phase !== 'idle'

  const statusText =
    phase === 'counting'
      ? `${formatCountdown(remainingSec)} 后停止`
      : phase === 'finishing-track'
        ? '播完当前曲后停止'
        : '未开启'

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>定时关闭</span>
        <span className={styles.sectionStatus}>{statusText}</span>
      </div>
      <div className={styles.chips}>
        {SLEEP_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            className={styles.chip}
            onClick={() => useSleepTimerStore.getState().start(m)}
          >
            {m} 分
          </button>
        ))}
        {active && (
          <button type="button" className={styles.chip} onClick={() => useSleepTimerStore.getState().cancel()}>
            取消
          </button>
        )}
      </div>
      <button
        type="button"
        className={styles.optionRow}
        data-on={finishTrack}
        onClick={() => useSleepTimerStore.getState().setFinishTrack(!finishTrack)}
      >
        <span>到点后播完当前曲</span>
        <span className={styles.optionState}>{finishTrack ? '开' : '关'}</span>
      </button>
    </section>
  )
}

/** 「更多」菜单:把不常用的音质 / 倍速 / 定时关闭整合到一个弹层,给播放栏右侧腾出空间。 */
export function MoreMenu() {
  const [open, setOpen] = useState(false)
  const rate = usePlayerStore((s) => s.rate)
  const sleepPhase = useSleepTimerStore((s) => s.phase)
  const rootRef = useRef<HTMLDivElement>(null)

  const hasActive = rate !== 1 || sleepPhase !== 'idle'

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

  return (
    <div className={styles.root} ref={rootRef}>
      <motion.button
        type="button"
        className={`${styles.toggleBtn} no-drag`}
        data-active={open || hasActive}
        onClick={() => setOpen((v) => !v)}
        title="更多:音质 / 倍速 / 定时关闭"
        aria-label="更多"
        aria-expanded={open}
        whileTap={tapScale}
        transition={springSnappy}
      >
        <MoreIcon />
        {hasActive && <span className={styles.activeDot} aria-hidden="true" />}
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
            <QualitySection open={open} />
            <RateSection />
            <SleepSection />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
