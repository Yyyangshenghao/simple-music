import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useOfflineCacheStore } from '../../stores/offline-cache'
import styles from './OfflineSaveStatus.module.css'

export function OfflineSaveStatus() {
  const job = useOfflineCacheStore((state) => state.job)
  useEffect(() => {
    if (!job || (job.status !== 'done' && job.status !== 'failed')) return
    const timer = window.setTimeout(() => useOfflineCacheStore.getState().dismissJob(), 4000)
    return () => window.clearTimeout(timer)
  }, [job])
  const label = job?.status === 'resolving'
    ? '正在寻找可保存音源…'
    : job?.status === 'saving'
      ? '正在保存到本地…'
      : job?.status === 'done'
        ? '已保存到本地'
        : '保存失败'
  return (
    <AnimatePresence>
      {job && (
        <motion.div
          className={styles.status}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
        >
          <span className={styles.info}>
            <strong>{job.track.name}</strong>
            <span>{label}</span>
          </span>
          {(job.status === 'resolving' || job.status === 'saving') ? (
            <button type="button" onClick={() => useOfflineCacheStore.getState().cancelSave()}>取消</button>
          ) : (
            <button type="button" onClick={() => useOfflineCacheStore.getState().dismissJob()}>关闭</button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
