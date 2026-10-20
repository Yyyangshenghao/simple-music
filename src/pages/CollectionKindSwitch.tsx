import { motion } from 'motion/react'
import { springSnappy } from '../lib/motion-presets'
import styles from './CollectionKindSwitch.module.css'

export type CollectionKind = 'collected' | 'albums'

const OPTIONS: { value: CollectionKind; label: string; icon: JSX.Element }[] = [
  { value: 'collected', label: '歌单', icon: <path d="M4 6h11M4 11h11M4 16h6M17.5 18.5V9.5l3 1.2M17.5 18.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" /> },
  { value: 'albums', label: '专辑', icon: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.4" /></> },
]

/** 收藏页内的二级分段：与主页签同属玻璃体系，但更轻，不使用强调色以免与主导航争层级。 */
export function CollectionKindSwitch({ value, onChange }: { value: CollectionKind; onChange(value: CollectionKind): void }) {
  return (
    <div className={`${styles.track} no-drag`} role="group" aria-label="收藏类型">
      {OPTIONS.map(option => {
        const active = option.value === value
        return (
          <button key={option.value} type="button" className={styles.option} aria-pressed={active}
            onClick={() => { if (!active) onChange(option.value) }}>
            {active && <motion.span layoutId="collection-kind-pill" className={styles.pill} transition={springSnappy} />}
            <svg className={styles.icon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{option.icon}</svg>
            <span className={styles.label}>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
