import { usePlayerStore } from '../../stores/player'
import type { AudioQuality } from '../../types/domain'
import styles from './QualityBadge.module.css'

const ORDER: AudioQuality[] = ['standard', 'higher', 'exhigh', 'lossless']

const LABELS: Record<AudioQuality, string> = {
  standard: '标准',
  higher: '较高',
  exhigh: '极高',
  lossless: '无损'
}

/** 音质徽标：点击在 standard→higher→exhigh→lossless 间循环切换。 */
export function QualityBadge() {
  const quality = usePlayerStore((s) => s.quality)
  const setQuality = usePlayerStore((s) => s.setQuality)

  function cycle() {
    const idx = ORDER.indexOf(quality)
    const next = ORDER[(idx + 1) % ORDER.length]
    setQuality(next)
  }

  return (
    <button
      type="button"
      className={`${styles.badge} no-drag`}
      data-quality={quality}
      onClick={cycle}
      title={`音质：${LABELS[quality]}（点击切换）`}
    >
      {LABELS[quality]}
    </button>
  )
}
