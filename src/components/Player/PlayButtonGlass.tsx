import { useId } from 'react'
import styles from './PlayButtonGlass.module.css'

/**
 * 播放键玻璃：与我的库分段控件的透镜同一套语言——内部完全通透，不加填充、模糊或额外光带，
 * 只留一道上亮下弱的渐变细边表现玻璃厚度。播放图标和点击区域仍由 PlayerBar 持有。
 */
export function PlayButtonGlass() {
  const rimId = useId()
  return <span className={styles.surface} aria-hidden="true">
    <svg className={styles.rim} viewBox="0 0 44 44">
      <defs><linearGradient id={rimId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="white" stopOpacity="0.5" />
        <stop offset="0.45" stopColor="white" stopOpacity="0.06" />
        <stop offset="1" stopColor="white" stopOpacity="0.2" />
      </linearGradient></defs>
      <circle cx="22" cy="22" r="21.5" fill="none" stroke={`url(#${rimId})`} strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  </span>
}
