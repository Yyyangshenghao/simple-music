import { useEffect } from 'react'
import { motion } from 'motion/react'
import { tapScale } from '../../lib/motion-presets'
import { useShuangeStore } from '../../stores/shuange'
import { usePlayerStore } from '../../stores/player'
import { useLikesStore, likeKeyOf } from '../../stores/likes'
import { CoverParticleCloud } from '../Visualizer/CoverParticleCloud'
import styles from './ShuangeCard.module.css'

export function ShuangeCard() {
  const track = usePlayerStore((s) => s.currentTrack)
  const status = usePlayerStore((s) => s.status)
  const toggle = usePlayerStore((s) => s.toggle)
  const next = useShuangeStore((s) => s.next)
  const prev = useShuangeStore((s) => s.prev)
  const playFull = useShuangeStore((s) => s.playFullCurrent)
  const leave = useShuangeStore((s) => s.leave)
  const liked = useLikesStore((s) => track ? (s.likedByKey[likeKeyOf(track)] ?? false) : false)
  const supports = useLikesStore((s) => s.supports)

  useEffect(() => {
    if (track) void useLikesStore.getState().ensureChecked(track)
  }, [track])

  return (
    <motion.div className={styles.card} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className={styles.bg}><CoverParticleCloud coverUrl={track?.cover} /></div>
      <div className={styles.scrim} />
      <div className={styles.body}>
        <div className={styles.meta}>
          <div className={styles.title}>{track?.name ?? '加载中'}</div>
          <div className={styles.artist}>{track?.artist}</div>
        </div>
        <div className={styles.actions}>
          <motion.button whileTap={tapScale} onClick={() => void toggle()} aria-label={status === 'playing' ? '暂停' : '播放'}>
            {status === 'playing' ? '❚❚' : '▶'}
          </motion.button>
          <motion.button whileTap={tapScale} onClick={() => void prev()} aria-label="上一首">↑</motion.button>
          <motion.button whileTap={tapScale} onClick={() => void next()} aria-label="下一首">↓</motion.button>
          {track && supports(track) && (
            <motion.button whileTap={tapScale} onClick={() => void useLikesStore.getState().toggleLike(track)} aria-label="红心">
              {liked ? '♥' : '♡'}
            </motion.button>
          )}
          <motion.button whileTap={tapScale} onClick={playFull} aria-label="播放全曲">全曲</motion.button>
          <motion.button whileTap={tapScale} onClick={leave} aria-label="退出">退出</motion.button>
        </div>
      </div>
    </motion.div>
  )
}