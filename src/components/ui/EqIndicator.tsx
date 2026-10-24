import styles from './EqIndicator.module.css'

/** 迷你均衡器：当前曲目标记，播放时 3 根柱跳动，暂停时定格。 */
export function EqIndicator({ paused }: { paused: boolean }) {
  return (
    <span className={`${styles.eq}${paused ? ` ${styles.eqPaused}` : ''}`} aria-hidden="true">
      <i /><i /><i />
    </span>
  )
}
