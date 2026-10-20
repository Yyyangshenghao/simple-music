import { AnimatePresence, motion } from 'motion/react'
import { useActionToastStore, useToastStore } from '../../stores/toast'
import { springGentle } from '../../lib/motion-presets'
import styles from './Toast.module.css'

/** 全局轻提示:播放受限等一次性消息,底部居中淡入淡出,自动消失。 */
export function Toast() {
  const message = useToastStore((s) => s.message)
  const notification = useActionToastStore((s) => s.notification)

  return (
    <div className={styles.root} aria-live="polite">
      <AnimatePresence>
        {notification && (
          <motion.div
            key="action"
            className={`${styles.card} ${styles.actionCard}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={springGentle}
          >
            <span>{notification.message}</span>
            <button type="button" onClick={() => useActionToastStore.getState().activate()}>{notification.label}</button>
          </motion.div>
        )}
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
