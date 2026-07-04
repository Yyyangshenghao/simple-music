import type { ReactNode } from 'react'
import styles from './GradientText.module.css'

/** 氛围渐变文字：background-clip 流动渐变，随 --ambient-* 切歌变色。 */
export function GradientText({ children }: { children: ReactNode }) {
  return <span className={styles.gradient}>{children}</span>
}
