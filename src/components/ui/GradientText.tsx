import type { ReactNode } from 'react'
import { useSettingsStore } from '../../stores/settings'
import styles from './GradientText.module.css'

/** 氛围渐变文字：静态渐变叠加合成层呼吸，随 --ambient-* 切歌变色。 */
export function GradientText({ children }: { children: ReactNode }) {
  const motionOn = useSettingsStore((s) => s.performance.gradientTextMotion)
  return <span className={`${styles.gradient}${motionOn ? '' : ` ${styles.static}`}`}>{children}</span>
}
