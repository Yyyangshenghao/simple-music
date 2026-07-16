import { usePlayerStore } from '../../stores/player'
import styles from './RateBadge.module.css'

const ORDER = [1, 1.25, 1.5, 2, 0.75]

function label(rate: number): string {
  return `${rate}x`
}

/** 倍速徽标:点击在 1x→1.25x→1.5x→2x→0.75x 间循环切换(保留音高)。 */
export function RateBadge() {
  const rate = usePlayerStore((s) => s.rate)
  const setRate = usePlayerStore((s) => s.setRate)

  function cycle() {
    const idx = ORDER.indexOf(rate)
    setRate(ORDER[(idx + 1) % ORDER.length])
  }

  return (
    <button
      type="button"
      className={`${styles.badge} no-drag`}
      data-active={rate !== 1}
      onClick={cycle}
      title={`播放速度:${label(rate)}（点击切换）`}
    >
      {label(rate)}
    </button>
  )
}
