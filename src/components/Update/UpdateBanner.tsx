import { AnimatePresence, motion } from 'motion/react'
import { useUpdateStore } from '../../stores/update'
import { springGentle, tapScale } from '../../lib/motion-presets'
import styles from './UpdateBanner.module.css'

/** 顶部更新提示条：检测到新版本时出现，下载/安装走 job 状态机，用户可关闭并记住该版本不再提示。 */
export function UpdateBanner() {
  const info = useUpdateStore((s) => s.info)
  const job = useUpdateStore((s) => s.job)
  const downloading = useUpdateStore((s) => s.downloading)
  const dismissedVersion = useUpdateStore((s) => s.dismissedVersion)
  const startDownload = useUpdateStore((s) => s.startDownload)
  const installUpdate = useUpdateStore((s) => s.installUpdate)
  const installing = useUpdateStore((s) => s.installing)
  const dismiss = useUpdateStore((s) => s.dismiss)

  const visible = !!info?.updateAvailable && info.release.version !== dismissedVersion && !!window.desktop?.isDesktop

  const ready = job?.status === 'ready'
  const errored = job?.status === 'error'

  const actionLabel = ready
    ? installing
      ? '正在安装…'
      : '重启并安装'
    : downloading
      ? `下载中 ${job?.progress ?? 0}%`
      : errored
        ? '重试下载'
        : '下载更新'

  const handleAction = (): void => {
    if (ready) void installUpdate()
    else void startDownload()
  }

  return (
    <div className={styles.root} aria-live="polite">
      <AnimatePresence>
        {visible && info && (
          <motion.div
            className={styles.card}
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={springGentle}
          >
            <div className={styles.text}>
              <span className={styles.title}>发现新版本 v{info.release.version}</span>
              <span className={styles.summary}>{info.release.summary}</span>
            </div>
            {downloading && !ready && (
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${job?.progress ?? 0}%` }} />
              </div>
            )}
            <div className={styles.actions}>
              <motion.button
                className={styles.actionBtn}
                onClick={handleAction}
                whileTap={tapScale}
                transition={springGentle}
                disabled={(downloading && !ready && !errored) || installing}
              >
                {actionLabel}
              </motion.button>
              <button className={styles.dismissBtn} onClick={dismiss} aria-label="关闭更新提示">
                ×
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
