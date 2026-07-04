import { useRef } from 'react'
import { motion, useInView } from 'motion/react'
import type { Track } from '../../types/domain'
import { TrackRow } from './TrackRow'
import styles from './AnimatedTrackRow.module.css'

interface AnimatedTrackRowProps {
  track: Track
  index: number
  onPlay(): void
  delay?: number
}

export function AnimatedTrackRow({ track, index, onPlay, delay = 0.1 }: AnimatedTrackRowProps) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.1, once: true })

  return (
    <motion.div
      ref={ref}
      className={styles.wrapper}
      initial={{ scale: 0.7, opacity: 0 }}
      animate={inView ? { scale: 1, opacity: 1 } : { scale: 0.7, opacity: 0 }}
      transition={{ duration: 0.2, delay: Math.min(delay, 0.4) }}
    >
      <TrackRow track={track} index={index} onPlay={onPlay} />
    </motion.div>
  )
}
