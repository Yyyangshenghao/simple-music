import { useEffect, useRef, useState } from 'react'
import styles from './HeartIcon.module.css'

const HEART_PATH = 'M12 20.1c-.21 0-.42-.07-.59-.21C6.43 15.86 3 12.78 3 9.03 3 6.3 5.08 4.25 7.68 4.25c1.74 0 3.3.9 4.32 2.33 1.02-1.43 2.58-2.33 4.32-2.33 2.6 0 4.68 2.05 4.68 4.78 0 3.75-3.43 6.83-8.41 10.86-.17.14-.38.21-.59.21z'

/**
 * 红心图标:filled 时纯色实心,否则细描边;颜色取自 currentColor。
 * 从未点亮切到点亮时做一次轻微回弹(首次挂载不播)。供 PlayerBar / TrackRow 等红心按钮复用。
 */
export function HeartIcon({ filled, size = 17 }: { filled: boolean; size?: number }) {
  const [pop, setPop] = useState(0)
  const prevFilled = useRef(filled)

  useEffect(() => {
    if (filled && !prevFilled.current) setPop((n) => n + 1)
    prevFilled.current = filled
  }, [filled])

  return (
    <svg
      key={pop}
      className={styles.heart}
      data-filled={filled}
      data-pop={pop > 0 || undefined}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <path d={HEART_PATH} transform="translate(-1.08 -0.96) scale(1.09)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}
