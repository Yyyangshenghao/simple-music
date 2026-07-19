import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { usePlayerStore } from '../../stores/player'
import { fetchTrackQualities, type TrackQualityOption } from '../../lib/track-qualities'
import { springGentle } from '../../lib/motion-presets'
import type { AudioQuality } from '../../types/domain'
import styles from './QualityBadge.module.css'

const LABELS: Record<AudioQuality, string> = {
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

/**
 * 音质徽标:点击弹出当前曲目真实可得的档位选单(服务端逐档探测,没有无损就不列无损),
 * 选中即切全局音质偏好并热重载当前曲目;「最高」为自动档,逐曲取实际最高。
 */
export function QualityBadge() {
  const quality = usePlayerStore((s) => s.quality)
  const setQuality = usePlayerStore((s) => s.setQuality)
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const currentQuality = usePlayerStore((s) => s.currentQuality)
  const [open, setOpen] = useState(false)
  // null = 检测中;[] = 无可选档(本地音乐/探测失败)
  const [options, setOptions] = useState<TrackQualityOption[] | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const fetchSession = useRef(0)

  const trackKey = currentTrack ? `${currentTrack.source}:${String(currentTrack.mid ?? currentTrack.id ?? '')}` : ''

  // 弹层打开或换曲时探测当前曲目的真实档位;晚到的过期响应丢弃
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

  // Esc 关闭 + 点击弹层/按钮之外关闭(与 SleepTimerButton 同款交互)
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

  function pick(q: AudioQuality) {
    setQuality(q)
    setOpen(false)
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.badge} no-drag`}
        data-quality={quality}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={`音质偏好:${LABELS[quality]}${currentQuality ? `(当前播放:${currentQuality})` : ''}`}
      >
        {LABELS[quality]}
      </button>

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
              <span className={styles.title}>音质</span>
              {currentQuality && <span className={styles.status}>当前播放:{currentQuality}</span>}
            </div>
            <button className={styles.option} data-on={quality === 'max'} onClick={() => pick('max')}>
              <span>最高</span>
              <span className={styles.optionHint}>自动取本曲最高档</span>
            </button>
            {options == null ? (
              <div className={styles.tip}>正在检测本曲可用档位…</div>
            ) : options.length === 0 ? (
              <div className={styles.tip}>本曲无可选档位</div>
            ) : (
              options.map((opt) => (
                <button
                  key={opt.level}
                  className={styles.option}
                  data-on={quality === opt.level}
                  onClick={() => pick(opt.level as AudioQuality)}
                >
                  <span>{opt.label}</span>
                  {opt.br ? <span className={styles.optionHint}>{Math.round(opt.br / 1000)} kbps</span> : null}
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
