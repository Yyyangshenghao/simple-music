import { AnimatePresence, motion } from 'motion/react'
import { usePlayerStore } from '../../stores/player'
import { iconSwap } from '../../lib/motion-presets'
import { useProviderStore } from '../../stores/providers'
import { SourceBadge } from '../ui/SourceBadge'

/** 播放来源徽标：常显模式始终展示，动态模式仅在实际音源与内容来源不同时展示。 */
export function SourceFallbackBadge() {
  const actualSource = usePlayerStore((s) => s.actualSource)
  const originSource = usePlayerStore((s) => s.currentTrack?.source)
  const mode = useProviderStore((s) => s.sourceBadgeMode)
  const visible = !!actualSource && mode !== 'hidden' && (mode === 'always' || actualSource !== originSource)

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.span
          key={actualSource}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={iconSwap}
        >
          <SourceBadge source={actualSource} displayMode="always" />
        </motion.span>
      )}
    </AnimatePresence>
  )
}
