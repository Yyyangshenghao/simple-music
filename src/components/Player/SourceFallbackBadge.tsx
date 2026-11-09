import { AnimatePresence, motion } from 'motion/react'
import { usePlayerStore } from '../../stores/player'
import { iconSwap } from '../../lib/motion-presets'
import { useProviderStore } from '../../stores/providers'
import { SourceBadge } from '../ui/SourceBadge'
import { usePageTransition } from '../../hooks/useMotion'
import { accompanimentId } from '../../lib/karaoke-library'
import styles from './SourceFallbackBadge.module.css'

/** 紧跟歌手名的实际音源标识。伴奏不显示；普通播放按常显或动态来源设置展示。 */
export function SourceFallbackBadge() {
  const pageTransition = usePageTransition()
  const actualSource = usePlayerStore((s) => s.actualSource)
  const originSource = usePlayerStore((s) => s.currentTrack?.source)
  const accompaniment = usePlayerStore((s) => !!s.accompaniment || !!(s.currentTrack && accompanimentId(s.currentTrack)))
  const mode = useProviderStore((s) => s.sourceBadgeMode)
  const visible = !accompaniment && !!actualSource && mode !== 'hidden' && (mode === 'always' || actualSource !== originSource)

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.span
          key={actualSource}
          className={styles.slot}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={pageTransition(iconSwap)}
        >
          <SourceBadge source={actualSource} compact displayMode="always" />
        </motion.span>
      )}
    </AnimatePresence>
  )
}
