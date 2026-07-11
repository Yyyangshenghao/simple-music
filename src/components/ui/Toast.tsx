import { AnimatePresence, motion } from 'motion/react'
import { useToastStore } from '../../stores/toast'
import { springGentle } from '../../lib/motion-presets'
import styles from './Toast.module.css'

/** 全局轻提示:播放受限等一次性消息,底部居中淡入淡出,自动消失。 */
export function Toast() {
  const message = useToastStore((s) => s.message)

  return (
    <div className={styles.root} aria-live="polite">
      <AnimatePresence>
        {message && (
          <motion.div
            key={message}
            className={styles.card}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={springGentle}
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
