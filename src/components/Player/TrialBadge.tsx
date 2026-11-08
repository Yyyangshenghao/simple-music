import { usePlayerStore } from '../../stores/player'
import { SOURCE_BRAND } from '../../lib/source-brand'
import styles from './TrialBadge.module.css'

/** 平台只给片段时如实标明，否则听到一半结束会被当成播放故障。 */
export function TrialBadge() {
  const resolution = usePlayerStore((s) => s.resolution)
  if (!resolution?.trial) return null
  const hint = `${SOURCE_BRAND[resolution.actualSource].label}只提供试听片段，完整版请到官方 App 收听`
  return (
    <span className={styles.slot}>
      <span className={styles.badge} title={hint} aria-label={hint}>试听</span>
    </span>
  )
}
