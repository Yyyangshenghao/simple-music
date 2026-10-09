import { AnimatePresence, motion } from 'motion/react'
import { useBackdropStore } from '../../stores/backdrop'
import styles from './DetailBackdrop.module.css'

/** 歌单/歌手详情页的全局模糊封面背景:渲染在 App 根部,铺满整个应用(含 TopBar 区域)。
 * 仅当某个详情页写入 cover 时才显示,列表/探索等页面沿用原本的氛围背景。 */
export function DetailBackdrop() {
  const cover = useBackdropStore((s) => s.cover)
  const variant = useBackdropStore((s) => s.variant)

  return (
    <div className={styles.root} aria-hidden="true">
      <AnimatePresence>
        {cover && (
          <motion.div
            key={`${variant}:${cover}`}
            className={`${styles.scene} ${variant === 'artist' ? styles.artist : ''}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className={styles.layer} style={{ backgroundImage: `url(${cover})` }} />
            <div className={styles.scrim} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
