import { AnimatePresence, motion } from 'motion/react'
import { usePlayerStore } from '../../stores/player'
import { SOURCE_BRAND } from '../../lib/source-brand'
import { iconSwap } from '../../lib/motion-presets'
import styles from './SourceFallbackBadge.module.css'

/** 跨音源兜底徽标:原音源放不了、实际从对侧音源出声时显示,提示用户当前音频来源。 */
export function SourceFallbackBadge() {
  const fallbackSource = usePlayerStore((s) => s.fallbackSource)

  return (
    <AnimatePresence initial={false}>
      {fallbackSource && (
        <motion.span
          className={styles.badge}
          data-source={fallbackSource}
          title={`原音源无法播放，已从${SOURCE_BRAND[fallbackSource].label}换源`}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={iconSwap}
        >
          {SOURCE_BRAND[fallbackSource].label}
        </motion.span>
      )}
    </AnimatePresence>
  )
}
